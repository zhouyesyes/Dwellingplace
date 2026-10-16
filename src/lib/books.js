import { decodeTxt } from "./txtEncoding.js";
// 共读：书架上的书。一本书一个项目。
//   store.books      [{ id, title, author, cover, chapters: [{ title, n }], pos: { ch, p }, hisPos, addedAt, readAt, readSecs, mine, his }]
//                    cover：封面图（images 里的 id），没有就画一个纯色的；n：这一章有几段
//                    pos / hisPos：你 / 他读到哪；readSecs：你读了多久；mine / his：读完的评分和读后感 { stars, text, at }
//   book:<id>        正文 { chapters: [{ title, paras: [段落…], media?: [{ p, resource }] }], resources?: { 路径: 图片数据 } }（单独存并同步）
//   store.bookNotes  便利贴 [{ id, bookId, ch, p, quote, text, from: "me" | "ai", ts, seen }]
//                    p：贴在第几段；seen：对方看过没有（你贴的他看没看过 / 他贴的你看没看过）
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
export async function importBook(file, { encoding } = {}) {
  const name = file.name.replace(/\.[^.]+$/, "");
  const buf = new Uint8Array(await file.arrayBuffer());
  const isEpub = /\.epub$/i.test(file.name) || (buf[0] === 0x50 && buf[1] === 0x4b);
  const parsed = isEpub ? await parseEpub(buf) : parseTxt(buf, name, encoding);
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
    chapters: chapters.map(c => ({ title: c.title, n: c.paras.length })),
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

// TXT 解码通过后仍沿用原来的分章规则。
const CH_RE = /^\s*(第[零〇一二两三四五六七八九十百千万0-9０-９]+[章回节卷集部篇幕].{0,30}|序章.{0,20}|楔子.{0,20}|引子.{0,20}|尾声.{0,20}|番外.{0,30}|后记.{0,20}|Chapter\s*\d+.{0,40}|CHAPTER\s*\d+.{0,40})\s*$/;
function parseTxt(buf, name, encoding) {
  const decoded = decodeTxt(buf, encoding);
  if (decoded.suspicious) throw new Error("编码可能不正确，请切换编码后再确认");
  const lines = decoded.text.replace(/\r\n?/g, "\n").split("\n").map(s => s.replace(/^[\s　]+|\s+$/g, "")).filter(Boolean);
  const chapters = [];
  let cur = { title: "开头", paras: [] };
  for (const l of lines) {
    if (CH_RE.test(l) && l.length <= 40) {
      if (cur.paras.length || chapters.length) chapters.push(cur);
      cur = { title: l, paras: [] };
    } else cur.paras.push(l);
  }
  chapters.push(cur);
  // 第一章前面只有书名、作者这一两行：不算一章
  if (chapters.length > 1 && chapters[0].title === "开头" && chapters[0].paras.join("").length < 60) chapters.shift();
  // 没有章节标题的 txt：每 60 段切一节，免得一章太长
  if (chapters.length === 1 && cur.paras.length > 120) {
    const all = cur.paras, out = [];
    for (let i = 0; i < all.length; i += 60) out.push({ title: `第 ${out.length + 1} 节`, paras: all.slice(i, i + 60) });
    return { title: name, chapters: out };
  }
  return { title: name, chapters };
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

  // 目录里的章节名：EPUB3 的 nav 或 EPUB2 的 toc.ncx
  const labels = {};
  const navItem = Object.values(items).find(i => /\bnav\b/.test(i.props));
  if (navItem) {
    const nav = new DOMParser().parseFromString(text(navItem.href), "text/html");
    for (const a of nav.querySelectorAll("nav a[href]")) labels[join(dir(navItem.href), a.getAttribute("href"))] ??= a.textContent.trim();
  }
  const ncxItem = Object.values(items).find(i => /ncx/.test(i.type));
  if (ncxItem) {
    const ncx = xml(text(ncxItem.href));
    for (const np of ncx.getElementsByTagNameNS("*", "navPoint")) {
      const src = np.getElementsByTagNameNS("*", "content")[0]?.getAttribute("src");
      const lab = np.getElementsByTagNameNS("*", "text")[0]?.textContent?.trim();
      if (src && lab) labels[join(dir(ncxItem.href), src)] ??= lab;
    }
  }

  const resources = Object.create(null);
  for (const item of Object.values(items)) {
    if (epubImageType(item.type) && Object.hasOwn(files, item.href)) resources[item.href] = imageData(files[item.href], item.type);
  }
  const chapters = [];
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
    for (const node of doc.body.querySelectorAll('img, svg')) {
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
      const p = textBlocks.filter(e => !e.contains(node) && (e.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)).length;
      media.push({ p: Math.min(p, paras.length), resource: resources[resource] ? resource : '',
        alt: (node.getAttribute('alt') || node.querySelector('title')?.textContent || '').trim().slice(0, 1000),
        caption: (node.closest('figure')?.querySelector('figcaption')?.textContent || '').trim().slice(0, 1000) });
    }
    if (paras.join("").length < 20 && !media.length) continue; // 封面、版权页这种几乎没字的跳过
    const h = doc.querySelector("h1, h2, h3")?.textContent.trim();
    chapters.push({ sourceId: ref.getAttribute("idref"), sourcePath: it.href, title: (labels[it.href] || h || doc.title || `第 ${chapters.length + 1} 节`).slice(0, 60), paras, ...(media.length ? { media } : {}) });
  }

  // 封面：properties="cover-image"，或者 <meta name="cover" content="图片的 id">
  let coverItem = Object.values(items).find(i => /cover-image/.test(i.props));
  if (!coverItem) { const cid = opf.querySelector('meta[name="cover"]')?.getAttribute("content"); if (cid) coverItem = items[cid]; }
  const cover = coverItem && /^image\//.test(coverItem.type) && files[coverItem.href] ? new Blob([files[coverItem.href]], { type: coverItem.type }) : null;
  return { title: meta("title"), author: meta("creator"), cover, chapters, resources };
}

// ---------- 读到哪了、便利贴 ----------
export function savePos(b, ch, p) {
  b.pos = { ch, p };
  b.readAt = Date.now();
}
// 一条划线 / 批注：划在第 ch 章第 p 段的 [start, end) 这几个字上（旧的没有 start / end：按 quote 去段落里找，找不到就是整段）。
// text 空着 = 只划了线
export function addNote(b, { ch, p, quote, text, from, start, end }) {
  store.bookNotes ??= [];
  const n = { id: uid(), bookId: b.id, ch, p, quote: (quote || "").slice(0, 200), text: (text || "").trim().slice(0, 1000), from, ts: Date.now(), seen: false };
  if (start != null && end != null && end > start) Object.assign(n, { start, end });
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
