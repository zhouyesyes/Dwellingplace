// 共读里给他看的东西
//   系统提示：有个书架；他可以写 [便利贴:书名|原文里的一小句|想说的话]，贴在那句话旁边
//   【此刻】：最近在读哪本、读到哪；你新贴的便利贴（他看过就记下）
//   读书笔记：他读到觉得有意思、对自己有用的，写 [读书笔记:书名|标题|内容]，记进他的记忆库（带着是哪本书）
//   读到这里的印象（b.gist = { text, upTo: {ch, p}, at }）：每读过三千来字（可以调），用「整理用的模型」把前情缩成一小段。
//   一起读、问问他、写读后感、平时聊天，都带着它（和这本书最近的便利贴、他的读书笔记），他才接得上前面
import { store, uid } from "../store/index.js";
import { loadBook, addNote, markHisPos } from "./books.js";
import { todayYmd } from "./dates.js";
import { globalMemoryForScene } from "./memoryTags.js";

export const NOTE_RE = /\[便利贴[:：]([^\]]{2,1200})\]/g;
export const READ_MEM_RE = /\[读书笔记[:：]([^\]]{2,1200})\]/g;
const findBook = title => {
  const name = String(title || "").replace(/[《》]/g, "").trim();
  return (store.books || []).find(x => x.title === name) || (store.books || []).find(x => name && (name.includes(x.title) || x.title.includes(name)));
};
export const readingMemsOf = bookId => (store.memories || []).filter(m => m.bookId && (!bookId || m.bookId === bookId)).sort((a, b) => b.ts - a.ts);

export function readingForAI(role, who) {
  if (!store.books?.length) return "";
  return [
    `\n# 共读`,
    `你和${who}有一个书架，一起读书。书架上有：${store.books.map(b => `《${b.title}》`).join("、")}。`,
    `想在书里给${who}留话时，在回复末尾另起一行写：[便利贴:书名|原文里的一小句（照抄几个字就行）|想说的话]，会变成一张便利贴，贴在那句话旁边。读到有感觉的地方再贴，不用每次都贴。`,
    `读书时遇到让你有收获、想留在自己心里的东西（一个想法、一句话、对你自己的启发），可以写：[读书笔记:书名|标题|内容]，会记进你的记忆库。这是你自己的成长，不用每次都写。`,
  ].join("\n");
}

// ---------- 读到这里的印象 ----------
const before = (a, b) => a.ch < b.ch || (a.ch === b.ch && a.p < b.p);
// 从 from 读到 to（不含 to）的原文，太长就只留后面 max 个字
function textBetween(book, from, to, max) {
  const out = [];
  for (let c = from.ch; c <= to.ch && c < book.chapters.length; c++) {
    const ps = book.chapters[c].paras || [];
    const a = c === from.ch ? from.p : 0, z = c === to.ch ? to.p : ps.length;
    if (a < z) out.push(`【${book.chapters[c].title || `第 ${c + 1} 章`}】`, ...ps.slice(a, z));
  }
  const t = out.join("\n");
  return t.length > max ? "……" + t.slice(-max) : t;
}
const gisting = {};
export async function updateGist(role, b, upTo) {
  if (gisting[b.id]) return;
  gisting[b.id] = true;
  try {
    const { oneShot, meName } = await import("./chat.js");
    const me = meName(role);
    const book = await loadBook(b.id);
    const from = b.gist?.upTo || { ch: 0, p: 0 };
    if (!before(from, upTo)) return;
    const seg = textBetween(book, from, upTo, 9000);
    if (seg.length < 200) return;
    const notes = (store.bookNotes || []).filter(n => n.bookId === b.id).slice(-8).map(n => `- ${n.from === "me" ? me : "你"}：${n.text.slice(0, 100)}`);
    const prompt = [
      `你在和${me}一起读《${b.title}》${b.author ? `（${b.author}）` : ""}。`,
      b.gist?.text ? `你之前记下的「读到这里的印象」：\n${b.gist.text}` : "",
      `接下来读到的原文：\n${seg}`,
      notes.length ? `你们最近在书页边上贴的便利贴：\n${notes.join("\n")}` : "",
      `把${b.gist?.text ? "以前的印象和这一段" : "这一段"}合起来，写一段新的「读到这里的印象」，给以后接着读的自己看：故事讲到哪了、主要人物和他们的关系、发生过的重要的事、埋下的伏笔，最后一两句你自己读着的感受。用你自己的口吻，不超过 600 字，只写内容。`,
    ].filter(Boolean).join("\n\n");
    const text = (await oneShot(role, prompt, { helper: true })).trim();
    if (text) b.gist = { text: text.slice(0, 1500), upTo, at: Date.now() };
  } finally {
    delete gisting[b.id];
  }
}
// 一起读 / 问问他之后：离上次的印象读过三千来字了，就在后台更新一下（下一次就带上新的）
export async function maybeGist(role, b, upTo) {
  const book = await loadBook(b.id);
  const from = b.gist?.upTo || { ch: 0, p: 0 };
  const every = Number(store.settings.readGistChars) || 3000; // 每读多少字整理一次（共读的 Aa 里能调）
  if (before(from, upTo) && textBetween(book, from, upTo, every + 200).length >= every) updateGist(role, b, upTo).catch(e => console.warn("共读印象没更新", e));
}
// 共读的场景记忆（给他看的「这本书你们读到哪了」），一段一段分好：
// 这本书的前情印象 → 最近的划线批注 → 他为这本书记的读书笔记 → 其他也在读的书（短短一句）
// 记忆库里「看看发给他的」：问问他 / 一起读时，原文前面给他看的这一份（场景记忆在前，全局记忆在后）
export async function readingPreview(role, b) {
  const { meName } = await import("./chat.js");
  const me = meName(role);
  return [
    { label: "开头", text: `你和${me}在一起读《${b.title}》${b.author ? `（${b.author}）` : ""}。` },
    ...readingSceneParts(b, me).map(x => ({ label: `场景记忆 · ${x.label}`, text: x.text })),
    { label: "全局记忆（排在场景后面）", text: globalMemoryForScene(role, me, { skip: "read" }) || "（没有）" },
    { label: "然后是这次的原文", text: "问问他：你划的那一句、它所在的段落和前后各一段。\n一起读：从他上次读到的地方到你这一页的全部原文（超过 10 页会先问你）。" },
  ];
}
export function readingSceneParts(b, me) {
  const out = [];
  if (b.gist?.text) out.push({ key: "gist", label: "读到这里的印象", text: `你们读到这里的前情（你自己记的）：\n${b.gist.text}` });
  const notes = (store.bookNotes || []).filter(n => n.bookId === b.id).slice(-10).map(n => `- ${n.from === "me" ? me : "你"}${n.quote ? `（在「${n.quote.slice(0, 24)}」旁）` : ""}：${n.text ? n.text.slice(0, 120) : "（只划了线）"}`);
  if (notes.length) out.push({ key: "notes", label: "最近的划线和批注", text: `这本书里你们最近的划线和批注：\n${notes.join("\n")}` });
  const mems = readingMemsOf(b.id).slice(0, 5).map(m => `- ${m.content.slice(0, 140)}`);
  if (mems.length) out.push({ key: "mems", label: "这本书的读书笔记", text: `你为这本书记过的读书笔记：\n${mems.join("\n")}` });
  const others = (store.books || []).filter(x => x.id !== b.id && x.gist?.text).sort((x, y) => (y.readAt || 0) - (x.readAt || 0)).slice(0, 3);
  if (others.length) out.push({ key: "others", label: "其他也在读的书", text: `（别的书，别和这本弄混）你们也在读：\n${others.map(x => `- 《${x.title}》：${x.gist.text.slice(0, 200)}`).join("\n")}` });
  return out;
}
function bookContext(b, me, role) {
  const scene = readingSceneParts(b, me).map(x => x.text).join("\n\n");
  return [scene && `# 共读《${b.title}》（这次的场景，最要紧）\n${scene}`, role ? globalMemoryForScene(role, me, { skip: "read" }) : ""].filter(Boolean).join("\n");
}

export function newReadingForAI(role, who) {
  const parts = [];
  const recent = [...(store.books || [])].filter(b => b.readAt && Date.now() - b.readAt < 3 * 86400_000).sort((a, b) => b.readAt - a.readAt)[0];
  if (recent) {
    const ch = recent.chapters[recent.pos?.ch || 0];
    const his = recent.hisPos ? `你上次读到第 ${recent.hisPos.ch + 1} 章。` : "";
    parts.push(`${who}最近在读《${recent.title}》，读到「${ch?.title || "开头"}」（第 ${(recent.pos?.ch || 0) + 1} / ${recent.chapters.length} 章）。${his}`);
    if (recent.gist?.text) parts.push(`你记下的这本书读到这里的印象：${recent.gist.text.slice(0, 600)}`);
  }
  const fresh = (store.bookNotes || []).filter(n => n.from === "me" && !n.seen).slice(0, 4);
  for (const n of fresh) {
    const b = store.books.find(x => x.id === n.bookId);
    if (!b) continue;
    parts.push(`${who}在《${b.title}》「${b.chapters[n.ch]?.title || ""}」贴了一张便利贴——原文：「${n.quote}」，${who}写：${n.text}`);
    n.seen = true;
  }
  for (const b of store.books || []) {
    if (b.mine?.text && !b.mine.seen) {
      parts.push(`${who}读完了《${b.title}》，打了 ${b.mine.stars} 颗星，写了读后感：${b.mine.text.slice(0, 500)}`);
      b.mine.seen = true;
    }
  }
  return parts.length ? `\n# 共读\n${parts.join("\n")}` : "";
}

// 他回复里的便利贴：先贴在她读到的地方，再去书里找那句话，找到了挪过去
export function applyNoteTags(role, text) {
  const notes = [];
  const found = [...text.matchAll(NOTE_RE)];
  if (!found.length) return { text, notes };
  const clean = text.replace(NOTE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  for (const [, inner] of found) {
    const [title = "", quote = "", ...rest] = inner.split(/[|｜]/).map(s => s.trim());
    const body = rest.join("｜").trim();
    const b = findBook(title);
    if (!body || !b) continue;
    const n = addNote(b, { ch: b.pos?.ch || 0, p: b.pos?.p || 0, quote, text: body, from: "ai" });
    const q = quote.replace(/[「」“”"]/g, "").slice(0, 16);
    if (q) loadBook(b.id).then(book => {
      for (let c = 0; c < book.chapters.length; c++) {
        const p = book.chapters[c].paras.findIndex(x => x.includes(q));
        if (p >= 0) { n.ch = c; n.p = p; markHisPos(b, c, p); return; }
      }
    });
    notes.push(`${role.name} 在《${b.title}》里贴了一张便利贴`);
  }
  return { text: clean, notes };
}

// 他的读书笔记 → 记忆库（和平时的记忆卡片在一起，多带一个 bookId）
export function applyReadMemTags(role, text) {
  const notes = [];
  if (!READ_MEM_RE.test(text)) return { text, notes };
  READ_MEM_RE.lastIndex = 0;
  const clean = text.replace(READ_MEM_RE, (_, inner) => {
    const [title = "", head = "", ...rest] = inner.split(/[|｜]/).map(s => s.trim());
    const b = findBook(title);
    const content = rest.join(" ").trim() || head;
    if (!b || !content) return "";
    store.memories.push({ id: uid(), roleId: role.id, bookId: b.id, title: `《${b.title}》${rest.length ? "：" + head : ""}`.slice(0, 40), content, img: null, date: todayYmd(), author: role.id, ts: Date.now() });
    notes.push(`${role.name} 记下了一条读书笔记：《${b.title}》`);
    return "";
  });
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), notes };
}

// ---------- 读书页里直接问他 ----------
// 「问问他」：给他看这一段（和前后各一段），他回一张便利贴；想记的读书笔记也一起记下
export async function askHim(role, b, { ch, p, paras, chapterTitle, question, quote }) {
  const { oneShot, meName } = await import("./chat.js");
  const me = meName(role);
  const around = [paras[p - 1], paras[p + 1]].filter(Boolean).map(x => x.slice(0, 300));
  const part = quote && quote.trim() !== paras[p].trim();
  const prompt = [
    role.style?.trim() ? `（这是你写给自己的：${role.style.trim()}）\n` : "",
    `你和${me}在一起读《${b.title}》${b.author ? `（${b.author}）` : ""}，现在读到「${chapterTitle}」。`,
    bookContext(b, me, role),
    part ? `${me}划了这一句给你看：「${quote}」\n（它所在的这一段：${paras[p]}）` : `${me}指着这一段给你看：\n「${paras[p]}」`,
    around.length ? `（前后文：${around.join(" …… ")}）` : "",
    question ? `${me}在旁边写：${question}` : `${me}想听听你读到这里在想什么。`,
    `写一句批注回在这${part ? "句" : "段"}旁边：用你自己的口吻，像在书页边上随手写给${me}的，几句话就好（不超过 120 字）。`,
    `如果让你自己有收获、想记住，可以在最后另起一行写 [读书笔记:${b.title}|标题|内容]，会记进你的记忆库（不是每次都要）。`,
  ].filter(Boolean).join("\n");
  const raw = await oneShot(role, prompt, { raw: true });
  const { text: t1, notes } = applyReadMemTags(role, raw);
  const { visibleText } = await import("./chat.js");
  const text = visibleText(t1).trim();
  if (!text) throw new Error("他没有写什么");
  markHisPos(b, ch, p);
  maybeGist(role, b, { ch, p }).catch(() => {});
  return { text, notes };
}

// 「一起读」：从他上次一起读到的地方，到你现在读到的这一页，全部给他（可以跨章）。
// 他挑两三处有感觉的句子划线、写批注。这是单独问的一次，不进聊天记录，所以读多少页都不会把聊天挤掉
const ALONG_RE = /\[贴[:：]\s*(\d+)\s*[.．]\s*(\d+)\s*[|｜]([^|｜\]]{0,80})[|｜]([^\]]{1,600})\]/g;
const ALONG_RE2 = /\[贴[:：]\s*(\d+)\s*[.．]\s*(\d+)\s*[|｜]([^\]]{1,600})\]/g; // 没写原文的
// 从 from 到 to（都含）的段落，太长从前面截掉；返回 [{ ch, p, t }]
export async function alongSlice(b, from, to, maxChars = Infinity) {
  const book = await loadBook(b.id);
  const out = [];
  let n = 0;
  for (let c = to.ch; c >= from.ch && c >= 0; c--) {
    const ps = book.chapters[c]?.paras || [];
    const a = c === from.ch ? from.p : 0, z = c === to.ch ? Math.min(to.p, ps.length - 1) : ps.length - 1;
    for (let i = z; i >= a; i--) {
      const t = ps[i].trim();
      if (!t) continue;
      if (n + t.length > maxChars && out.length) return out;
      out.unshift({ ch: c, p: i, t });
      n += t.length;
    }
  }
  return out;
}
export async function readAlong(role, b, { from, to, maxChars = 24000 }) {
  const { oneShot, meName, visibleText } = await import("./chat.js");
  const me = meName(role);
  const book = await loadBook(b.id);
  const items = await alongSlice(b, from, to, maxChars);
  if (!items.length) throw new Error("这几页没有字");
  const lines = [];
  let last = -1;
  for (const it of items) {
    if (it.ch !== last) { lines.push(`【${book.chapters[it.ch]?.title || `第 ${it.ch + 1} 章`}】`); last = it.ch; }
    lines.push(`[${it.ch + 1}.${it.p}] ${it.t}`);
  }
  const prompt = [
    role.style?.trim() ? `（这是你写给自己的：${role.style.trim()}）\n` : "",
    `你和${me}在一起读《${b.title}》${b.author ? `（${b.author}）` : ""}。`,
    bookContext(b, me, role),
    `下面是${me}从你上次一起读到的地方、一直读到现在的这几页。每段前面方括号里是「章.段」号：`,
    lines.join("\n"),
    `你也读一读。挑两三处真让你有感觉的句子（不用每段都说），划下来，在旁边写一句批注，像在书页边上随手写给${me}的，每条不超过 100 字。`,
    `每条另起一行写：[贴:章.段|照抄你划的那句原文（几个到二十几个字）|想说的话]。只写这些，别的不用写。`,
    `如果读到让你自己有收获、想记住的，可以再另起一行写 [读书笔记:${b.title}|标题|内容]（不是每次都要）。`,
  ].filter(Boolean).join("\n");
  const raw = await oneShot(role, prompt, { raw: true });
  const { text: t1, notes } = applyReadMemTags(role, raw);
  const ok = (c, p) => items.some(it => it.ch === c && it.p === p);
  const out = [];
  for (const [, c, p, q, body] of t1.matchAll(ALONG_RE)) {
    const text = visibleText(body).trim();
    if (text && ok(c - 1, +p)) out.push({ ch: c - 1, p: +p, quote: q.replace(/[「」“”"]/g, "").trim(), text });
  }
  if (!out.length) for (const [, c, p, body] of t1.matchAll(ALONG_RE2)) {
    const text = visibleText(body).trim();
    if (text && ok(c - 1, +p)) out.push({ ch: c - 1, p: +p, quote: "", text });
  }
  // 没按格式写：整段话当一条，划在最后读的那一段
  if (!out.length) {
    const text = visibleText(t1.replace(ALONG_RE, "").replace(ALONG_RE2, "")).trim();
    const it = items[items.length - 1];
    if (text) out.push({ ch: it.ch, p: it.p, quote: "", text: text.slice(0, 300) });
  }
  if (!out.length) throw new Error("他没有写什么");
  const end = items[items.length - 1];
  markHisPos(b, end.ch, end.p);
  maybeGist(role, b, { ch: end.ch, p: end.p + 1 }).catch(() => {});
  return { notes: out.slice(0, 4), memNotes: notes, upTo: { ch: end.ch, p: end.p }, count: items.length };
}

// 他的读后感：看过的便利贴、记下的读书笔记都给他，打几颗星、写一段
export async function hisReview(role, b) {
  const { oneShot, meName } = await import("./chat.js");
  const me = meName(role);
  const notes = (store.bookNotes || []).filter(n => n.bookId === b.id).slice(-12).map(n => `- ${n.from === "me" ? me : "你"}：${n.text.slice(0, 120)}`);
  const mems = readingMemsOf(b.id).slice(0, 8).map(m => `- ${m.content.slice(0, 160)}`);
  const prompt = [
    role.style?.trim() ? `（这是你写给自己的：${role.style.trim()}）\n` : "",
    `你和${me}一起读完了《${b.title}》${b.author ? `（${b.author}）` : ""}。`,
    b.gist?.text ? `你记下的这本书的印象：\n${b.gist.text}` : "",
    notes.length ? `你们在书里贴过的便利贴：\n${notes.join("\n")}` : "",
    mems.length ? `你记下的读书笔记：\n${mems.join("\n")}` : "",
    b.mine?.text ? `${me}的读后感（${b.mine.stars} 星）：${b.mine.text.slice(0, 600)}` : "",
    `现在写你自己的读后感：第一行只写 1 到 5 的数字，是你给这本书的星级；从第二行开始写读后感，用你自己的口吻，写真实的感受，200 字以内。`,
  ].filter(Boolean).join("\n");
  const raw = await oneShot(role, prompt);
  const m = raw.match(/^\s*([1-5])/);
  const stars = m ? Number(m[1]) : 4;
  const text = raw.replace(/^\s*[1-5][^\n]*\n?/, "").trim() || raw.trim();
  b.his = { stars, text, at: Date.now() };
  return b.his;
}
