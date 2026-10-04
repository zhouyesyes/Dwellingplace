// AI 在回复里写记忆卡片：
//   [记忆:标题|内容]
//   [改记忆:#ab12|新的内容]   或   [改记忆:#ab12|新标题|新的内容]
import { store, uid } from "../store/index.js";
import { todayYmd } from "./dates.js";

export const MEM_TAG_RE = /\[(记忆|改记忆)[:：]([^\]]{1,1200})\]/g;
const MAX_FOR_AI = 40;

export const memoriesOf = roleId =>
  store.memories.filter(m => m.roleId === roleId).sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);

// 给 AI 看的记忆（同一个角色的所有对话共用）
export function memoryForAI(role, meName) {
  const list = memoriesOf(role.id).slice(0, MAX_FOR_AI);
  const lines = list.map(m => {
    const body = m.content.length > 300 ? m.content.slice(0, 300) + "…" : m.content;
    return `- #${m.id.slice(0, 4)} [${m.date}] ${m.title}：${body.replace(/\n+/g, " ")}`;
  });
  return [
    `\n# 你的记忆库`,
    `这是你和${meName}之间的记忆卡片，所有对话共用。聊天时自然地记得这些事，不用刻意复述。`,
    lines.length ? lines.join("\n") : "（还没有记忆）",
    `如果这次聊天里有值得长久记住的事（关于${meName}的喜好、经历、约定、重要的时刻），可以在回复末尾另起一行写：[记忆:标题|内容]`,
    `需要更新某张卡片时写：[改记忆:#编号|新的内容]（也可以 [改记忆:#编号|新标题|新的内容]）。`,
    `只记真正重要的事，不要每次都写；标题简短，内容一两句话。`,
  ].join("\n");
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
