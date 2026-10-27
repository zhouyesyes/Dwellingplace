import { readingPageParts } from "./readingImages.js";
// 共读里给他看的东西
//   系统提示：有个书架；他可以写 [便利贴:书名|原文里的一小句|想说的话]，贴在那句话旁边
//   【此刻】：24 小时里读过的书、来往的划线批注（见 moment.js）
//   读书笔记：他读到觉得有意思、对自己有用的，写 [读书笔记:书名|标题|内容]，记进他的记忆库（带着是哪本书）
//   前情（整理模型，客观的梗概，一段段接起来）和他自己的中途印象（每 2 万字一句），见下面「前情和中途印象」。
//   一起读、问问他、写读后感，都带着它们（和这本书最近的便利贴、他的读书笔记），他才接得上前面
import { store, uid, apiFor, modelFor } from "../store/index.js";
import { loadBook, addNote, markHisPos } from "./books.js";
import { todayYmd } from "./dates.js";
import { estTokens } from "./budget.js";
import { globalMemoryForScene, takeSuggestions, newMemory, READ_NOTES_ON } from "./memoryTags.js";

export const NOTE_RE = /\[便利贴[:：]([^\]]{2,1200})\]/g;
export { READ_NOTES_ON };
export const READ_MEM_RE = /\[读书笔记[:：]([^\]]{2,1200})\]/g;
const findBook = title => {
  const name = String(title || "").replace(/[《》]/g, "").trim();
  return (store.books || []).find(x => x.title === name) || (store.books || []).find(x => name && (name.includes(x.title) || x.title.includes(name)));
};
export const readingMemsOf = bookId => (store.memories || []).filter(m => m.bookId && (!bookId || m.bookId === bookId) && (m.status || "valid") === "valid").sort((a, b) => b.ts - a.ts);

export function readingForAI(role, who) {
  if (!store.books?.length) return "";
  return [
    `\n# 共读`,
    `你和${who}有一个书架，一起读书。书架上有：${store.books.map(b => `《${b.title}》`).join("、")}。`,
    `想在书里给${who}留话时，在回复末尾另起一行写：[便利贴:书名|原文里的一小句（照抄几个字就行）|想说的话]，会变成一张便利贴，贴在那句话旁边。读到有感觉的地方再贴，不用每次都贴。`,
  ].join("\n");
}

// ---------- 前情（整理模型）和他的中途印象（他自己） ----------
// 前情 b.gist = { segs: [{ text, from, upTo, at, model, chars }], text, upTo, at }
//   读过的原文攒到 6 万字（可以调），等这一章读完再整理；一直没读完一章，到 7 万字就直接整理。
//   每次只整理新读的那一段，写成客观的故事梗概（不带感情），一段段接起来；整理到哪之后的原文，他每次都看得见。
// 中途印象 b.imprs = [{ text, upTo, at, model }]：每读 2 万字（可以调），他用自己的模型写一句 100 字以内的印象，
//   结合前情、看得见的原文、以前的印象——可能会推翻以前的想法。每一版都留着（回看他的理解怎么变的），平时只带最新的一版。
const before = (a, b) => a.ch < b.ch || (a.ch === b.ch && a.p < b.p);
// 从 from 读到 to（不含 to）的原文，太长就只留后面 max 个字
function textBetween(book, from, to, max = Infinity) {
  const out = [];
  for (let c = from.ch; c <= to.ch && c < book.chapters.length; c++) {
    const ps = book.chapters[c].paras || [];
    const a = c === from.ch ? from.p : 0, z = c === to.ch ? to.p : ps.length;
    if (a < z) out.push(`【${book.chapters[c].title || `第 ${c + 1} 章`}】`, ...ps.slice(a, z));
    if (z === ps.length && a < z) out.push(...authorNote(book.chapters[c]));
  }
  const t = out.join("\n");
  return t.length > max ? "……" + t.slice(-max) : t;
}
// 这一章末尾作者写的话（晋江的「作者有话要说」）：给 AI 看，但写明是作者的话，不是正文，别当剧情、也不用像正文那样批注
function authorNote(chap) {
  const note = chap?.note;
  if (!note?.length) return [];
  const t = note.slice(1).join("\n").slice(0, 600);
  return t ? [`（以下是作者在这一章末尾写的话，不是正文，不用当剧情，也别当正文去批注：${t}）`] : [];
}
// 两处之间有多少字（不拼字符串）
function charsBetween(book, from, to) {
  let n = 0;
  for (let c = from.ch; c <= to.ch && c < book.chapters.length; c++) {
    const ps = book.chapters[c].paras || [];
    const a = c === from.ch ? from.p : 0, z = c === to.ch ? Math.min(to.p, ps.length) : ps.length;
    for (let i = a; i < z; i++) n += ps[i].length;
  }
  return n;
}
export const sumEvery = () => Number(store.settings.readSumChars) || 60000;
export const SUM_FORCE = 10000; // 一直没读完一章：多读这么多字就直接整理
export const imprEvery = () => Number(store.settings.readImprChars) || 20000;
export const IMPR_MAX = 100;
export const latestImpr = b => (b.imprs || []).at(-1) || null;
const START = { ch: 0, p: 0 };

const gisting = {};
// 把前情 upTo 之前、上次整理之后的那一段整理成一段客观的梗概，接在前面那几段后面
export async function updateGist(role, b, upTo) {
  if (gisting[b.id]) return;
  gisting[b.id] = true;
  try {
    const { oneShot, meName, helperApi } = await import("./chat.js");
    const me = meName(role);
    const book = await loadBook(b.id);
    const from = b.gist?.upTo || START;
    if (!before(from, upTo)) return;
    const seg = textBetween(book, from, upTo);
    if (seg.length < 200) return;
    const prevText = b.gist?.text || "";
    const prompt = [
      `这是《${b.title}》${b.author ? `（${b.author}）` : ""}的一段原文，${me}和朋友在一起读。`,
      prevText ? `前面的梗概（已经整理过的，接着它往下写，不用重复）：\n${prevText.length > 3000 ? "……" + prevText.slice(-3000) : prevText}` : "",
      `这次要整理的原文：\n${seg}`,
      `把这次的原文整理成客观的故事梗概，给以后接着读的人看：发生了什么、按先后顺序、出场的人物和他们的关系、重要的细节和伏笔。只客观讲故事，不要评价，不要抒情，不要写读者的感受。只整理这次的原文，不超过 ${Math.max(600, Math.min(1500, Math.round(seg.length / 40)))} 字，只写梗概本身。`,
    ].filter(Boolean).join("\n\n");
    const text = (await oneShot(role, prompt, { helper: true, raw: true })).trim();
    if (!text) return;
    const segs = [...(b.gist?.segs || (prevText ? [{ text: prevText, from: START, upTo: from, at: b.gist?.at }] : [])), { text: text.slice(0, 3000), from, upTo, at: Date.now(), model: helperApi(role).model, chars: seg.length }];
    b.gist = { segs, text: segs.map(s => s.text).join("\n\n"), upTo, at: Date.now() };
  } finally {
    delete gisting[b.id];
  }
}
// 一起读 / 问问他之后：攒够了就在后台整理（下一次就带上新的）
export async function maybeGist(role, b, upTo) {
  const book = await loadBook(b.id);
  const from = b.gist?.upTo || START;
  const every = sumEvery();
  if (!before(from, upTo) || charsBetween(book, from, upTo) < every) return;
  // 等一章读完：切在最近读完的那一章末尾（这一章的开头）；一直没读完一章，多读 1 万字就切在现在
  const end = upTo.p >= (book.chapters[upTo.ch]?.paras.length || 0) ? { ch: upTo.ch + 1, p: 0 } : { ch: upTo.ch, p: 0 };
  let cut = null;
  if (before(from, end) && charsBetween(book, from, end) >= every) cut = end.ch >= book.chapters.length ? upTo : end;
  else if (charsBetween(book, from, upTo) >= every + SUM_FORCE) cut = upTo;
  if (cut) updateGist(role, b, cut).catch(e => console.warn("共读前情没整理成", e));
}
// 上次整理之后、到 to 之前（不含）读过的原文：他每次都看得见（太长留后面的）
export async function sinceGist(b, to, max = sumEvery() + SUM_FORCE + 5000) {
  const book = await loadBook(b.id);
  const from = b.gist?.upTo || START;
  return before(from, to) ? textBetween(book, from, to, max) : "";
}
export async function rawSince(b, to = b.pos || START) {
  const book = await loadBook(b.id);
  const from = b.gist?.upTo || START;
  return before(from, to) ? charsBetween(book, from, to) : 0;
}

// 他的中途印象：离上一次印象又读了 2 万字，就写一句新的（用他自己的模型）
const imprBusy = {};
export async function maybeImpression(role, b, upTo) {
  if (imprBusy[b.id]) return;
  const book = await loadBook(b.id);
  const from = latestImpr(b)?.upTo || START;
  if (!before(from, upTo) || charsBetween(book, from, upTo) < imprEvery()) return;
  imprBusy[b.id] = true;
  try { await writeImpression(role, b, upTo); } catch (e) { console.warn("中途印象没写成", e); } finally { delete imprBusy[b.id]; }
}
export async function writeImpression(role, b, upTo = b.hisPos ? { ch: b.hisPos.ch, p: b.hisPos.p + 1 } : b.pos || START) {
  const { oneShot, meName } = await import("./chat.js");
  const me = meName(role);
  const book = await loadBook(b.id);
  const olds = b.imprs || [];
  const raw = await sinceGist(b, upTo);
  const notes = (store.bookNotes || []).filter(n => n.bookId === b.id).slice(-10).map(n => `- ${n.from === "me" ? me : "你"}：${(n.text || "（划线）").slice(0, 80)}`);
  const prompt = [
    role.style?.trim() ? `（这是你写给自己的：${role.style.trim()}）\n` : "",
    `你和${me}在一起读《${b.title}》${b.author ? `（${b.author}）` : ""}，现在读到「${book.chapters[Math.min(upTo.ch, book.chapters.length - 1)]?.title || ""}」。`,
    b.gist?.text ? `前情梗概（整理好的）：\n${b.gist.text}` : "",
    raw ? `之后读过的原文：\n${raw}` : "",
    notes.length ? `你们在书页边上写的批注：\n${notes.join("\n")}` : "",
    olds.length ? `你以前写下的中途印象（从早到晚）：\n${olds.map((x, i) => `${i + 1}. ${x.text}`).join("\n")}` : "",
    `读到这里，写一句你现在对这本书的印象：用你自己的口吻，是你真实的理解和感受${olds.length ? "；和以前想的不一样也没关系，可以推翻自己" : ""}。${IMPR_MAX} 字以内，只写这一句。`,
  ].filter(Boolean).join("\n\n");
  const text = (await oneShot(role, prompt, { raw: true })).trim().replace(/^["“「]|["”」]$/g, "").slice(0, IMPR_MAX);
  if (!text) return null;
  b.imprs ??= [];
  const x = { text, upTo, at: Date.now(), model: modelFor(null, role) || apiFor(null, role)?.model || "" };
  b.imprs.push(x);
  return x;
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
    { label: "全局记忆（排在场景后面，含主聊天最近的消息）", text: (await globalMemoryForScene(role, me, { skip: "read" })) || "（没有）" },
    { label: "上次整理前情之后读过的原文（他都看得见）", text: (await sinceGist(b, b.pos || { ch: 0, p: 0 })) || "（刚整理过，或者还没读）" },
    { label: "然后是这次的", text: "问问他：你划的那一句、它所在的段落和前后各一段。\n一起读：他先看目录，自己挑从哪读、读多少（1000～8000 token），再给他那一段。" },
  ];
}
export function readingSceneParts(b, me) {
  const out = [];
  if (b.gist?.text) out.push({ key: "gist", label: "前情梗概", text: `这本书前面的梗概（整理模型客观记的，一段段接着）：\n${b.gist.text}` });
  const im = latestImpr(b);
  if (im) out.push({ key: "impr", label: "你最新的中途印象", text: `你读到「${b.chapters[Math.min(im.upTo.p === 0 && im.upTo.ch > 0 ? im.upTo.ch - 1 : im.upTo.ch, b.chapters.length - 1)]?.title || ""}」时写下的印象：${im.text}` });
  const notes = (store.bookNotes || []).filter(n => n.bookId === b.id).slice(-10).map(n => `- ${n.from === "me" ? me : "你"}${n.quote ? `（在「${n.quote.slice(0, 24)}」旁）` : ""}：${n.text ? n.text.slice(0, 120) : "（只划了线）"}`);
  if (notes.length) out.push({ key: "notes", label: "最近的划线和批注", text: `这本书里你们最近的划线和批注：\n${notes.join("\n")}` });
  const mems = (READ_NOTES_ON ? readingMemsOf(b.id) : []).slice(0, 5).map(m => `- ${m.content.slice(0, 140)}`);
  if (mems.length) out.push({ key: "mems", label: "这本书的读书笔记", text: `你为这本书记过的读书笔记：\n${mems.join("\n")}` });
  const others = (store.books || []).filter(x => x.id !== b.id && x.readAt && !x.mine).sort((x, y) => (y.readAt || 0) - (x.readAt || 0)).slice(0, 3);
  if (others.length) out.push({ key: "others", label: "其他也在读的书", text: `（别的书，别和这本弄混）你们也在读：\n${others.map(x => `- 《${x.title}》${latestImpr(x) ? `：${latestImpr(x).text}` : ""}`).join("\n")}` });
  return out;
}
async function bookContext(b, me, role, query = "") {
  const scene = readingSceneParts(b, me).map(x => x.text).join("\n\n");
  return [scene && `# 共读《${b.title}》（这次的场景，最要紧）\n${scene}`, role ? await globalMemoryForScene(role, me, { skip: "read", query }) : ""].filter(Boolean).join("\n");
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
    if (!READ_NOTES_ON) return ""; // 功能关着：他万一还是写了，标记悄悄去掉，不记
    const [title = "", head = "", ...rest] = inner.split(/[|｜]/).map(s => s.trim());
    const b = findBook(title);
    const content = rest.join(" ").trim() || head;
    if (!b || !content) return "";
    // 同一次醒来的结果被两台设备各记一遍时，不要记出两张一模一样的
    if ((store.memories || []).some(m => m.roleId === role.id && m.bookId === b.id && m.status !== "deleted" && m.content === content)) return "";
    newMemory(role, { bookId: b.id, title: `《${b.title}》${rest.length ? "：" + head : ""}`.slice(0, 40), content, source: { type: "read", by: "ai", id: b.id, label: `《${b.title}》` } });
    notes.push(`${role.name} 记下了一条读书笔记：《${b.title}》`);
    return "";
  });
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), notes };
}

// 这几段旁边已经贴着的便利贴（她贴的、他自己以前贴的、她回他的）：读到这里，他看得见
export function notesBeside(b, at, me) {
  const ok = new Set(at.map(x => `${x.ch}.${x.p}`));
  const all = store.bookNotes || [];
  const byId = id => all.find(n => n.id === id);
  const out = {};
  for (const n of all) {
    if (n.bookId !== b.id || !n.text || !ok.has(`${n.ch}.${n.p}`)) continue;
    const to = n.replyTo && byId(n.replyTo);
    const where = n.quote ? `在「${n.quote.slice(0, 30)}」旁` : "在这段旁";
    const line = n.from === "me"
      ? `${me}${where}贴了：${n.text.slice(0, 300)}${to ? `（回你的「${to.text.slice(0, 40)}」）` : ""}`
      : `你以前${where}贴过：${n.text.slice(0, 160)}`;
    (out[`${n.ch}.${n.p}`] ??= []).push({ n, line });
  }
  return out;
}

// ---------- 读书页里直接问他 ----------
// 「问问他」：给他看这一段（和前后各一段），他回一张便利贴；想记的读书笔记也一起记下
// thread：她在回他的哪张便利贴（他之前写的那句话）
export async function askHim(role, b, { ch, p, paras, chapterTitle, question, quote, page, thread }) {
  const { oneShot, meName } = await import("./chat.js");
  const me = meName(role);
  const para = paras[p] || "";
  const imageOnly = !para.trim();
  if (imageOnly && !page?.images?.length && !page?.text?.trim()) throw new Error("这几页没有字");
  const around = [paras[p - 1], paras[p + 1]].filter(Boolean).map(x => x.slice(0, 300));
  const part = quote && quote.trim() !== para.trim();
  const beside = imageOnly ? [] : (notesBeside(b, [{ ch, p }], me)[`${ch}.${p}`] || []).filter(x => !thread || x.n.text !== question);
  const prompt = [
    role.style?.trim() ? `（这是你写给自己的：${role.style.trim()}）\n` : "",
    `你和${me}在一起读《${b.title}》${b.author ? `（${b.author}）` : ""}，现在读到「${chapterTitle}」。`,
    await bookContext(b, me, role, `${question || ""} ${quote || paras[p] || ""}`),
    await (async () => { const t = await sinceGist(b, { ch, p: Math.max(0, p - 1) }); return t ? `（上次整理前情之后，你们读过的原文：）\n${t}` : ""; })(),
    imageOnly ? `${me}指着当前图片页给你看。没有可批注的文字段落，不要编造段落或原文。` : part ? `${me}划了这一句给你看：「${quote}」\n（它所在的这一段：${paras[p]}）` : `${me}指着这一段给你看：\n「${paras[p]}」`,
    imageOnly && page?.text ? `当前页可见文字：\n${page.text}` : "",
    around.length ? `（前后文：${around.join(" …… ")}）` : "",
    beside.length ? `这段旁边已经贴着的便利贴：\n${beside.map(x => `- ${x.line}`).join("\n")}` : "",
    thread ? `你之前在这句旁边贴过一张便利贴：「${thread}」\n${me}回你：${question}` : question ? `${me}在旁边写：${question}` : `${me}想听听你读到这里在想什么。`,
    imageOnly ? `直接回应当前页的图片或图片失败占位，几句话就好（不超过 120 字）。未提供画面时明确说明看不到。` : thread ? `再写一张便利贴回${me}，贴在同一句旁边：用你自己的口吻，几句话就好（不超过 120 字）。` : `写一句批注回在这${part ? "句" : "段"}旁边：用你自己的口吻，像在书页边上随手写给${me}的，几句话就好（不超过 120 字）。`,
  ].filter(Boolean).join("\n");
  const raw = await oneShot(role, prompt, { raw: true, parts: await readingPageParts(page) });
  const { text: t1, notes } = applyReadMemTags(role, raw);
  const { visibleText } = await import("./chat.js");
  const text = visibleText(t1).trim();
  if (!text) throw new Error("他没有写什么");
  if (imageOnly) return { text, notes, imageOnly: true };
  for (const x of beside) if (x.n.from === "me") x.n.seen = true;
  markHisPos(b, ch, p);
  maybeGist(role, b, { ch, p }).catch(() => {});
  maybeImpression(role, b, { ch, p: p + 1 }).catch(() => {});
  return { text, notes };
}

// 「一起读」：从你现在这一页往后的十来页，全部给他（可以跨章）——你还没读到的，他先读，一路贴批注，你往后读就会看到。
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
// 从 from 往后的段落（不含空段），最多 maxChars 字：[{ ch, p, t }]（自由时间他自己往后读）
// size：怎么量一段（默认按字数；他自己读按 token 粗估）
export async function forwardSlice(b, from, maxChars = 12000, size = t => t.length) {
  const book = await loadBook(b.id);
  const out = [];
  let n = 0;
  for (let c = from.ch; c < book.chapters.length; c++) {
    const ps = book.chapters[c]?.paras || [];
    for (let i = c === from.ch ? from.p : 0; i < ps.length; i++) {
      const t = ps[i].trim();
      if (!t) continue;
      if (n + size(t) > maxChars && out.length) return out;
      out.push({ ch: c, p: i, t });
      n += size(t);
    }
  }
  return out;
}

// ---------- 他自己读：按他自己的进度，他自己挑读哪、读多少 ----------
//   b.alongTo：他上一次读到哪（书页上「他读到这里」、你书页边上他的小头像都按这个）；b.hisNext：他说下次从哪开始（自由时间里说的）
//   读多少：1000～8000 token（中文大约一个字一个 token），他自己定
export const READ_MIN = 1000, READ_MAX = 8000;
export const hisAt = b => b.alongTo || b.hisPos || null;
const START0 = { ch: 0, p: 0 };
// 他接着读的话从哪开始：他说过下次从哪就从那；不然从上次读到的下一段；还没读过就从她读到的地方
export function hisNextFrom(b, book, roleId) {
  const pin = herPin(b, roleId);
  if (pin) return { ch: Math.min(pin.ch, book.chapters.length - 1), p: 0 };
  if (b.hisNext?.end) return tailStart(book, b.hisNext.tokens || 4000);
  if (b.hisNext) return { ch: b.hisNext.ch, p: b.hisNext.p || 0 };
  const at = hisAt(b);
  return at ? { ch: at.ch, p: at.p + 1 } : b.pos || START0;
}
// 她在目录里点的「下次从这章读」：b.herNext = { ch, ids: [哪几个 AI 还没用] }；每个 AI 读过一次就从 ids 里划掉，划空了整个清掉
export const herPin = (b, roleId) => (b.herNext && b.herNext.ids?.includes(roleId) ? b.herNext : null);
export function setHerPin(b, ch, ids) { b.herNext = { ch, ids: [...ids] }; }
export function clearHerPin(b, roleId) {
  if (!b.herNext) return;
  if (roleId == null) { delete b.herNext; return; }
  const ids = (b.herNext.ids || []).filter(x => x !== roleId);
  if (ids.length) b.herNext = { ...b.herNext, ids }; else delete b.herNext;
}
// 倒着数够 tokens，结尾那一段从哪开始
function tailStart(book, tokens) {
  let n = 0;
  for (let c = book.chapters.length - 1; c >= 0; c--) {
    const ps = book.chapters[c].paras || [];
    for (let i = ps.length - 1; i >= 0; i--) { n += estTokens(ps[i]); if (n >= tokens) return { ch: c, p: i }; }
  }
  return START0;
}
// 目录：每章多少 token，标上你们读到哪
function tocText(b, book, me) {
  const mine = b.pos, his = hisAt(b);
  return book.chapters.map((c, i) => {
    const tok = c.paras.reduce((a, t) => a + estTokens(t), 0);
    const marks = [his && his.ch === i ? "← 你上次读到这一章" : "", mine && mine.ch === i ? `← ${me}读到这一章` : ""].filter(Boolean).join(" ");
    return `${i + 1}. ${c.title || `第 ${i + 1} 章`}（约 ${tok} token）${marks ? " " + marks : ""}`;
  }).join("\n");
}
const CHOICE_RE = /\[读[:：]\s*(接着|末尾|结尾|\d+)\s*(?:[|｜]\s*(\d+))?\s*\]/;
const NEXT_RE = /\[下次从[:：]\s*(接着|末尾|结尾|\d+)\s*\]/;
const READ_TO_RE = /\[读到[:：]\s*(\d+)\s*[.．]\s*(\d+)\s*\]/;
// 第一步：给他看目录和你们读到哪，他挑从哪开始、读多少
export async function chooseReading(role, b) {
  const { oneShot, meName } = await import("./chat.js");
  const me = meName(role);
  const book = await loadBook(b.id);
  const im = latestImpr(b);
  const next = hisNextFrom(b, book, role.id);
  const pin = herPin(b, role.id);
  const pinTitle = pin ? book.chapters[next.ch]?.title || `第 ${next.ch + 1} 章` : "";
  const prompt = [
    role.style?.trim() ? `（这是你写给自己的：${role.style.trim()}）\n` : "",
    `你和${me}在一起读《${b.title}》${b.author ? `（${b.author}）` : ""}。这次你自己挑读哪里、读多少。`,
    `目录：\n${tocText(b, book, me)}`,
    pin ? `【${me}特意定的起点】${me}在目录里点了「下次从这章读」：这次请从「${pinTitle}」（第 ${next.ch + 1} 章）开头读。这是${me}定的，比你自己对中途的印象优先；中间那些章${me}不想让你读，别回头补。读多少还是你自己定。` : "",
    !pin && hisAt(b) ? `你上次读到「${book.chapters[hisAt(b).ch]?.title || ""}」；接着读的话从「${book.chapters[next.ch]?.title || ""}」那里开始。` : `你还没读过这本，接着读的话从${me}读到的地方开始。`,
    b.gist?.text ? `前面的梗概：\n${b.gist.text.length > 2000 ? "……" + b.gist.text.slice(-2000) : b.gist.text}` : "",
    im ? `你最新的中途印象：${im.text}` : "",
    pin ? `读多少你自己定：` : `大多数时候接着往下读就好；想跳到某一章、或者直接去看结尾，也可以。读多少你自己定：${READ_MIN}～${READ_MAX} token（中文大约一个字一个 token）。`,
    pin ? `只回一行：[读:${next.ch + 1}|token数]（token 数你定）。` : `只回一行：[读:接着|token数]，或者 [读:章号|token数]（从那一章开头读），或者 [读:末尾|token数]。`,
  ].filter(Boolean).join("\n\n");
  const raw = await oneShot(role, prompt, { raw: true });
  return parseChoice(raw, b, book, role.id);
}
export function parseChoice(raw, b, book, roleId) {
  const m = String(raw || "").match(CHOICE_RE);
  const tokens = Math.max(READ_MIN, Math.min(READ_MAX, Number(m?.[2]) || 4000));
  // 她定了起点：不管他回了什么，都从那一章开头读
  if (herPin(b, roleId)) return { how: "chapter", tokens, from: hisNextFrom(b, book, roleId) };
  const where = m?.[1] || "接着";
  if (/末尾|结尾/.test(where)) return { how: "end", tokens, from: tailStart(book, tokens) };
  if (/^\d+$/.test(where)) {
    const ch = Math.max(0, Math.min(book.chapters.length - 1, Number(where) - 1));
    return { how: "chapter", tokens, from: { ch, p: 0 } };
  }
  return { how: "next", tokens, from: hisNextFrom(b, book) };
}
// 自由时间读完写的：[读到:章.段]（读到哪停的）、[下次从:章号 / 末尾]（下次想从哪开始）
export function readMarks(raw, items) {
  const t = String(raw || "");
  const to = t.match(READ_TO_RE);
  const upTo = to && items.some(it => it.ch === to[1] - 1 && it.p === +to[2]) ? { ch: to[1] - 1, p: +to[2] } : null;
  const nx = t.match(NEXT_RE);
  const next = !nx || nx[1] === "接着" ? null : /末尾|结尾/.test(nx[1]) ? { end: true } : { ch: Math.max(0, Number(nx[1]) - 1), p: 0 };
  return { upTo, next };
}

// 一起读给他看的全部（原文按「章.段」编号）
// alone：自由时间自己读（带目录，他说读到哪停、下次从哪开始）；self：书页上他自己挑的这一段 { how, tokens }
export async function alongPrompt(role, b, items, from, { alone = false, self = null } = {}) {
  const { meName } = await import("./chat.js");
  const me = meName(role);
  const book = await loadBook(b.id);
  const beside = notesBeside(b, items, me);
  const lines = [];
  let last = -1;
  for (const it of items) {
    if (it.ch !== last) { lines.push(`【${book.chapters[it.ch]?.title || `第 ${it.ch + 1} 章`}】`); last = it.ch; }
    lines.push(`[${it.ch + 1}.${it.p}] ${it.t}`);
    if (it.p === (book.chapters[it.ch]?.paras.length || 0) - 1) lines.push(...authorNote(book.chapters[it.ch]).map(x => `    ${x}`));
    for (const x of beside[`${it.ch}.${it.p}`] || []) lines.push(`    （便利贴：${x.line}）`);
  }
  const hers = Object.values(beside).flat().some(x => x.n.from === "me");
  const earlier = await sinceGist(b, from);
  return [
    role.style?.trim() ? `（这是你写给自己的：${role.style.trim()}）\n` : "",
    `你和${me}在一起读《${b.title}》${b.author ? `（${b.author}）` : ""}。`,
    await bookContext(b, me, role),
    earlier ? `\n（上次整理前情之后、你们已经读过的原文，接着前情看：）\n${earlier.length > 8000 ? "……" + earlier.slice(-8000) : earlier}` : "",
    alone ? `\n目录（章号. 章名）：\n${book.chapters.map((c, i) => `${i + 1}. ${c.title || `第 ${i + 1} 章`}`).join("\n")}` : "",
    alone
      ? `\n这是你的自由时间，你自己想读书了，按你自己的进度往后读。下面是接下来的这一段（最多 ${READ_MAX} token；${me}现在不在，你一路留批注，${me}读到时会看到）。每段前面方括号里是「章.段」号：`
      : self
        ? `\n下面是你自己挑的这一段（${self.how === "end" ? "结尾" : self.how === "chapter" ? `从「${book.chapters[from.ch]?.title || ""}」开头` : "接着你上次读到的地方"}，约 ${self.tokens} token），你一路留批注，${me}读到时会看到。每段前面方括号里是「章.段」号：`
        : `\n下面是从${me}现在读到的这一页开始、往后的十来页（${me}还没读到，你先读，一路留批注，${me}往后读时会看到）。每段前面方括号里是「章.段」号：`,
    lines.join("\n"),
    `你读一读这一段。挑三五处真让你有感觉的句子，分散在前后不同的地方（不用每段都说），划下来，在旁边写一句批注，像在书页边上随手写给${me}的，每条不超过 100 字。`,
    `每条另起一行写：[贴:章.段|照抄你划的那句原文（几个到二十几个字）|想说的话]。只写这些，别的不用写。`,
    alone ? `读多少你自己定：想停就停，另起一行写 [读到:章.段]（停在哪一段；不写就是读完了这一段）。下次想换个地方读（跳到某一章、去看结尾），再写一行 [下次从:章号] 或 [下次从:末尾]；接着往下读就不用写。` : "",
    hers ? `段落下面括号里的是已经贴着的便利贴。${me}贴的你都看得见；想回应哪张，就贴在同一句上（照抄她划的那句原文），算在这三五处里。` : "",
  ].filter(Boolean).join("\n");
}
// 他读完写的：认出每条批注（照抄的句子、章.段），读书笔记记进记忆库
export async function parseAlong(role, items, raw) {
  const { visibleText } = await import("./chat.js");
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
    if (text && !/^\[不说话\]$/.test(text)) out.push({ ch: it.ch, p: it.p, quote: "", text: text.slice(0, 300) });
  }
  const end = items[items.length - 1];
  const marks = readMarks(raw, items);
  // 停在哪之后的批注不算（他说读到那儿就停了）
  const stop = marks.upTo || { ch: end.ch, p: end.p };
  const kept = out.filter(n => n.ch < stop.ch || (n.ch === stop.ch && n.p <= stop.p));
  return { notes: (kept.length ? kept : out).slice(0, 6), memNotes: notes, upTo: stop, next: marks.next };
}
// 批注贴进书里（照抄的句子找得到就划那一句，找不到就整段）
export async function placeAlong(b, notes, seenCh = -1) {
  const book = await loadBook(b.id);
  for (const n of notes) {
    const para = book.chapters[n.ch]?.paras[n.p] || "";
    const i = n.quote ? para.indexOf(n.quote.slice(0, 40)) : -1;
    const [st, en] = i >= 0 ? [i, i + n.quote.length] : [0, para.length];
    addNote(b, { ch: n.ch, p: n.p, start: st, end: Math.min(en, para.length), quote: para.slice(st, en), text: n.text, from: "ai" }).seen = n.ch === seenCh;
  }
}
export async function readAlong(role, b, { from, to, maxChars = 24000, page }) {
  const { oneShot } = await import("./chat.js");
  const items = await alongSlice(b, from, to, maxChars);
  if (!items.length) {
    // 图片页没有段落可贴批注：沿用问问他的页面上下文，回复单独呈现，不伪造文字坐标。
    const result = await askHim(role, b, { ch: from.ch, p: from.p, paras: [], chapterTitle: b.chapters[from.ch]?.title || "", page });
    return { text: result.text, imageOnly: true, notes: [], memNotes: result.notes, upTo: { ...from }, count: 0 };
  }
  const raw = await oneShot(role, await alongPrompt(role, b, items, from), { raw: true, parts: await readingPageParts(page) });
  const r = await parseAlong(role, items, raw);
  if (!r.notes.length) throw new Error("他没有写什么");
  for (const x of Object.values(notesBeside(b, items, "")).flat()) if (x.n.from === "me") x.n.seen = true; // 她贴的，他读到了
  markHisPos(b, r.upTo.ch, r.upTo.p);
  maybeGist(role, b, { ch: r.upTo.ch, p: r.upTo.p + 1 }).catch(() => {});
  maybeImpression(role, b, { ch: r.upTo.ch, p: r.upTo.p + 1 }).catch(() => {});
  return { ...r, count: items.length };
}

// 书页上「一起读」：他先挑读哪、读多少，再读那一段（这一段里的插图也给他看，最多 4 张）
export async function readOnHisOwn(role, b) {
  const { oneShot } = await import("./chat.js");
  const book = await loadBook(b.id);
  const choice = await chooseReading(role, b);
  const items = await forwardSlice(b, choice.from, choice.tokens, estTokens);
  if (!items.length) throw new Error("他挑的那一段没有字");
  const images = [];
  const last = items[items.length - 1];
  for (let c = items[0].ch; c <= last.ch && images.length < 4; c++) {
    const chap = book.chapters[c];
    (chap.media || []).forEach((m, index) => {
      if (images.length >= 4 || (c === items[0].ch && m.p < items[0].p) || (c === last.ch && m.p > last.p + 1)) return;
      images.push({ id: `图${c + 1}-${index + 1}`, ch: c, ahead: true, p: m.p, alt: m.alt || "", caption: m.caption || "", before: chap.paras[m.p - 1] || "", after: chap.paras[m.p] || "", source: book.resources?.[m.resource] || "" });
    });
  }
  const page = images.length ? { ch: items[0].ch, text: "", images } : null;
  const raw = await oneShot(role, await alongPrompt(role, b, items, choice.from, { self: choice }), { raw: true, parts: await readingPageParts(page) });
  const r = await parseAlong(role, items, raw);
  if (!r.notes.length) throw new Error("他没有写什么");
  for (const x of Object.values(notesBeside(b, items, "")).flat()) if (x.n.from === "me") x.n.seen = true;
  markHisPos(b, r.upTo.ch, r.upTo.p);
  b.alongTo = r.upTo;
  delete b.hisNext;
  clearHerPin(b, role.id);
  maybeGist(role, b, { ch: r.upTo.ch, p: r.upTo.p + 1 }).catch(() => {});
  maybeImpression(role, b, { ch: r.upTo.ch, p: r.upTo.p + 1 }).catch(() => {});
  return { ...r, choice, from: items[0] };
}

// 他的读后感：前情、他的中途印象、便利贴、读书笔记、你的读后感（重读的还有以前几遍的）都给他，打几颗星、写一篇（最多 3000 字）。
// 重写不覆盖：旧的那篇收进 b.hisOld，每篇都标着是第几遍读的
export const REVIEW_MAX = 3000;
export async function hisReview(role, b) {
  const { oneShot, meName } = await import("./chat.js");
  const me = meName(role);
  const round = b.round || 1;
  const notes = (store.bookNotes || []).filter(n => n.bookId === b.id).slice(-16).map(n => `- ${n.from === "me" ? me : "你"}：${(n.text || "（划线）").slice(0, 120)}`);
  const mems = (READ_NOTES_ON ? readingMemsOf(b.id) : []).slice(0, 8).map(m => `- ${m.content.slice(0, 160)}`);
  const past = (b.past || []).map(x => `第 ${x.round} 遍：${x.his?.text ? `你当时的读后感（${x.his.stars} 星）：${x.his.text.slice(0, 800)}` : x.impression?.text || "（没写）"}`);
  const prompt = [
    role.style?.trim() ? `（这是你写给自己的：${role.style.trim()}）\n` : "",
    `你和${me}${round > 1 ? `第 ${round} 遍` : ""}读完了《${b.title}》${b.author ? `（${b.author}）` : ""}。`,
    b.gist?.text ? `这本书的梗概：\n${b.gist.text}` : "",
    b.imprs?.length ? `你一路读下来写的中途印象（从早到晚）：\n${b.imprs.map((x, i) => `${i + 1}. ${x.text}`).join("\n")}` : "",
    notes.length ? `你们在书里贴过的便利贴：\n${notes.join("\n")}` : "",
    mems.length ? `你记下的读书笔记：\n${mems.join("\n")}` : "",
    past.length ? `以前读的几遍：\n${past.join("\n")}` : "",
    b.his?.text ? `你这一遍之前写过一篇（这次重写，可以不一样）：${b.his.text.slice(0, 600)}` : "",
    b.mine?.text ? `${me}的读后感（${b.mine.stars} 星）：${b.mine.text.slice(0, 1500)}` : "",
    `现在写你自己的读后感：第一行只写 1 到 5 的数字，是你给这本书的星级；从第二行开始写读后感，用你自己的口吻，写真实的感受和想法${round > 1 ? "，也可以写这一遍和以前读的时候有什么不一样" : ""}。想写多长写多长，最多 ${REVIEW_MAX} 字。`,
  ].filter(Boolean).join("\n");
  const raw = await oneShot(role, prompt);
  const m = raw.match(/^\s*([1-5])/);
  const stars = m ? Number(m[1]) : 4;
  const text = (raw.replace(/^\s*[1-5][^\n]*\n?/, "").trim() || raw.trim()).slice(0, REVIEW_MAX);
  if (b.his?.text) (b.hisOld ??= []).push(b.his);
  b.his = { stars, text, at: Date.now(), round };
  import("./board.js").then(m => m.bookImpression(role, b)).catch(e => console.warn("读完的印象没整理成", e)); // 板块记忆里的一句印象
  return b.his;
}
