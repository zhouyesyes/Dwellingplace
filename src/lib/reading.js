// 共读里给他看的东西
//   系统提示：有个书架；他可以写 [便利贴:书名|原文里的一小句|想说的话]，贴在那句话旁边
//   【此刻】：最近在读哪本、读到哪；你新贴的便利贴（他看过就记下）
//   读书笔记：他读到觉得有意思、对自己有用的，写 [读书笔记:书名|标题|内容]，记进他的记忆库（带着是哪本书）
import { store, uid } from "../store/index.js";
import { loadBook, addNote, markHisPos } from "./books.js";
import { todayYmd } from "./dates.js";

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

export function newReadingForAI(role, who) {
  const parts = [];
  const recent = [...(store.books || [])].filter(b => b.readAt && Date.now() - b.readAt < 3 * 86400_000).sort((a, b) => b.readAt - a.readAt)[0];
  if (recent) {
    const ch = recent.chapters[recent.pos?.ch || 0];
    const his = recent.hisPos ? `你上次读到第 ${recent.hisPos.ch + 1} 章。` : "";
    parts.push(`${who}最近在读《${recent.title}》，读到「${ch?.title || "开头"}」（第 ${(recent.pos?.ch || 0) + 1} / ${recent.chapters.length} 章）。${his}`);
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
export async function askHim(role, b, { ch, p, paras, chapterTitle, question }) {
  const { oneShot, meName } = await import("./chat.js");
  const me = meName(role);
  const around = [paras[p - 1], paras[p + 1]].filter(Boolean).map(x => x.slice(0, 300));
  const prompt = [
    role.style?.trim() ? `（这是你写给自己的：${role.style.trim()}）\n` : "",
    `你和${me}在一起读《${b.title}》${b.author ? `（${b.author}）` : ""}，现在读到「${chapterTitle}」。`,
    `${me}指着这一段给你看：\n「${paras[p]}」`,
    around.length ? `（前后文：${around.join(" …… ")}）` : "",
    question ? `${me}在旁边写：${question}` : `${me}想听听你读到这里在想什么。`,
    `写一张便利贴贴在这段旁边：用你自己的口吻，像在书页边上随手写给${me}的，几句话就好（不超过 120 字）。`,
    `如果这一段让你自己有收获、想记住，可以在最后另起一行写 [读书笔记:${b.title}|标题|内容]，会记进你的记忆库（不是每次都要）。`,
  ].filter(Boolean).join("\n");
  const raw = await oneShot(role, prompt, { raw: true });
  const { text: t1, notes } = applyReadMemTags(role, raw);
  const { visibleText } = await import("./chat.js");
  const text = visibleText(t1).trim();
  if (!text) throw new Error("他没有写什么");
  markHisPos(b, ch, p);
  return { text, notes };
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
