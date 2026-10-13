// AI 在回复里写记忆卡片：
//   [记忆:标题|内容]
//   [改记忆:#ab12|新的内容]   或   [改记忆:#ab12|新标题|新的内容]
import { store, uid, loadMessages } from "../store/index.js";
import { todayYmd } from "./dates.js";
import { lettersOf } from "./letters.js";

export const MEM_TAG_RE = /\[(记忆|改记忆)[:：]([^\]]{1,1200})\]/g;
// 每次带多少张记忆卡片（钉住的不算在里面，永远带着）：记忆库「记忆设置」里调
export const cardLimit = () => Number(store.settings.cardLimit) || 40;
// 记忆卡片：钉住的在最前，其余按新旧
export const cardsForAI = (all, n = cardLimit()) => {
  const cards = all.filter(m => memKind(m) === "card");
  return [...cards.filter(m => m.pinned), ...cards.filter(m => !m.pinned).slice(0, n)];
};
// 你们来往的信：他读过的你的信、他写的信，留一行（标题 + 一句），他以后提得起来
export function lettersLog(role, meName, n = 10) {
  return lettersOf(role.id).filter(l => l.from !== "me" || l.readAt).slice(-n)
    .map(l => `- [${l.date}] ${l.from === "me" ? `${meName}写给你` : `你写给${meName}`}「${l.title || "无题"}」：${(l.body || "").replace(/\s+/g, " ").slice(0, 40)}${(l.body || "").length > 40 ? "…" : ""}`).join("\n");
}

// ---------- 候选记忆 ----------
// 整理摘要、前情、讨论摘要的时候，让整理模型顺手挑出值得单独记住的事，写成 [候选记忆:标题|内容]；
// 先放在「待确认」里，你点「收下」才变成记忆卡片
export const SUGGEST_RE = /\[候选记忆[:：]([^\]]{2,600})\]/g;
export const suggestRule = me => `另外：如果这些里面有值得单独长久记住的事（${me}的喜好、经历、约定、重要的时刻），在最后另起一行写 [候选记忆:标题|内容]，最多 3 条，一两句话；没有就不写。`;
export function takeSuggestions(role, text, src) {
  const found = [...text.matchAll(SUGGEST_RE)];
  if (found.length) {
    store.memSuggest ??= [];
    for (const [, inner] of found) {
      const [title = "", ...rest] = inner.split(/[|｜]/).map(x => x.trim());
      const content = rest.join(" ").trim() || title;
      if (content && !store.memSuggest.some(x => x.roleId === role.id && x.content === content)) store.memSuggest.push({ id: uid(), roleId: role.id, title: title.slice(0, 40), content, src, ts: Date.now() });
    }
  }
  return text.replace(SUGGEST_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}
export const suggestionsOf = roleId => (store.memSuggest || []).filter(x => x.roleId === roleId);
export function acceptSuggestion(x) {
  store.memories.push({ id: uid(), roleId: x.roleId, title: x.title || x.content.slice(0, 12), content: x.content, img: null, date: todayYmd(), author: x.roleId, ts: Date.now() });
  dropSuggestion(x);
}
export function dropSuggestion(x) {
  const i = (store.memSuggest || []).indexOf(x);
  if (i >= 0) store.memSuggest.splice(i, 1);
}

export const memoriesOf = roleId =>
  store.memories.filter(m => m.roleId === roleId).sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);

// 记忆分三种：平时的记忆卡片；共读里记下的读书笔记（带 bookId）；共写的总结（带 writingId）
export const memKind = m => (m.bookId ? "read" : m.writingId ? "write" : "card");
const line = (m, n = 300) => `- #${m.id.slice(0, 4)} [${m.date}] ${m.title}：${(m.content.length > n ? m.content.slice(0, n) + "…" : m.content).replace(/\n+/g, " ")}`;

// 给 AI 看的全局记忆（同一个角色的所有对话共用）：先是记忆卡片，再是从共读、共写整理过来的（分开标好）
export function memoryForAI(role, meName) {
  const all = memoriesOf(role.id);
  const cards = cardsForAI(all);
  const reads = all.filter(m => memKind(m) === "read").slice(0, 10);
  const writes = all.filter(m => memKind(m) === "write").slice(0, 6);
  const letters = lettersLog(role, meName);
  return [
    `\n# 你的记忆库（全局记忆）`,
    `这是你和${meName}之间的记忆，所有对话共用。聊天时自然地记得这些事，不用刻意复述。`,
    `## 记忆卡片`,
    cards.length ? cards.map(m => line(m) + (m.pinned ? "（钉住的，很重要）" : "")).join("\n") : "（还没有记忆卡片）",
    letters ? `## 你们来往的信（只记了标题和开头）\n${letters}` : "",
    reads.length ? `## 共读里你记下的读书笔记\n${reads.map(m => line(m, 200)).join("\n")}` : "",
    writes.length ? `## 共写：你们在写的书（你自己记的总结）\n${writes.map(m => line(m, 300)).join("\n")}` : "",
    `如果这次聊天里有值得长久记住的事（关于${meName}的喜好、经历、约定、重要的时刻），可以在回复末尾另起一行写：[记忆:标题|内容]`,
    `需要更新某张卡片时写：[改记忆:#编号|新的内容]（也可以 [改记忆:#编号|新标题|新的内容]）。`,
    `只记真正重要的事，不要每次都写；标题简短，内容一两句话。`,
  ].filter(Boolean).join("\n");
}

// 共读、共写这些场景里：场景自己的记忆放前面，这份全局记忆放在后面——
// 记忆卡片、最近聊天的摘要、主聊天里最近的消息（「每次能看到多少条」的一半），这样他在哪都还是同一个他
export async function globalMemoryForScene(role, meName, { skip } = {}) {
  const all = memoriesOf(role.id);
  const cards = cardsForAI(all, Math.min(30, cardLimit()));
  const reads = skip === "read" ? [] : all.filter(m => memKind(m) === "read").slice(0, 5);
  const writes = skip === "write" ? [] : all.filter(m => memKind(m) === "write").slice(0, 3);
  const thread = [...(store.threads || [])].filter(t => t.roleId === role.id && !t.mail).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  let recent = "";
  if (thread) {
    const { pathOf, afterSummary, visibleText, splitBubbles } = await import("./chat.js");
    const n = Math.floor(Math.max(2, Number(store.settings.historyLimit) || 80) / 2);
    const path = afterSummary(thread, pathOf(thread, await loadMessages(thread.id)).filter(m => m.from !== "event" && !m.pending && !m.error));
    recent = path.slice(-n).map(m => {
      const t = m.from === "user" ? m.text || (m.attachments?.length ? "[图片/文件]" : "") : splitBubbles(visibleText(m.text)).join(" ");
      return t ? `${m.from === "user" ? meName : "你"}：${t.length > 300 ? t.slice(0, 300) + "…" : t}` : "";
    }).filter(Boolean).join("\n");
  }
  const parts = [
    cards.length ? `记忆卡片：\n${cards.map(m => line(m, 160)).join("\n")}` : "",
    thread?.summary?.text ? `聊天的摘要记忆：\n${thread.summary.text.slice(0, 1500)}` : "",
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
        store.memories.push({ id: uid(), roleId: role.id, title, content, img: null, date: todayYmd(), author: role.id, ts: Date.now() });
        notes.push(`${role.name} 写下了一张记忆卡片：${title}`);
      }
    } else {
      const id = parts[0].replace(/^#/, "");
      const m = id && store.memories.find(x => x.roleId === role.id && x.id.startsWith(id));
      if (!m) return "";
      const rest = parts.slice(1);
      if (rest.length > 1) m.title = rest.shift().slice(0, 40);
      const content = rest.join(" ").trim();
      if (content) m.content = content;
      m.editedBy = role.id;
      m.ts = Date.now();
      notes.push(`${role.name} 更新了记忆卡片：${m.title}`);
    }
    return "";
  });
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), notes };
}
