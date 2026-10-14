// 共读的讨论室：每本书一间（《雨季》讨论室），共读室里还有一间大的（聊读过的、在读的书，读书这件事）。
// 和共写的讨论一样：说一句，他回一句；按 token 算，讨论原文到上限的八成就把前面新的这段整理成一小段，接在旧摘要后面（旧的不重写）。
//
// 每次给他看的（场景在前，全局在后）：
//   一本书的讨论室：这本书读到哪、第几遍；前情梗概（太长留后面）；他一路写的中途印象（每版都给，最新的标出来）；
//                   他的读后感（每一遍的）和你的读后感；最近的划线批注；他为这本书记的读书笔记；讨论摘要和摘要之后的讨论
//   大讨论室：书架上每本书一行（读到哪、他最新的印象、读后感几颗星和开头）；最近的读书笔记；讨论摘要和之后的讨论
//   全局记忆：常驻和相关的记忆卡片、板块记忆、此刻、主聊天最近几千 token（「场景里带主聊天多少」那个设置，默认 6k）
//   涉及以前的事：他可以写 [翻记忆:关键词]，在所有聊天和记忆里找，找到了再回（一次最多翻两回）
import { reactive } from "vue";
import { store, uid } from "../store/index.js";
import { get, set } from "./kv.js";
import { progressOf } from "./books.js";
import { latestImpr, readingMemsOf, applyNoteTags, applyReadMemTags } from "./reading.js";
import { globalMemoryForScene, takeSuggestions } from "./memoryTags.js";
import { recallForAI } from "./recall.js";
import { tail, sumTokens, keepCount, writeTokens, AUTO, snapshotSum } from "./budget.js";

export const HALL = "hall";
export const roomBook = id => (id === HALL ? null : (store.books || []).find(b => b.id === id) || null);
// 摘要挂在哪：一本书挂在书上，大讨论室挂在 store.readHall 上
export function roomOwner(id) {
  if (id === HALL) return (store.readHall ??= {});
  return roomBook(id);
}
export const roomTitle = id => (id === HALL ? "共读讨论室" : `《${roomBook(id)?.title || "这本书"}》讨论室`);

// ---------- 讨论记录 ----------
const talks = reactive({});
export async function loadRoom(id) {
  if (!talks[id]) talks[id] = (await get(`rtalk:${id}`)) || [];
  return talks[id];
}
export const saveRoom = id => set(`rtalk:${id}`, JSON.parse(JSON.stringify(talks[id] || [])));
export async function dropRoomMsg(id, mid) {
  const list = await loadRoom(id);
  const i = list.findIndex(m => m.id === mid);
  if (i >= 0) list.splice(i, 1);
  await saveRoom(id);
}
async function cutAfter(id, mid, keep) {
  const list = await loadRoom(id);
  const i = list.findIndex(m => m.id === mid);
  if (i >= 0) list.splice(keep ? i + 1 : i);
}
export async function regenRoom(role, id, mid) {
  await cutAfter(id, mid, false);
  return roomTalk(role, id, "");
}
export async function editRoomAndResend(role, id, mid, text) {
  const m = (await loadRoom(id)).find(x => x.id === mid);
  if (!m) return;
  m.text = text.trim();
  m.edited = true;
  await cutAfter(id, mid, true);
  return roomTalk(role, id, "");
}

export const roomLimit = writeTokens; // 和共写的讨论用同一个上限（默认 3 万）
export const roomAutoAt = () => Math.round(roomLimit() * AUTO);
export function roomAfterSum(owner, list) {
  const i = owner?.talkSum?.upTo ? list.findIndex(m => m.id === owner.talkSum.upTo) : -1;
  return i >= 0 ? list.slice(i + 1) : list;
}

// ---------- 给他看的 ----------
const cut = (t, n) => (t.length > n ? "……" + t.slice(-n) : t);
const where = b => {
  const pct = Math.round(progressOf(b) * 100);
  return b.mine || b.his ? "读完了" : pct > 0 ? `读到 ${pct}%` : "还没开始读";
};
function bookParts(b, me) {
  const out = [];
  out.push({ key: "book", label: "这本书", text: `《${b.title}》${b.author ? `（${b.author}）` : ""}：${where(b)}${(b.round || 1) > 1 ? `，这是第 ${b.round} 遍读` : ""}。` });
  if (b.gist?.text) out.push({ key: "gist", label: "前情梗概", text: `前情梗概（整理模型客观记的）：\n${cut(b.gist.text, 4000)}` });
  if (b.imprs?.length) out.push({ key: "imprs", label: `你的中途印象（${b.imprs.length} 版）`, text: `你一路读下来写的中途印象（从早到晚，最后一条是你现在的看法；前面的是以前的想法，可能被你推翻过）：\n${b.imprs.map((x, i) => `${i + 1}. ${x.text}`).join("\n")}` });
  const his = [...(b.past || []).filter(x => x.his?.text).map(x => ({ ...x.his, round: x.round })), ...(b.hisOld || []), ...(b.his ? [b.his] : [])];
  if (his.length) out.push({ key: "his", label: "你的读后感", text: his.map(x => `你第 ${x.round || 1} 遍读完写的读后感（${x.stars} 星）：\n${x.text.slice(0, 1500)}`).join("\n\n") });
  if (b.mine?.text) out.push({ key: "mine", label: `${me}的读后感`, text: `${me}的读后感（${b.mine.stars} 星）：\n${b.mine.text.slice(0, 1500)}` });
  const notes = (store.bookNotes || []).filter(n => n.bookId === b.id).slice(-12).map(n => `- ${n.from === "me" ? me : "你"}${n.quote ? `（在「${n.quote.slice(0, 24)}」旁）` : ""}：${n.text ? n.text.slice(0, 120) : "（只划了线）"}`);
  if (notes.length) out.push({ key: "notes", label: "最近的划线和批注", text: `这本书里你们最近的划线和批注：\n${notes.join("\n")}` });
  const mems = readingMemsOf(b.id).slice(0, 8).map(m => `- ${m.content.slice(0, 160)}`);
  if (mems.length) out.push({ key: "mems", label: "这本书的读书笔记", text: `你为这本书记过的读书笔记：\n${mems.join("\n")}` });
  return out;
}
function hallParts(me) {
  const books = [...(store.books || [])].sort((a, b) => (b.readAt || b.addedAt || 0) - (a.readAt || a.addedAt || 0));
  const out = [];
  if (books.length) out.push({ key: "shelf", label: `书架（${books.length} 本）`, text: `书架上的书（最近读的在前）：\n${books.slice(0, 20).map(b => {
    const im = latestImpr(b);
    return [`- 《${b.title}》${b.author ? `（${b.author}）` : ""}：${where(b)}`, im && `你最新的印象：${im.text}`, b.his && `你的读后感 ${b.his.stars} 星：${b.his.text.slice(0, 160)}…`, b.mine && `${me}给了 ${b.mine.stars} 星`].filter(Boolean).join("；");
  }).join("\n")}` });
  const mems = readingMemsOf().slice(0, 8).map(m => `- ${m.title}：${m.content.slice(0, 120)}`);
  if (mems.length) out.push({ key: "mems", label: "最近的读书笔记", text: `你最近记的读书笔记：\n${mems.join("\n")}` });
  return out;
}
// 场景记忆一段段（记忆库「看看发给他的」也能用）
export function roomSceneParts(id, list, me) {
  const owner = roomOwner(id);
  const b = roomBook(id);
  const out = b ? bookParts(b, me) : hallParts(me);
  if (owner?.talkSum?.text) out.push({ key: "talkSum", label: "讨论摘要（只在这间讨论室）", text: `你们之前在这里讨论的摘要（你自己整理的）：\n${owner.talkSum.text}` });
  const rest = tail(roomAfterSum(owner, list), roomLimit());
  out.push({ key: "talk", label: `摘要之后的讨论（${rest.length} 句）`, text: `你们${owner?.talkSum?.text ? "接着" : "刚才"}在聊：\n${rest.map(m => `${m.from === "me" ? me : "你"}：${m.text}`).join("\n") || "（刚坐下）"}` });
  return out;
}
export async function roomPrompt(role, id, extra = "", alone = false) {
  const { meName } = await import("./chat.js");
  const me = meName(role);
  const list = await loadRoom(id);
  const b = roomBook(id);
  const last = [...list].reverse().find(m => m.from === "me")?.text || "";
  return [
    role.style?.trim() ? `（这是你写给自己的：${role.style.trim()}）\n` : "",
    b
      ? `你和${me}一起读《${b.title}》。现在你们坐在共读室的讨论室里，专门聊这本书：情节、人物、写法、读到时的感受、和自己的生活有什么关系。说你真实的理解和想法，可以和${me}看法不一样，可以推翻你以前的印象；没读到的地方别编，也别剧透${me}还没读到的（除非${me}问）。`
      : `你和${me}有一个共读室，一起读了好些书。现在你们坐在共读室的大讨论室里：可以聊读过的、在读的书，把几本书放在一起比，也可以聊读书这件事本身。说你真实的想法，别空泛。`,
    `\n# ${roomTitle(id)}（这次的场景，最要紧）\n${roomSceneParts(id, list, me).map(x => x.text).join("\n\n")}`,
    await globalMemoryForScene(role, me, { skip: "read", query: last }),
    [
      `\n你可以在回复里顺手做这几件事（不是每次都要）：`,
      `- 想不起以前的事（你们聊过什么、哪天说过什么），或者${me}问起以前的事：只回复一行 [翻记忆:关键词]（不要写别的），系统会在你们所有的聊天记录和记忆里找给你，你再回复`,
      `- 给书里某句话贴便利贴：另起一行写 [便利贴:书名|原文里的一小句|想说的话]`,
      `- 让你自己有收获、想记住的：另起一行写 [读书笔记:书名|标题|内容]，会记进你的记忆库`,
    ].join("\n"),
    extra,
    alone ? `\n（这是你的自由时间，你自己走进了这里，${me}现在不在。写一段你想留在这里的话：想和${me}讨论的、读到想到的、想问${me}的，等${me}来了会看到。像平时说话那样，几段就好。不想写就只写 [不说话]。）` : `\n现在接着回${me}，像平时说话那样，几段就好。`,
  ].filter(Boolean).join("\n");
}

// ---------- 说一句，他回一句 ----------
const RECALL_LINE = /^\s*\[翻记忆[:：]\s*([^\]\n]{1,60})\]\s*$/m;
export async function roomTalk(role, id, text) {
  const { oneShot, visibleText, meName } = await import("./chat.js");
  const list = await loadRoom(id);
  if (text.trim()) list.push({ id: uid(), from: "me", text: text.trim(), ts: Date.now() });
  const notes = [];
  let extra = "";
  let raw = "";
  for (let i = 0; i < 3; i++) {
    raw = await oneShot(role, await roomPrompt(role, id, extra), { raw: true });
    const rm = raw.match(RECALL_LINE);
    if (!rm || i === 2) break;
    const q = rm[1].trim();
    const r = await recallForAI(role, q, meName(role));
    notes.push(`${role.name} 翻了翻记忆「${q}」· 找到 ${r.count} 条`);
    extra += `\n\n【你刚才翻记忆「${q}」找到的（是你自己的聊天记录和记忆，不是${meName(role)}说的话）】\n${r.text}`;
  }
  raw = raw.replace(new RegExp(RECALL_LINE.source, "gm"), "");
  const t1 = applyNoteTags(role, raw);
  const t2 = applyReadMemTags(role, t1.text);
  notes.push(...t1.notes, ...t2.notes);
  const reply = visibleText(t2.text).trim();
  if (reply || notes.length) list.push({ id: uid(), from: "ai", text: reply, notes, ts: Date.now() });
  await saveRoom(id);
  const owner = roomOwner(id);
  if (owner) owner.talkAt = Date.now();
  if (sumTokens(roomAfterSum(owner, list)) >= roomAutoAt()) compressRoom(role, id, { why: "limit" }).catch(e => console.warn("讨论摘要没整理成", e));
  return { reply, notes };
}

// ---------- 讨论摘要（只在这间讨论室，不进记忆库）----------
const summing = {};
export async function compressRoom(role, id, { keep, why = "manual" } = {}) {
  if (summing[id]) throw new Error("正在整理，等一下");
  const { oneShot, meName, helperApi, sumSpanHead } = await import("./chat.js");
  const owner = roomOwner(id);
  if (!owner) return 0;
  const list = await loadRoom(id);
  const rest = roomAfterSum(owner, list);
  keep ??= keepCount(rest, roomLimit());
  const old = rest.slice(0, Math.max(0, rest.length - keep));
  if (old.length < 2) return 0;
  summing[id] = true;
  try {
    const me = meName(role);
    const prev = owner.talkSum?.text;
    const b = roomBook(id);
    let text = (await oneShot(role, [
      b ? `你和${me}在共读室的讨论室里聊《${b.title}》。` : `你和${me}在共读室的大讨论室里聊书。`,
      prev ? `（以前已经整理好的讨论摘要，最后一段是这样的，只是让你接得上，不要改写、不要重复：）\n${cut(prev, 1500)}\n` : "",
      `下面是你们${prev ? "接着" : ""}讨论的：\n${old.map(m => `${m.from === "me" ? me : "你"}：${(m.text || "").slice(0, 600)}`).join("\n")}\n`,
      `只把这一段新的讨论整理成一小段摘要，写给以后接着讨论的自己看：聊了哪些书、哪些地方，各自怎么看，有什么分歧，${me}在意什么。书里的人物写名字，别用含糊的「他」「她」。按先后，客观简洁，不超过 800 字。只写这一段摘要本身。`,
      `另外：如果讨论里有关于${me}本人、值得长久记住的事（不是书里的内容），在最后另起一行写 [候选记忆:标题|内容]，最多 2 条；没有就不写。`,
    ].filter(Boolean).join("\n"), { helper: true, raw: true })).trim();
    text = takeSuggestions(role, text, roomTitle(id));
    if (!text) return 0;
    snapshotSum(owner, "talkSum");
    text = [prev, `${sumSpanHead(old[0].ts, old[old.length - 1].ts)}\n${text.slice(0, 2400)}`].filter(Boolean).join("\n\n"); // 接在后面，不重写以前的
    owner.talkSum = { text, upTo: old[old.length - 1].id, count: (owner.talkSum?.count || 0) + old.length, at: Date.now(), why, last: old.length,
      lastSpan: [old[0].ts, old[old.length - 1].ts], model: helperApi(role).model, tokens: sumTokens(old) };
    return old.length;
  } finally {
    delete summing[id];
  }
}
