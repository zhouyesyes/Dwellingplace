import { decodeTxt } from "./txtEncoding.js";
import { splitLines } from "./chapterSplit.js";
// 共读：书架上的书。一本书一个项目。
//   store.books      [{ id, title, author, cover, chapters: [{ title, n }], pos: { ch, p }, hisPos, addedAt, readAt, readSecs, mine, his }]
//                    cover：封面图（images 里的 id），没有就画一个纯色的；n：这一章有几段
//                    pos / hisPos：你 / 他读到哪；readSecs：你读了多久；mine / his：读完的评分和读后感 { stars, text, at }
//   book:<id>        正文 { chapters: [{ id, title, paras: [段落…], media?: [{ p, resource }] }], resources?: { 路径: 图片数据 }, removed?: [移除的章节] }（单独存并同步）
//                    id：章节的稳定编号（改名、挪位置都不变；EPUB 用书里自带的编号）；书架上 chapters 也带着同一个 id
//                    heading：TXT 里章名原本是哪几行（换规则重新分章时用）
//   store.bookNotes  便利贴 [{ id, bookId, ch, p, quote, text, from: "me" | "ai", ts, seen, replyTo }]
//                    p：贴在第几段；seen：对方看过没有（你贴的他看没看过 / 他贴的你在书页上看没看到过）；replyTo：回应的是哪一张
import { resolveEpubPath, epubImageType, imageData } from "./epubImages.js";
import { unzipSync, strFromU8 } from "fflate";
import { store, uid } from "../store/index.js";
import { get, set, del } from "./kv.js";
import { saveImage, deleteImage } from "./images.js";

const key = id => `book:${id}`;
const cache = new Map(); // 读过的正文先放着，翻章不用每次去 IndexedDB 拿
export async function loadBook(id) {
  if (!cache.has(id)) cache.set(id, (await get(key(id))) || { chapters: [] });
  return cache.get(id);
}
export const replaceBookCache = (id, body) => cache.set(id, body);
export const bookById = id => (store.books || []).find(b => b.id === id);
export const notesOf = (bookId, ch) => (store.bookNotes || []).filter(n => n.bookId === bookId && (ch == null || n.ch === ch));

// ---------- 导入 ----------
export async function importBook(file, { encoding, rule } = {}) {
  const name = file.name.replace(/\.[^.]+$/, "");
  const buf = new Uint8Array(await file.arrayBuffer());
  const isEpub = /\.epub$/i.test(file.name) || (buf[0] === 0x50 && buf[1] === 0x4b);
  const parsed = isEpub ? await parseEpub(buf) : parseTxt(buf, name, encoding, rule);
  const chapters = parsed.chapters.filter(c => c.paras.length || c.media?.length);
  if (!chapters.length) throw new Error("这本书里没读出文字");
  const id = uid();
  const body = { chapters, ...(parsed.resources ? { resources: parsed.resources } : {}) };
  await set(key(id), body);
  cache.set(id, body);
  store.books ??= [];
  store.books.push({
    id,
    title: (parsed.title || name).slice(0, 80),
    author: (parsed.author || "").slice(0, 40),
    cover: parsed.cover ? await saveImage(parsed.cover, { maxSize: 600, quality: 0.85 }) : null,
    chapters: shelfChapters(chapters),
    pos: { ch: 0, p: 0 },
    addedAt: Date.now(),
    readAt: 0,
  });
  return id;
}

export async function removeBook(b) {
  store.books.splice(store.books.indexOf(b), 1);
  store.bookNotes = (store.bookNotes || []).filter(n => n.bookId !== b.id);
  if (b.cover) deleteImage(b.cover);
  cache.delete(b.id);
  await del(key(b.id));
}

export const shelfChapters = chapters => chapters.map(c => ({ id: c.id, title: c.title, n: c.paras.length }));

// TXT：解码通过后一行一段，分章见 chapterSplit.js（导入前预览可以换规则）
export const txtLines = text => text.replace(/\r\n?/g, "\n").split("\n").map(s => s.replace(/^[\s　]+|\s+$/g, "")).filter(Boolean);
// 章名是原文里的哪几行（「第一卷」「第一章」）：换规则重新分章时放回正文里重新认；改名、手动切开起的名字不算原文
export const headingOf = (c, lines) => { const hs = c.heads || (c.head >= 0 ? [c.head] : []); return hs.length ? { heading: hs.map(i => lines[i]) } : {}; };
export function txtChapters(text, rule = "auto") {
  const lines = txtLines(text);
  return splitLines(lines, rule).map(c => ({ id: uid(), title: c.title.slice(0, 60), ...headingOf(c, lines), paras: c.lines.map(i => lines[i]) }));
}
function parseTxt(buf, name, encoding, rule) {
  const decoded = decodeTxt(buf, encoding);
  if (!decoded.usable) throw new Error("正文为空或损坏字符过多，请重新选择编码导入");
  return { title: name, chapters: txtChapters(decoded.text, rule) };
}

// EPUB：其实是个 zip。按 spine（阅读顺序）一篇篇拿出正文；目录里有名字就用目录的名字
export async function parseEpub(buf) {
  const files = unzipSync(buf);
  const text = p => (files[p] ? strFromU8(files[p]) : "");
  const xml = s => new DOMParser().parseFromString(s, "application/xml");
  const dir = p => p.replace(/[^/]*$/, "");
  const join = resolveEpubPath;
  const opfPath = join("", xml(text("META-INF/container.xml")).querySelector("rootfile")?.getAttribute("full-path"));
  if (!opfPath) throw new Error("这个 epub 打不开（找不到目录文件）");
  const opf = xml(text(opfPath));
  const base = dir(opfPath);
  const invalid = message => { const error = new Error(`EPUB 文件异常：${message}，不能覆盖旧书`); error.code = 'EPUB_STRUCTURE'; throw error; };
  const items = {};
  for (const it of opf.querySelectorAll("manifest > item")) {
    const href = it.getAttribute("href");
    if (!href?.trim() || !join(base, href)) invalid('资源清单缺少有效位置');
    items[it.getAttribute("id")] = { href: join(base, href), type: it.getAttribute("media-type") || "", props: it.getAttribute("properties") || "" };
  }
  const meta = tag => opf.getElementsByTagNameNS("*", tag)[0]?.textContent?.trim() || "";

  // 封面：properties="cover-image"，或者 <meta name="cover" content="图片的 id">
  let coverItem = Object.values(items).find(i => /cover-image/.test(i.props));
  if (!coverItem) { const cid = opf.querySelector('meta[name="cover"]')?.getAttribute("content"); if (cid) coverItem = items[cid]; }

  // 书自带的目录：EPUB3 的 nav（优先），没有就用 EPUB2 的 toc.ncx。按顺序排好：[{ file, frag, label }]
  const toc = [];
  const tocRef = (from, href = "") => { const i = href.indexOf("#"); return [join(from, href), i >= 0 ? decodeURIComponent(href.slice(i + 1)) : ""]; };
  const navItem = Object.values(items).find(i => /\bnav\b/.test(i.props));
  if (navItem) {
    const nav = new DOMParser().parseFromString(text(navItem.href), "text/html");
    const tocNav = [...nav.querySelectorAll("nav")].find(n => /toc/.test(n.getAttribute("epub:type") || "")) || nav.querySelector("nav");
    for (const a of tocNav?.querySelectorAll("a[href]") || []) {
      const [f, frag] = tocRef(dir(navItem.href), a.getAttribute("href"));
      toc.push({ file: f, frag, label: a.textContent.replace(/\s+/g, " ").trim() });
    }
  }
  const ncxItem = Object.values(items).find(i => /ncx/.test(i.type));
  if (!toc.length && ncxItem) {
    const ncx = xml(text(ncxItem.href));
    for (const np of ncx.getElementsByTagNameNS("*", "navPoint")) {
      const src = np.getElementsByTagNameNS("*", "content")[0]?.getAttribute("src");
      const lab = np.getElementsByTagNameNS("*", "text")[0]?.textContent?.replace(/\s+/g, " ").trim();
      if (!src) continue;
      const [f, frag] = tocRef(dir(ncxItem.href), src);
      toc.push({ file: f, frag, label: lab || "" });
    }
  }
  // 书里标出来的封面、扉页、版权页、目录页（opf 的 guide、nav 的 landmarks）
  const front = new Set();
  for (const r of opf.querySelectorAll("guide > reference")) {
    if (/^(cover|title-page|copyright-page|toc)$/i.test(r.getAttribute("type") || "")) front.add(join(base, r.getAttribute("href") || "").split("#")[0]);
  }
  if (navItem) {
    const nav = new DOMParser().parseFromString(text(navItem.href), "text/html");
    for (const a of nav.querySelectorAll('nav[epub\\:type~="landmarks"] a[href], nav[*|type~="landmarks"] a[href]')) {
      if (/(cover|titlepage|title-page|copyright|toc)/i.test(a.getAttribute("epub:type") || "")) front.add(join(dir(navItem.href), a.getAttribute("href")).split("#")[0]);
    }
  }

  const resources = Object.create(null);
  for (const item of Object.values(items)) {
    if (epubImageType(item.type) && Object.hasOwn(files, item.href)) resources[item.href] = imageData(files[item.href], item.type);
  }
  // 一篇篇读出来：段落、图片（挂在第几段前面）、带 id 的元素在第几段（目录指到篇中间时用）
  const docs = [];
  for (const ref of opf.querySelectorAll("spine > itemref")) {
    const it = items[ref.getAttribute("idref")];
    if (!it) invalid('阅读顺序引用了不存在的章节');
    if (!Object.hasOwn(files, it.href)) invalid('章节资源缺失');
    if (!/html|xml/.test(it.type)) continue;
    const doc = new DOMParser().parseFromString(text(it.href), "text/html");
    const blocks = [...doc.body?.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre") || []].filter(e => !e.querySelector("p, li, blockquote"));
    let paras = blocks.map(e => e.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (!paras.length) paras = (doc.body?.textContent || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
    // 图片单独挂在原有文字段落旁，不改变文字编号和划线偏移。
    const media = [];
    const textBlocks = blocks.filter(e => e.textContent.replace(/\s+/g, " ").trim());
    const before = node => textBlocks.filter(e => !e.contains(node) && (e.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)).length;
    for (const node of doc.body?.querySelectorAll('img, svg') || []) {
      if (node.parentElement?.closest('svg')) continue;
      let resource = '';
      if (node.localName === 'svg') {
        const svg = node.cloneNode(true);
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.querySelectorAll('script, foreignObject').forEach(e => e.remove());
        // SVG 作为独立图片加载：保留填色、字体等样式，浏览器禁用脚本与外部子资源。
        for (const e of [svg, ...svg.querySelectorAll('*')]) {
          for (const attr of [...e.attributes]) {
            if (/^on/i.test(attr.name)) e.removeAttribute(attr.name);
            else if (attr.localName === 'href') {
              const value = attr.value;
              if (!value.startsWith('#')) {
                const data = resources[join(dir(it.href), value)];
                if (data && e.localName === 'image') e.setAttributeNS(attr.namespaceURI, attr.name, data);
                else e.removeAttributeNS(attr.namespaceURI, attr.localName);
              }
            }
          }
        }
        resource = `inline:${it.href}:${media.length}`;
        resources[resource] = imageData(new TextEncoder().encode(new XMLSerializer().serializeToString(svg)), 'image/svg+xml');
      } else {
        resource = join(dir(it.href), node.getAttribute('src'));
        if (!resources[resource]) {
          const source = node.closest('picture')?.querySelector('source[srcset]');
          resource = join(dir(it.href), source?.getAttribute('srcset')?.split(',')[0].trim().split(/\s+/)[0]);
        }
      }
      const href = node.localName === 'svg' ? node.querySelector('image')?.getAttribute('href') || node.querySelector('image')?.getAttribute('xlink:href') : null;
      media.push({ p: Math.min(before(node), paras.length), resource: resources[resource] ? resource : '',
        alt: (node.getAttribute('alt') || node.querySelector('title')?.textContent || '').trim().slice(0, 1000),
        caption: (node.closest('figure')?.querySelector('figcaption')?.textContent || '').trim().slice(0, 1000),
        ...(href ? { src: join(dir(it.href), href) } : {}) });
    }
    // 带 id 的元素从第几段开始（在某一段里面的，就算那一段）
    const anchors = {};
    const idx = new Map(textBlocks.map((e, i) => [e, i]));
    let n = 0, inBlock = null;
    for (const e of doc.body?.querySelectorAll("*") || []) {
      const key = e.id || (e.localName === "a" && e.getAttribute("name")); // 老书用 <a name> 做锚点
      if (idx.has(e)) { inBlock = e; n = idx.get(e); if (key) anchors[key] ??= n; n++; continue; }
      if (key) anchors[key] ??= inBlock?.contains(e) ? idx.get(inBlock) : n;
    }
    docs.push({ idref: ref.getAttribute("idref"), href: it.href, props: it.props, paras, media, anchors, h: doc.querySelector("h1, h2, h3")?.textContent.replace(/\s+/g, " ").trim(), title: doc.title?.trim() });
  }

  // 不进正文的页：封面、空白页、扉页、版权页、书里的目录页（只看页本身，不按「第几篇」删，序言不会被误删）
  const tocLabels = new Set(toc.map(t => t.label).filter(Boolean));
  const titleN = meta("title").replace(/\s+/g, "");
  const isFront = d => {
    const all = d.paras.join("");
    const n = all.length;
    const inToc = toc.some(t => t.file === d.href);
    if (!n && !d.media.length) return true; // 空白页（短短一行的，比如献词「纪念某某」、「第一部」，留着）
    if (/\bnav\b/.test(d.props)) return true; // 目录文件本身
    if (front.has(d.href) && n < 1500) return true;
    // 封面：只有封面那张图，几乎没字
    if (n < 20 && d.media.length === 1 && coverItem && (d.media[0].resource === coverItem.href || d.media[0].src === coverItem.href)) return true;
    if (n < 20 && /cover/i.test(d.href) && !inToc) return true;
    // 版权页：短，而且有好几处版权信息
    const marks = (all.match(/版权|ISBN|Copyright|©|出版社|出版发行|印刷|印张|定价|All rights reserved|CIP|责任编辑|字数/gi) || []).length;
    if (n < 1500 && marks >= 2) return true;
    // 扉页：只有书名、作者这几行（短短几行、没有逗号句号），目录里也没有它；带书名的题记不算
    if (!inToc && n < 80 && !d.media.length && titleN && all.replace(/\s+/g, "").includes(titleN) && !/[，。！？；…]/.test(all)) return true;
    // 书里的目录页：大部分行都是目录里的章节名
    if (tocLabels.size >= 3 && d.paras.length >= 3 && d.paras.filter(p => tocLabels.has(p)).length / d.paras.length >= .6) return true;
    if (/(^|\/)(toc|contents)[^/]*$/i.test(d.href) && n < 3000 && !inToc) return true;
    return false;
  };
  const kept = docs.filter(d => !isFront(d));

  // 切成章：有目录就按目录（目录指到哪一篇、篇里哪个位置，就从哪里开始新的一章；没进目录的篇接在上一章后面）；没有目录就一篇一章
  const marks = toc.filter(t => kept.some(d => d.href === t.file));
  const starts = new Map(); // `${篇}:${段}` → 目录项
  for (const t of marks) {
    const di = kept.findIndex(d => d.href === t.file);
    const p = t.frag && kept[di].anchors[t.frag] != null ? kept[di].anchors[t.frag] : 0;
    const k = `${di}:${p}`;
    // 上下两级指到同一个地方（「查令十字街84号」下面的「正文」）：名字连起来
    if (!starts.has(k)) starts.set(k, { ...t });
    else if (t.label && !starts.get(k).label.includes(t.label)) starts.get(k).label = `${starts.get(k).label} · ${t.label}`;
  }
  const useToc = starts.size >= 2;
  // 有目录就照着书的目录分：没进目录的篇接在上一章后面（书信集里一封封信，书的目录只有「正文」一项，就是一章），
  // 除非它自己有标题（h1–h3），那是书里看得见的新一节
  const alone = kept.map(d => !!d.h);
  const bookTitle = meta("title");
  const chapters = [];
  let cur = null;
  const open = (d, p, t) => {
    const frag = t?.frag && p > 0 ? `#${t.frag}` : "";
    cur = { id: `${d.idref}${frag}`, sourceId: d.idref, sourcePath: d.href, title: (t?.label || (useToc && !chapters.length ? "开头" : "") || d.h || (d.title && d.title !== bookTitle ? d.title : "") || (d.paras[p] || "").slice(0, 20) || `第 ${chapters.length + 1} 节`).slice(0, 60), paras: [], media: [] };
    chapters.push(cur);
  };
  kept.forEach((d, di) => {
    const cuts = useToc ? [...starts.keys()].filter(k => k.startsWith(`${di}:`)).map(k => Number(k.split(":")[1])) : [];
    const bounds = [...new Set([0, ...cuts])].sort((x, y) => x - y);
    bounds.forEach((from, k) => {
      const to = k + 1 < bounds.length ? bounds[k + 1] : d.paras.length;
      const t = starts.get(`${di}:${from}`);
      if (t) open(d, from, t);
      else if (!useToc || !cur || (from === 0 && alone[di])) open(d, from, null); // 没有目录：一篇一章；第一个目录项之前自己有内容的（比如没进目录的序言）、自己算一章的：单独一章
      const off = cur.paras.length, last = k + 1 === bounds.length;
      cur.paras.push(...d.paras.slice(from, to));
      for (const m of d.media) if (m.p >= from && (m.p < to || (last && m.p === to))) cur.media.push({ ...m, p: m.p - from + off });
    });
  });
  // 整理：几乎空的一章——只有个标题的（「第一部」分部页）把名字并进下一章；有几个字的（献词）字挪到下一章开头，不丢
  const bare = s => s.replace(/[\s\p{P}\p{S}]/gu, "");
  for (let k = chapters.length - 2; k >= 0; k--) {
    const c = chapters[k], next = chapters[k + 1];
    if (c.paras.join("").length >= 20 || c.media.length) continue;
    if (c.paras.every(p => bare(c.title).includes(bare(p)))) next.title = `${c.title} · ${next.title}`.slice(0, 60);
    else {
      next.media = next.media.map(m => ({ ...m, p: m.p + c.paras.length }));
      next.paras = [...c.paras, ...next.paras];
    }
    chapters.splice(k, 1);
  }
  const seen = new Set();
  for (const c of chapters) {
    while (seen.has(c.id)) c.id += "+";
    seen.add(c.id);
    for (const m of c.media) delete m.src;
    if (!c.media.length) delete c.media;
  }

  const cover = coverItem && /^image\//.test(coverItem.type) && files[coverItem.href] ? new Blob([files[coverItem.href]], { type: coverItem.type }) : null;
  return { title: meta("title"), author: meta("creator"), cover, chapters, resources };
}

// ---------- 读到哪了、便利贴 ----------
export function savePos(b, ch, p) {
  b.pos = { ch, p };
  b.readAt = Date.now();
}
// 一条划线 / 批注：划在第 ch 章第 p 段的 [start, end) 这几个字上（旧的没有 start / end：按 quote 去段落里找，找不到就是整段）。
// text 空着 = 只划了线；replyTo：回应哪一张便利贴
export function addNote(b, { ch, p, quote, text, from, start, end, replyTo }) {
  store.bookNotes ??= [];
  const n = { id: uid(), bookId: b.id, ch, p, quote: (quote || "").slice(0, 200), text: (text || "").trim().slice(0, 1000), from, ts: Date.now(), seen: false };
  if (start != null && end != null && end > start) Object.assign(n, { start, end });
  if (replyTo) n.replyTo = replyTo;
  store.bookNotes.push(n);
  return n;
}
export function removeNote(n) {
  store.bookNotes.splice(store.bookNotes.indexOf(n), 1);
}

// 没封面的书：按书名挑一个颜色
const TONES = ["#c9b8a6", "#9fb4c7", "#c4a7b5", "#a9bfa4", "#b9adc9", "#d1b48c", "#8fa3a8", "#c79e8f"];
export const toneOf = b => TONES[[...(b.title || "")].reduce((a, c) => a + c.codePointAt(0), 0) % TONES.length];

// ---------- 进度、时间、评分 ----------
// 读到百分之几（按段落算）
export function progressOf(b, pos = b.pos) {
  if (!pos || !b.chapters?.length) return 0;
  const total = b.chapters.reduce((a, c) => a + c.n, 0) || 1;
  const before = b.chapters.slice(0, pos.ch).reduce((a, c) => a + c.n, 0);
  return Math.min(1, (before + (pos.p || 0) + 1) / total);
}
// 在读的时候每隔一会儿记一笔：这本书读了多久、每天读了多久（store.readingLog { "2026-10-12": 秒 }）
export function tickReading(b, sec) {
  b.readSecs = (b.readSecs || 0) + sec;
  store.readingLog ??= {};
  const d = ymdOf(new Date());
  store.readingLog[d] = (store.readingLog[d] || 0) + sec;
}
const ymdOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function readingTotals() {
  const log = store.readingLog || {};
  const now = new Date(), today = ymdOf(now), month = today.slice(0, 7), year = today.slice(0, 4);
  let t = 0, m = 0, y = 0, all = 0;
  for (const [d, s] of Object.entries(log)) {
    all += s;
    if (d === today) t += s;
    if (d.startsWith(month)) m += s;
    if (d.startsWith(year)) y += s;
  }
  return { today: t, month: m, year: y, all };
}
export const fmtDur = s => {
  s = Math.round(s || 0);
  if (s < 60) return s ? "不到 1 分钟" : "0 分钟";
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} 小时${m ? ` ${m} 分` : ""}` : `${m} 分钟`;
};
// 他读到哪：他看过的段落里最靠后的那一段
export function markHisPos(b, ch, p) {
  const cur = b.hisPos;
  if (!cur || ch > cur.ch || (ch === cur.ch && p > cur.p)) b.hisPos = { ch, p, at: Date.now() };
}

// ---------- 导入的字体（读书时用）----------
//   store.readerFonts [{ id, name }]，字体文件存在 font:<id>
const loadedFonts = new Set();
export async function addFont(file) {
  const id = uid();
  await set(`font:${id}`, file);
  store.readerFonts ??= [];
  store.readerFonts.push({ id, name: file.name.replace(/\.[^.]+$/, "").slice(0, 30) });
  return id;
}
export async function useFont(id) {
  if (!id || loadedFonts.has(id)) return id ? `qf-${id}` : "";
  const blob = await get(`font:${id}`);
  if (!blob) return "";
  const face = new FontFace(`qf-${id}`, await blob.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  loadedFonts.add(id);
  return `qf-${id}`;
}
export async function removeFont(f) {
  store.readerFonts.splice(store.readerFonts.indexOf(f), 1);
  if (store.readerPrefs?.font === f.id) store.readerPrefs.font = "";
  await del(`font:${f.id}`);
}
