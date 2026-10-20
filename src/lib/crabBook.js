// 小螃蟹的对话本：栖所里和它的那一条聊天 ↔ 私人仓库 qisuo-memory（经过她的服务器，钥匙只在服务器上）
// 栖所这边新说的写进去；Claude Code、云端、醒来时写进去的，拿回来按时间接在这条聊天后面。
// 这条聊天就是对话本：太长了照栖所平时那样整理成摘要，两边读的都是「摘要 + 最近原话」。
import { store, roleById, apiById, threadsOf, createThread, loadMessages, saveMessages, uid, CRAB } from "../store/index.js";
import { activePath, ROOT } from "./tree.js";
import { get, set } from "./kv.js";
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
  for (const a of (m.attachments || []).filter(a => a.kind === "image")) {
    try { const b = await get("img:" + a.img); if (!b) throw 0; media.push({ data: await toBase64(await shrink(b)) }); }
    catch { lost++; }
  }
  return { media, lost };
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

let busy = false;
export async function syncBook() {
  const role = roleById(CRAB);
  const base = bookBase(role);
  if (!role || !base || busy) return;
  busy = true;
  try {
    const st = (role.book ??= { pushedTs: 0, pulledTs: 0, sig: "" });
    const t = bookThread(role);
    if (st.thread !== t.id) { // 换了一条：这条的话从头写进去（按 id 去重，不会重复）；开这条前半小时以来别处写的也拿过来
      if (st.thread) st.pulledTs = Math.min(st.pulledTs, (t.createdAt || Date.now()) - 30 * 60_000);
      st.thread = t.id; st.pushedTs = 0; st.sig = "";
    }
    const all = await loadMessages(t.id);
    // 写进去：栖所这边新说的（别处拿回来的不再写回去）、摘要、记忆卡片
    const fresh = activePath(all, t.sel || {}).filter(m => !m.pending && !m.error && !m.where && m.ts > st.pushedTs && ((m.text || "").trim() || m.attachments?.some(a => a.kind === "image")));
    const packs = await Promise.all(fresh.map(packImages));
    const summary = t.summary?.text || "";
    const memories = memoriesOf(CRAB).filter(isLive).map(m => `- [${m.date}] ${m.cat ? `（${m.cat}）` : ""}${m.title}：${m.content.replace(/\n+/g, " ")}`).join("\n");
    const sig = `${summary.length}:${memories.length}:${summary.slice(-40)}:${memories.slice(0, 40)}`;
    if (fresh.length || sig !== st.sig) {
      const r = await fetch(base + "/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: fresh.map((m, i) => ({ id: m.id, ts: m.ts, where: "qisuo", from: m.from === "ai" ? "crab" : "me", text: m.text || "", ...(packs[i].media.length ? { media: packs[i].media } : {}), ...(packs[i].lost ? { lost: packs[i].lost } : {}) })), summary, memories }),
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
      if (all.some(m => m.id === e.id)) { st.pulledTs = Math.max(st.pulledTs, Number(e.ts) || 0); continue; }
      const atts = e.media?.length ? await fetchImages(base, e.media) : [];
      if (!atts) break; // 图还没拿到：这句和后面的下次再拿，别悄悄丢了
      st.pulledTs = Math.max(st.pulledTs, Number(e.ts) || 0);
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
