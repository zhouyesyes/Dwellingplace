// 工具属于哪几间小房间：她自己勾（工具页每个工具后面的 逛 / 玩 / 雾潮群岛），可以多选。
// 按「哪个人 + 哪个 MCP + 哪个工具」各记一份：store.toolRooms = { "人|MCP的id|工具名": ["stroll", "play"] }；
// 没有这一项 = 还没分房间。chatgpt 和 CC 各勾各的，同一个 MCP 接给两个人、或两个 MCP 有同名工具，都不会互相带上。
// 第一次升级时，把原来按工具名记的勾法原样抄给两个人当起点（见 store 的 migrate），之后以她勾的为准。
// 主聊天里不带分进了房间的工具；房间里带勾进这间的 + 还没分房间的通用工具。
// 第四个勾「哪里都能用」记成房间键 "all"：勾了它，主聊天和每间房都带（别的三个勾不管）；浏览器默认就是这个。
export const EVERYWHERE = "all";
import { store } from "../store/index.js";
import { PLATFORMS } from "./roomCatalog.js";

export const BACKSTAGE = new Set(PLATFORMS.flatMap(p => p.backstage)); // 查参数用的：三间房里都带，主聊天里不带

// 原来的分法：{ 工具名: [房间…] }
export function defaultToolRooms() {
  const out = {};
  for (const p of PLATFORMS) for (const [room, names] of Object.entries(p.rooms)) for (const n of names) (out[n] ??= []).push(room);
  return out;
}

// server 可以是 MCP 本身，也可以直接给它的 id
export const toolRoomKey = (roleId, server, name) => `${roleId}|${server?.id ?? server}|${name}`;
export const roomsOfTool = (roleId, server, name) => store.toolRooms?.[toolRoomKey(roleId, server, name)] || [];
export const toolInRoom = (roleId, server, name, key) => roomsOfTool(roleId, server, name).includes(key);
export const toolEverywhere = (roleId, server, name) => toolInRoom(roleId, server, name, EVERYWHERE);
// 进这间房带不带：勾了这间 / 哪里都能用 / 查参数的 / 还没分房间
export const toolCarriedInRoom = (roleId, server, name, key) => BACKSTAGE.has(name) || !roomsOfTool(roleId, server, name).length || toolInRoom(roleId, server, name, key) || toolEverywhere(roleId, server, name);
// 分进了某间房（这个人的主聊天里就不带它）
export const isRoomTool = (roleId, server, name) => BACKSTAGE.has(name) || (roomsOfTool(roleId, server, name).length > 0 && !toolEverywhere(roleId, server, name));
export function setToolRoom(roleId, server, name, key, on) {
  store.toolRooms ??= {};
  const k = toolRoomKey(roleId, server, name);
  const cur = new Set(roomsOfTool(roleId, server, name));
  if (on) cur.add(key); else cur.delete(key);
  if (cur.size) store.toolRooms[k] = [...cur];
  else delete store.toolRooms[k];
}
// 给还没见过的工具填默认房间（浏览器的工具默认「哪里都能用」，chatgpt 和 CC 都是）
export function defaultToolRoom(roleIds, server, names, key) {
  store.toolRooms ??= {};
  for (const r of roleIds) for (const n of names) store.toolRooms[toolRoomKey(r, server, n)] ??= [key];
}
