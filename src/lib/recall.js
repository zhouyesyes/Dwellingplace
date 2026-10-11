// 翻聊天记录、记忆卡片：他用「翻记忆」，你在记忆页里搜，用的都是这里
import { store, threadsOf, loadMessages, roleById } from "../store/index.js";
import { activePath } from "./tree.js";
import { memoriesOf } from "./memoryTags.js";

const terms = q => String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
const hit = (text, ts) => { const t = String(text || "").toLowerCase(); return ts.length && ts.every(w => t.includes(w)); };
// 聊天里显示的文字：去掉签名、记忆这些标记，多条气泡连成一句
export const plainOf = m => String(m.text || "").replace(/\[(签名|记忆|改记忆|日历|改日历|删日历|搜索|翻记忆|闹钟)[:：][^\]]*\]/g, "").replace(/\n{2,}/g, " ").trim()
  || ((m.attachments || []).length ? "[图片/文件]" : "");
// 关键词前后各留一点
export function snippet(text, q, around = 60) {
  const t = String(text || "");
  const w = terms(q)[0];
  const i = w ? t.toLowerCase().indexOf(w) : -1;
  if (i < 0 || t.length <= around * 2) return t.length > around * 2 ? t.slice(0, around * 2) + "…" : t;
  const a = Math.max(0, i - around), b = Math.min(t.length, i + w.length + around);
  return (a ? "…" : "") + t.slice(a, b) + (b < t.length ? "…" : "");
}

// 搜聊天：这个 AI 的所有对话（只看现在显示的那条线），新的在前
export async function searchChats(roleId, q, { limit = 50 } = {}) {
  const ts = terms(q);
  if (!ts.length) return [];
  const out = [];
  for (const t of threadsOf(roleId)) {
    for (const m of activePath(await loadMessages(t.id), t.sel || {})) {
      if (m.pending || m.error || (m.from !== "user" && m.from !== "ai")) continue;
      const text = plainOf(m);
      if (hit(text, ts)) out.push({ thread: t, m, text });
    }
  }
  return out.sort((a, b) => b.m.ts - a.m.ts).slice(0, limit);
}

export function searchCards(roleId, q) {
  const ts = terms(q);
  return ts.length ? memoriesOf(roleId).filter(m => hit(`${m.title} ${m.content} ${m.date}`, ts)) : [];
}

// 给他看的结果
export async function recallForAI(role, q, me) {
  const cards = searchCards(role.id, q).slice(0, 8);
  const chats = (await searchChats(role.id, q, { limit: 12 }));
  const sums = threadsOf(role.id).map(t => t.summary?.text).filter(s => s && hit(s, terms(q)));
  const day = ts => new Date(ts).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const lines = [
    ...cards.map(c => `· 记忆卡片 [${c.date}] ${c.title}：${c.content.slice(0, 300)}`),
    ...sums.map(s => `· 你整理过的摘要里：${snippet(s, q, 120)}`),
    ...chats.map(r => `· 聊天 [${day(r.m.ts)}] ${r.m.from === "user" ? me : role.name}：${snippet(r.text, q, 80)}`),
  ];
  return { count: cards.length + chats.length + sums.length, text: lines.length ? lines.join("\n") : `（没有找到和「${q}」有关的。换个说法、少一点字再找找，或者就照实说记不清了。）` };
}

// 你收藏的聊天
export const isFav = m => (store.favorites || []).some(f => f.msgId === m.id);
export function toggleFav(thread, m) {
  store.favorites ??= [];
  const i = store.favorites.findIndex(f => f.msgId === m.id);
  if (i >= 0) { store.favorites.splice(i, 1); return false; }
  store.favorites.unshift({ id: m.id, msgId: m.id, threadId: thread.id, roleId: thread.roleId, from: m.from, text: plainOf(m), ts: m.ts, savedAt: Date.now() });
  return true;
}
export const whoName = (f, me) => (f.from === "user" ? me : roleById(f.roleId)?.name || "他");
