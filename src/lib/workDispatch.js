// 聊天里他把活交给工作间：回复里写
//   <交给工作间 项目="栖所">要做什么、在哪些文件、做完怎么确认</交给工作间>
// 栖所就在工作间那个项目里开一个任务（和他一起），把说明交给 Codex；聊天里留一条小记，点一下进去看。
// Codex 做完，下次打开工作间那个任务时他会先看一遍结果再告诉你（推上线这类事照样要你点）。
// 一天最多交 DAILY_MAX 次（醒来时交的另算，见中转）
import { store } from "../store/index.js";
import { wr, refresh, newThread, say, thread } from "./workroom.js";
export { noteWorkroom } from "./workroom.js";
import { workThread, loadTalk } from "./workTogether.js";

export const WORK_RE = /<交给工作间(?:\s+项目\s*=\s*["“「]?([^"”」>]+?)["”」]?)?\s*>([\s\S]*?)<\/交给工作间>/g;
const DAILY_MAX = 5;
const today = () => new Date().toDateString();

export function workroomForAI(who) {
  const w = store.settings.workroom;
  if (!w?.projects?.length) return "";
  return [
    `\n# 工作间`,
    `你在${who}的服务器上有一个工作间：Codex（一个写代码、跑命令的工程助手）在里面的项目文件夹里干活。项目：${w.projects.map(p => `「${p}」`).join("、")}${w.projects.includes("栖所") ? "（「栖所」就是你们现在用的这个栖所的代码）" : ""}。`,
    `${who}让你去做、或者你发现栖所哪里坏了想修，可以把活交给工作间：另起一段写 <交给工作间 项目="项目名">要做什么、在哪些文件、做完怎么确认（比如构建、截图看看）、别碰什么</交给工作间>。Codex 看不到你们的聊天，只看得到这段说明，要写清楚。`,
    `交过去以后，过程都在工作间里；删东西、装东西这类事 Codex 会等${who}点允许，推上线也要${who}在工作间里点，你只负责说清楚要做什么。一天最多交 ${DAILY_MAX} 次，小事别交，聊天里说说就好。`,
  ].join("\n");
}

// 回复里的 <交给工作间>：开任务、交给 Codex，返回去掉标签的文字和小记
export async function applyWorkTags(role, text) {
  const found = [...String(text || "").matchAll(WORK_RE)];
  if (!found.length) return { text, notes: [] };
  const clean = text.replace(WORK_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  const notes = [];
  const d = (store.workDaily ??= { day: "", n: 0 });
  if (d.day !== today()) Object.assign(d, { day: today(), n: 0 });
  if (!wr.status) await refresh();
  for (const [, proj, body] of found) {
    const task = body.trim();
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
      await say(t.id, task);
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
