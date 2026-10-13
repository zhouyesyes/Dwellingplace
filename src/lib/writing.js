// 共写：书桌上的书。一本书一个项目，里面是一张张卡片（人物、设定、大纲、灵感、片段……），不一定按章节。
//   store.writings   [{ id, title, color, pitch, synopsis, cover, banner, bg, bubbleMe, bubbleAi, createdAt, updatedAt, memId, sinceSum }]
//                    pitch：一句话的定位；synopsis：简介；cover / banner / bg：封面、页头图、讨论页背景（图片 id）；bubbleMe / bubbleAi：气泡颜色
//                    color：书脊颜色的编号；memId：这本书在他记忆库里那张总结卡；sinceSum：上次总结以后又聊了几句
//   store.writeCards [{ id, projectId, type, title, content, atts, from, ts }]   from："me" 或 "ai"（他提的新卡片）
//                    atts：卡片上的图片、文件 [{ kind: "image", img } | { kind: "pdf" | "text", name, … }]（和聊天里的附件一样）
//   store.writeNotes [{ id, projectId, cardId, from, text, ts, seen }]     便利贴：贴在卡片上
//   wtalk:<项目 id>  和他讨论的记录 [{ id, from, text, atts, ts }]（单独存，会同步）
import { reactive } from "vue";
import { store, uid } from "../store/index.js";
import { get, set, del } from "./kv.js";
import { todayYmd } from "./dates.js";
import { saveImage, deleteImage, CHAT_IMAGE } from "./images.js";

export const CARD_TYPES = {
  role: { label: "人物", mark: "人" },
  world: { label: "设定", mark: "设" },
  outline: { label: "大纲", mark: "纲" },
  idea: { label: "灵感", mark: "灵" },
  scene: { label: "片段", mark: "段" },
  ref: { label: "资料", mark: "资" },
  other: { label: "其他", mark: "记" },
};
// 书脊：淡淡的多巴胺色（按编号存，换了这一排，旧书也跟着换）
// 卡片的颜色（自己挑）：浅浅的几种
export const TINTS = { white: "#ffffff", mint: "#e3f3ec", cream: "#fbf3df", pink: "#fbe8ec", blue: "#e4eefa", lilac: "#eee8f8", sand: "#f2ece4" };
export const cardBg = c => TINTS[c.tint] || (c.from === "ai" ? TINTS.blue : TINTS.white);
export const SPINES = ["#ffadc6", "#ffcb85", "#ffe17d", "#a6e3a1", "#8fd3f4", "#bfa8f6", "#ffa494", "#7fdcd0"];

export const projects = () => store.writings || [];
export const projectById = id => projects().find(p => p.id === id);
// 卡片按自己排的顺序（c.order）；没排过的按放上来的先后
const ordOf = c => (c.order ?? c.ts);
export const cardsOf = pid => (store.writeCards || []).filter(c => c.projectId === pid).sort((a, b) => ordOf(a) - ordOf(b));
// 资料夹的顺序（p.folders）：自己排过就按排的，新加的类型接在后面
export const folderOrder = p => [...new Set([...(p?.folders || []).filter(k => CARD_TYPES[k]), ...Object.keys(CARD_TYPES)])];
export function moveFolder(p, key, d) {
  const list = folderOrder(p);
  const i = list.indexOf(key), j = i + d;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  p.folders = list;
}
// 同一个资料夹里往前 / 往后挪一张
export function moveCard(c, d) {
  const list = cardsOf(c.projectId).filter(x => x.type === c.type);
  const i = list.indexOf(c), j = i + d;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((x, k) => (x.order = k));
}
export const notesOfCard = cid => (store.writeNotes || []).filter(n => n.cardId === cid);
export const freshNotes = pid => (store.writeNotes || []).filter(n => n.from === "ai" && !n.seen && (!pid || n.projectId === pid));

export function newProject(title) {
  store.writings ??= [];
  const p = { id: uid(), title: title.trim().slice(0, 60), color: store.writings.length % SPINES.length, createdAt: Date.now(), updatedAt: Date.now(), memId: null, sinceSum: 0 };
  store.writings.push(p);
  return p;
}
export async function removeProject(p) {
  store.writings.splice(store.writings.indexOf(p), 1);
  store.writeCards = (store.writeCards || []).filter(c => c.projectId !== p.id);
  store.writeNotes = (store.writeNotes || []).filter(n => n.projectId !== p.id);
  for (const k of ["cover", "banner", "bg"]) if (p[k]) deleteImage(p[k]);
  delete talks[p.id];
  await del(`wtalk:${p.id}`);
}
const touch = pid => { const p = projectById(pid); if (p) p.updatedAt = Date.now(); };

export function addCard(pid, { type = "idea", title = "", content = "", from = "me", atts = [] }) {
  store.writeCards ??= [];
  const same = (store.writeCards || []).filter(x => x.projectId === pid && x.type === type);
  const c = { id: uid(), projectId: pid, type, title: title.trim().slice(0, 60), content: content.trim(), atts, from, ts: Date.now(), order: same.length ? Math.max(...same.map(ordOf)) + 1 : 0 };
  store.writeCards.push(c);
  touch(pid);
  return c;
}
export function removeCard(c) {
  for (const a of c.atts || []) if (a.kind === "image") deleteImage(a.img); else if (a.file) del(`file:${a.file}`);
  store.writeCards.splice(store.writeCards.indexOf(c), 1);
  store.writeNotes = (store.writeNotes || []).filter(n => n.cardId !== c.id);
}
export function addNote(c, text, from) {
  store.writeNotes ??= [];
  const n = { id: uid(), projectId: c.projectId, cardId: c.id, from, text: text.trim().slice(0, 1000), ts: Date.now(), seen: from === "me" };
  store.writeNotes.push(n);
  touch(c.projectId);
  return n;
}
export const removeNote = n => store.writeNotes.splice(store.writeNotes.indexOf(n), 1);
// 采纳：便利贴上的话接到卡片后面，便利贴撕掉
export function adoptNote(n) {
  const c = store.writeCards.find(x => x.id === n.cardId);
  if (c) c.content = [c.content, n.text].filter(Boolean).join("\n\n");
  removeNote(n);
}

// ---------- 图片、文件 ----------
// 一个文件 → 附件：图片压一下存起来，PDF、文本和聊天里一样
export async function toAtt(file) {
  if (file.type.startsWith("image/")) return { kind: "image", img: await saveImage(file, CHAT_IMAGE), name: file.name };
  const { fileToAttachment } = await import("./chat.js");
  return fileToAttachment(file);
}
// 导入：每个文件变成一张卡片（文本文件的字直接放进卡片里；图片、PDF 挂在卡片上）
export async function importFiles(pid, files, type = "ref") {
  const out = [];
  for (const f of files) {
    const a = await toAtt(f);
    const title = f.name.replace(/\.[^.]+$/, "").slice(0, 60);
    out.push(a.kind === "text" ? addCard(pid, { type, title, content: a.text }) : addCard(pid, { type, title, atts: [a] }));
  }
  return out;
}

// ---------- 讨论记录 ----------
const talks = reactive({});
export async function loadTalk(pid) {
  if (!talks[pid]) talks[pid] = (await get(`wtalk:${pid}`)) || [];
  return talks[pid];
}
export const saveTalk = pid => set(`wtalk:${pid}`, JSON.parse(JSON.stringify(talks[pid] || [])));
// 讨论里的一条：删掉（只删这一条）、从这条往后都去掉（重新回答 / 改了重发用）
export async function dropTalkMsg(pid, id) {
  const list = await loadTalk(pid);
  const i = list.findIndex(m => m.id === id);
  if (i >= 0) list.splice(i, 1);
  await saveTalk(pid);
}
async function cutTalkAfter(pid, id, keep) {
  const list = await loadTalk(pid);
  const i = list.findIndex(m => m.id === id);
  if (i >= 0) list.splice(keep ? i + 1 : i);
}
// 他这条重新说一遍
export async function regenTalk(role, p, id) {
  await cutTalkAfter(p.id, id, false);
  return talk(role, p, "");
}
// 改了自己那句，从那里重新聊
export async function editTalkAndResend(role, p, id, text) {
  const m = (await loadTalk(p.id)).find(x => x.id === id);
  if (!m) return;
  m.text = text.trim();
  m.edited = true;
  await cutTalkAfter(p.id, id, true);
  return talk(role, p, "");
}

// 这本书给他看的样子：标题 + 每张卡片（太长的截断）
function projectText(p, limit = 9000) {
  const out = [];
  let n = 0;
  // 按她排的顺序：资料夹一个一个来，夹里的卡片也按顺序
  outer: for (const k of folderOrder(p)) {
    for (const c of cardsOf(p.id).filter(x => x.type === k)) {
      const att = (c.atts || []).length ? `（卡片上有 ${c.atts.map(a => a.kind === "image" ? "图" : a.name).join("、")}）` : "";
      const line = `【${CARD_TYPES[c.type]?.label || "其他"}】${c.title || "（无题）"}：${c.content.replace(/\n{2,}/g, "\n").slice(0, 700)}${att}`;
      if (n + line.length > limit) { out.push("……（还有一些卡片，太长没放进来）"); break outer; }
      out.push(line);
      n += line.length;
    }
  }
  const head = [p.pitch?.trim() && `定位：${p.pitch.trim()}`, p.synopsis?.trim() && `简介：${p.synopsis.trim().slice(0, 1200)}`].filter(Boolean).join("\n");
  return [head, out.join("\n") || "（还没有卡片）"].filter(Boolean).join("\n\n");
}

const NOTE_TAG = /\[便签[:：]([^\]]{2,1200})\]/g;
const CARD_TAG = /\[新卡片[:：]([^\]]{2,2000})\]/g;
// 他回复里的便签、新卡片：贴上去、放上桌，返回剩下的话和提示
function applyTags(p, text) {
  const notes = [];
  text = text.replace(NOTE_TAG, (_, inner) => {
    const [title = "", ...rest] = inner.split(/[|｜]/).map(s => s.trim());
    const body = rest.join("｜").trim();
    const c = cardsOf(p.id).find(x => x.title === title) || cardsOf(p.id).find(x => title && (x.title.includes(title) || title.includes(x.title)));
    if (c && body) { addNote(c, body, "ai"); notes.push(`贴在「${c.title}」上`); }
    return "";
  });
  text = text.replace(CARD_TAG, (_, inner) => {
    const [type = "", title = "", ...rest] = inner.split(/[|｜]/).map(s => s.trim());
    const key = Object.keys(CARD_TYPES).find(k => CARD_TYPES[k].label === type) || "idea";
    const content = rest.join("｜").trim();
    if (content) { addCard(p.id, { type: key, title, content, from: "ai" }); notes.push(`放了一张新卡片「${title || "无题"}」`); }
    return "";
  });
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), notes };
}

function rulesFor(who) {
  return [
    `你可以在回复里顺手做两件事（不是每次都要）：`,
    `- 给某张卡片贴便利贴（批注、建议、疑问）：另起一行写 [便签:卡片标题|想说的话]`,
    `- 提一张新卡片（${Object.values(CARD_TYPES).map(t => t.label).join("、")}）：另起一行写 [新卡片:类型|标题|内容]，${who}可以留下或者撕掉`,
  ].join("\n");
}

// 共写的场景记忆，一段一段分好：这本书（定位、简介、资料按顺序）→ 你记着的这本书的总结 → 刚才的讨论 → 其他在写的书（短短一句）
export function writingSceneParts(p, list, me) {
  const out = [{ key: "cards", label: "定位、简介和资料", text: `这本书的定位、简介和资料（按${me}排的顺序）：\n${projectText(p)}` }];
  const memo = store.memories.find(m => m.id === p.memId);
  if (memo) out.push({ key: "memo", label: "你记着的这本书", text: `你之前记下的这本书：${memo.content}` });
  const recent = list.slice(-16).map(m => `${m.from === "me" ? me : "你"}：${m.text}${m.atts?.length ? `（附了 ${m.atts.map(a => a.kind === "image" ? "一张图" : a.name).join("、")}）` : ""}`).join("\n");
  out.push({ key: "talk", label: "刚才的讨论（最近 16 句）", text: `你们刚才在聊：\n${recent || "（刚坐下）"}` });
  const others = projects().filter(x => x.id !== p.id).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 3);
  if (others.length) out.push({ key: "others", label: "其他在写的书", text: `（别的书，别和这本弄混）${me}还在写：${others.map(x => `《${x.title}》${x.pitch ? `（${x.pitch}）` : ""}`).join("、")}` });
  return out;
}
// 讨论时给他看的全部：场景记忆在前，全局记忆在后（记忆库里「看看发给他的」也是这一份）
export async function writingPrompt(role, p, atts = []) {
  const { meName } = await import("./chat.js");
  const { globalMemoryForScene } = await import("./memoryTags.js");
  const me = meName(role);
  const list = await loadTalk(p.id);
  return [
    role.style?.trim() ? `（这是你写给自己的：${role.style.trim()}）\n` : "",
    `${me}是写小说的人。你们坐在书桌前，一起琢磨${me}在写的《${p.title}》。你是${me}的写作伙伴：认真读设定，说真实的想法，可以提问、提建议、指出矛盾，也可以夸，但别空泛，也别替${me}把书写完。`,
    `\n# 共写《${p.title}》（这次的场景，最要紧）\n${writingSceneParts(p, list, me).map(x => x.text).join("\n\n")}`,
    globalMemoryForScene(role, me, { skip: "write" }),
    `\n${rulesFor(me)}`,
    atts.length ? `\n${me}这次发来的图片、文件在最前面。` : "",
    `\n现在接着回${me}，像平时说话那样，几段就好。`,
  ].filter(Boolean).join("\n");
}

// 在书桌前和他讨论：说一句，他回一句
export async function talk(role, p, text, atts = []) {
  const { oneShot, visibleText } = await import("./chat.js");
  const list = await loadTalk(p.id);
  if (text.trim() || atts.length) list.push({ id: uid(), from: "me", text: text.trim(), atts, ts: Date.now() });
  else if (list.at(-1)?.from === "me") atts = list.at(-1).atts || []; // 重新回答：带上那句里的图片、文件
  const prompt = await writingPrompt(role, p, atts);
  const raw = await oneShot(role, prompt, { raw: true, attachments: atts });
  const { text: rest, notes } = applyTags(p, raw);
  const reply = visibleText(rest).trim();
  if (reply || notes.length) list.push({ id: uid(), from: "ai", text: reply, notes, ts: Date.now() });
  await saveTalk(p.id);
  touch(p.id);
  p.sinceSum = (p.sinceSum || 0) + 1;
  if (p.sinceSum >= (Number(store.settings.writeSumEvery) || 8)) summarize(role, p).catch(e => console.warn("共写总结失败", e));
  return { reply, notes };
}

// 请他看一张卡片：贴一张便利贴
export async function reviewCard(role, c) {
  const { oneShot, meName, visibleText } = await import("./chat.js");
  const p = projectById(c.projectId);
  const me = meName(role);
  const prompt = [
    role.style?.trim() ? `（这是你写给自己的：${role.style.trim()}）\n` : "",
    `你是${me}写《${p.title}》时的写作伙伴。这本书的其他卡片：\n${projectText(p, 5000)}`,
    `\n${me}想听你说说这一张【${CARD_TYPES[c.type]?.label}】「${c.title}」：\n${c.content}`,
    notesOfCard(c.id).length ? `\n上面已经贴着的便利贴：\n${notesOfCard(c.id).map(n => `- ${n.from === "me" ? me : "你"}：${n.text}`).join("\n")}` : "",
    `\n写一张便利贴贴在这张卡片上：具体的想法、建议或者疑问，用你自己的口吻，150 字以内。只写便利贴上的字。`,
  ].filter(Boolean).join("\n");
  const text = visibleText(await oneShot(role, prompt, { attachments: c.atts || [] })).trim();
  if (!text) throw new Error("他没有写什么");
  const n = addNote(c, text, "ai");
  n.seen = true;
  return n;
}

// 把这本书最近的讨论总结一小段，放进他的记忆库（每本书一张，后来的覆盖前面的）
export async function summarize(role, p) {
  const { oneShot, meName } = await import("./chat.js");
  const list = await loadTalk(p.id);
  const me = meName(role);
  const prev = store.memories.find(m => m.id === p.memId);
  const prompt = [
    `你和${me}一起在琢磨${me}写的小说《${p.title}》。`,
    prev ? `你之前记下的：${prev.content}` : "",
    `最近的讨论：\n${list.slice(-24).map(m => `${m.from === "me" ? me : "你"}：${m.text.slice(0, 300)}`).join("\n")}`,
    `用两三句话写一张给自己的记忆卡：这本书现在写到哪、${me}最近在琢磨什么、卡在哪、你们定下了什么。不要细节，120 字以内。只写内容。`,
  ].filter(Boolean).join("\n");
  const text = (await oneShot(role, prompt, { helper: true })).trim();
  if (!text) return;
  if (prev) Object.assign(prev, { content: text, date: todayYmd(), ts: Date.now() });
  else {
    const m = { id: uid(), roleId: role.id, writingId: p.id, title: `在写《${p.title}》`, content: text, img: null, date: todayYmd(), author: role.id, ts: Date.now() };
    store.memories.push(m);
    p.memId = m.id;
  }
  p.sinceSum = 0;
}

// 聊天时他知道你们在写什么（系统提示里一行）
export function writingForAI(who) {
  const list = projects();
  if (!list.length) return "";
  return `\n# 共写\n你和${who}有一张书桌，一起琢磨${who}写的小说：${list.map(p => `《${p.title}》`).join("、")}。具体的讨论在书桌那边，平时聊天想起来可以问问进展。`;
}
