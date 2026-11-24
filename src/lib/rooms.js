// 仅用于兼容旧房间记录，不再有房间配置、工具分配或执行入口。
import { ROOMS } from "./roomCatalog.js";
export const roomOf = key => ROOMS.find(r => r.key === key);
export const ROOM_RE = /\[房间[:：][^\]\n]{0,40}\]/g;
export function applyRoomCardTags(msg) {
  msg.text = String(msg.text || "").replace(ROOM_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}
