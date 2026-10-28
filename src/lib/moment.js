// 【此刻】：最近 24 小时里发生的事，附在最新那条消息前面给他看（每次都现算，不进系统提示）
//   信箱：24 小时里寄出、读过的信，一共最多 3 封（标题 + 第一句）；她新寄来的信他读一次全文；他寄出的信她还没拆，一直挂着直到拆开
//   共读：24 小时里读过的每本书分开记——书名、进度、最新的印象、24 小时里来往的划线批注（每本最多 3 条）
//   他自己记的：[此刻:…] 最多 3 条、每条 35 字以内，24 小时后自动忘
// 存的都是准确的时间戳，「3 小时前」是给他看的那一刻才算出来的
import { store, uid, solo } from "../store/index.js";
import { lettersOf } from "./letters.js";
import { tideMoment } from "./meanwhile.js";
import { ROOMS } from "./roomCatalog.js";

export const DAY = 86400_000;
export const MOMENT_MAX = 3;
export const MOMENT_LEN = 35;
export const MOMENT_RE = /\[此刻[:：]([^\]]{1,200})\]/g;

const ms = t => (typeof t === "number" ? t : t ? +new Date(t) : 0);
export const within = (t, span = DAY) => !!ms(t) && Date.now() - ms(t) < span;
export function ago(t) {
  const m = Math.floor((Date.now() - ms(t)) / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} 小时前` : `${Math.floor(h / 24)} 天前`;
}
const first = s => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  const m = t.match(/^.*?[。！？!?…]/);
  const one = (m ? m[0] : t);
  return one.length > 40 ? one.slice(0, 40) + "…" : one;
};

// ---------- 他自己记在此刻的 ----------
// 此刻只有一份全局的：主聊天、各间小房间、共读共写、醒来都带这一份。
// 在房间里记的，内容前面加房间名（「逛：……」）；以前每间房自己记的（带 room 字段）并回这一份
const roomLabel = key => (key === "group" ? "群聊" : ROOMS.find(r => r.key === key)?.label || "");
export const momentText = m => (m.room && roomLabel(m.room) && !m.text.startsWith(`${roomLabel(m.room)}：`) ? `${roomLabel(m.room)}：${m.text}` : m.text);
export const momentsOf = roleId => (store.moments || []).filter(x => x.roleId === roleId && within(x.ts)).sort((a, b) => a.ts - b.ts);
export function pruneMoments() {
  if (store.moments?.some(x => !within(x.ts))) store.moments = store.moments.filter(x => within(x.ts));
  // 旧的房间此刻：名字写进内容，并回全局
  for (const x of store.moments || []) if (x.room) { x.text = momentText(x); delete x.room; }
}
// room：在小房间里记的（"stroll" 等），内容前面加房间名；不写就是主聊天里记的
export function addMoment(role, text, room = "") {
  pruneMoments();
  const t = String(text || "").replace(/\s+/g, " ").trim().slice(0, MOMENT_LEN);
  if (!t) return null;
  const full = room && roomLabel(room) ? `${roomLabel(room)}：${t}` : t;
  store.moments ??= [];
  const mine = momentsOf(role.id);
  if (mine.some(x => x.text === full)) return null;
  // 满了：最早的那条让位
  for (const old of mine.slice(0, Math.max(0, mine.length - MOMENT_MAX + 1))) store.moments.splice(store.moments.indexOf(old), 1);
  const m = { id: uid(), roleId: role.id, text: full, ts: Date.now() };
  store.moments.push(m);
  return m;
}
export function removeMoment(m) {
  const i = (store.moments || []).indexOf(m);
  if (i >= 0) store.moments.splice(i, 1);
}
export function applyMomentTags(role, text, room = "") {
  const notes = [];
  const clean = text.replace(MOMENT_RE, (_, body) => {
    const m = addMoment(role, body, room);
    if (m) notes.push(`${role.name} 在此刻里记下：${m.text}`);
    return "";
  });
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), notes };
}
export const momentRule = me =>
  `接下来 24 小时里想一直记着的小事（比如因为什么有了什么心情、答应了${me}待会儿要做的事），可以在回复末尾另起一行写：[此刻:内容]，${MOMENT_LEN} 字以内，最多同时记 ${MOMENT_MAX} 条，24 小时后自动忘。此刻只有一份，主聊天、各间小房间、共读共写、醒来都看得到这一份（在小房间里记的，系统会自动在前面加上房间名）。要长久记住的还是写进记忆卡片。`;

// ---------- 信箱 ----------
// peek：只是看看（记忆库、场景里用），不把信记成他读过了；brief：新来的信也只给标题和第一句
export function lettersMoment(role, who, { peek = false, brief = false } = {}) {
  const all = lettersOf(role.id);
  const parts = [];
  const shown = new Set();
  for (const l of all.filter(l => l.from === "me" && !l.locked && !l.readAt).slice(0, 3)) {
    shown.add(l.id);
    parts.push(brief
      ? `${who}寄来一封信「${l.title || "没有标题"}」（${ago(l.ts)}）：${first(l.body)}（回到聊天时你会读到全文）`
      : `${who}寄来一封信（${ago(l.ts)}寄出）——\n标题：${l.title || "（没有标题）"}\n${l.body}\n${l.sign ? `——${l.sign}` : ""}`);
    if (!peek && !brief) l.readAt = Date.now();
  }
  // 他寄的、她还没拆的：一直挂着，直到她拆开
  for (const l of all.filter(l => l.from !== "me" && !l.readAt)) {
    shown.add(l.id);
    parts.push(`你寄给${who}的信「${l.title}」（${ago(l.ts)}寄出），${who}还没拆开。`);
  }
  // 24 小时里寄出、读过的（一共最多 3 封）
  const lastTouch = l => Math.max(ms(l.ts), within(l.readAt) ? ms(l.readAt) : 0);
  const log = all.filter(l => !shown.has(l.id) && !l.locked && (within(l.ts) || within(l.readAt))).sort((a, b) => lastTouch(b) - lastTouch(a)).slice(0, 3).reverse();
  for (const l of log) {
    const mine = l.from === "me";
    const read = l.readAt ? (mine ? `你读过（${ago(l.readAt)}）` : `${who}拆开了（${ago(l.readAt)}）`) : "";
    parts.push(`- ${mine ? `${who}寄给你` : `你寄给${who}`}「${l.title || "没有标题"}」（${ago(l.ts)}寄出${read ? "，" + read : ""}）：${first(l.body)}`);
  }
  const locked = all.filter(l => l.from === "me" && l.locked).length;
  if (locked) parts.push(`（信箱里还有 ${locked} 封${who}上了锁的信，你还读不到。）`);
  return parts.join("\n");
}

// ---------- 共读 ----------
export function readingMoment(role, who, { peek = false } = {}) {
  const books = (store.books || []).filter(b => within(b.readAt)).sort((a, b) => b.readAt - a.readAt);
  const blocks = [];
  for (const b of books) {
    const c = b.pos?.ch || 0;
    const lines = [`《${b.title}》（${who} ${ago(b.readAt)}读过）：读到「${b.chapters[c]?.title || "开头"}」，第 ${c + 1} / ${b.chapters.length} 章。${b.hisPos ? `你一起读到第 ${b.hisPos.ch + 1} 章。` : ""}`];
    const im = (b.imprs || []).at(-1);
    if (im) lines.push(`  你最新的中途印象（${ago(im.at)}）：${im.text}`);
    const notes = (store.bookNotes || []).filter(n => n.bookId === b.id && within(n.ts)).sort((x, y) => x.ts - y.ts).slice(-3);
    if (notes.length) lines.push(`  24 小时里的划线和批注（${notes.length} 条，旧的在前）：`);
    for (const n of notes) {
      const where = b.chapters[n.ch]?.title ? `「${b.chapters[n.ch].title}」` : "";
      const q = (n.quote || "").slice(0, 60);
      lines.push(n.from === "me"
        ? `  - ${ago(n.ts)} ${who}${n.text ? "批注" : "划线"}${where}：「${q}」${n.text ? ` —— ${n.text.slice(0, 200)}` : ""}`
        : `  - ${ago(n.ts)} 你贴的便利贴${where}：「${q}」—— ${(n.text || "").slice(0, 200)}`);
      if (!peek && n.from === "me") n.seen = true;
    }
    blocks.push(lines.join("\n"));
  }
  // 读后感：不管什么时候写的，他没看过就给他看一次
  for (const b of store.books || []) {
    if (b.mine?.text && !b.mine.seen) {
      blocks.push(`${who}读完了《${b.title}》，打了 ${b.mine.stars} 颗星，写了读后感：${b.mine.text.slice(0, 500)}`);
      if (!peek) b.mine.seen = true;
    }
  }
  return blocks.join("\n");
}

// ---------- 合起来 ----------
export function momentParts(role, who, opt = {}) {
  const mine = momentsOf(role.id);
  return [
    { key: "letters", title: "信箱", text: lettersMoment(role, who, opt) },
    ...(solo(role) ? [] : [{ key: "read", title: "共读", text: readingMoment(role, who, opt) }]), // 共读还没给小螃蟹接
    { key: "tide", title: "潮间带（你们三个人共用的生活记录页）", text: tideMoment(role, opt) },
    { key: "self", title: "你自己记在此刻的（24 小时后自动忘）", text: mine.map(m => `- ${ago(m.ts)}：${momentText(m)}`).join("\n") },
  ];
}
export function momentForAI(role, who, opt = {}) {
  const parts = momentParts(role, who, opt).filter(p => p.text);
  return parts.length ? `\n# 最近 24 小时\n${parts.map(p => `## ${p.title}\n${p.text}`).join("\n")}` : "";
}
