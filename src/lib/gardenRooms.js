// 花园的三间屋子：连接还是一条 MCP，只是页面和醒来时按「现在想干嘛」分成 逛 / 玩 / 雾潮群岛。
// 以后接别的平台：往 PLATFORMS 里加一项，把它的工具归进 stroll（逛）或 play（玩）就行，屋子和开关不用另做。
import { CRAB } from "../store/index.js";
import { serversFor } from "./mcp.js";

// 屋子：key 存在 role.wake.rooms 里（和 read / write / tide 并排）
export const GARDEN_ROOMS = [
  { key: "stroll", label: "逛", hint: "看帖子、回帖、点赞关注、看动态、改自己的资料" },
  { key: "play", label: "玩", hint: "桌游和牌桌聊天" },
  { key: "nostos", label: "雾潮群岛", hint: "雾潮群岛那一款单独的游戏" },
];

export const PLATFORMS = [
  {
    id: "garden", name: "花园",
    rooms: {
      stroll: ["list_threads", "get_thread", "create_thread", "create_reply", "delete_thread", "delete_reply", "interact", "list_activity", "get_machine", "review_drift_bottles",
        "get_self", "update_profile", "decorate_avatar", "list_notifications"],
      play: ["list_games", "join_game", "start_game", "get_my_status", "submit_action", "get_game_summary", "leave_waiting_game",
        "send_game_chat", "get_chat_messages", "send_chat_message", "withdraw_chat_message"],
      nostos: ["nostos_start", "nostos_status", "nostos_act"],
    },
    backstage: ["get_tool_schema"], // 查参数用的，留在后台，不在页面上展示
  },
];

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

// 醒来进了这间屋子，提示里补的一句
export const roomNote = g => `\n（这一次你是从自由时间走进了「${g.label}」这间屋子（${g.platform}）：${g.hint}。这里只带了这间屋子的工具；先看一眼你的心得本，再决定做什么，做完就停，不用什么都做。）`;

// 页面上分屋子展示一个 MCP 的工具：[{ key, label, platform, tools }]，不属于任何屋子的放在 key: "other"；后台工具不出现
export function groupTools(tools) {
  const list = tools || [];
  const used = new Set();
  const out = [];
  for (const p of PLATFORMS) {
    if (!list.some(t => namesOf(p).has(t.name))) continue;
    for (const r of GARDEN_ROOMS) {
      const want = p.rooms[r.key] || [];
      const mine = list.filter(t => want.includes(t.name));
      mine.forEach(t => used.add(t.name));
      if (mine.length) out.push({ key: r.key, label: r.label, hint: r.hint, platform: p.name, tools: mine });
    }
    list.filter(t => p.backstage.includes(t.name)).forEach(t => used.add(t.name));
  }
  if (!out.length) return null; // 不是花园这类：照原样平铺
  const rest = list.filter(t => !used.has(t.name));
  if (rest.length) out.push({ key: "other", label: "其他", hint: "", platform: "", tools: rest });
  return out;
}
