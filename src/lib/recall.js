// 翻聊天记录、记忆卡片：他用「翻记忆」，你在记忆页里搜，用的都是这里
import { store, threadsOf, loadMessages, roleById } from "../store/index.js";
import { activePath } from "./tree.js";
import { memoriesOf, markUsed } from "./memoryTags.js";
import { lettersOf } from "./letters.js";
import { exactRank, bm25Rank, fuse, parseWhen, parseKinds, KINDS } from "./rank.js";

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


// ---------- 他翻记忆 ----------
// [翻记忆:关键词] 或 [翻记忆:关键词|范围|时间]：范围是 聊天 / 共读 / 共写 / 信 / 卡片 / 摘要，时间像「最近一周」「上个月」「2026-10」「10月3日」。
// 去哪找：所有对话（含邮箱那边）里你们说的话、共写的讨论、书里的划线批注、来往的信、记忆卡片、各处的摘要。
// 怎么排：精确 + BM25，RRF 合起来（见 rank.js）。聊天找到的那句，前后各带一句
export function parseRecall(raw) {
  const [q = "", ...rest] = String(raw || "").split(/[|｜]/).map(s => s.trim());
  let kinds = null, when = null;
  for (const x of rest) {
    const w = parseWhen(x);
    if (w) { when = w; continue; }
    const k = parseKinds(x);
    if (k) kinds = k;
  }
  return { q, kinds, when };
}
async function docsOf(role, me, skip) {
  const docs = [];
  const name = f => (f === "user" || f === "me" ? me : role.name);
  for (const t of threadsOf(role.id)) {
    const path = activePath(await loadMessages(t.id), t.sel || {}).filter(m => !m.pending && !m.error && (m.from === "user" || m.from === "ai"));
    path.forEach((m, i) => {
      const text = plainOf(m);
      if (!text || skip?.has(m.id)) return; // 他眼前就看得到的（这个对话最近的）不用翻
      docs.push({ kind: "chat", text, ts: m.ts, who: name(m.from), where: t.mail ? "邮箱那边" : `「${t.title || "对话"}」`, prev: path[i - 1], next: path[i + 1] });
    });
    if (t.summary?.text) docs.push({ kind: "sum", text: t.summary.text, ts: t.summary.at, where: `对话「${t.title || ""}」的摘要` });
  }
  const { projects, loadTalk, ideaBox, cardsOf } = await import("./writing.js");
  const box = ideaBox();
  if (box) for (const c of cardsOf(box.id)) {
    const g = (box.groups || []).find(x => x.id === c.groupId);
    docs.push({ kind: "write", text: `${c.title} ${c.content} ${(c.tags || []).join(" ")}`, ts: c.ts, who: c.from === "ai" ? role.name : me, where: g ? `灵感抽屉·以前的书《${g.title}》的卡片` : "灵感抽屉的卡片" });
  }
  for (const p of [...projects(), ...(box ? [box] : [])]) {
    const at = p.kind === "ideas" ? "灵感抽屉" : `共写《${p.title}》`;
    for (const m of await loadTalk(p.id)) if (m.text) docs.push({ kind: "write", text: m.text, ts: m.ts, who: name(m.from), where: at });
    if (p.talkSum?.text) docs.push({ kind: "sum", text: p.talkSum.text, ts: p.talkSum.at, where: `${at}的讨论摘要` });
  }
  for (const n of store.bookNotes || []) {
    const b = (store.books || []).find(x => x.id === n.bookId);
    if (!b || !(n.text || n.quote)) continue;
    docs.push({ kind: "read", text: `${n.quote ? `「${n.quote}」` : ""}${n.text ? " " + n.text : ""}`, ts: n.ts, who: n.from === "me" ? me : role.name, where: `共读《${b.title}》${n.text ? "的批注" : "的划线"}` });
  }
  for (const b of store.books || []) for (const x of b.imprs || []) docs.push({ kind: "read", text: x.text, ts: x.at, who: role.name, where: `共读《${b.title}》的中途印象` });
  for (const l of lettersOf(role.id)) {
    if (l.locked) continue;
    docs.push({ kind: "letter", text: `${l.title} ${l.body}`, ts: l.ts, who: l.from === "me" ? me : role.name, where: `信「${l.title || "没有标题"}」` });
  }
  for (const m of memoriesOf(role.id)) {
    if (!["valid", "obsolete", undefined].includes(m.status)) continue;
    docs.push({ kind: "card", text: `${m.title} ${m.content} ${(m.tags || []).join(" ")}`, ts: m.ts, card: m, pinned: m.access === "pinned", importance: m.importance, obsolete: m.status === "obsolete" });
  }
  return docs;
}
export async function searchAll(role, raw, me, { limit = 16, skip } = {}) {
  const { q, kinds, when } = parseRecall(raw);
  let docs = await docsOf(role, me, skip);
  if (kinds) docs = docs.filter(d => kinds.has(d.kind));
  if (when) docs = docs.filter(d => d.ts >= when[0] && d.ts < when[1]);
  // 只给了范围、时间，没给关键词：按时间排
  const ranked = q ? fuse([exactRank(docs, q), bm25Rank(docs, q)]) : docs.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  // 别让一种挤满：卡片最多 6、摘要最多 3
  const cap = { card: 6, sum: 3 }, n = {};
  const out = [];
  for (const d of ranked) {
    n[d.kind] = (n[d.kind] || 0) + 1;
    if (cap[d.kind] && n[d.kind] > cap[d.kind]) continue;
    out.push(d);
    if (out.length >= limit) break;
  }
  return { q, kinds, when, hits: out, pool: docs.length };
}
const day = ts => new Date(ts).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const short = (s, n) => { const t = String(s || "").replace(/\s+/g, " "); return t.length > n ? t.slice(0, n) + "…" : t; };
export function hitLine(d, q, me, role) {
  if (d.kind === "card") return `· 记忆卡片 #${d.card.id.slice(0, 4)} [${d.card.date}] ${d.card.title}：${short(d.card.content, 300)}${d.obsolete ? "（已过时：以前是这样，现在不是了）" : ""}`;
  if (d.kind === "sum") return `· ${d.where}里：${snippet(d.text, q, 120)}`;
  const ctx = d.kind === "chat" ? [d.prev && `前一句 ${d.prev.from === "user" ? me : role.name}：${short(plainOf(d.prev), 50)}`, d.next && `后一句 ${d.next.from === "user" ? me : role.name}：${short(plainOf(d.next), 50)}`].filter(Boolean).join("；") : "";
  return `· ${d.where} [${day(d.ts)}] ${d.who}：${snippet(d.text, q, 80)}${ctx ? `（${ctx}）` : ""}`;
}
// 给他看的结果
export async function recallForAI(role, raw, me, { skip } = {}) {
  const r = await searchAll(role, raw, me, { skip });
  const scope = [r.kinds && [...r.kinds].map(k => KINDS[k]).join("、"), r.when && `${new Date(r.when[0]).toLocaleDateString("zh-CN")} 到 ${new Date(r.when[1] - 1).toLocaleDateString("zh-CN")}`].filter(Boolean).join("，");
  store.searchLog ??= [];
  const cards = r.hits.filter(d => d.kind === "card").map(d => d.card);
  markUsed(cards);
  store.searchLog.unshift({ roleId: role.id, ts: Date.now(), q: String(raw).slice(0, 60), count: r.hits.length, ids: cards.map(m => m.id) });
  store.searchLog.splice(50);
  const head = scope ? `（只在 ${scope} 里找的）\n` : "";
  return { count: r.hits.length, text: r.hits.length ? head + r.hits.map(d => hitLine(d, r.q, me, role)).join("\n") : `${head}（没有找到和「${r.q || raw}」有关的。换个说法、少一点字、或者放宽范围和时间再找找，或者就照实说记不清了。）` };
}

// 你收藏的聊天
export const isFav = m => (store.favorites || []).some(f => f.msgId === m.id);
export function toggleFav(thread, m) {
  store.favorites ??= [];
  const i = store.favorites.findIndex(f => f.msgId === m.id);
  if (i >= 0) { store.favorites.splice(i, 1); return false; }
  store.favorites.unshift({ id: m.id, msgId: m.id, threadId: thread.id, roleId: thread.roleId || m.who, from: m.from, text: plainOf(m), ts: m.ts, savedAt: Date.now() });
  return true;
}
export const whoName = (f, me) => (f.from === "user" ? me : roleById(f.roleId)?.name || "他");
