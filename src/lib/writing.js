// 共写：书桌上的书。一本书一个项目，里面是一张张卡片（人物、设定、大纲、灵感、片段……），不一定按章节。
//   store.writings   [{ id, title, color, pitch, synopsis, cover, banner, bg, bubbleMe, bubbleAi, createdAt, updatedAt, memId, talkSum, folders }]
//                    pitch：一句话的定位；synopsis：简介；cover / banner / bg：封面、页头图、讨论页背景（图片 id）；bubbleMe / bubbleAi：气泡颜色
//                    color：书脊颜色的编号；memId：这本书在他记忆库里那张总结卡（手动记的）；talkSum：讨论摘要（只在这本书里）；folders：资料夹的顺序
//   store.writeCards [{ id, projectId, type, title, content, atts, from, ts }]   from："me" 或 "ai"（他提的新卡片）
//                    atts：卡片上的图片、文件 [{ kind: "image", img } | { kind: "pdf" | "text", name, … }]（和聊天里的附件一样）
//   store.writeNotes [{ id, projectId, cardId, from, text, ts, seen }]     便利贴：贴在卡片上
//   wtalk:<项目 id>  和他讨论的记录 [{ id, from, text, atts, ts }]（单独存，会同步）
import { tail, keepCount, sumTokens, writeTokens, AUTO, snapshotSum } from "./budget.js";
import { applyBoardTags, PROGRESS_MAX } from "./board.js";
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
// 深色时浅色卡片只留一点颜色（--pastel），白卡片就是卡片色
export const cardBg = c => { const h = TINTS[c.tint] || (c.from === "ai" ? TINTS.blue : TINTS.white); return h === TINTS.white ? "var(--card)" : `color-mix(in srgb, ${h} var(--pastel), var(--card))`; };
export const SPINES = ["#ffadc6", "#ffcb85", "#ffe17d", "#a6e3a1", "#8fd3f4", "#bfa8f6", "#ffa494", "#7fdcd0"];

// 书桌上在写的书（灵感抽屉不算）
export const projects = () => (store.writings || []).filter(p => p.kind !== "ideas");
export const projectById = id => (store.writings || []).find(p => p.id === id);

// ---------- 灵感抽屉 ----------
// 书桌外面一个单独的地方（p.kind = "ideas"，只有一个），不属于哪本在写的书：
//   杂乱的灵感卡片（c.groupId 为空），和以前的书的复盘——一本一个小集子（p.groups [{ id, title, tags, ts }]），里面只有卡片，没有资料夹。
//   卡片和集子都能加标签（c.tags / g.tags，只有这里有）。打开也是和他聊，东西都在右边半开的抽屉里。
//   大概的样子（几张灵感、常用的标签、有哪些以前的书）放进全局记忆的板块里
export const ideaBox = () => (store.writings || []).find(p => p.kind === "ideas") || null;
export function openIdeaBox() {
  let p = ideaBox();
  if (!p) {
    p = newProject("灵感抽屉");
    Object.assign(p, { kind: "ideas", groups: [] });
  }
  return p;
}
export const tagsOf = s => [...new Set(String(s || "").split(/[\s,，、#]+/).map(t => t.trim()).filter(Boolean))].slice(0, 12);
export function addGroup(p, title) {
  p.groups ??= [];
  const g = { id: uid(), title: title.trim().slice(0, 60), tags: [], ts: Date.now() };
  p.groups.push(g);
  return g;
}
export function removeGroup(p, g) {
  for (const c of cardsOf(p.id).filter(c => c.groupId === g.id)) delete c.groupId; // 卡片留着，变回杂乱的灵感
  p.groups.splice(p.groups.indexOf(g), 1);
}
export function allTags(p) {
  const n = {};
  for (const c of cardsOf(p.id)) for (const t of c.tags || []) n[t] = (n[t] || 0) + 1;
  for (const g of p.groups || []) for (const t of g.tags || []) n[t] = (n[t] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1]).map(([t, k]) => ({ t, k }));
}
const tagLine = tags => (tags?.length ? `〔${tags.join("、")}〕` : "");
function ideaText(p, limit = 12000) {
  const out = [];
  let n = 0;
  const push = line => { if (n + line.length > limit) return false; out.push(line); n += line.length; return true; };
  const card = c => `- ${c.title || "（无题）"}${tagLine(c.tags)}：${c.content.replace(/\n{2,}/g, "\n").slice(0, 500)}${(c.atts || []).length ? `（附了 ${c.atts.length} 个图片、文件）` : ""}`;
  const loose = cardsOf(p.id).filter(c => !c.groupId);
  if (loose.length) push(`【杂乱的灵感】`);
  for (const c of [...loose].reverse()) if (!push(card(c))) { out.push("……（还有一些，太长没放进来）"); break; }
  for (const g of p.groups || []) {
    if (!push(`【以前的书《${g.title}》${tagLine(g.tags)}】`)) break;
    for (const c of cardsOf(p.id).filter(c => c.groupId === g.id)) if (!push(card(c))) break;
  }
  return out.join("\n") || "（抽屉还是空的）";
}
// 全局记忆里放的大概样子
export function ideaBoard() {
  const p = ideaBox();
  if (!p) return "";
  const cards = cardsOf(p.id);
  const loose = cards.filter(c => !c.groupId);
  if (!cards.length && !(p.groups || []).length) return "";
  const tags = allTags(p).slice(0, 8).map(x => `${x.t}（${x.k}）`).join("、");
  return [
    `- 杂乱的灵感 ${loose.length} 张${loose.length ? `，最近的：${loose.slice(-3).reverse().map(c => c.title || c.content.slice(0, 12)).join("、")}` : ""}`,
    (p.groups || []).length ? `- 以前的书：${p.groups.map(g => `《${g.title}》${tagLine(g.tags)}`).join("、")}` : "",
    tags ? `- 常用的标签：${tags}` : "",
  ].filter(Boolean).join("\n");
}
// 卡片按自己排的顺序（c.order）；没排过的按放上来的先后
const ordOf = c => (c.order ?? c.ts);
export const cardsOf = pid => (store.writeCards || []).filter(c => c.projectId === pid).sort((a, b) => ordOf(a) - ordOf(b));
// 资料夹的顺序（p.folders）：自己排过就按排的，新加的类型接在后面
export const folderOrder = p => [...new Set([...(p?.folders || []).filter(k => CARD_TYPES[k]), ...Object.keys(CARD_TYPES)])];
// 长按拖着排顺序：把它挪到第 to 个
export function placeFolder(p, key, to) {
  const list = folderOrder(p).filter(k => k !== key);
  list.splice(Math.max(0, Math.min(to, list.length)), 0, key);
  p.folders = list;
}
export function placeCard(c, to) {
  const list = cardsOf(c.projectId).filter(x => x.type === c.type && x !== c);
  list.splice(Math.max(0, Math.min(to, list.length)), 0, c);
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
export async function importFiles(pid, files, type = "ref", extra = {}) {
  const out = [];
  for (const f of files) {
    const a = await toAtt(f);
    const title = f.name.replace(/\.[^.]+$/, "").slice(0, 60);
    const c = a.kind === "text" ? addCard(pid, { type, title, content: a.text }) : addCard(pid, { type, title, atts: [a] });
    Object.assign(c, extra);
    out.push(c);
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
    if (p.kind === "ideas") { // 灵感抽屉：第一段是标签
      const content = rest.join("｜").trim();
      if (content) { const c = addCard(p.id, { type: "idea", title, content, from: "ai" }); c.tags = tagsOf(type); notes.push(`放了一张灵感卡片「${title || "无题"}」`); }
      return "";
    }
    const key = Object.keys(CARD_TYPES).find(k => CARD_TYPES[k].label === type) || "idea";
    const content = rest.join("｜").trim();
    if (content) { addCard(p.id, { type: key, title, content, from: "ai" }); notes.push(`放了一张新卡片「${title || "无题"}」`); }
    return "";
  });
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), notes };
}

function rulesFor(who) {
  return [
    `你可以在回复里顺手做这几件事（不是每次都要）：`,
    `- 给某张卡片贴便利贴（批注、建议、疑问）：另起一行写 [便签:卡片标题|想说的话]`,
    `- 提一张新卡片（${Object.values(CARD_TYPES).map(t => t.label).join("、")}）：另起一行写 [新卡片:类型|标题|内容]，${who}可以留下或者撕掉`,
    `- 这本书有了进展、定下了下一步：另起一行写 [写书进度:现在到哪了|下一步]，各 ${PROGRESS_MAX} 字以内（会记进你的全局记忆，平时聊天也记得）`,
  ].join("\n");
}

function ideaRules(who) {
  return [
    `你可以在回复里顺手做这几件事（不是每次都要）：`,
    `- 给某张卡片贴便利贴：另起一行写 [便签:卡片标题|想说的话]`,
    `- 放一张新的灵感卡片：另起一行写 [新卡片:标签（几个词，空格隔开，可以不写）|标题|内容]，${who}可以留下或者撕掉`,
  ].join("\n");
}

// 共写的场景记忆，一段一段分好：这本书（定位、简介、资料按顺序）→ 你记着的这本书的总结 → 刚才的讨论 → 其他在写的书（短短一句）
export function writingSceneParts(p, list, me) {
  if (p.kind === "ideas") return ideaSceneParts(p, list, me);
  const out = [{ key: "cards", label: "定位、简介和资料", text: `这本书的定位、简介和资料（按${me}排的顺序）：\n${projectText(p)}` }];
  const memo = store.memories.find(m => m.id === p.memId);
  if (memo) out.push({ key: "memo", label: "你记着的这本书", text: `你之前记下的这本书：${memo.content}` });
  if (p.board?.progress || p.board?.next) out.push({ key: "board", label: "进度和下一步", text: `这本书现在到哪了：${p.board.progress || "—"}；下一步：${p.board.next || "—"}` });
  if (p.talkSum?.text) out.push({ key: "talkSum", label: "讨论摘要（只在这本书里）", text: `你们之前讨论的摘要（你自己整理的）：\n${p.talkSum.text}` });
  const rest = tail(talkAfterSum(p, list), talkLimit());
  const recent = rest.map(m => `${m.from === "me" ? me : "你"}：${m.text}${m.atts?.length ? `（附了 ${m.atts.map(a => a.kind === "image" ? "一张图" : a.name).join("、")}）` : ""}`).join("\n");
  out.push({ key: "talk", label: `摘要之后的讨论（${rest.length} 句）`, text: `你们${p.talkSum?.text ? "接着" : "刚才"}在聊：\n${recent || "（刚坐下）"}` });
  const others = projects().filter(x => x.id !== p.id).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 3);
  if (others.length) out.push({ key: "others", label: "其他在写的书", text: `（别的书，别和这本弄混）${me}还在写：${others.map(x => `《${x.title}》${x.pitch ? `（${x.pitch}）` : ""}`).join("、")}` });
  return out;
}
function ideaSceneParts(p, list, me) {
  const out = [{ key: "cards", label: "抽屉里的灵感和以前的书", text: `灵感抽屉里有（新的灵感在前；以前的书一本一组）：\n${ideaText(p)}` }];
  if (p.talkSum?.text) out.push({ key: "talkSum", label: "讨论摘要（只在抽屉这里）", text: `你们之前在这里聊的摘要（你自己整理的）：\n${p.talkSum.text}` });
  const rest = tail(talkAfterSum(p, list), talkLimit());
  out.push({ key: "talk", label: `摘要之后的讨论（${rest.length} 句）`, text: `你们${p.talkSum?.text ? "接着" : "刚才"}在聊：\n${rest.map(m => `${m.from === "me" ? me : "你"}：${m.text}`).join("\n") || "（刚打开抽屉）"}` });
  const books = projects().filter(x => !x.archived);
  if (books.length) out.push({ key: "others", label: "书桌上在写的书", text: `（书桌上在写的，别弄混）${books.map(x => `《${x.title}》`).join("、")}` });
  return out;
}
// 讨论时给他看的全部：场景记忆在前，全局记忆在后（记忆库里「看看发给他的」也是这一份）
export async function writingPrompt(role, p, atts = [], alone = false) {
  const { meName } = await import("./chat.js");
  const { globalMemoryForScene } = await import("./memoryTags.js");
  const me = meName(role);
  const list = await loadTalk(p.id);
  return [
    role.style?.trim() ? `（这是你写给自己的：${role.style.trim()}）\n` : "",
    p.kind === "ideas"
      ? `${me}是写小说的人。你们在翻${me}的灵感抽屉：这里放着还没成书的灵感、以前写过的书的复盘，不属于书桌上哪一本。陪${me}聊聊：哪些灵感能连起来、能长成什么，以前的书有什么可以带走的。说真实的想法，别空泛。`
      : `${me}是写小说的人。你们坐在书桌前，一起琢磨${me}在写的《${p.title}》。你是${me}的写作伙伴：认真读设定，说真实的想法，可以提问、提建议、指出矛盾，也可以夸，但别空泛，也别替${me}把书写完。`,
    `\n# ${p.kind === "ideas" ? "灵感抽屉" : `共写《${p.title}》`}（这次的场景，最要紧）\n${writingSceneParts(p, list, me).map(x => x.text).join("\n\n")}`,
    await globalMemoryForScene(role, me, { skip: "write", query: [...list].reverse().find(m => m.from === "me")?.text || "" }),
    `\n${p.kind === "ideas" ? ideaRules(me) : rulesFor(me)}`,
    atts.length ? `\n${me}这次发来的图片、文件在最前面。` : "",
    alone ? `\n（这是你的自由时间，你自己走进了这里，${me}现在不在。写一段你想留在这里的话：想和${me}讨论的、读到想到的、想问${me}的，等${me}来了会看到。像平时说话那样，几段就好。不想写就只写 [不说话]。）` : `\n现在接着回${me}，像平时说话那样，几段就好。`,
  ].filter(Boolean).join("\n");
}

// ---------- 讨论摘要（只在这本书里，不进记忆库）----------
// 和聊天一样按 token 算：摘要后面的讨论原文每次最多带 talkLimit()（默认 3 万，书页「⋯」里调）；到八成就把前面这段新的整理成一小段，接在旧摘要后面（旧的不重写），最近一半留着。
// 旧的那份留一个版本（p.talkSumVers），能退回
export const talkLimit = writeTokens;
export const talkAutoAt = () => Math.round(writeTokens() * AUTO);
export function talkAfterSum(p, list) {
  const i = p.talkSum?.upTo ? list.findIndex(m => m.id === p.talkSum.upTo) : -1;
  return i >= 0 ? list.slice(i + 1) : list;
}
const talkSumming = {};
export async function compressTalk(role, p, { keep, why = "manual" } = {}) {
  if (talkSumming[p.id]) throw new Error("正在整理，等一下");
  const { oneShot, meName } = await import("./chat.js");
  const list = await loadTalk(p.id);
  const rest = talkAfterSum(p, list);
  keep ??= keepCount(rest, writeTokens());
  const old = rest.slice(0, Math.max(0, rest.length - keep));
  if (old.length < 2) return 0;
  talkSumming[p.id] = true;
  try {
    const me = meName(role);
    const prev = p.talkSum?.text;
    const { CAT_HINT } = await import("./memoryTags.js");
    let text = (await oneShot(role, [
      p.kind === "ideas" ? `你和${me}在翻${me}的灵感抽屉（还没成书的灵感、以前的书的复盘）。` : `你和${me}一起在琢磨${me}写的小说《${p.title}》。`,
      prev ? `（以前已经整理好的讨论摘要，最后一段是这样的，只是让你接得上，不要改写、不要重复：）\n${prev.length > 1500 ? "……" + prev.slice(-1500) : prev}\n` : "",
      `下面是你们${prev ? "接着" : ""}讨论的：\n${old.map(m => `${m.from === "me" ? me : "你"}：${(m.text || "").slice(0, 600)}`).join("\n")}\n`,
      `只把这一段新的讨论整理成一小段摘要，写给以后接着讨论的自己看：定下了什么、改了什么、还没想好什么、${me}在意什么、你提过的建议。书里的人物写名字，别用含糊的「他」「她」。按先后，简洁，不超过 800 字。只写这一段摘要本身。`,
      p.kind === "ideas" ? "" : `然后另起一行写这本书现在的进度：[写书进度:现在到哪了|下一步]，各 ${PROGRESS_MAX} 字以内。`,
      `另外：如果讨论里有关于${me}本人、值得长久记住的事（不是书里的设定），在最后另起一行写 [候选记忆:类别|标题|内容]，最多 2 条（类别从这几个里选：${CAT_HINT}）；没有就不写。`,
    ].filter(Boolean).join("\n"), { helper: true, raw: true })).trim();
    const { takeSuggestions } = await import("./memoryTags.js");
    text = takeSuggestions(role, text, `共写《${p.title}》`);
    if (p.kind !== "ideas") text = applyBoardTags(role, text, { project: p }).text;
    if (!text) return 0;
    const { helperApi } = await import("./chat.js");
    snapshotSum(p, "talkSum");
    const { sumSpanHead } = await import("./chat.js");
    text = [prev, `${sumSpanHead(old[0].ts, old[old.length - 1].ts)}\n${text.slice(0, 2400)}`].filter(Boolean).join("\n\n"); // 接在以前的后面，不重写以前的
    p.talkSum = { text, upTo: old[old.length - 1].id, count: (p.talkSum?.count || 0) + old.length, at: Date.now(), why, last: old.length,
      lastSpan: [old[0].ts, old[old.length - 1].ts], model: helperApi(role).model, tokens: sumTokens(old) };
    return old.length;
  } finally {
    delete talkSumming[p.id];
  }
}

// 在书桌前和他讨论：说一句，他回一句
export async function talk(role, p, text, atts = []) {
  const { oneShot, visibleText } = await import("./chat.js");
  const list = await loadTalk(p.id);
  if (text.trim() || atts.length) list.push({ id: uid(), from: "me", text: text.trim(), atts, ts: Date.now() });
  else if (list.at(-1)?.from === "me") atts = list.at(-1).atts || []; // 重新回答：带上那句里的图片、文件
  const prompt = await writingPrompt(role, p, atts);
  const raw = await oneShot(role, prompt, { raw: true, attachments: atts });
  const t0 = applyTags(p, raw);
  const t1 = applyBoardTags(role, t0.text, { project: p });
  const rest = t1.text, notes = [...t0.notes, ...t1.notes];
  const reply = visibleText(rest).trim();
  if (reply || notes.length) list.push({ id: uid(), from: "ai", text: reply, notes, ts: Date.now() });
  await saveTalk(p.id);
  touch(p.id);
  if (sumTokens(talkAfterSum(p, list)) >= talkAutoAt()) compressTalk(role, p, { why: "limit" }).catch(e => console.warn("讨论摘要没整理成", e));
  return { reply, notes };
}

// 请他看一张卡片：贴一张便利贴
export async function reviewCard(role, c) {
  const { oneShot, meName, visibleText } = await import("./chat.js");
  const p = projectById(c.projectId);
  const me = meName(role);
  const prompt = [
    role.style?.trim() ? `（这是你写给自己的：${role.style.trim()}）\n` : "",
    p.kind === "ideas" ? `你是${me}的写作伙伴，在翻${me}的灵感抽屉。抽屉里还有：\n${ideaText(p, 5000)}` : `你是${me}写《${p.title}》时的写作伙伴。这本书的其他卡片：\n${projectText(p, 5000)}`,
    `\n${me}想听你说说这一张${p.kind === "ideas" ? "" : `【${CARD_TYPES[c.type]?.label}】`}「${c.title}」${tagLine(c.tags)}：\n${c.content}`,
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
  if (prev) Object.assign(prev, { content: text, date: todayYmd(), ts: Date.now(), updatedAt: Date.now() });
  else {
    const { newMemory } = await import("./memoryTags.js");
    const m = newMemory(role, { writingId: p.id, title: `在写《${p.title}》`, content: text, source: { type: "write", by: "helper", id: p.id, label: `《${p.title}》` } });
    p.memId = m.id;
  }
  p.sinceSum = 0;
}

// 聊天时他知道你们在写什么（系统提示里一行）
export function writingForAI(who) {
  const list = projects().filter(p => !p.archived);
  if (!list.length) return "";
  return `\n# 共写\n你和${who}有一张书桌，一起琢磨${who}写的小说：${list.map(p => `《${p.title}》`).join("、")}。具体的讨论在书桌那边，平时聊天想起来可以问问进展。`;
}
