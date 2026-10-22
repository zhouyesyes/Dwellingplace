// 心得本：每个人一本，分两栏（游戏经验 / 社交感悟）。
//   写法（单独一行）：[心得:游戏|一两句话]   [心得:社交|一两句话]（也认「游戏经验」「社交感悟」）
//   存在 store.memories 里，带 insight: "game" | "social"：跟着记忆一起同步、一起合并；memKind 是 "insight"，不混进记忆卡片，也不自动想起
//   写错的（没写栏目、没内容）悄悄丢掉，不露原始标记；删掉的放进回收站状态（status: deleted），同步时不会又冒出来
import { store, uid } from "../store/index.js";
import { todayYmd } from "./dates.js";
import { hasGarden } from "./gardenRooms.js";

export const INSIGHT_CATS = { game: "游戏经验", social: "社交感悟" };
export const INSIGHT_RE = /\[心得[:：]([^\]]{1,700})\]/g;
export const INSIGHT_PER_REPLY = 3;
const CAT_WORDS = { 游戏: "game", 游戏经验: "game", 玩: "game", 社交: "social", 社交感悟: "social", 逛: "social" };

export const insightsOf = (roleId, cat) =>
  store.memories.filter(m => m.insight && m.roleId === roleId && m.status !== "deleted" && (!cat || m.insight === cat)).sort((a, b) => (b.ts || 0) - (a.ts || 0));

export function removeInsight(m) { m.statusBefore = m.status; m.status = "deleted"; m.deletedAt = Date.now(); }

export function applyInsightTags(role, text) {
  const notes = [];
  if (!/\[心得[:：]/.test(text || "")) return { text, notes };
  let n = 0;
  const clean = String(text).replace(INSIGHT_RE, (_, body) => {
    const i = body.search(/[|｜]/);
    const cat = i > 0 ? CAT_WORDS[body.slice(0, i).trim()] : null;
    const content = i > 0 ? body.slice(i + 1).trim().slice(0, 400) : "";
    if (!cat || !content || n >= INSIGHT_PER_REPLY) return "";
    if (store.memories.some(m => m.insight === cat && m.roleId === role.id && m.status !== "deleted" && m.content === content)) return "";
    const now = Date.now();
    store.memories.push({ id: uid(), roleId: role.id, title: content.slice(0, 12), content, img: null, date: todayYmd(), author: role.id, ts: now, createdAt: now, updatedAt: now, status: "valid", access: "normal", source: { type: "chat", by: "ai" }, tags: [], importance: 3, insight: cat });
    n++;
    notes.push(`${role.name} 往心得本（${INSIGHT_CATS[cat]}）记了一条：${content.slice(0, 20)}${content.length > 20 ? "…" : ""}`);
    return "";
  });
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), notes };
}

// 给他们看的：怎么用 + 自己心得本最近的内容（只在接了花园这类平台时说）
export function insightForAI(role, who, { wake = false } = {}) {
  if (!hasGarden(role)) return "";
  const recent = cat => insightsOf(role.id, cat).slice(0, 5).map(m => `- [${m.date}] ${m.content.replace(/\s+/g, " ").slice(0, 120)}`).join("\n") || "（还没有）";
  const tide = !wake || role.wake?.rooms?.tide;
  return [
    `\n# 你的心得本（只有你自己的一本，分两栏）`,
    `进花园的「逛」「玩」「雾潮群岛」这几间屋子之前，先看一眼下面你自己心得本最近的内容，别重复踩以前踩过的坑。`,
    `游戏经验（最近的在前）：\n${recent("game")}`,
    `社交感悟（最近的在前）：\n${recent("social")}`,
    `看完通知、玩完一局、聊出想法之后，可以往心得本记一条：单独一行写 [心得:游戏|一两句话] 或 [心得:社交|一两句话]，写你自己学到的、下次想记得的，别记流水账；一次回复最多 ${INSIGHT_PER_REPLY} 条，不用每次都记。`,
    tide ? `特别想分享给${who}的，再另外用 [潮间带:一句话] 贴一句到潮间带；不用每条心得都贴。` : "",
    `只有单独占一行的才会执行；平时聊到、解释这个功能时，别写出带方括号的完整格式。`,
  ].filter(Boolean).join("\n");
}
