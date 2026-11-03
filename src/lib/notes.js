// 工作台：小续的个人笔记本（像 Obsidian），管生活和创作
//
// 存法：每一篇笔记、每一个文件夹、每一张小纸条都是 IndexedDB 里单独的一样，同步也一样一样交：
//   note:<id>  { id, title, body, folder, created, ts }     一篇笔记（folder 是文件夹 id，没有就是最外层）
//   fold:<id>  { id, name, parent, ts }                      一个文件夹（可以嵌套，parent 是上一层的 id）
//   benchcover { img, ts }                                   首页的首图（图本身是 img:<id>，和聊天发图一样压缩、单独同步）
//   benchtitle { name, ts }                                  首页标题的名字（没改过就是「工作台」）
//   tip:<id>   { id, note, by, kind, why, find, replace, folder, to, ts }   他们挂的建议小纸条
// 改哪一篇只交那一篇；两台设备同时改同一篇，见 mergeNote（不会谁冲掉谁）。
// 他们（小章鱼、小螃蟹）只能看和提议：列目录、读一篇、挂小纸条；改不改、挪不挪由她点头（applyTip）。
import { reactive } from "vue";
import { keys as idbKeys } from "idb-keyval";
import { get, set, del, onRemoteChange } from "./kv.js";
import { uid } from "../store/index.js";
import { pickFile, saveImage, deleteImage, CHAT_IMAGE } from "./images.js";

export const bench = reactive({ ready: false, notes: {}, folders: {}, tips: {}, cover: null, title: null });
const kindOf = k => (k.startsWith("note:") ? "notes" : k.startsWith("fold:") ? "folders" : k.startsWith("tip:") ? "tips" : null);
const idOfKey = k => k.slice(5);

// ---------- 取和存 ----------
let loading = null;
export function loadBench() {
  if (bench.ready) return Promise.resolve();
  return (loading ||= (async () => {
    bench.cover = (await get(COVER_KEY)) || null;
    bench.title = (await get(TITLE_KEY)) || null;
    for (const k of (await idbKeys()).map(String)) {
      const kind = kindOf(k);
      if (!kind) continue;
      const v = await get(k);
      if (v) bench[kind][idOfKey(k)] = v;
    }
    bench.ready = true;
  })());
}

// ---------- 首页标题（可以改名）----------
const TITLE_KEY = "benchtitle";
export const DEFAULT_TITLE = "工作台";
export const benchName = () => bench.title?.name || DEFAULT_TITLE;
export async function renameBench(name) {
  const t = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 16);
  if (!t || t === DEFAULT_TITLE) { bench.title = null; await del(TITLE_KEY); return; } // 改回默认就不留着了
  bench.title = { name: t, ts: Date.now() };
  await set(TITLE_KEY, plain(bench.title));
}

// ---------- 首页首图 ----------
const COVER_KEY = "benchcover";
// 从相册选一张（先压缩再存）；换图时旧的那张图删掉。取消了返回 false
export async function pickCover() {
  const [file] = await pickFile("image/*");
  if (!file) return false;
  const img = await saveImage(file, CHAT_IMAGE);
  const old = bench.cover?.img;
  bench.cover = { img, ts: Date.now() };
  await set(COVER_KEY, plain(bench.cover));
  if (old) deleteImage(old);
  return true;
}
export async function clearCover() {
  const old = bench.cover?.img;
  bench.cover = null;
  await del(COVER_KEY);
  if (old) deleteImage(old);
}

// 正在编辑、还没存盘的笔记：id → 开始改之前的样子（别的设备同时改了，用来三方合并）
const pending = new Map();
const timers = new Map();
// 别的设备同步来了新的：换进来；这一篇我这边正改着，就合在一起
onRemoteChange(async k => {
  if (k === COVER_KEY && bench.ready) { bench.cover = (await get(k)) || null; return; }
  if (k === TITLE_KEY && bench.ready) { bench.title = (await get(k)) || null; return; }
  const kind = kindOf(k);
  if (!kind || !bench.ready) return;
  const id = idOfKey(k), v = await get(k);
  if (v === undefined) { delete bench[kind][id]; pending.delete(id); return; }
  if (kind === "notes" && pending.has(id) && bench.notes[id]) {
    const merged = mergeNote(pending.get(id), bench.notes[id], v);
    pending.set(id, v);
    bench.notes[id] = merged;
    return;
  }
  bench[kind][id] = v;
});

const plain = o => JSON.parse(JSON.stringify(o));
const saveNow = n => set(`note:${n.id}`, plain(n));

// 正文改了：过一会儿自动存（打字时不用每个字都存）
export function editNote(n, patch) {
  if (!pending.has(n.id)) pending.set(n.id, plain(n));
  Object.assign(n, patch, { ts: Date.now() });
  clearTimeout(timers.get(n.id));
  timers.set(n.id, setTimeout(() => flushNote(n.id), 700));
}
export async function flushNote(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const n = bench.notes[id];
  if (!n || !pending.has(id)) return;
  pending.delete(id);
  await saveNow(n);
}
export const flushAllNotes = () => Promise.all([...pending.keys()].map(flushNote));
if (typeof addEventListener === "function") {
  addEventListener("pagehide", () => { flushAllNotes(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAllNotes(); });
}

// 同一篇两边都改了：标题、所在文件夹谁改了听谁的（都改了取新的）；正文只一边改了听那一边，
// 两边都改了就都留着：云端的在前，这边的接在后面，中间隔一行——宁可多一段，也不丢字
export function mergeNote(base, mine, theirs) {
  if (!theirs) return mine;
  if (!mine) return theirs;
  const same = (a, b) => a === b;
  const pick = f => base && same(mine[f], base[f]) ? theirs[f] : base && same(theirs[f], base[f]) ? mine[f] : (mine.ts || 0) >= (theirs.ts || 0) ? mine[f] : theirs[f];
  let body;
  if (same(mine.body, theirs.body)) body = mine.body;
  else if (base && same(mine.body, base.body)) body = theirs.body;
  else if (base && same(theirs.body, base.body)) body = mine.body;
  else body = `${theirs.body || ""}\n\n——（另一台设备同时改的版本）——\n${mine.body || ""}`;
  return { ...theirs, title: pick("title"), folder: pick("folder"), body, created: Math.min(...[mine.created, theirs.created].filter(Boolean)) || Date.now(), ts: Math.max(mine.ts || 0, theirs.ts || 0) };
}

// ---------- 标题、链接 ----------
const cleanName = s => String(s ?? "").replace(/[\[\]|#\n\r]/g, " ").replace(/\s+/g, " ").trim();
export const noteList = () => Object.values(bench.notes);
export const folderList = () => Object.values(bench.folders);
export const sortNotes = list => [...list].sort((a, b) => (b.ts || 0) - (a.ts || 0));
export const sortFolders = list => [...list].sort((a, b) => a.name.localeCompare(b.name, "zh"));


// 搜索：标题和正文都找，空格隔开表示都要有；标题命中的排前面，给一小段上下文
export function searchNotes(q) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const n of noteList()) {
    const title = n.title.toLowerCase(), body = String(n.body || "").toLowerCase();
    if (!words.every(w => title.includes(w) || body.includes(w))) continue;
    const inTitle = words.some(w => title.includes(w));
    const at = body.indexOf(words.find(w => body.includes(w)) || "");
    const snip = at < 0 ? "" : (at > 20 ? "…" : "") + n.body.slice(Math.max(0, at - 20), at + 60).replace(/\s+/g, " ");
    out.push({ note: n, snip, inTitle });
  }
  return out.sort((a, b) => (b.inTitle - a.inTitle) || (b.note.ts || 0) - (a.note.ts || 0));
}

// ---------- 文件夹 ----------
export const childFolders = parent => sortFolders(folderList().filter(f => (f.parent || null) === (parent || null)));
export const notesIn = folder => sortNotes(noteList().filter(n => (n.folder || null) === (folder || null)));
export function pathOf(folderId) {
  const names = [];
  for (let id = folderId, i = 0; id && bench.folders[id] && i < 30; id = bench.folders[id].parent, i++) names.unshift(bench.folders[id].name);
  return names;
}
const descendants = id => { // 这个文件夹下面所有的文件夹 id（含自己）
  const out = [id];
  for (const f of folderList()) if (f.parent === id && !out.includes(f.id)) out.push(...descendants(f.id));
  return out;
};
const uniqueTitle = (base, except) => {
  let t = cleanName(base) || "没起名字", i = 2;
  while (noteList().some(n => n.id !== except && n.title.toLowerCase() === t.toLowerCase())) t = `${cleanName(base) || "没起名字"} ${i++}`;
  return t;
};

export async function newFolder(name, parent = null) {
  const f = { id: uid(), name: cleanName(name) || "新文件夹", parent: parent || null, ts: Date.now() };
  bench.folders[f.id] = f;
  await set(`fold:${f.id}`, plain(f));
  return f;
}
export async function renameFolder(id, name) {
  const f = bench.folders[id];
  const t = cleanName(name);
  if (!f || !t) return;
  f.name = t; f.ts = Date.now();
  await set(`fold:${id}`, plain(f));
}
// 挪到别的文件夹下面（不能挪进自己里面）
export async function moveFolder(id, parent) {
  const f = bench.folders[id];
  if (!f || (parent && descendants(id).includes(parent))) return false;
  f.parent = parent || null; f.ts = Date.now();
  await set(`fold:${id}`, plain(f));
  return true;
}
// 删文件夹：里面的文件夹和笔记一起删（调用前要她点过确认）
export function folderStats(id) {
  const ids = descendants(id);
  return { folders: ids.length - 1, notes: noteList().filter(n => ids.includes(n.folder)).length };
}
export async function deleteFolder(id) {
  const ids = descendants(id);
  for (const n of noteList().filter(n => ids.includes(n.folder))) await deleteNote(n.id);
  for (const fid of ids) { delete bench.folders[fid]; await del(`fold:${fid}`); }
}

// ---------- 笔记 ----------
export async function newNote({ title = "", body = "", folder = null } = {}) {
  const now = Date.now();
  const n = { id: uid(), title: uniqueTitle(title || "没起名字"), body, folder: folder || null, created: now, ts: now };
  bench.notes[n.id] = n;
  await saveNow(n);
  return n;
}
// 改名：只改这一篇的标题，别的笔记正文不动
export async function renameNote(id, name) {
  const n = bench.notes[id];
  if (!n) return;
  const t = uniqueTitle(name, id);
  if (t === n.title) return n.title;
  await flushNote(id);
  n.title = t; n.ts = Date.now();
  await saveNow(n);
  return t;
}
export async function moveNote(id, folder) {
  const n = bench.notes[id];
  if (!n) return;
  await flushNote(id);
  n.folder = folder || null; n.ts = Date.now();
  await saveNow(n);
}
export async function deleteNote(id) {
  clearTimeout(timers.get(id)); timers.delete(id); pending.delete(id);
  delete bench.notes[id];
  await del(`note:${id}`);
  for (const t of Object.values(bench.tips)) if (t.note === id) await dropTip(t.id);
}

// ---------- 小纸条（他们的建议）----------
export const tipsOf = noteId => Object.values(bench.tips).filter(t => t.note === noteId).sort((a, b) => a.ts - b.ts);
export const tipCount = () => Object.keys(bench.tips).length;
async function dropTip(id) { delete bench.tips[id]; await del(`tip:${id}`); }
export const rejectTip = dropTip; // 点「不要」：收起来
const KINDS = { move: "挪进文件夹", edit: "改一段", note: "一句话建议" };
export const tipKindLabel = k => (k === "link" ? "建议" : KINDS[k] || "建议");
// 按名字找文件夹：「生活」或「创作/小说」这样的路径；「最外层」「根目录」是不放在任何文件夹里
export function findFolder(name) {
  const t = String(name || "").trim();
  if (!t || /^(最外层|根目录|外面|无)$/.test(t)) return { id: null };
  const parts = t.split(/[\/／>›]/).map(s => cleanName(s)).filter(Boolean);
  let cur = null;
  for (const p of parts) {
    const f = folderList().find(x => (x.parent || null) === cur && x.name.toLowerCase() === p.toLowerCase());
    if (!f) return null;
    cur = f.id;
  }
  return { id: cur };
}
// 点「好」：真的去改；改不了（原文已经变了、文件夹没了）就说为什么，纸条留着
export async function applyTip(id) {
  const t = bench.tips[id], n = t && bench.notes[t.note];
  if (!t) return { ok: false, msg: "这张小纸条已经不在了" };
  if (!n) { await dropTip(id); return { ok: false, msg: "那篇笔记已经不在了，小纸条收起了" }; }
  if (t.kind === "link") {
    // 双链已经去掉了：旧的「把两篇链起来」纸条不再执行，点好只是收起
    await dropTip(id);
    return { ok: true, msg: "这类建议已经不用了，收起了" };
  } else if (t.kind === "move") {
    const f = findFolder(t.folder);
    if (!f) return { ok: false, msg: `没找到「${t.folder}」这个文件夹，先建好再点好` };
    await moveNote(n.id, f.id);
  } else if (t.kind === "edit") {
    const at = t.find ? String(n.body || "").indexOf(t.find) : -1;
    if (at < 0) return { ok: false, msg: "原文这段已经变了，找不到要改的地方；点「不要」收起，让他们再看一遍" };
    editNote(n, { body: n.body.slice(0, at) + (t.replace ?? "") + n.body.slice(at + t.find.length) });
    await flushNote(n.id);
  }
  await dropTip(id);
  return { ok: true, msg: "改好了" };
}

// ---------- 给他们的三个工具（只能看和提议）----------
export const BUILTIN_BENCH = {
  id: "builtin-bench",
  name: "工作台",
  builtin: true,
  disabledTools: [],
  tools: [
    { name: "列目录", description: "看工作台（她的笔记本）里有哪些文件夹和笔记标题，不含正文。她提到笔记、或者聊到想翻翻笔记的时候先用这个；不要每次聊天都翻。", inputSchema: { type: "object", properties: { folder: { type: "string", description: "只看某个文件夹，写名字或「生活/日记」这样的路径；不写就看全部" } } } },
    { name: "读笔记", description: "读某一篇笔记的正文，附上它的文件夹。她提到某篇、或者聊到相关内容时才读，一次只读需要的那一篇。", inputSchema: { type: "object", properties: { title: { type: "string", description: "笔记的标题" } }, required: ["title"] } },
    { name: "挂建议", description: "在某篇笔记旁边挂一张建议小纸条，她点「好」才生效、点「不要」就收起。你们不能直接改正文、不能新建、删除或挪动。", inputSchema: { type: "object", properties: {
      title: { type: "string", description: "要挂在哪一篇笔记上（标题）" },
      kind: { type: "string", enum: ["move", "edit", "note"], description: "move 挪进某个文件夹（写 folder）；edit 改一段（写 find 和 replace）；note 只是一句话建议" },
      why: { type: "string", description: "写清楚建议什么、为什么，她看这句话来决定" },
      folder: { type: "string", description: "kind 是 move 时：目标文件夹的名字或路径，已经存在的" },
      find: { type: "string", description: "kind 是 edit 时：正文里要改的那一段原文，要和原文一字不差" },
      replace: { type: "string", description: "kind 是 edit 时：改成什么" },
    }, required: ["title", "kind", "why"] } },
  ],
};

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…（太长，后面 ${s.length - n} 字没读，要看哪一段可以让她指出来）` : s);
function lookup(title) {
  const exact = findNote(title);
  if (exact) return { n: exact };
  const t = cleanName(title).toLowerCase();
  const near = noteList().filter(n => t && (n.title.toLowerCase().includes(t) || t.includes(n.title.toLowerCase())));
  if (near.length === 1) return { n: near[0] };
  return { err: near.length ? `「${title}」有几篇差不多的：${near.slice(0, 8).map(n => `「${n.title}」`).join("、")}，请写完整标题。` : `没有叫「${title}」的笔记，可以先用列目录看看。` };
}
export async function benchTool(name, args = {}, by = "") {
  await loadBench();
  if (name === "列目录") {
    const root = args.folder ? findFolder(args.folder) : { id: null, all: true };
    if (!root) return { text: `没找到「${args.folder}」这个文件夹。`, isError: true };
    const lines = [];
    const walk = (fid, depth) => {
      for (const f of childFolders(fid)) { lines.push(`${"  ".repeat(depth)}📁 ${f.name}（${notesIn(f.id).length} 篇）`); walk(f.id, depth + 1); }
      for (const n of notesIn(fid)) lines.push(`${"  ".repeat(depth)}- ${n.title}`);
    };
    walk(root.id, 0);
    if (!lines.length) return { text: "（工作台里还没有笔记）", isError: false };
    const total = noteList().length;
    return { text: clip(`共 ${total} 篇笔记。\n${lines.join("\n")}`, 6000), isError: false };
  }
  if (name === "读笔记") {
    const r = lookup(args.title);
    if (r.err) return { text: r.err, isError: true };
    const n = r.n, fp = pathOf(n.folder);
    return { text: [
      `标题：${n.title}`, `所在：${fp.length ? fp.join(" / ") : "最外层"}`,
      `\n${clip(n.body || "（空的）", 8000)}`,
    ].filter(Boolean).join("\n"), isError: false };
  }
  if (name === "挂建议") {
    const r = lookup(args.title);
    if (r.err) return { text: r.err, isError: true };
    const n = r.n, kind = String(args.kind || "note"), why = String(args.why || "").trim().slice(0, 400);
    if (!KINDS[kind]) return { text: "kind 只能是 move / edit / note。", isError: true };
    if (!why) return { text: "why 要写清楚建议什么、为什么。", isError: true };
    const tip = { id: uid(), note: n.id, by: by || "ai", kind, why, ts: Date.now() };
    if (kind === "move") {
      const f = findFolder(args.folder);
      if (!f) return { text: `没有「${args.folder}」这个文件夹（你们不能新建）。可以改成 note 建议她新建一个。`, isError: true };
      if ((n.folder || null) === f.id) return { text: "它已经在那个文件夹里了。", isError: true };
      tip.folder = String(args.folder).trim();
    } else if (kind === "edit") {
      tip.find = String(args.find ?? ""); tip.replace = String(args.replace ?? "").slice(0, 4000);
      if (!tip.find || !String(n.body || "").includes(tip.find)) return { text: "find 在正文里没找到，要和原文一字不差；请先用读笔记再看一遍。", isError: true };
    }
    if (tipsOf(n.id).length >= 6) return { text: "这篇笔记旁边已经挂了不少没处理的小纸条，先等她看完。", isError: true };
    if (tipsOf(n.id).some(x => x.kind === kind && x.folder === tip.folder && x.find === tip.find && x.why === why)) return { text: "这张小纸条已经挂着了。", isError: false };
    bench.tips[tip.id] = tip;
    await set(`tip:${tip.id}`, plain(tip));
    return { text: `已经在「${n.title}」旁边挂了一张小纸条，等她点好或不要。`, isError: false };
  }
  return { text: `工作台没有叫「${name}」的工具。`, isError: true };
}
