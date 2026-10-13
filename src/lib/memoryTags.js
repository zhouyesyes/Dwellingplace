// AI 在回复里写记忆卡片：
//   [记忆:标题|内容]
//   [改记忆:#ab12|新的内容]   或   [改记忆:#ab12|新标题|新的内容]
import { store, uid } from "../store/index.js";
import { todayYmd } from "./dates.js";

export const MEM_TAG_RE = /\[(记忆|改记忆)[:：]([^\]]{1,1200})\]/g;
const MAX_FOR_AI = 40;

export const memoriesOf = roleId =>
  store.memories.filter(m => m.roleId === roleId).sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);

// 记忆分三种：平时的记忆卡片；共读里记下的读书笔记（带 bookId）；共写的总结（带 writingId）
export const memKind = m => (m.bookId ? "read" : m.writingId ? "write" : "card");
const line = (m, n = 300) => `- #${m.id.slice(0, 4)} [${m.date}] ${m.title}：${(m.content.length > n ? m.content.slice(0, n) + "…" : m.content).replace(/\n+/g, " ")}`;

// 给 AI 看的全局记忆（同一个角色的所有对话共用）：先是记忆卡片，再是从共读、共写整理过来的（分开标好）
export function memoryForAI(role, meName) {
  const all = memoriesOf(role.id);
  const cards = all.filter(m => memKind(m) === "card").slice(0, MAX_FOR_AI);
  const reads = all.filter(m => memKind(m) === "read").slice(0, 10);
  const writes = all.filter(m => memKind(m) === "write").slice(0, 6);
  return [
    `\n# 你的记忆库（全局记忆）`,
    `这是你和${meName}之间的记忆，所有对话共用。聊天时自然地记得这些事，不用刻意复述。`,
    `## 记忆卡片`,
    cards.length ? cards.map(m => line(m)).join("\n") : "（还没有记忆卡片）",
    reads.length ? `## 共读里你记下的读书笔记\n${reads.map(m => line(m, 200)).join("\n")}` : "",
    writes.length ? `## 共写：你们在写的书（你自己记的总结）\n${writes.map(m => line(m, 300)).join("\n")}` : "",
    `如果这次聊天里有值得长久记住的事（关于${meName}的喜好、经历、约定、重要的时刻），可以在回复末尾另起一行写：[记忆:标题|内容]`,
    `需要更新某张卡片时写：[改记忆:#编号|新的内容]（也可以 [改记忆:#编号|新标题|新的内容]）。`,
    `只记真正重要的事，不要每次都写；标题简短，内容一两句话。`,
  ].filter(Boolean).join("\n");
}

// 共读、共写这些场景里：场景自己的记忆放前面，这份全局记忆放在后面（短一点，只供参考）
export function globalMemoryForScene(role, meName, { skip } = {}) {
  const all = memoriesOf(role.id);
  const cards = all.filter(m => memKind(m) === "card").slice(0, 30);
  const reads = skip === "read" ? [] : all.filter(m => memKind(m) === "read").slice(0, 5);
  const writes = skip === "write" ? [] : all.filter(m => memKind(m) === "write").slice(0, 3);
  const thread = [...(store.threads || [])].filter(t => t.roleId === role.id && !t.mail && t.summary?.text).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  const parts = [
    cards.length ? `记忆卡片：\n${cards.map(m => line(m, 160)).join("\n")}` : "",
    thread ? `最近聊天的摘要：\n${thread.summary.text.slice(0, 1200)}` : "",
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
