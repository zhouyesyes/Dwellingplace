// 章节管理（目录的「编辑」里）：改名、移除（先放进「已移除章节」，能恢复）、合并、从某一段切开、换一种规则重新分章。
// 每样操作都是：拼出新的章节表（每一段记着原来是第几章第几段），再把笔记、读到哪（你和他）、前情、印象……的位置挪过去，
// 正文和书架一起存（一个事务，失败就都不变）。
//   章节 id 不变：改名只改名字；切开时前半截留原来的 id，后半截新给一个；合并留第一章的 id
//   移除的章节：body.removed [{ id, title, paras, media, at（原来排第几）, removedAt }]；上面的笔记 ch 记成 -1、removedCh 记着章节 id
import { store, uid, prepareBookPersistence, commitBookTransaction } from "../store/index.js";
import { get } from "./kv.js";
import { replaceBookCache, shelfChapters, headingOf } from "./books.js";
import { splitLines } from "./chapterSplit.js";

const copy = x => JSON.parse(JSON.stringify(x));

// 旧书的章节没有 id：补上（EPUB 有书里自带的编号就用它）
function withIds(body) {
  const seen = new Set();
  for (const c of body.chapters) {
    c.id ||= c.sourceId || uid();
    while (seen.has(c.id)) c.id += "+";
    seen.add(c.id);
  }
  return body;
}

// 一章原样搬过去：每段记着来处
const keep = (c, ci) => ({ ...c, from: c.paras.map((_, p) => [ci, p]) });

// 把新的章节表存下来：挪位置、挪笔记，正文和书架一起写
async function commit(bookId, build) {
  await prepareBookPersistence();
  const saved = await get(`book:${bookId}`);
  if (!saved?.chapters?.length) throw Error("这本书的正文还没下载到这台设备");
  const oldBody = copy(saved);
  const body = withIds(copy(saved));
  const { chapters, removed = body.removed || [], restoredNotes = {} } = build(body);
  if (!chapters.length) throw Error("至少要留一章");
  // 原来第几章第几段 → 现在第几章第几段
  const map = new Map();
  chapters.forEach((c, ci) => c.from.forEach((f, p) => { if (f) map.set(`${f[0]}:${f[1]}`, [ci, p]); }));
  const chapterOf = new Map(chapters.map((c, ci) => [c.from.find(Boolean)?.[0], ci]));
  // 找不到的位置（那段成了标题、那章被移除）：同一章往后找最近的一段，再不行就下一章开头
  const moveTo = (ch, p) => {
    const hit = map.get(`${ch}:${p}`);
    if (hit) return { ch: hit[0], p: hit[1], exact: true };
    const old = body.chapters[ch];
    for (let q = p + 1; old && q < old.paras.length; q++) { const h = map.get(`${ch}:${q}`); if (h) return { ch: h[0], p: h[1] }; }
    for (let c = ch + 1; c < body.chapters.length; c++) if (chapterOf.has(c)) return { ch: chapterOf.get(c), p: 0 };
    for (let c = ch - 1; c >= 0; c--) if (chapterOf.has(c)) return { ch: chapterOf.get(c), p: 0 };
    return { ch: 0, p: 0 };
  };
  const walk = v => {
    if (!v || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    if (Number.isInteger(v.ch) && Number.isInteger(v.p) && v.ch >= 0) { const m = moveTo(v.ch, v.p); return { ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])), ch: m.ch, p: m.p }; }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
  };
  const removedIds = new Set(removed.map(r => r.id));
  const next = copy(store);
  const bi = next.books.findIndex(x => x.id === bookId);
  if (bi < 0) throw Error("这本书已不在书架上");
  const { chapters: _, ...rest } = next.books[bi];
  next.books[bi] = { ...walk(rest), chapters: shelfChapters(chapters) };
  next.bookNotes = (next.bookNotes || []).map(n => {
    if (n.bookId !== bookId) return n;
    if (n.removedCh) { // 移除章节上的笔记：章节恢复了就回来
      const at = restoredNotes[n.removedCh];
      if (at == null) return n;
      const { removedCh, ...m } = n;
      return { ...m, ch: at };
    }
    if (n.ch < 0) return n; // 覆盖导入时没对上的，原样留着
    const id = body.chapters[n.ch]?.id;
    if (id && removedIds.has(id) && !chapters.some(c => c.id === id)) return { ...n, ch: -1, removedCh: id };
    const m = moveTo(n.ch, n.p);
    const out = { ...n, ch: m.ch, p: m.p };
    if (!m.exact) { delete out.start; delete out.end; } // 那段成了标题之类：按摘录去找那句
    return out;
  });
  const clean = chapters.map(({ from, ...c }) => { if (c.media && !c.media.length) delete c.media; return c; });
  const nextBody = { ...body, chapters: clean, removed };
  if (!removed.length) delete nextBody.removed;
  await commitBookTransaction([[`book:${bookId}`, nextBody]], next, [[`book:${bookId}`, oldBody]]);
  replaceBookCache(bookId, nextBody);
  return nextBody;
}

// 改名：只改名字
export function renameChapter(bookId, index, title) {
  title = title.trim().slice(0, 60);
  if (!title) throw Error("名字不能空着");
  return commit(bookId, body => ({ chapters: body.chapters.map((c, ci) => ({ ...keep(c, ci), ...(ci === index ? { title } : {}) })) }));
}

// 移除几章：放进「已移除章节」（记着原来排在第几）
export function removeChapters(bookId, indexes) {
  const drop = new Set(indexes);
  return commit(bookId, body => {
    if (drop.size >= body.chapters.length) throw Error("至少要留一章");
    const now = Date.now();
    const removed = [...(body.removed || []), ...body.chapters.map((c, at) => ({ c, at })).filter(x => drop.has(x.at)).map(({ c, at }) => ({ ...c, at, removedAt: now }))];
    return { chapters: body.chapters.map(keep).filter((_, ci) => !drop.has(ci)), removed };
  });
}

// 恢复：放回原来的位置附近（原来第几章，就插回第几章；后面多出来的往后排）
export function restoreChapter(bookId, id) {
  return commit(bookId, body => {
    const r = (body.removed || []).find(x => x.id === id);
    if (!r) throw Error("这一章已经不在「已移除」里了");
    const { at, removedAt, ...c } = r;
    const chapters = body.chapters.map(keep);
    const i = Math.min(Math.max(0, at), chapters.length);
    chapters.splice(i, 0, { ...c, from: c.paras.map(() => null) });
    return { chapters, removed: body.removed.filter(x => x.id !== id), restoredNotes: { [id]: i } };
  });
}

// 合并相邻的几章：并进第一章（名字、id 用第一章的）
export function mergeChapters(bookId, indexes) {
  const list = [...new Set(indexes)].sort((a, b) => a - b);
  if (list.length < 2) throw Error("选两章以上才能合并");
  if (list.some((x, k) => k && x !== list[k - 1] + 1)) throw Error("只能合并挨着的几章");
  return commit(bookId, body => {
    const chapters = [];
    body.chapters.forEach((c, ci) => {
      if (ci <= list[0] || ci > list.at(-1)) return chapters.push(keep(c, ci));
      const head = chapters.at(-1), off = head.paras.length;
      head.media = [...(head.media || []), ...(c.media || []).map(m => ({ ...m, p: m.p + off }))];
      head.paras = [...head.paras, ...c.paras];
      head.from = [...head.from, ...c.paras.map((_, p) => [ci, p])];
    });
    return { chapters };
  });
}

// 从第 p 段切开：p 段和后面的成为新的一章
export function splitChapter(bookId, index, p, title) {
  return commit(bookId, body => {
    const c = body.chapters[index];
    if (!c || p <= 0 || p >= c.paras.length) throw Error("切开的地方要在这一章中间");
    const chapters = body.chapters.map(keep);
    const a = chapters[index];
    const b = { id: uid(), title: (title || c.paras[p]).trim().slice(0, 60) || `${c.title}（下）`, paras: a.paras.slice(p), from: a.from.slice(p), media: (a.media || []).filter(m => m.p >= p).map(m => ({ ...m, p: m.p - p })) };
    a.paras = a.paras.slice(0, p);
    a.from = a.from.slice(0, p);
    a.media = (a.media || []).filter(m => m.p < p);
    chapters.splice(index + 1, 0, b);
    return { chapters };
  });
}

// 换一种规则重新分章：把整本书摊成一行一行（TXT 原文里的章名行也放回去；EPUB 的章名本来就在正文第一段），重新认标题。
// 图片跟着它前后的那段走；章 id 尽量沿用（新章的开头还是原来某章的开头，就用那章的 id）
function flatten(body) {
  const lines = [], from = [], media = [];
  body.chapters.forEach((c, ci) => {
    for (const h of c.heading || []) if (h !== c.paras[0]) { lines.push(h); from.push(null); }
    c.paras.forEach((t, p) => {
      for (const m of c.media || []) if (m.p === p) media.push({ ...m, at: lines.length });
      lines.push(t); from.push([ci, p]);
    });
    for (const m of c.media || []) if (m.p >= c.paras.length) media.push({ ...m, at: lines.length, tail: true });
  });
  return { lines, from, media };
}
export function resplitPreview(body, rule) {
  const { lines } = flatten(body);
  return splitLines(lines, rule).map(c => ({ title: c.title, n: c.lines.length }));
}
export function resplitChapters(bookId, rule) {
  return commit(bookId, body => {
    const { lines, from, media } = flatten(body);
    const starts = new Map(body.chapters.map((c, ci) => [`${ci}:0`, c.id]));
    const used = new Set();
    const split = splitLines(lines, rule);
    // 每张图归到一章：图在第几行前面，就归到包含那一行的章（章末的图归上一章）
    const his = split.map(s => Math.max(s.head, ...s.lines));
    const mediaOf = split.map(() => []);
    for (const m of media) {
      const at = m.tail ? m.at - 1 : m.at;
      let k = his.findIndex(h => h >= at);
      if (k < 0) k = split.length - 1;
      const { at: line, tail, ...rest } = m;
      mediaOf[k].push({ ...rest, p: split[k].lines.filter(li => li < line).length });
    }
    const chapters = split.map((s, k) => {
      const f = s.lines.map(i => from[i]);
      const first = f.find(Boolean);
      let id = first && starts.get(`${first[0]}:${first[1]}`);
      if (!id || used.has(id)) id = uid();
      used.add(id);
      return { id, title: s.title.slice(0, 60), ...headingOf(s, lines), paras: s.lines.map(i => lines[i]), from: f, media: mediaOf[k] };
    });
    return { chapters };
  });
}
