// 工具属于哪几间小房间：她自己勾（工具页每个工具后面的 逛 / 玩 / 雾潮群岛），可以多选。
// store.toolRooms = { 工具名: ["stroll", "play"] }；没有这个工具名 = 还没分房间。
// 第一次升级时，用 roomCatalog.js 里原来的分法当默认值写进去（见 store 的 migrate），之后以她勾的为准。
// 主聊天里不带分进了房间的工具；房间里带勾进这间的 + 还没分房间的通用工具。
import { store } from "../store/index.js";
import { PLATFORMS } from "./roomCatalog.js";

export const BACKSTAGE = new Set(PLATFORMS.flatMap(p => p.backstage)); // 查参数用的：三间房里都带，主聊天里不带

// 原来的分法：{ 工具名: [房间…] }
export function defaultToolRooms() {
  const out = {};
  for (const p of PLATFORMS) for (const [room, names] of Object.entries(p.rooms)) for (const n of names) (out[n] ??= []).push(room);
  return out;
}

export const roomsOfTool = name => store.toolRooms?.[name] || [];
export const toolInRoom = (name, key) => roomsOfTool(name).includes(key);
// 分进了某间房（主聊天里就不带它）
export const isRoomTool = name => BACKSTAGE.has(name) || roomsOfTool(name).length > 0;
export function setToolRoom(name, key, on) {
  store.toolRooms ??= {};
  const cur = new Set(roomsOfTool(name));
  if (on) cur.add(key); else cur.delete(key);
  if (cur.size) store.toolRooms[name] = [...cur];
  else delete store.toolRooms[name];
}
