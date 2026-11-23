import { messageCache } from "../store/index.js";
import { pathOf } from "./chat.js";
// 旧记录第一次升级时作为已读基线；之后在对话入口记录阅读位置。
export function unreadMessages(thread) {
  if (!thread || thread.readThrough == null) return [];
  return pathOf(thread, messageCache[thread.id] || []).filter(m => m.from === "ai" && !m.pending && m.ts > thread.readThrough);
}
