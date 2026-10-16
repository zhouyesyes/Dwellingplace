// 工作间里「和他一起」：你和他（平时聊天的那个他，带着精简的记忆）商量，他把活交给 Codex 去做；
// Codex 做完一轮，他先看一遍结果再告诉你，需要的话接着交下一步。审批永远是你点。
//
// 他看到的（精简，不扛整个聊天）：
//   他是谁（写给自己的那段）· 常驻记忆卡片 · 这个项目定下的决定 · 施工现场（Codex 最近这一轮做了什么）· 工作间里你们最近的对话
//   · 你刚发的附件：图片、视频截的画面、文件里的字（在手机上先看一遍，见 seeFiles.js）
// 他能做的（写在回复里）：
//   <交给Codex>任务说明</交给Codex>   交给 Codex（正在干活就是插一句）
//   [停下Codex]                       让 Codex 停下
//   [记下决定:内容]                    记进这个项目的决定（以后每次都带着）
//   <施工摘要>…</施工摘要>             收工时写：存进他的记忆（每个项目一张，后来的更新前面的）
// 连着自己交给 Codex 最多 3 次（中间你没说话），就停下来问你
import { reactive } from "vue";
import { store, uid } from "../store/index.js";
import { get, set } from "./kv.js";
import { wr, thread, say, interrupt } from "./workroom.js";
import { pinnedOf, newMemory } from "./memoryTags.js";
import { tail } from "./budget.js";
import { seeFiles } from "./seeFiles.js";

const CHAIN_MAX = 3;
const TALK_TOKENS = 8000;

// ---------- 存的东西 ----------
export const workThread = id => ((store.workThreads ??= {})[id] ??= { mode: "gpt", awaiting: false, chain: 0, sent: [] });
export const workProject = name => ((store.workProjects ??= {})[name] ??= { decisions: "", memId: null });
const talks = reactive({});
export async function loadTalk(id) {
  if (!talks[id]) talks[id] = (await get(`wtk:${id}`)) || [];
  return talks[id];
}
const saveTalk = id => set(`wtk:${id}`, JSON.parse(JSON.stringify(talks[id] || [])));
export const busy = reactive({}); // threadId -> true：他在想
export const phases = reactive({}); // 只放本轮的阶段，不存提示词或模型原文，也不写进持久记录

// ---------- 施工现场：Codex 最近这一轮做了什么 ----------
const cmdText = c => { const s = String(c || ""); const m = s.match(/^\/bin\/(?:ba)?sh -l?c (["'])([\s\S]*)\1$/); return m ? m[2] : s; };
const cut = (s, n) => (String(s || "").length > n ? String(s).slice(0, n) + "…" : String(s || ""));
export function siteText(id) {
  const t = thread(id);
  const items = t.items;
  // 从最近一次开始干活算起（没有就看最后 40 条）
  let from = 0;
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === "turn" && items[i].state === "started") { from = i; break; }
  const cur = items.slice(from);
  const lines = [];
  const said = cur.filter(x => x.kind === "agent" && x.text).map(x => x.text);
  if (said.length) lines.push(`Codex 说的：\n${cut(said.join("\n\n"), 2500)}`);
  const plan = [...cur].reverse().find(x => x.kind === "plan" && x.steps?.length);
  if (plan) lines.push(`计划：${plan.steps.map(s => `${s.status === "completed" ? "✓" : s.status === "inProgress" ? "▸" : "○"}${s.step}`).join("；")}`);
  const cmds = cur.filter(x => x.kind === "command").slice(-12);
  if (cmds.length) lines.push(`跑的命令：\n${cmds.map(c => `$ ${cut(cmdText(c.command), 160)} → ${c.status || "?"}${c.exitCode != null ? `（退出码 ${c.exitCode}）` : ""}${c.status === "failed" && c.output ? `\n  输出末尾：${cut(c.output.slice(-400), 400)}` : ""}`).join("\n")}`);
  const files = [...new Set(cur.filter(x => x.kind === "files").flatMap(x => (x.changes || []).map(c => c.path)))];
  if (files.length) lines.push(`改过的文件：${files.join("、")}`);
  const ask = cur.filter(x => x.kind === "approval" && x.state === "pending");
  if (ask.length) lines.push(`等她点的审批：${ask.map(a => cut(cmdText(a.command) || "改文件", 120)).join("；")}`);
  const end = [...cur].reverse().find(x => x.kind === "turn" && x.state !== "started");
  if (end) {
    lines.push(`这一轮：${{ completed: "做完了", interrupted: "被停下了", failed: "出错了" }[end.state] || end.state}${end.error ? `（${end.error}）` : ""}`);
    if (end.diff) lines.push(`这一轮的改动（diff）：\n${cut(end.diff, 2500)}`);
  } else if (t.turnId) lines.push("这一轮：还在干活");
  return lines.join("\n") || "（Codex 还没开始干活）";
}

// ---------- 给他看的 ----------
// 附件怎么写进提示：刚发来的这条，内容就附在消息里他看得到；以前的只剩名字和路径（要看交给 Codex）
const pathsOf = m => m.attachments.map(a => `${a.name}（${a.type}；用途：${a.purpose || "未填写"}）${a.path}`).join("；");
function attNote(m, fresh) {
  if (!m.attachments?.length) return "";
  if (fresh && m.seen?.length) return `\n附件（就附在这条消息里，你直接看）：${m.seen.join("；")}\n（服务器上的路径，要交给 Codex 时用：${pathsOf(m)}）`;
  return `\n附件（之前发的，现在看不到内容了；要看就交给 Codex 读）：${pathsOf(m)}`;
}
async function prompt(role, id, extra, fresh) {
  const { meName } = await import("./chat.js");
  const me = meName(role);
  const wt = workThread(id);
  const meta = thread(id).meta || {};
  const proj = workProject(meta.project || "");
  const list = await loadTalk(id);
  const recent = tail(list, TALK_TOKENS).map(m => `${m.from === "me" ? me : "你"}：${m.text}${attNote(m, m === fresh)}`).join("\n");
  const cards = pinnedOf(role.id).slice(0, 12).map(m => `- ${m.title}：${cut(m.content, 160)}`).join("\n");
  const chainLeft = CHAIN_MAX - (wt.chain || 0);
  return [
    role.style?.trim() ? `（这是你写给自己的：${role.style.trim()}）\n` : "",
    `你和${me}在工作间里一起做一个项目「${meta.project || ""}」（这个任务叫「${meta.title || ""}」）。你是${me}的伙伴，也是这次的工头：和${me}商量要做什么、怎么做，把具体的活交给 Codex（一个在服务器沙盒里写代码、跑命令的工程助手），它做完你先检查，再用你自己的话告诉${me}结果。`,
    `Codex 只能动项目文件夹里的东西，上网只能连 OpenAI。删东西、装东西、联网这类事 Codex 会请${me}点允许——审批是${me}的事，你可以说说建议，但别替${me}决定。`,
    cards ? `\n# 你常驻的记忆\n${cards}` : "",
    proj.decisions ? `\n# 这个项目定下的决定\n${proj.decisions}` : "",
    `\n# 施工现场（Codex 最近这一轮）\n${siteText(id)}`,
    `\n# 工作间里你们刚才说的\n${recent || "（刚进来）"}`,
    [
      `\n# 你能做的（写在回复里，不是每次都要）`,
      `- 把活交给 Codex：另起一段写 <交给Codex>任务说明</交给Codex>。说明写清楚：要做什么、在哪些文件、做完怎么确认（比如跑哪个测试）、别碰什么。Codex 看不到你们的聊天，只看得到这段说明。正在干活时交过去，就是插一句话给它。`,
      `- 让 Codex 停下：单独一行写 [停下Codex]`,
      `- 记下一个项目决定（以后每次都会带着）：另起一行写 [记下决定:内容]`,
      `- ${me}说收工、或者一件事做完了：写 <施工摘要>做了什么、定下了什么、还剩什么</施工摘要>，会存进你的记忆`,
      chainLeft > 0 ? `- 你已经连着交给 Codex ${wt.chain || 0} 次了（中间${me}没说话），最多再交 ${chainLeft} 次就要停下来问${me}。` : `- 你已经连着交给 Codex ${CHAIN_MAX} 次了，这次不能再交，先告诉${me}进展、问问${me}的意思。`,
    ].join("\n"),
    extra ? `\n${extra}` : "",
    `\n现在回${me}，像平时说话那样，简短清楚。`,
  ].filter(Boolean).join("\n");
}

// ---------- 他回复里的动作 ----------
const DISPATCH_RE = /<交给Codex>([\s\S]*?)<\/交给Codex>/g;
const STOP_RE = /\[停下Codex\]/g;
const DECIDE_RE = /\[记下决定[:：]([^\]]{2,600})\]/g;
const SUMMARY_RE = /<施工摘要>([\s\S]*?)<\/施工摘要>/g;
async function act(role, id, raw, { fromReport, fresh }) {
  const wt = workThread(id);
  const meta = thread(id).meta || {};
  const proj = workProject(meta.project || "");
  const notes = [];
  let text = raw;
  for (const [, d] of text.matchAll(DECIDE_RE)) {
    proj.decisions = [proj.decisions, `- ${d.trim()}（${new Date().toLocaleDateString("zh-CN")}）`].filter(Boolean).join("\n").slice(-4000);
    notes.push(`记下决定：${cut(d.trim(), 40)}`);
  }
  for (const [, s] of text.matchAll(SUMMARY_RE)) {
    const content = s.trim().slice(0, 1200);
    if (!content) continue;
    const old = proj.memId && store.memories.find(m => m.id === proj.memId);
    if (old) Object.assign(old, { content, ts: Date.now(), updatedAt: Date.now() });
    else proj.memId = newMemory(role, { title: `工作间：${meta.project}`, content, source: { type: "work", by: "ai", label: `工作间「${meta.project}」` } }).id;
    notes.push("施工摘要存进了他的记忆");
  }
  if (STOP_RE.test(text)) {
    await interrupt(id).catch(() => {});
    notes.push("让 Codex 停下了");
  }
  const tasks = [...text.matchAll(DISPATCH_RE)].map(m => m[1].trim()).filter(Boolean);
  if (tasks.length) {
    if (fromReport && (wt.chain || 0) >= CHAIN_MAX) {
      notes.push(`已经连着交给 Codex ${CHAIN_MAX} 次了，先停下来等你`);
    } else {
      const task = tasks.join("\n\n");
      try {
        await say(id, task, fresh?.attachments || []);
        delete phases[id]; // 交活已收到回应，执行状态交给 Codex 的真实事件
        wt.awaiting = true;
        wt.dispatchedAt = Date.now();
        wt.chain = fromReport ? (wt.chain || 0) + 1 : 1;
        wt.sent = [...(wt.sent || []), task.slice(0, 60)].slice(-30);
        notes.push("交给了 Codex");
      } catch (e) {
        notes.push(`没交成：${e.message}`);
      }
    }
  }
  text = text.replace(DISPATCH_RE, "").replace(STOP_RE, "").replace(DECIDE_RE, "").replace(SUMMARY_RE, (m, s) => `\n（施工摘要）${s.trim()}\n`);
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), notes };
}

async function ask(role, id, extra, { fromReport = false, fresh = null, parts = [], phase = fromReport ? "checking" : "preparing" } = {}) {
  busy[id] = true;
  phases[id] = phase;
  try {
    const { oneShot, visibleText } = await import("./chat.js");
    const raw = await oneShot(role, await prompt(role, id, extra, fresh), { raw: true, parts });
    const r = await act(role, id, raw, { fromReport, fresh });
    const list = await loadTalk(id);
    const reply = visibleText(r.text).trim();
    // at：说这句时 Codex 的过程走到第几条（时间线按这个排，不靠两边的钟）
    if (reply || r.notes.length) list.push({ id: uid(), from: "ai", text: reply, notes: r.notes, ts: Date.now(), at: thread(id).items.length, report: fromReport });
    await saveTalk(id);
  } finally {
    delete busy[id];
    delete phases[id];
  }
}

// 你说一句。files：这次附件的原文件（还在手机上），先看一遍再一起给他
export async function talk(role, id, text, attachments = [], files = []) {
  busy[id] = true;
  phases[id] = "preparing";
  try {
    const list = await loadTalk(id);
    list.push({ id: uid(), from: "me", text: text.trim(), attachments, ts: Date.now(), at: thread(id).items.length });
    const m = list.at(-1); // 取回响应式的那一条，后面认「刚发的这条」靠它
    workThread(id).chain = 0;
    let parts = [];
    if (files.length) {
      const r = await seeFiles(files); parts = r.parts; m.seen = r.seen;
    }
    await saveTalk(id);
    await ask(role, id, "", { fresh: m, parts });
  } finally {
    delete busy[id];
    delete phases[id];
  }
}

// Codex 做完了一轮（他交过去的）：他先看看结果，再告诉你
export async function report(role, id) {
  const wt = workThread(id);
  if (!wt.awaiting || busy[id]) return;
  wt.awaiting = false;
  await ask(role, id, `（Codex 刚做完你交过去的这一轮，结果在上面的施工现场里。先看看做得对不对、测试过没过，再告诉她；还要接着做就交下一步。）`, { fromReport: true });
}

// 收工：请他写施工摘要，存进记忆
export async function wrapUp(role, id) {
  await ask(role, id, `（她说先收工。写一段 <施工摘要>：这次做了什么、定下了什么、还剩什么没做，三五句话；再跟她说一两句。）`, { phase: "wrapping" });
}

// Codex 那边一轮结束了吗（他交过去之后）
export function turnDoneSince(id, ts) {
  return thread(id).items.some(x => x.kind === "turn" && x.state !== "started" && x.ts >= (ts || 0));
}
export { wr };
