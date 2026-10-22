// 心得本：每个人一本，分三栏（游戏经验 / 社交感悟 / 雾潮群岛）。
//   写法（单独一行）：[心得:游戏|游戏名|一两句话]   [心得:社交|一两句话]   [心得:雾潮群岛|一两句话]（也认「游戏经验」「社交感悟」「雾潮」）
//   游戏心得带游戏名（存在 m.game）；没写游戏名的旧心得、写漏了的归「其他」
//   小世界里的房间（逛 / 玩 / 雾潮群岛）各看自己那一栏，记的是同一份数据：这边删了那边也没有
//   存在 store.memories 里，带 insight: "game" | "social" | "nostos"：跟着记忆一起同步、一起合并；memKind 是 "insight"，不混进记忆卡片，也不自动想起
//   写错的（没写栏目、没内容）悄悄丢掉，不露原始标记；删掉的放进回收站状态（status: deleted），同步时不会又冒出来
import { store, uid } from "../store/index.js";
import { todayYmd } from "./dates.js";
import { roomOf, roomIntro } from "./rooms.js";
import { ROOMS } from "./roomCatalog.js";

export const INSIGHT_CATS = { game: "游戏经验", social: "社交感悟", nostos: "雾潮群岛" };
export const INSIGHT_RE = /\[心得[:：]([^\]]{0,700})\]/g; // 写成什么样都先拿掉，写错的不露出来
export const INSIGHT_PER_REPLY = 3;
const CAT_WORDS = { 游戏: "game", 游戏经验: "game", 玩: "game", 社交: "social", 社交感悟: "social", 逛: "social", 雾潮群岛: "nostos", 雾潮: "nostos", 群岛: "nostos" };

export const insightsOf = (roleId, cat) =>
  store.memories.filter(m => m.insight && m.roleId === roleId && m.status !== "deleted" && (!cat || m.insight === cat)).sort((a, b) => (b.ts || 0) - (a.ts || 0));

// 游戏心得按游戏名分组（没有游戏名的归「其他」，排在最后）：[{ game, list }]，每组里新的在前
export const OTHER_GAME = "其他";
export function groupByGame(list) {
  const map = new Map();
  for (const m of list) {
    const g = (m.game || "").trim() || OTHER_GAME;
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(m);
  }
  return [...map].map(([game, l]) => ({ game, list: l })).sort((a, b) => (a.game === OTHER_GAME) - (b.game === OTHER_GAME) || (b.list[0].ts || 0) - (a.list[0].ts || 0));
}

export function removeInsight(m) { m.statusBefore = m.status; m.status = "deleted"; m.deletedAt = Date.now(); }

export function applyInsightTags(role, text) {
  const notes = [];
  if (!/\[心得[:：]/.test(text || "")) return { text, notes };
  let n = 0;
  const clean = String(text).replace(INSIGHT_RE, (_, body) => {
    const parts = body.split(/[|｜]/).map(x => x.trim());
    const cat = parts.length > 1 ? CAT_WORDS[parts[0]] : null;
    // 游戏心得：[心得:游戏|游戏名|内容]；游戏名没写（只有两段）就归「其他」
    const game = cat === "game" && parts.length >= 3 && parts[1].length <= 20 ? parts[1].replace(/[《》「」]/g, "") : "";
    const content = parts.slice(game ? 2 : 1).join(" ").trim().slice(0, 400);
    if (!cat || !content || n >= INSIGHT_PER_REPLY) return "";
    if (store.memories.some(m => m.insight === cat && m.roleId === role.id && m.status !== "deleted" && m.content === content && (m.game || "") === game)) return "";
    const now = Date.now();
    store.memories.push({ id: uid(), roleId: role.id, title: content.slice(0, 12), content, img: null, date: todayYmd(), author: role.id, ts: now, createdAt: now, updatedAt: now, status: "valid", access: "normal", source: { type: "chat", by: "ai" }, tags: [], importance: 3, insight: cat, ...(game ? { game } : {}) });
    n++;
    notes.push(`${role.name} 往心得本（${INSIGHT_CATS[cat]}${game ? `·${game}` : ""}）记了一条：${content.slice(0, 20)}${content.length > 20 ? "…" : ""}`);
    return "";
  });
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), notes };
}

// 一条心得给他看的样子
const insLine = (m, n = 120) => `- [${m.date}]${m.game ? `【${m.game}】` : ""} ${m.content.replace(/\s+/g, " ").slice(0, n)}`;

// 进房间时给他看的：这间房的介绍 + 这间房那一栏心得本最近几条 + 怎么记（房间里照旧带全）
export const ROOM_INSIGHTS = 4;
export function roomInsightForAI(role, who, key, { wake = false } = {}) {
  const room = roomOf(key);
  if (!room) return "";
  const recent = insightsOf(role.id, room.cat).slice(0, ROOM_INSIGHTS).map(m => insLine(m)).join("\n") || "（还没有）";
  const tide = !wake || role.wake?.rooms?.tide;
  const fmt = room.cat === "game" ? `[心得:游戏|游戏名|一两句话]（游戏名一定要写，比如 [心得:游戏|UNO|……]）` : `[心得:${INSIGHT_CATS[room.cat]}|一两句话]`;
  return [
    `这间「${room.label}」的介绍（${who}和你一起定的，固定的）：${roomIntro(role, key)}`,
    `你这间「${room.label}」的心得本（${INSIGHT_CATS[room.cat]}，最近几条，别重复踩以前踩过的坑）：\n${recent}`,
    `看完通知、玩完一局、聊出想法之后，可以往心得本记一条：单独一行写 ${fmt}。只记下次还用得上的经验（怎么做更好、哪里踩过坑），别记流水账；一次回复最多 ${INSIGHT_PER_REPLY} 条，不用每次都记。这本和记忆页「Drawers」里的心得本是同一本。`,
    tide ? `特别想分享给${who}的，再另外用 [潮间带:一句话] 贴一句到潮间带；不用每条心得都贴。` : "",
    `只有单独占一行的才会执行；平时聊到、解释这个功能时，别写出带方括号的完整格式。`,
  ].filter(Boolean).join("\n");
}

// 主聊天（以及别的房间、醒来）里带的房间板块记忆：三间的介绍 + 每间一点点最近的心得（不带房间对话摘要）
//   逛：最新三条；玩：最近两周有心得的游戏，每个游戏最新一条；雾潮群岛：最新一条
export const GAME_FRESH = 14 * 86400_000;
export function roomBoardText(role, { skip = "" } = {}) {
  const out = [];
  for (const r of ROOMS) {
    if (r.key === skip) continue;
    const all = insightsOf(role.id, r.cat);
    const pick = r.key === "stroll" ? all.slice(0, 3)
      : r.key === "play" ? groupByGame(all.filter(m => Date.now() - (m.ts || 0) < GAME_FRESH)).map(g => g.list[0])
      : all.slice(0, 1);
    out.push(`「${r.label}」：${roomIntro(role, r.key)}${pick.length ? `\n  最近的心得：\n${pick.map(m => "  " + insLine(m, 100)).join("\n")}` : ""}`);
  }
  return out.join("\n");
}
