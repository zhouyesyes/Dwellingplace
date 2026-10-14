// AI 在回复里写记忆卡片：
//   [记忆:标题|内容]
//   [改记忆:#ab12|新的内容]   或   [改记忆:#ab12|新标题|新的内容]
import { momentParts } from "./moment.js";
import { boardForAI, boardRule } from "./board.js";
import { tail, sceneChatTokens } from "./budget.js";
import { store, uid, loadMessages } from "../store/index.js";
import { todayYmd } from "./dates.js";
import { lettersOf } from "./letters.js";

export const MEM_TAG_RE = /\[(记忆|改记忆|过时记忆|归档记忆|常驻记忆)[:：]([^\]]{1,1200})\]/g;

// ---------- 记忆卡片的两件事（分开存）----------
// status：这件事现在还成不成立   valid 当前有效 / pending 待确认 / obsolete 已过时 / deleted 回收站
// access：平时怎么给他           pinned 常驻（每次都带，最多 20 张）/ normal 普通（按你说的话自动想起几张）/ archived 归档（只在搜索时出现）
// 界面上只看到：常驻、普通、归档、待确认、已过时（+ 回收站）
// source：{ type: chat / read / write / letter / manual / helper, by: ai / helper / me, id, range, label }
export const PIN_MAX = 20;
export const ACCESS = { pinned: "常驻", normal: "普通", archived: "归档" };
export const STATUS = { valid: "当前有效", pending: "待确认", obsolete: "已过时", deleted: "回收站" };
export const SRC = { chat: "聊天", read: "共读", write: "共写", letter: "信件", manual: "你手动写的", helper: "整理时挑出来的", calendar: "日历", review: "他整理时改的" };
export const BY = { ai: "他自己记的", helper: "整理模型建议的", me: "你写的" };
export const isLive = m => (m.status || "valid") === "valid";
export const accessOf = m => m.access || (m.pinned ? "pinned" : "normal");
// 每次自动想起几张普通记忆（记忆库「记忆设置」里调）
export const recallCount = () => Number(store.settings.recallCount ?? 5);
// 新建一张卡片：都走这里，来源、时间一起记好
export function newMemory(role, { title, content, status = "valid", access = "normal", source = {}, tags = [], importance = 3, ...rest }) {
  const now = Date.now();
  const m = { id: uid(), roleId: role.id ?? role, title: (title || content.slice(0, 12)).slice(0, 40), content, img: null, date: todayYmd(), author: source.by === "me" ? "me" : role.id ?? role, ts: now, createdAt: now, updatedAt: now, status, access, source, tags, importance, ...rest };
  store.memories.push(m);
  return m;
}
const touch = m => { m.updatedAt = m.ts = Date.now(); };
export const pinnedOf = roleId => memoriesOf(roleId).filter(m => isLive(m) && accessOf(m) === "pinned");
// 换使用方式；常驻满了不挤掉旧的，返回一句提示
export function setAccess(m, access) {
  if (access === "pinned" && accessOf(m) !== "pinned" && pinnedOf(m.roleId).length >= PIN_MAX) return `常驻已经有 ${PIN_MAX} 张了，先把不那么要紧的移回普通再来`;
  m.access = access;
  delete m.pinned;
  if (m.status === "pending" || m.status === "obsolete") m.status = "valid";
  touch(m);
  return "";
}
export function confirmMemory(m, access = "normal") { m.status = "valid"; return setAccess(m, access); }
export function markObsolete(m) { m.status = "obsolete"; touch(m); }
export function trashMemory(m) { m.statusBefore = m.status; m.status = "deleted"; m.deletedAt = Date.now(); }
export function restoreMemory(m) { m.status = m.statusBefore && m.statusBefore !== "deleted" ? m.statusBefore : "valid"; delete m.deletedAt; delete m.statusBefore; }
export function purgeMemory(m) { const i = store.memories.indexOf(m); if (i >= 0) store.memories.splice(i, 1); }

// ---------- 自动想起：普通记忆里和这句话有关的几张 ----------
// 先用最简单的：中文两两连在一起的词 + 英文单词，看卡片里有几个对得上（标签对上加分、重要的加一点）；对不上的一张也不放
const STOP = new Set("我们 你们 他们 这个 那个 一个 什么 没有 就是 可以 自己 现在 时候 知道 今天 然后 因为 所以 但是 还是 已经 不是 觉得 一下 这样 怎么 真的 有点 一点 的话 哈哈 这么 那么 好像 还有 如果 只是 一起 一样".split(" "));
const grams = s => {
  const out = new Set();
  const t = String(s || "").toLowerCase();
  for (const w of t.match(/[a-z0-9]{2,}/g) || []) out.add(w);
  for (const seg of t.replace(/[^\u4e00-\u9fff]+/g, " ").split(" ")) for (let i = 0; i < seg.length - 1; i++) { const g = seg.slice(i, i + 2); if (!STOP.has(g)) out.add(g); }
  return out;
};
export function recallCards(roleId, text, n = recallCount(), { exclude = [] } = {}) {
  if (!n || !String(text || "").trim()) return [];
  const q = grams(text);
  if (!q.size) return [];
  const scored = [];
  for (const m of memoriesOf(roleId)) {
    if (!isLive(m) || accessOf(m) !== "normal" || memKind(m) !== "card" || exclude.includes(m.id)) continue;
    const g = grams(`${m.title} ${m.content}`);
    let hit = 0;
    for (const x of q) if (g.has(x)) hit++;
    const tagHit = (m.tags || []).some(t => String(text).includes(t)) ? 3 : 0;
    const score = hit + tagHit + ((m.importance || 3) - 3) * 0.5;
    if (hit + tagHit >= 2) scored.push({ m, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, n).map(x => x.m);
}
// 卡片被用上了（自动想起、他翻到）：记一下，健康检查里能看出哪些很久没用过
export function markUsed(list) {
  const now = Date.now();
  for (const m of list) { m.usedAt = now; m.useCount = (m.useCount || 0) + 1; }
}
// 附在【此刻】里的：这次自动想起来的几张（记一笔，记忆库里能看到最近想起了什么、因为哪句话）
export function recalledForAI(role, text) {
  const list = recallCards(role.id, text);
  if (list.length) {
    markUsed(list);
    store.recallLog ??= [];
    store.recallLog.unshift({ roleId: role.id, ts: Date.now(), q: String(text).slice(0, 60), ids: list.map(m => m.id) });
    store.recallLog.splice(30);
  }
  return list.length ? `\n# 可能相关的记忆（这句话让你想起来的）\n${list.map(m => line(m, 300)).join("\n")}` : "";
}

// 你们来往的信：他读过的你的信、他写的信，留一行（标题 + 一句），他以后提得起来
export function lettersLog(role, meName, n = 10) {
  return lettersOf(role.id).filter(l => l.from !== "me" || l.readAt).slice(-n)
    .map(l => `- [${l.date}] ${l.from === "me" ? `${meName}写给你` : `你写给${meName}`}「${l.title || "无题"}」：${(l.body || "").replace(/\s+/g, " ").slice(0, 40)}${(l.body || "").length > 40 ? "…" : ""}`).join("\n");
}

// ---------- 候选记忆（待确认）----------
// 整理摘要、前情、讨论摘要的时候，整理模型顺手挑出值得单独记住的事，写成 [候选记忆:标题|内容]；
// 变成一张「待确认」的卡片：不发给他、不自动想起，你确认了才生效
export const SUGGEST_RE = /\[候选记忆[:：]([^\]]{2,600})\]/g;
export const suggestRule = me => `另外：如果这些里面有值得单独长久记住的事（${me}的喜好、经历、约定、重要的时刻），在最后另起一行写 [候选记忆:标题|内容]，最多 3 条，一两句话；没有就不写。`;
export function takeSuggestions(role, text, src) {
  for (const [, inner] of text.matchAll(SUGGEST_RE)) {
    const [title = "", ...rest] = inner.split(/[|｜]/).map(x => x.trim());
    const content = rest.join(" ").trim() || title;
    if (content && !store.memories.some(x => x.roleId === role.id && x.content === content)) newMemory(role, { title, content, status: "pending", source: { type: "helper", by: "helper", label: src } });
  }
  return text.replace(SUGGEST_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

export const memoriesOf = roleId =>
  store.memories.filter(m => m.roleId === roleId).sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);

// 记忆分三种：平时的记忆卡片；共读里记下的读书笔记（带 bookId）；共写的总结（带 writingId）
export const memKind = m => (m.bookId ? "read" : m.writingId ? "write" : "card");
const line = (m, n = 300) => `- #${m.id.slice(0, 4)} [${m.date}] ${m.title}：${(m.content.length > n ? m.content.slice(0, n) + "…" : m.content).replace(/\n+/g, " ")}`;

// 给 AI 看的全局记忆（同一个角色的所有对话共用，放在系统提示里）：常驻的卡片 → 来往的信 → 共读、共写整理过来的（分开标好）。
// 普通记忆不全放：每次按你说的话自动想起几张，附在【此刻】里（见 recalledForAI）。醒来的时候没有「你说的话」，就多带几张最近的
export function memoryForAI(role, meName, { wake = false } = {}) {
  const all = memoriesOf(role.id).filter(isLive);
  const pinned = all.filter(m => memKind(m) === "card" && accessOf(m) === "pinned");
  const recent = wake ? all.filter(m => memKind(m) === "card" && accessOf(m) === "normal").slice(0, 10) : [];
  const reads = all.filter(m => memKind(m) === "read" && accessOf(m) !== "archived").slice(0, 10);
  const writes = all.filter(m => memKind(m) === "write" && accessOf(m) !== "archived").slice(0, 6);
  const letters = lettersLog(role, meName);
  const board = boardForAI(role);
  return [
    `\n# 你的记忆库（全局记忆）`,
    `这是你和${meName}之间的记忆，所有对话共用。聊天时自然地记得这些事，不用刻意复述。`,
    `## 常驻的记忆卡片（最要紧的，一直记着）`,
    pinned.length ? pinned.map(m => line(m)).join("\n") : "（还没有常驻的卡片）",
    recent.length ? `## 最近的记忆卡片\n${recent.map(m => line(m)).join("\n")}` : "",
    `其他记忆卡片平时不全放在这里：每次会按${meName}说的话，自动想起有关的几张，附在【此刻】里；想不起来就「翻记忆」。`,
    board ? `## 板块记忆（在写的书、在读和读完的书、笔友：长期的进展，一直记着）\n${board}` : "",
    letters ? `## 你们来往的信（只记了标题和开头）\n${letters}` : "",
    reads.length ? `## 共读里你记下的读书笔记\n${reads.map(m => line(m, 200)).join("\n")}` : "",
    writes.length ? `## 共写：你们在写的书（你自己记的总结）\n${writes.map(m => line(m, 300)).join("\n")}` : "",
    `如果这次聊天里有值得长久记住的事（关于${meName}的喜好、经历、约定、重要的时刻），可以在回复末尾另起一行写：[记忆:标题|内容]`,
    `需要更新某张卡片时写：[改记忆:#编号|新的内容]（也可以 [改记忆:#编号|新标题|新的内容]）。能直接改的就改原卡，别留两张互相矛盾的。`,
    `某张卡片说的事已经不成立了（比如病好了、搬家了），写 [过时记忆:#编号]，它会留作历史，不再当成现在的事。不常用了但还成立的写 [归档记忆:#编号]；特别要紧、想一直记着的写 [常驻记忆:#编号]（最多 ${PIN_MAX} 张）。`,
    `只记真正重要的事，不要每次都写；标题简短，内容一两句话。`,
    boardRule(meName),
  ].filter(Boolean).join("\n");
}

// 共读、共写这些场景里：场景自己的记忆放前面，这份全局记忆放在后面——
// 记忆卡片、最近聊天的摘要、主聊天里最近的消息（最近约 6 千 token，记忆设置里调），这样他在哪都还是同一个他
export async function globalMemoryForScene(role, meName, { skip, query = "" } = {}) {
  const all = memoriesOf(role.id).filter(isLive);
  const pinned = all.filter(m => memKind(m) === "card" && accessOf(m) === "pinned");
  const cards = [...pinned, ...recallCards(role.id, query, recallCount(), { exclude: pinned.map(m => m.id) })];
  const reads = skip === "read" ? [] : all.filter(m => memKind(m) === "read" && accessOf(m) !== "archived").slice(0, 5);
  const writes = skip === "write" ? [] : all.filter(m => memKind(m) === "write" && accessOf(m) !== "archived").slice(0, 3);
  const thread = [...(store.threads || [])].filter(t => t.roleId === role.id && !t.mail).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  let recent = "";
  if (thread) {
    const { pathOf, afterSummary, visibleText, splitBubbles } = await import("./chat.js");
    const path = afterSummary(thread, pathOf(thread, await loadMessages(thread.id)).filter(m => m.from !== "event" && !m.pending && !m.error));
    recent = tail(path, sceneChatTokens()).map(m => {
      const t = m.from === "user" ? m.text || (m.attachments?.length ? "[图片/文件]" : "") : splitBubbles(visibleText(m.text)).join(" ");
      return t ? `${m.from === "user" ? meName : "你"}：${t.length > 300 ? t.slice(0, 300) + "…" : t}` : "";
    }).filter(Boolean).join("\n");
  }
  const board = boardForAI(role, { skip });
  const moment = momentParts(role, meName, { peek: true, brief: true }).filter(p => p.text).map(p => `【${p.title}】\n${p.text}`).join("\n");
  const parts = [
    cards.length ? `记忆卡片（常驻的，和这次可能相关的）：\n${cards.map(m => line(m, 160)).join("\n")}` : "",
    board ? `板块记忆（长期的进展）：\n${board}` : "",
    moment ? `最近 24 小时（【此刻】）：\n${moment}` : "",
    thread?.summary?.text ? `聊天的摘要记忆（最近的几段）：\n${thread.summary.text.length > 2000 ? "……" + thread.summary.text.slice(-2000) : thread.summary.text}` : "",
    recent ? `平时聊天里最近说的（最近的在最后）：\n${recent}` : "",
    reads.length ? `共读的读书笔记：\n${reads.map(m => line(m, 120)).join("\n")}` : "",
    writes.length ? `共写的总结：\n${writes.map(m => line(m, 160)).join("\n")}` : "",
  ].filter(Boolean);
  return parts.length ? `\n# 全局记忆（平时的你记得的，放在这里供参考）\n${parts.join("\n\n")}` : "";
}

export function applyMemoryTags(role, text) {
  const notes = [];
  const clean = text.replace(MEM_TAG_RE, (_, op, body) => {
    const parts = body.split(/[|｜]/).map(s => s.trim());
    if (op === "记忆") {
      const title = (parts.length > 1 ? parts[0] : parts[0].slice(0, 12)).slice(0, 40);
      const content = (parts.length > 1 ? parts.slice(1).join(" ") : parts[0]).trim();
      if (content) {
        newMemory(role, { title, content, source: { type: "chat", by: "ai" } });
        notes.push(`${role.name} 写下了一张记忆卡片：${title}`);
      }
      return "";
    }
    const id = parts[0].replace(/^#/, "");
    const m = id && store.memories.find(x => x.roleId === role.id && x.id.startsWith(id) && x.status !== "deleted");
    if (!m) return "";
    if (op === "改记忆") {
      const rest = parts.slice(1);
      if (rest.length > 1) m.title = rest.shift().slice(0, 40);
      const content = rest.join(" ").trim();
      if (content) m.content = content;
      m.editedBy = role.id;
      touch(m);
      notes.push(`${role.name} 更新了记忆卡片：${m.title}`);
    } else if (op === "过时记忆") {
      markObsolete(m);
      notes.push(`${role.name} 把「${m.title}」标成了已过时`);
    } else if (op === "归档记忆") {
      setAccess(m, "archived");
      notes.push(`${role.name} 把「${m.title}」归档了`);
    } else if (op === "常驻记忆") {
      const err = setAccess(m, "pinned");
      notes.push(err ? `${role.name} 想把「${m.title}」设为常驻，但${err}` : `${role.name} 把「${m.title}」设为常驻`);
    }
    return "";
  });
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), notes };
}
