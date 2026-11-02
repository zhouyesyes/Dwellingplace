// 小螃蟹的对话本：栖所里和它的那一条聊天 ↔ 私人仓库 qisuo-memory（经过她的服务器，钥匙只在服务器上）
// 栖所这边新说的写进去；Claude Code、云端、醒来时写进去的，拿回来按时间接在这条聊天后面。
// 这条聊天就是对话本：太长了照栖所平时那样整理成摘要，两边读的都是「摘要 + 最近原话」。
import { store, roleById, apiById, threadsOf, createThread, loadMessages, saveMessages, uid, CRAB, oldHomeRoleIds, wipeOldHome } from "../store/index.js";
import { activePath, ROOT } from "./tree.js";
import { get, set } from "./kv.js";
import { videoNote } from "./video.js";
import { shareLines, shareImageIds } from "./share.js";
import { applyMemoryTags, memoriesOf, isLive } from "./memoryTags.js";

export const WHERE = { code: "在 Claude Code 里", cloud: "云端干活", wake: "自己醒来" };

// 对话本的接口：照着小螃蟹聊天的地址（…/claude/v1）→ …/claude/book
const bookBase = role => {
  const a = apiById(role?.apiId);
  return a && /\/claude\/v1\/?$/i.test(a.baseUrl || "") ? a.baseUrl.replace(/\/+$/, "").replace(/\/v1$/i, "") + "/book" : null;
};

// 哪一条聊天是对话本：她正开着的那条（新开的也算，别处写进来的才会出现在她眼前）；
// 没有的话用记住的那条（要是空的，就换成真有内容的那条）
export function bookThread(role) {
  const list = threadsOf(role.id);
  const used = t => !!(t && (t.preview || t.summary?.text));
  let t = list.find(x => x.id === role.lastThreadId) || list.find(x => x.id === role.bookThreadId);
  if (!used(t) && t?.id !== role.lastThreadId) t = list.find(used) || t || list[0];
  if (!t) t = createThread(role.id);
  role.bookThreadId = t.id;
  return t;
}


// ---------- 图片：压到几百 KB 以内再送去存（私人仓库别越变越胖） ----------
const MEDIA_KB = 400;
const toBase64 = async blob => {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
};
async function shrink(blob) {
  if (blob.size <= MEDIA_KB * 1024) return blob;
  const bmp = await createImageBitmap(blob);
  try {
    let out = blob;
    for (const [size, q] of [[1024, 0.7], [800, 0.6], [640, 0.5]]) {
      const k = Math.min(1, size / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      out = await new Promise(r => c.toBlob(r, "image/jpeg", q)) || out;
      if (out.size <= MEDIA_KB * 1024) break;
    }
    return out;
  } finally { bmp.close?.(); }
}
// 这句话带的图 → { media: [{data}], lost: 读不到的张数 }
async function packImages(m) {
  const media = []; let lost = 0;
  // 视频：截的几帧当图片送去，文字里写一行说明（TA 听不到声音）
  const imgs = (m.attachments || []).flatMap(a => a.kind === "image" ? [a.img] : a.kind === "video" ? (a.frames || [a.img]) : []);
  if (m.share) imgs.push(...shareImageIds(m.share).slice(0, 9)); // 转发的聊天记录里的图（最多 9 张）
  const vids = (m.attachments || []).filter(a => a.kind === "video");
  for (const id of imgs) {
    try { const b = await get("img:" + id); if (!b) throw 0; media.push({ data: await toBase64(await shrink(b)) }); }
    catch { lost++; }
  }
  return { media, lost, note: vids.map(a => `（${videoNote(a)}）`).join("\n") };
}
// 别处发来的图：从服务器拿回来存进本地，变成这句话的图片附件；拿不到就返回 null（下次再拿）
async function fetchImages(base, media) {
  const atts = [];
  for (const x of media) {
    const r = await fetch(`${base}/media?p=${encodeURIComponent(x.p)}`);
    if (!r.ok) return null;
    const id = uid();
    await set("img:" + id, await r.blob());
    atts.push({ kind: "image", img: id, name: x.k === "video" ? "视频第一帧" : "" });
  }
  return atts;
}
const stripMediaNotes = text => String(text).replace(/\n?（附图：book\/media\/[^）]*）/g, "").replace(/\n?（附了一段视频，第一帧缩略图：[^）]*）/g, "\n（附了一段视频，这里只有第一帧）").trim();

// 自己醒来写进对话本的那份（id 是 wake-<醒来的id>）；栖所聊天里同一次醒来是 w<醒来的id>、带 wakeId。
// 之前已经被当成新话搬进来的重复那条，在这里清掉（对话本里的记录不动）：它的后续消息接回它的上一条
const wakeIdOf = e => (/^wake-/.test(String(e.id)) || e.where === "wake") ? String(e.id).replace(/^wake-/, "") : "";
function dropWakeEchoes(all, t) {
  const real = new Set(all.filter(m => m.wakeId).map(m => m.wakeId));
  const echoes = all.filter(m => !m.wakeId && /^wake-/.test(String(m.id)) && real.has(m.id.slice(5)));
  if (!echoes.length) return false;
  for (const e of echoes) {
    for (const c of all) if (c.parentId === e.id) c.parentId = e.parentId;
    if (t.sel) {
      if (t.sel[e.parentId] === e.id) t.sel[e.parentId] = t.sel[e.id] || all.find(c => c.parentId === e.parentId && c !== e)?.id;
      delete t.sel[e.id];
    }
    all.splice(all.indexOf(e), 1);
  }
  return true;
}

// 共读笔记整个去掉（10/27）：旧的读书笔记（记忆库里带书的那几条，两个人的都算）先整份存进私人仓库 backup/ 里，服务器说存好了才删；
// 服务器还是旧的（不认 backup）或连不上，就什么都不删，下次再试。删掉靠记忆库平常的同步传给别的设备
async function purgeReadNotes(base) {
  if (store.fixes?.readNotesPurged) return;
  const list = (store.memories || []).filter(m => m.bookId && !m.insight);
  if (!list.length) { store.fixes = { ...(store.fixes || {}), readNotesPurged: { count: 0, at: Date.now() } }; return; }
  const name = `backup/read-notes-${new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)}-${list.length}.json`;
  const books = Object.fromEntries((store.books || []).map(b => [b.id, b.title]));
  const text = JSON.stringify({ note: "共读笔记（记忆库里带书的读书笔记）删除前的整份备份", at: new Date().toISOString(), count: list.length, memories: list.map(m => ({ ...m, bookTitle: books[m.bookId] || "" })) }, null, 1);
  const r = await fetch(base + "/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries: [], files: { [name]: text } }) });
  if (!r.ok || !(await r.json().catch(() => ({}))).saved?.includes(name)) return;
  const ids = new Set(list.map(m => m.id));
  store.memories = store.memories.filter(m => !ids.has(m.id));
  store.fixes = { ...(store.fixes || {}), readNotesPurged: { count: list.length, at: Date.now(), backup: name } };
}

// 旧居去掉了（11/2）：里面的 AI（设定）、他们的聊天消息、老群聊、记忆卡片，先整份存进私人仓库 backup/oldhome-日期*.json，
// 条数核对一致、服务器说每个文件都存好了才删；服务器还是旧的或连不上就什么都不删，下次再试。
// 太大（服务器一个文件最多 4MB）就按消息分成几个文件。删掉靠平常的同步传给别的设备；
// 之后 store.fixes.oldhomePurged 一直在，别的设备（含旧版又同步回来的）每次载入都会再清一遍
const CHUNK = 3_000_000;
async function purgeOldHome(base) {
  if (store.fixes?.oldhomePurged) return;
  const ids = oldHomeRoleIds();
  const a = store.archive || {};
  const mems = (store.memories || []).filter(m => ids.has(m.roleId));
  const threads = a.threads || [];
  const groups = [...(a.groups || []), ...(store.groups || [])];
  if (!ids.size && !threads.length && !groups.length && !mems.length && !(a.events || []).length) { store.fixes = { ...(store.fixes || {}), oldhomePurged: { count: 0, at: Date.now() } }; return; }
  const msgs = {};
  for (const t of threads) msgs[t.id] = await loadMessages(t.id).then(l => l.filter(m => !m.pending)).catch(() => []);
  const total = { roles: (a.roles || []).length, threads: threads.length, groups: groups.length, events: (a.events || []).length, memories: mems.length, messages: Object.values(msgs).reduce((n, l) => n + l.length, 0) };
  // 分件：第一件放设定、群聊、日历、记忆；消息按大小接着装，装满换下一件
  const parts = [{ archive: { ...a, threads }, groups: store.groups || [], memories: mems, messages: {} }];
  let size = JSON.stringify(parts[0]).length;
  for (const [tid, list] of Object.entries(msgs)) {
    for (const m of list) {
      const n = JSON.stringify(m).length + 2;
      if (size + n > CHUNK && (parts.length > 1 || Object.keys(parts[0].messages).length)) { parts.push({ messages: {} }); size = 2; }
      (parts[parts.length - 1].messages[tid] ??= []).push(m);
      size += n;
    }
  }
  const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const files = {};
  parts.forEach((p, i) => { files[`backup/oldhome-${day}${parts.length > 1 ? `-${i + 1}` : ""}.json`] = JSON.stringify({ note: "旧居（以前住在栖所里的 AI）删除前的整份备份", at: new Date().toISOString(), part: i + 1, of: parts.length, total, ...p }); });
  // 核对：把要送出去的文字读回来，数出来的条数要和手里的一样
  const back = Object.values(files).map(t => JSON.parse(t));
  const got = {
    roles: back[0].archive.roles.length, threads: back[0].archive.threads.length, groups: back[0].archive.groups.length + back[0].groups.length, events: back[0].archive.events.length, memories: back[0].memories.length,
    messages: back.reduce((n, p) => n + Object.values(p.messages).reduce((k, l) => k + l.length, 0), 0),
  };
  if (Object.keys(total).some(k => got[k] !== total[k])) return;
  const names = Object.keys(files);
  const r = await fetch(base + "/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries: [], files }) });
  const saved = r.ok ? (await r.json().catch(() => ({}))).saved || [] : [];
  if (!names.every(n => saved.includes(n))) return;
  store.fixes = { ...(store.fixes || {}), oldhomePurged: { ...total, at: Date.now(), backup: names } };
  wipeOldHome();
}

let busy = false;
export async function syncBook() {
  const role = roleById(CRAB);
  const base = bookBase(role);
  if (!role || !base || busy) return;
  busy = true;
  try {
    const st = (role.book ??= { pushedTs: 0, pulledTs: 0, sig: "" });
    await purgeReadNotes(base).catch(() => {});
    await purgeOldHome(base).catch(() => {});
    const t = bookThread(role);
    if (st.thread !== t.id) { // 换了一条：这条的话从头写进去（按 id 去重，不会重复）；开这条前半小时以来别处写的也拿过来
      if (st.thread) st.pulledTs = Math.min(st.pulledTs, (t.createdAt || Date.now()) - 30 * 60_000);
      st.thread = t.id; st.pushedTs = 0; st.sig = "";
    }
    const all = await loadMessages(t.id);
    if (dropWakeEchoes(all, t)) saveMessages(t.id);
    // 写进去：栖所这边新说的（别处拿回来的不再写回去）、摘要、记忆卡片
    const fresh = activePath(all, t.sel || {}).filter(m => !m.pending && !m.error && !m.where && m.ts > st.pushedTs && ((m.text || "").trim() || m.share || m.attachments?.some(a => a.kind === "image" || a.kind === "video")));
    const packs = await Promise.all(fresh.map(packImages));
    const summary = t.summary?.text || "";
    const memories = memoriesOf(CRAB).filter(isLive).map(m => `- [${m.date}] ${m.cat ? `（${m.cat}）` : ""}${m.title}：${m.content.replace(/\n+/g, " ")}`).join("\n");
    const sig = `${summary.length}:${memories.length}:${summary.slice(-40)}:${memories.slice(0, 40)}`;
    if (fresh.length || sig !== st.sig) {
      const r = await fetch(base + "/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: fresh.map((m, i) => ({ id: m.id, ts: m.ts, where: "qisuo", from: m.from === "ai" ? "crab" : "me", text: [m.text || (m.share ? shareLines(m.share, { me: "她", selfId: CRAB }) : ""), packs[i].note].filter(Boolean).join("\n"), ...(packs[i].media.length ? { media: packs[i].media } : {}), ...(packs[i].lost ? { lost: packs[i].lost } : {}) })), summary, memories }),
      });
      if (!r.ok) return; // 服务器还没放钥匙、或者没更新：安静地等下次
      if (fresh.length) st.pushedTs = Math.max(...fresh.map(m => m.ts));
      st.sig = sig;
    }
    // 拿回来：别处写进来的，按时间接在这条聊天后面
    const r = await fetch(`${base}/pull?since=${st.pulledTs}`, { cache: "no-store" });
    if (!r.ok) return;
    const { entries = [] } = await r.json();
    let added = 0;
    for (const e of entries.sort((a, b) => a.ts - b.ts)) {
      if (all.some(m => m.id === e.id || (wakeIdOf(e) && m.wakeId === wakeIdOf(e)))) { st.pulledTs = Math.max(st.pulledTs, Number(e.ts) || 0); continue; }
      const atts = e.media?.length ? await fetchImages(base, e.media) : [];
      if (!atts) break; // 图还没拿到：这句和后面的下次再拿，别悄悄丢了
      st.pulledTs = Math.max(st.pulledTs, Number(e.ts) || 0);
      if (wakeIdOf(e)) continue; // 自己醒来的：中转写进对话本的那份，栖所自己从信箱取回聊天（带 wakeId）；一律不再接一遍
      if (e.kind === "memory") { applyMemoryTags(role, e.text); continue; } // 别处记下的记忆卡片
      const path = activePath(all, t.sel || {});
      const parentId = path.length ? path[path.length - 1].id : ROOT;
      all.push({ id: e.id, parentId, from: e.from === "me" ? "user" : "ai", text: atts.length ? stripMediaNotes(e.text) : e.text, ...(atts.length ? { attachments: atts } : {}), ts: Number(e.ts) || Date.now(), where: e.where, notes: [] });
      (t.sel ??= {})[parentId] = e.id;
      added++;
    }
    if (added) {
      saveMessages(t.id);
      t.updatedAt = Date.now();
      t.preview = String(entries.at(-1)?.text || "").slice(0, 60);
    }
  } catch { /* 连不上：下次再说 */ }
  finally { busy = false; }
}

// 开着栖所的时候：一进来同步一次；正开着小螃蟹的聊天就每 15 秒一次，别的页面两分钟一次；切回来马上同步
let lastSync = 0;
const tick = () => {
  if (document.hidden) return;
  const inCrab = location.hash.startsWith(`#/chat/${CRAB}`);
  if (inCrab || Date.now() - lastSync > 120_000) { lastSync = Date.now(); syncBook(); }
};
export function startCrabBook() {
  setTimeout(syncBook, 3000);
  setInterval(tick, 15_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { lastSync = Date.now(); syncBook(); } });
  addEventListener("hashchange", () => { if (location.hash.startsWith(`#/chat/${CRAB}`)) { lastSync = Date.now(); syncBook(); } });
}
