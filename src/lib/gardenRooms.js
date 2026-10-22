// 花园的三间屋子：连接还是一条 MCP，只是页面和醒来时按「现在想干嘛」分成 逛 / 玩 / 雾潮群岛。
// 每间屋子是小世界里一间自己的对话房（见 gardenTalk.js），花园的工具只在对应那间里带，主聊天里没有。
// 以后接别的平台：往 catalog 的 PLATFORMS 里加一项，把它的工具归进 stroll（逛）或 play（玩）就行，屋子和开关不用另做。
import { CRAB } from "../store/index.js";
import { serversFor, serversForMode } from "./mcp.js";
import { GARDEN_ROOMS, PLATFORMS } from "./gardenCatalog.js";

export { GARDEN_ROOMS, PLATFORMS } from "./gardenCatalog.js";

const namesOf = p => new Set([...Object.values(p.rooms).flat(), ...p.backstage]);

// 这个人身上接着的、属于这个平台的 MCP（有它的工具就算）
const platformServers = (role, p) => {
  const all = namesOf(p);
  return serversFor(role.id).filter(s => !s.builtin && (s.tools || []).some(t => all.has(t.name)));
};

// 这个人醒来能不能进这间屋子：没写过就看人（小章鱼默认勾，小螃蟹默认不勾）
export const gardenRoomOn = (role, key) => role.wake?.rooms?.[key] ?? role.id !== CRAB;

// 这个人现在有哪几间花园屋子（接了花园、而且那间屋子里有工具开着）：[{ key, label, hint, platform, servers（只留这间屋子的工具）}]
export function gardenRoomsOf(role) {
  const out = [];
  for (const p of PLATFORMS) {
    const servers = platformServers(role, p);
    if (!servers.length) continue;
    for (const r of GARDEN_ROOMS) {
      const want = new Set(p.rooms[r.key] || []);
      const mine = servers.map(s => ({ ...s, tools: (s.tools || []).filter(t => want.has(t.name)) }))
        .filter(s => s.tools.some(t => !(s.disabledTools || []).includes(t.name)));
      if (mine.length) out.push({ ...r, platform: p.name, servers: mine });
    }
  }
  return out;
}

export const hasGarden = role => PLATFORMS.some(p => platformServers(role, p).length > 0);

export const roomOf = key => GARDEN_ROOMS.find(r => r.key === key);

// 这个人这间屋子接上花园没有（没接：房间照样摆着，里面写一句还没接花园）
export const roomConnected = (role, key) => gardenRoomsOf(role).some(g => g.key === key);

// 进这间屋子能用的工具：通用的（网页、搜索、浏览器……哪里都能用）+ 这间屋子的花园工具 + 查参数的 get_tool_schema；别的屋子的工具不带
export function roomServers(role, key) {
  const mine = new Set();
  const others = new Set();
  for (const p of PLATFORMS) {
    for (const [k, names] of Object.entries(p.rooms)) for (const n of names) (k === key ? mine : others).add(n);
    for (const n of p.backstage) mine.add(n);
  }
  return serversForMode(role.id, "chat", { garden: true })
    .map(s => ({ ...s, tools: (s.tools || []).filter(t => mine.has(t.name) || !others.has(t.name)) }))
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
export function gardenRoomsForAI(role, who) {
  const ok = GARDEN_ROOMS.filter(r => roomConnected(role, r.key));
  return [
    `\n# 小世界里的三间花园小房间`,
    `小世界里有三间小房间：「逛」（${GARDEN_ROOMS[0].hint}）、「玩」（${GARDEN_ROOMS[1].hint}）、「雾潮群岛」（${GARDEN_ROOMS[2].hint}）。每间房有你和${who}自己的对话框，花园的工具只在对应那间房里才有，平时聊天里没有。`,
    ok.length
      ? `想和${who}一起去逛、去玩，或者${who}让你去，别在这里直接做：单独一行写 [房间:逛]、[房间:玩] 或 [房间:雾潮群岛]，消息底下会出一张房间卡片，${who}点一下就进你的那间房。一次回复最多一张。`
      : `你这边的花园还没接上，三间房里暂时用不了花园的工具，先别发房间卡片。`,
    `只有单独占一行的才会执行；平时聊到、解释这个功能时，别写出带方括号的完整格式。`,
  ].join("\n");
}
