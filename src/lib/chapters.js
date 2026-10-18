// 章节管理（目录的「编辑」里）：改名、移除（先放进「已移除章节」，能恢复）、合并、从某一段切开、换一种规则重新分章。
// 还有改正文（选中一句的小卡片里「改正文」）：改字、改标点、拆段、并段，原文留着能恢复。
// 每样操作都是：拼出新的章节表（每一段记着原来是第几章第几段），再把笔记、读到哪（你和他）、前情、印象……的位置挪过去，
// 正文和书架一起存（一个事务，失败就都不变）。
//   章节 id 不变：改名只改名字；切开时前半截留原来的 id，后半截新给一个；合并留第一章的 id
//   移除的章节：body.removed [{ id, title, paras, media, at（原来排第几）, removedAt }]；上面的笔记 ch 记成 -1、removedCh 记着章节 id
import { store, uid, prepareBookPersistence, commitBookTransaction } from "../store/index.js";
import { get } from "./kv.js";
import { replaceBookCache, shelfChapters, headingOf, loadBook } from "./books.js";
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
  const { chapters, removed = body.removed || [], restoredNotes = {}, alias = [], noteMap = null } = build(body);
  if (!chapters.length) throw Error("至少要留一章");
  // 原来第几章第几段 → 现在第几章第几段
  const map = new Map();
  // 一段拆成几段时，原来那段的位置算第一段；并掉的那段（alias）算到并成的那段
  chapters.forEach((c, ci) => c.from.forEach((f, p) => { if (f && !map.has(`${f[0]}:${f[1]}`)) map.set(`${f[0]}:${f[1]}`, [ci, p]); }));
  for (const [oc, op, nc, np] of alias) map.set(`${oc}:${op}`, [nc, np]);
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
    const hit = noteMap?.(n); // 改正文：按改动挪划线的字
    if (hit) return { ...n, ...hit };
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
      delete head.orig; delete head.src; // 合并章节后，改过的正文就定下来了（原文不再单独留）
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
    delete a.orig; delete a.src; delete b.orig; delete b.src; // 切开章节后，改过的正文就定下来了
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

// ---------- 改正文 ----------
// 一章第一次改：原文整章留一份（c.orig），每一段记着来自原文的哪几段（c.src）；恢复原文就按它拼回去
function ensureOrig(c) {
  if (!c.orig) { c.orig = [...c.paras]; c.src = c.paras.map((_, i) => [i]); }
}
// 旧的几段 → 新的几段：两边各自连成一串，比出前后没变的部分，旧串里第几个字对到新串的哪一段第几个字
function offsetMap(olds, news) {
  const A = olds.join(""), B = news.join("");
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const toB = o => (o <= pre ? o : o >= A.length - suf ? o + B.length - A.length : pre);
  const starts = olds.map((_, i) => olds.slice(0, i).join("").length);
  const locate = (x, end) => {
    let acc = 0;
    for (let i = 0; i < news.length; i++) {
      const L = news[i].length;
      if (x < acc + L || (end && x <= acc + L) || i === news.length - 1) return [i, Math.max(0, Math.min(L, x - acc))];
      acc += L;
    }
    return [0, 0];
  };
  return (i, off, end) => locate(toB(starts[i] + off), end);
}
// 把第 ch 章第 p0 段起的 count 段换成 news（srcs：每一段新段落来自原文的哪几段）
function replaceParas(bookId, ch, p0, count, make) {
  return commit(bookId, body => {
    const c = body.chapters[ch];
    if (!c || p0 < 0 || p0 + count > c.paras.length) throw Error("这一段找不到了");
    ensureOrig(c);
    const olds = c.paras.slice(p0, p0 + count);
    const { news, srcs } = make(c, olds);
    if (!news.length) throw Error("不能把这一段改成空的");
    const d = news.length - count;
    const next = { ...c, paras: [...c.paras.slice(0, p0), ...news, ...c.paras.slice(p0 + count)], src: [...c.src.slice(0, p0), ...srcs, ...c.src.slice(p0 + count)] };
    next.media = (c.media || []).map(m => ({ ...m, p: m.p <= p0 ? m.p : m.p >= p0 + count ? m.p + d : p0 + Math.min(m.p - p0, news.length) }));
    // 和原文一模一样了：不用再留原文
    if (next.paras.length === next.orig.length && next.paras.every((t, i) => t === next.orig[i]) && next.src.every((x, i) => x.length === 1 && x[0] === i)) { delete next.orig; delete next.src; }
    const chapters = body.chapters.map((x, ci) => ci === ch ? { ...next, from: next.paras.map((_, p) => p < p0 ? [ch, p] : p >= p0 + news.length ? [ch, p - d] : p === p0 ? [ch, p0] : null) } : keep(x, ci));
    const alias = olds.slice(1).map((_, k) => [ch, p0 + 1 + k, ch, p0]);
    const at = offsetMap(olds, news);
    const noteMap = n => {
      if (n.ch !== ch || n.p < p0 || n.p >= p0 + count) return null;
      const i = n.p - p0;
      if (n.start == null) return { p: p0 + at(i, 0, false)[0] };
      const [sp, so] = at(i, n.start, false);
      const [ep, eo] = at(i, n.end, true);
      const end = ep === sp ? eo : news[sp].length;
      return end > so ? { p: p0 + sp, start: so, end, quote: news[sp].slice(so, end).slice(0, 200) } : { p: p0 + sp, start: undefined, end: undefined };
    };
    return { chapters, alias, noteMap };
  });
}
// 改一段：中间换行就拆成几段
export const editParagraph = (bookId, ch, p, text) => replaceParas(bookId, ch, p, 1, c => {
  const news = String(text || "").split(/\n+/).map(t => t.trim()).filter(Boolean);
  return { news, srcs: news.map(() => [...c.src[p]]) };
});
// 和下一段并成一段
export const mergeWithNext = (bookId, ch, p) => replaceParas(bookId, ch, p, 2, (c, olds) => ({ news: [olds.join("")], srcs: [[...new Set([...c.src[p], ...c.src[p + 1]])]] }));
// 这一段（和跟它一起拆开 / 并起来的那几段）恢复成原文
export function restoreGroup(c, p) {
  if (!c.orig || !c.src?.[p]) return null;
  const S = new Set(c.src[p]);
  let a = p, b = p, grew = true;
  while (grew) {
    grew = false;
    for (let q = 0; q < c.paras.length; q++) {
      if ((q < a || q > b) && c.src[q].some(i => S.has(i))) { a = Math.min(a, q); b = Math.max(b, q); grew = true; }
      if (q >= a && q <= b) for (const i of c.src[q]) if (!S.has(i)) { S.add(i); grew = true; }
    }
  }
  const idx = [...S].sort((x, y) => x - y);
  const news = idx.map(i => c.orig[i]);
  const same = b - a + 1 === news.length && news.every((t, k) => t === c.paras[a + k]);
  return same ? null : { a, count: b - a + 1, idx, news };
}
export async function restoreParagraph(bookId, ch, p) {
  const g = restoreGroup((await loadBook(bookId)).chapters[ch], p);
  if (!g) throw Error("这一段没改过");
  return replaceParas(bookId, ch, g.a, g.count, () => ({ news: g.news, srcs: g.idx.map(i => [i]) }));
}
