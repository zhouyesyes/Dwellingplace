// 共读里给他看的东西
//   系统提示：有个书架；他可以写 [便利贴:书名|原文里的一小句|想说的话]，贴在那句话旁边
//   【此刻】：最近在读哪本、读到哪；你新贴的便利贴（他看过就记下）
import { store } from "../store/index.js";
import { loadBook, addNote } from "./books.js";

export const NOTE_RE = /\[便利贴[:：]([^\]]{2,1200})\]/g;

export function readingForAI(role, who) {
  if (!store.books?.length) return "";
  return [
    `\n# 共读`,
    `你和${who}有一个书架，一起读书。书架上有：${store.books.map(b => `《${b.title}》`).join("、")}。`,
    `想在书里给${who}留话时，在回复末尾另起一行写：[便利贴:书名|原文里的一小句（照抄几个字就行）|想说的话]，会变成一张便利贴，贴在那句话旁边。读到有感觉的地方再贴，不用每次都贴。`,
  ].join("\n");
}

export function newReadingForAI(role, who) {
  const parts = [];
  const recent = [...(store.books || [])].filter(b => b.readAt && Date.now() - b.readAt < 3 * 86400_000).sort((a, b) => b.readAt - a.readAt)[0];
  if (recent) {
    const ch = recent.chapters[recent.pos?.ch || 0];
    parts.push(`${who}最近在读《${recent.title}》，读到「${ch?.title || "开头"}」（第 ${(recent.pos?.ch || 0) + 1} / ${recent.chapters.length} 章）。`);
  }
  const fresh = (store.bookNotes || []).filter(n => n.from === "me" && !n.seen).slice(0, 4);
  for (const n of fresh) {
    const b = store.books.find(x => x.id === n.bookId);
    if (!b) continue;
    parts.push(`${who}在《${b.title}》「${b.chapters[n.ch]?.title || ""}」贴了一张便利贴——原文：「${n.quote}」，${who}写：${n.text}`);
    n.seen = true;
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
    const name = title.replace(/[《》]/g, "");
    const b = (store.books || []).find(x => x.title === name) || (store.books || []).find(x => name && (name.includes(x.title) || x.title.includes(name)));
    if (!body || !b) continue;
    const n = addNote(b, { ch: b.pos?.ch || 0, p: b.pos?.p || 0, quote, text: body, from: "ai" });
    const q = quote.replace(/[「」“”"]/g, "").slice(0, 16);
    if (q) loadBook(b.id).then(book => {
      for (let c = 0; c < book.chapters.length; c++) {
        const p = book.chapters[c].paras.findIndex(x => x.includes(q));
        if (p >= 0) { n.ch = c; n.p = p; return; }
      }
    });
    notes.push(`${role.name} 在《${b.title}》里贴了一张便利贴`);
  }
  return { text: clean, notes };
}
