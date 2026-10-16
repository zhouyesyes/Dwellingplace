// 聊天里他把活交给工作间：回复里写
//   <交给工作间 项目="栖所">要做什么、在哪些文件、做完怎么确认</交给工作间>
// 栖所就在工作间那个项目里开一个任务（和他一起），把说明交给 Codex；聊天里留一条小记，点一下进去看。
// Codex 做完，下次打开工作间那个任务时他会先看一遍结果再告诉你（推上线这类事照样要你点）。
// 一天最多交 DAILY_MAX 次（醒来时交的另算，见中转）
import { store } from "../store/index.js";
import { wr, refresh, newThread, say, thread, listMaterials, listMaterialGroups, changeMaterial, uploadMaterial, editMaterialGroup, forgetMaterials } from "./workroom.js";
export { noteWorkroom } from "./workroom.js";
import { workThread, loadTalk } from "./workTogether.js";

export const WORK_RE = /<交给工作间([^>]*)>([\s\S]*?)<\/交给工作间>/g;
// 标签上的设置：项目="…" 素材="文件夹或文件名，逗号隔开" 带上聊天附件="是"
const attr = (s, k) => (String(s || "").match(new RegExp(`${k}\\s*=\\s*["“「]?([^"”」]+?)["”」]?(?=\\s+[^\\s=]+\\s*=|\\s*$)`)) || [])[1]?.trim() || "";
const DAILY_MAX = 20; // 她活多，5 次不够用（2026-10-16 调到 20）
const today = () => new Date().toDateString();

export function workroomForAI(who) {
  const w = store.settings.workroom;
  if (!w?.projects?.length) return "";
  return [
    `\n# 工作间`,
    `你在${who}的服务器上有一个工作间：Codex（一个写代码、跑命令的工程助手）在里面的项目文件夹里干活。项目：${w.projects.map(p => `「${p}」`).join("、")}${w.projects.includes("栖所") ? "（「栖所」就是你们现在用的这个栖所的代码）" : ""}。`,
    `${who}让你去做、或者你发现栖所哪里坏了想修，可以把活交给工作间：另起一段写 <交给工作间 项目="项目名">要做什么、在哪些文件、做完怎么确认（比如构建、截图看看）、别碰什么</交给工作间>。Codex 看不到你们的聊天，只看得到这段说明，要写清楚。`,
    materialsForAI(who),
    `交过去以后，过程都在工作间里；删东西、装东西这类事 Codex 会等${who}点允许，推上线也要${who}在工作间里点，你只负责说清楚要做什么。一天最多交 ${DAILY_MAX} 次，小事别交，聊天里说说就好。`,
  ].join("\n");
}

// 素材库里有什么（给他看的清单，太长就截）
function materialsForAI(who) {
  const lib = store.workMaterials || {};
  const lines = Object.entries(lib).map(([p, gs]) => `「${p}」：${gs.map(g => `${g.folder ? `文件夹「${g.folder}」` : "没分组的"}（${g.files.slice(0, 12).join("、")}${g.files.length > 12 ? ` 等 ${g.files.length} 个` : ""}）`).join("；")}`);
  return [
    lines.length ? `素材库（${who}存在工作间里的图片和文件）：${lines.join("\n").slice(0, 2500)}` : "",
    `交活时要带上素材，在标签里加 素材="文件夹名或文件名，逗号隔开"；要带上${who}最近在聊天里发给你的图片和文件，加 带上聊天附件="是"（会先存进素材库，再一起交给 Codex）。例如 <交给工作间 项目="栖所" 素材="贴纸" 带上聊天附件="是">…</交给工作间>`,
  ].filter(Boolean).join("\n");
}

// 她最近在聊天里发的附件（最近 20 条里她的，最多 8 个）→ 文件
async function chatFiles(history) {
  const { get } = await import("./kv.js");
  const out = [];
  for (const m of [...(history || [])].slice(-20).reverse()) {
    if (m.from !== "user") continue;
    for (const a of m.attachments || []) {
      if (out.length >= 8) break;
      try {
        if (a.kind === "image") {
          // 聊天里的图存的时候已经转过格式了，扩展名按实际的来（不然 IMG_1.HEIC 会被服务器拒收）
          const b = await get("img:" + a.img);
          const ext = ({ "image/png": "png", "image/gif": "gif", "image/webp": "webp" })[b?.type] || "jpg";
          if (b) out.push(new File([b], `${(a.name || `聊天图片${out.length + 1}`).replace(/\.[^.]+$/, "")}.${ext}`, { type: b.type || "image/jpeg" }));
        }
        else if (a.kind === "pdf") { const b = await get("file:" + a.file); if (b) out.push(new File([b], a.name || "文件.pdf", { type: "application/pdf" })); }
        else if (a.kind === "text") out.push(new File([a.text || ""], /\.(txt|md|csv|json)$/i.test(a.name || "") ? a.name : `${a.name || "文字"}.txt`, { type: "text/plain" }));
      } catch { /* 这个读不出来就跳过 */ }
    }
  }
  return out.reverse();
}

// 把素材（按文件夹名 / 文件名）和聊天附件挂到任务上，返回挂好的附件
async function gatherFiles(project, taskId, want, history) {
  const files = [];
  const names = want.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
  if (names.length) {
    const [{ materials = [] }, { groups = [] }] = await Promise.all([listMaterials(project), listMaterialGroups(project)]);
    const ids = new Set();
    for (const n of names) {
      const g = groups.find(g => g.name === n);
      if (g) g.files.forEach(id => ids.add(id));
      else materials.filter(m => m.name === n || m.name.replace(/\.[^.]+$/, "") === n).forEach(m => ids.add(m.id));
    }
    for (const id of [...ids].slice(0, 30)) files.push(await changeMaterial(project, id, "attach", { taskId }));
  }
  if (history) {
    const fromChat = await chatFiles(history);
    if (fromChat.length) {
      const ids = [];
      for (const f of fromChat) ids.push((await uploadMaterial(project, f, "")).id);
      const r = await editMaterialGroup(project, { action: "create", name: `${new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} 聊天里发的` });
      await editMaterialGroup(project, { action: "append", id: r.groups.at(-1).id, files: ids });
      for (const id of ids) files.push(await changeMaterial(project, id, "attach", { taskId }));
      forgetMaterials();
    }
  }
  return files;
}

// 回复里的 <交给工作间>：开任务、交给 Codex，返回去掉标签的文字和小记
// history：聊天记录（带上聊天附件时用）
export async function applyWorkTags(role, text, history = null) {
  const found = [...String(text || "").matchAll(WORK_RE)];
  if (!found.length) return { text, notes: [] };
  const clean = text.replace(WORK_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  const notes = [];
  const d = (store.workDaily ??= { day: "", n: 0 });
  if (d.day !== today()) Object.assign(d, { day: today(), n: 0 });
  if (!wr.status) await refresh();
  for (const [, attrs, body] of found) {
    const task = body.trim();
    const proj = attr(attrs, "项目"), wantMat = attr(attrs, "素材"), wantChat = /^(是|要|true|yes)$/i.test(attr(attrs, "带上聊天附件"));
    if (!task) continue;
    if (d.n >= DAILY_MAX) { notes.push({ text: `${role.name} 还想交给工作间，但今天已经交了 ${DAILY_MAX} 次，先没交` }); continue; }
    const projects = wr.status?.projects || [];
    const want = (proj || "").trim();
    const project = projects.find(p => p === want) || projects.find(p => p.toLowerCase() === want.toLowerCase()) || (!want && projects.length === 1 ? projects[0] : "");
    if (!project) { notes.push({ text: `${role.name} 想交给工作间的「${want || "？"}」，可是没有这个项目`, detail: task }); continue; }
    try {
      const title = task.split("\n")[0].replace(/[#*`]/g, "").slice(0, 24);
      const t = await newThread(project, title);
      const w = workThread(t.id);
      w.mode = "gpt";
      // 工作间里那段对话：从他交的这一句开始
      const list = await loadTalk(t.id);
      list.push({ id: `c${Date.now()}`, from: "ai", text: `（从聊天里交来的）\n${task}`, notes: [], ts: Date.now(), at: thread(t.id).items.length });
      const { set } = await import("./kv.js");
      await set(`wtk:${t.id}`, JSON.parse(JSON.stringify(list)));
      let files = [];
      try { files = await gatherFiles(project, t.id, wantMat, wantChat ? history : null); }
      catch (e) { notes.push({ text: `素材没带上：${e.message}` }); }
      await say(t.id, task, files);
      if (files.length) notes.push({ text: `一起带上了 ${files.length} 个素材` });
      Object.assign(w, { awaiting: true, dispatchedAt: Date.now(), chain: 1, sent: [task.slice(0, 60)] });
      d.n++;
      notes.push({ text: `${role.name} 去工作间「${project}」开了个任务：${title}`, href: `/work?t=${t.id}`, detail: task });
    } catch (e) {
      notes.push({ text: `${role.name} 想交给工作间，但没交成：${e.message}`, detail: task });
    }
  }
  return { text: clean, notes };
}

// 醒来时交的（中转那边已经开好任务、交给 Codex 了）：这边记上「和他一起」，Codex 做完他会先看一遍再告诉你
export async function adoptWork(list, ts) {
  const { set } = await import("./kv.js");
  for (const w of list || []) {
    if (!w?.threadId) continue;
    const wt = workThread(w.threadId);
    const talk = await loadTalk(w.threadId);
    if (talk.some(m => m.id === `wk${w.threadId}`)) continue;
    Object.assign(wt, { mode: "gpt", awaiting: true, dispatchedAt: ts || Date.now(), chain: 1, sent: [String(w.task || "").slice(0, 60)] });
    talk.unshift({ id: `wk${w.threadId}`, from: "ai", text: `（醒来的时候交来的）\n${w.task || ""}`, notes: [], ts: ts || Date.now(), at: 0 });
    await set(`wtk:${w.threadId}`, JSON.parse(JSON.stringify(talk)));
  }
}
