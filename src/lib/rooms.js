// 小房间：房间是容器（逛 / 玩 / 雾潮群岛……），每间房装着一组工具；哪个工具进哪间房由她在工具页自己勾（toolRooms.js）。
// 每间房是小世界里一间自己的对话房（见 gardenTalk.js），房间的工具只在对应那间里带，主聊天里没有。
// 新导入的工具默认不进任何房间（还没分房间）：主聊天和各间房里都照常带，勾进房间以后才只在那间房里带。
import { CRAB, store } from "../store/index.js";
import { serversFor, serversForMode } from "./mcp.js";
import { ROOMS, PLATFORMS } from "./roomCatalog.js";
import { roomsOfTool, toolInRoom, BACKSTAGE } from "./toolRooms.js";

export { ROOMS, PLATFORMS } from "./roomCatalog.js";

// 这个人身上接着的、有工具分进了小房间的 MCP（工具分房间见 toolRooms.js，她自己在工具页勾）
const roomServersOf = role => serversFor(role.id).filter(s => !s.builtin && (s.tools || []).some(t => roomsOfTool(t.name).length));

// 这个人醒来能不能进这间屋子：没写过就看人（小章鱼默认勾，小螃蟹默认不勾）
export const roomOn = (role, key) => role.wake?.rooms?.[key] ?? role.id !== CRAB;

// 这个人现在有哪几间房接上了工具（那间房里有工具开着）：[{ key, label, hint, platform, servers（只留这间屋子的工具）}]
export function roomsOf(role) {
  const out = [];
  const servers = roomServersOf(role);
  for (const r of ROOMS) {
    const mine = servers.map(s => ({ ...s, tools: (s.tools || []).filter(t => toolInRoom(t.name, r.key)) }))
      .filter(s => s.tools.some(t => !(s.disabledTools || []).includes(t.name)));
    if (mine.length) out.push({ ...r, platform: mine.map(s => s.name).join("、"), servers: mine });
  }
  return out;
}

export const hasRoomTools = role => roomServersOf(role).length > 0;

export const roomOf = key => ROOMS.find(r => r.key === key);

// 房间介绍：每个人每间房一段固定的话（记忆页「板块记忆」里改），平时进房间、主聊天里都带；没改过就用默认的
export const ROOM_INTRO_MAX = 200;
export const roomIntro = (role, key) => (store.roomIntros?.[`${role.id}:${key}`] || "").trim() || roomOf(key)?.intro || "";
export function setRoomIntro(role, key, text) {
  const t = String(text || "").replace(/\s+/g, " ").trim().slice(0, ROOM_INTRO_MAX);
  store.roomIntros ??= {};
  if (!t || t === roomOf(key)?.intro) delete store.roomIntros[`${role.id}:${key}`]; // 清空 = 回到默认
  else store.roomIntros[`${role.id}:${key}`] = t;
}

// 这个人这间房接上工具没有（没接：房间照样摆着，里面写一句还没接工具）
export const roomConnected = (role, key) => roomsOf(role).some(g => g.key === key);

// 进这间屋子能用的工具：通用的（网页、搜索、浏览器……哪里都能用）+ 这间房的工具 + 查参数的 get_tool_schema；别的屋子的工具不带
export function roomServers(role, key) {
  return serversForMode(role.id, "chat", { garden: true })
    .map(s => ({ ...s, tools: (s.tools || []).filter(t => toolInRoom(t.name, key) || BACKSTAGE.has(t.name) || !roomsOfTool(t.name).length) }))
    .filter(s => s.tools.length);
}

// ---------- 主聊天里的房间卡片 ----------
// 他想和她一起去逛 / 玩，在回复里单独一行写 [房间:逛]（也认「玩」「雾潮群岛」），消息底下就出一张房间卡片，点一下进到他的那间房。
// 解析出来存在消息上 msg.rooms = ["stroll"]；原始标记从文字里去掉，写错的（认不出是哪间）也悄悄丢掉，不露标记
export const ROOM_RE = /\[房间[:：][^\]\n]{0,40}\]/g;
const ROOM_WORDS = { 逛: "stroll", 玩: "play", 雾潮群岛: "nostos", 雾潮: "nostos", 群岛: "nostos" };
export function applyRoomCardTags(msg) {
  const found = [];
  msg.text = String(msg.text || "").replace(ROOM_RE, m => {
    const k = ROOM_WORDS[m.replace(/^\[房间[:：]/, "").replace(/\]$/, "").trim()];
    if (k && !found.includes(k)) found.push(k);
    return "";
  }).replace(/\n{3,}/g, "\n\n").trim();
  if (found.length && msg.id && !msg.wakeId) msg.rooms = found.slice(0, 1); // 一条消息一张
}
// 提示词：花园三间房在哪、怎么带她去（chatgpt、CC 都有）
export function roomsForAI(role, who) {
  const ok = ROOMS.filter(r => roomConnected(role, r.key));
  return [
    `\n# 小世界里的三间小房间`,
    `小世界里有三间小房间：${ROOMS.map(r => `「${r.label}」（${roomIntro(role, r.key)}）`).join("、")}。每间房有你和${who}自己的对话框，房间的工具只在对应那间房里才有，平时聊天里没有。`,
    `想和${who}一起去逛、去玩，或者${who}让你去，别在这里直接做：单独一行写 [房间:逛]、[房间:玩] 或 [房间:雾潮群岛]，消息底下会出一张房间卡片，同时你会立刻在那间房里开工（${who}在这里说的话会带进去当开头），不用等${who}点进去。卡片底下会自己显示你做到哪了，做完也不用回主聊天再说一遍；这里只说一两句，别假装已经做完了。一次回复最多一张。`,
    ok.length ? "" : `你这边的小房间还没接上工具：卡片照样可以发，但房间里什么也做不了，会提示还没接上工具，所以先别答应${who}一定能做到。`,
    `只有单独占一行的才会执行；平时聊到、解释这个功能时，别写出带方括号的完整格式。`,
  ].filter(Boolean).join("\n");
}
