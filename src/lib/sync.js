// 多设备同步：通过自己的服务器（deploy/qisuo-server/sync.mjs），手机、iPad、电脑看到的是同一份栖所
//
// 本地 IndexedDB 里的每一样（meta、msgs:<对话>、img:<id>、file:<id>）对应服务器上的一样，各有一个号（rev）。
//  - 这边改了：记成「待交」，过一会儿交上去（带上以为的号；别人先改了会被退回 409，取回来合并再交）
//  - 那边改了：定时问服务器「第 N 号之后有什么新的」，取回来换上
// 自己的记账放在 sync: 开头的键里，只在这台设备上：
//   sync:conf   { url }               同步地址 https://域名/p/口令/sync
//   sync:seq    看到第几号了
//   sync:known  { 键: { rev, h } }    每一样上次同步时的号和指纹（内容没变就不用交）
//   sync:dirty  [键…]                 改了还没交的
//   sync:base   上次同步时的 meta（两边都改了时，用来分清谁改了什么）
import { reactive, watch } from "vue";
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys, clear as idbClear } from "idb-keyval";
import { onLocalChange, isLocalKey } from "./kv.js";
import { store, applyRemoteMeta, messageCache } from "../store/index.js";
import { generating } from "./chat.js";

export const syncState = reactive({ on: false, url: "", busy: false, lastAt: 0, error: "", pending: 0 });

let known = {};
let seq = 0;
const dirty = new Set();
let pushTimer = null, pollTimer = null, running = null;

const trim = u => String(u || "").trim().replace(/\/+$/, "");
const saveKnown = () => idbSet("sync:known", known);
const saveDirty = () => { syncState.pending = dirty.size; return idbSet("sync:dirty", [...dirty]); };

// 内容指纹（够分辨「变没变」就行）
function hashStr(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return `${s.length}:${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}
const fingerprint = v => (v instanceof Blob ? `blob:${v.size}:${v.type}` : hashStr(JSON.stringify(v ?? null)));

async function call(path, init = {}) {
  const r = await fetch(syncState.url + path, { cache: "no-store", ...init });
  if (r.status === 401) throw new Error("同步地址里的口令不对");
  return r;
}
const q = k => `k=${encodeURIComponent(k)}`;

// ---------- 合并（两边都改了同一样）----------
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
const byId = a => Array.isArray(a) && a.length > 0 && a.every(x => isObj(x) && x.id != null);
const blank = v => v == null || v === "" || (Array.isArray(v) && !v.length);
// 三方合并：base 是上次同步时的样子。只有一边改了 → 用改了的；两边都改了 → 往里一层分；分不开就用这台的
// 第一次连上时没有 base：一边是空的就用另一边，都填了用服务器上的（新连上的设备多半是默认值）
function merge3(base, mine, theirs) {
  if (same(mine, theirs)) return mine;
  if (base !== undefined && same(mine, base)) return theirs;
  if (base !== undefined && same(theirs, base)) return mine;
  if (isObj(mine) && isObj(theirs)) {
    const out = {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const b = isObj(base) ? base[k] : undefined;
      if (!(k in mine) && b !== undefined && same(theirs[k], b)) continue; // 这边删了
      if (!(k in theirs) && b !== undefined && same(mine[k], b)) continue; // 那边删了
      const v = k in mine ? (k in theirs ? merge3(b, mine[k], theirs[k]) : mine[k]) : theirs[k];
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if ((byId(mine) || !mine?.length) && (byId(theirs) || !theirs?.length) && (mine?.length || theirs?.length)) {
    const b = new Map((Array.isArray(base) ? base : []).filter(isObj).map(x => [x.id, x]));
    const t = new Map(theirs.map(x => [x.id, x]));
    const m = new Map(mine.map(x => [x.id, x]));
    const out = [];
    for (const x of mine) {
      if (!t.has(x.id)) { if (b.has(x.id) && same(x, b.get(x.id))) continue; out.push(x); continue; } // 那边删了、这边没动 → 删
      out.push(merge3(b.get(x.id), x, t.get(x.id)));
    }
    for (const x of theirs) {
      if (m.has(x.id)) continue;
      if (b.has(x.id) && same(x, b.get(x.id))) continue; // 这边删了、那边没动 → 删
      out.push(x);
    }
    return out;
  }
  if (base === undefined) return blank(mine) ? theirs : blank(theirs) ? mine : theirs;
  return mine;
}
// 聊天记录：按 id 合在一起（同一条两边都有就用这台的），按时间排
function mergeMsgs(mine, theirs) {
  const ids = new Set(mine.map(m => m.id));
  return [...mine, ...theirs.filter(m => !ids.has(m.id))].map((m, i) => [m, i]).sort((a, b) => (a[0].ts || 0) - (b[0].ts || 0) || a[1] - b[1]).map(x => x[0]);
}

// ---------- 把取回来的东西换上 ----------
const threadOf = k => (k.startsWith("msgs:") ? k.slice(5) : null);
const busyKey = k => { const t = threadOf(k); return !!(t && generating[t]); }; // 正在回的对话先不动

async function applyLocal(k, val) {
  if (val === undefined) {
    await idbDel(k);
    const t = threadOf(k);
    if (t) delete messageCache[t];
    return;
  }
  await idbSet(k, val);
  // 给页面的是一份拷贝：别让页面上的数据和这里存着的共用同一份
  const copy = () => JSON.parse(JSON.stringify(val));
  if (k === "meta") applyRemoteMeta(copy());
  const t = threadOf(k);
  if (t && messageCache[t]) messageCache[t].splice(0, messageCache[t].length, ...copy());
}

async function fetchItem(k) {
  const r = await call(`/item?${q(k)}`);
  if (r.status === 404) return { rev: (await r.json().catch(() => ({}))).rev || 0, val: undefined };
  if (!r.ok) throw new Error(`取「${k}」失败（${r.status}）`);
  const rev = Number(r.headers.get("X-Rev")) || 0;
  const type = r.headers.get("Content-Type") || "";
  const val = /json/.test(type) ? await r.json() : await r.blob();
  return { rev, val };
}

// ---------- 交上去 ----------
async function pushOne(k, force = false) {
  const val = await idbGet(k);
  const h = val === undefined ? "del" : fingerprint(val);
  const kn = known[k];
  if (!force && kn && kn.h === h) { dirty.delete(k); return; }
  if (!force && !kn && val === undefined) { dirty.delete(k); return; }
  const base = force ? "*" : kn?.rev || 0;
  const init = val === undefined ? { method: "DELETE" }
    : val instanceof Blob ? { method: "PUT", headers: { "Content-Type": val.type || "application/octet-stream" }, body: val }
    : { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(val) };
  const r = await call(`/item?${q(k)}&base=${base}`, init);
  if (r.ok) {
    const { rev } = await r.json();
    known[k] = { rev, h };
    if (k === "meta") await idbSet("sync:base", val);
    dirty.delete(k);
    return;
  }
  if (r.status !== 409) throw new Error(`交「${k}」失败（${r.status}）`);
  // 别的设备先改了：取回来合并，下一轮再交
  const remote = await fetchItem(k);
  let merged;
  if (val === undefined || remote.val === undefined) merged = val ?? remote.val; // 一边删了一边改了：留着改了的
  else if (k === "meta") merged = merge3(await idbGet("sync:base"), val, remote.val);
  else if (threadOf(k) && Array.isArray(val) && Array.isArray(remote.val)) merged = mergeMsgs(val, remote.val);
  else merged = val; // 图片、文件：同一个 id 内容是一样的
  known[k] = { rev: remote.rev, h: remote.val === undefined ? "del" : fingerprint(remote.val) };
  if (k === "meta" && remote.val !== undefined) await idbSet("sync:base", remote.val);
  if (!same(merged, val)) await applyLocal(k, merged);
}

// ---------- 取回来 ----------
async function pull() {
  const r = await call(`/changes?since=${seq}`);
  if (!r.ok) throw new Error(`同步失败（${r.status}）`);
  const j = await r.json();
  let stopped = false;
  for (const it of j.items) {
    if (busyKey(it.k)) { stopped = true; break; } // 正在回的对话：等 TA 回完再取，号先不往前挪
    if (it.rev <= (known[it.k]?.rev || 0) || dirty.has(it.k)) { seq = it.rev; continue; } // 自己交的 / 这边也改了（交的时候会合并）
    if (it.del) {
      await applyLocal(it.k, undefined);
      known[it.k] = { rev: it.rev, h: "del" };
    } else {
      const { rev, val } = await fetchItem(it.k);
      if (val !== undefined) {
        await applyLocal(it.k, val);
        known[it.k] = { rev, h: fingerprint(val) };
        if (it.k === "meta") await idbSet("sync:base", val);
      }
    }
    seq = it.rev;
  }
  if (!stopped) seq = Math.max(seq, j.seq);
  await idbSet("sync:seq", seq);
  await saveKnown();
}

// 一轮：先取，再交
export function syncNow() {
  if (!syncState.on) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    syncState.busy = true;
    try {
      await pull();
      for (const k of [...dirty]) if (!busyKey(k)) await pushOne(k);
      if (dirty.size) for (const k of [...dirty]) if (!busyKey(k)) await pushOne(k); // 合并过的再交一次
      await saveKnown();
      await saveDirty();
      syncState.lastAt = Date.now();
      syncState.error = "";
    } catch (e) {
      syncState.error = e.message || String(e);
    } finally {
      syncState.busy = false;
      running = null;
    }
  })();
  return running;
}

function schedulePush(ms = 1500) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, ms);
}

// ---------- 开始 ----------
let started = false;
export async function startSync() {
  const conf = await idbGet("sync:conf");
  if (!conf?.url) return;
  syncState.url = conf.url;
  syncState.on = true;
  seq = (await idbGet("sync:seq")) || 0;
  known = (await idbGet("sync:known")) || {};
  for (const k of (await idbGet("sync:dirty")) || []) dirty.add(k);
  syncState.pending = dirty.size;
  if (started) return syncNow();
  started = true;
  onLocalChange(k => {
    if (!syncState.on) return;
    dirty.add(k);
    syncState.pending = dirty.size;
    idbSet("sync:dirty", [...dirty]).catch(() => {});
    schedulePush();
  });
  // 回完一条就交
  watch(() => Object.keys(generating).length, n => { if (!n) schedulePush(800); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncNow();
    else if (dirty.size) syncNow(); // 切到后台前赶紧交
  });
  addEventListener("online", () => syncNow());
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 20_000);
  return syncNow();
}

// ---------- 设置页 ----------
const localData = async () => (await idbKeys()).map(String).filter(k => !isLocalKey(k));
// 这台设备上有没有自己的东西（全新的设备只有一份默认的 meta）
export const hasOwnData = () => store.apis.length > 0 || store.threads.length > 0;

// 连上服务器看看：那边有没有东西
export async function probe(url) {
  url = trim(url);
  if (!/^https?:\/\/.+\/p\/[^/]+\/sync$/.test(url)) throw new Error("地址应该像 https://你的域名/p/口令/sync");
  const r = await fetch(url + "/changes?since=0", { cache: "no-store" });
  if (r.status === 401) throw new Error("口令不对");
  if (!r.ok) throw new Error(`连不上（${r.status}）：服务器可能还没更新`);
  const j = await r.json();
  return { url, count: j.items.filter(x => !x.del).length };
}

// how：server = 用服务器上的（这台的清掉），local = 用这台的（服务器上的换掉），merge = 两边合在一起
export async function enableSync(url, how) {
  url = trim(url);
  syncState.url = url;
  const r = await (await fetch(url + "/changes?since=0", { cache: "no-store" })).json();
  const remote = r.items.filter(x => !x.del).map(x => x.k);
  if (how === "server") {
    await idbClear();
    await idbSet("sync:conf", { url });
    location.reload(); // 重新打开时从 0 号开始全部取回来
    return;
  }
  await idbSet("sync:conf", { url });
  await idbSet("sync:seq", 0);
  await idbSet("sync:known", {});
  await idbDel("sync:base");
  const mine = await localData();
  if (how === "local") {
    // 这台的全部交上去；服务器上有、这台没有的删掉
    known = {};
    for (const k of remote.filter(k => !mine.includes(k))) await call(`/item?${q(k)}&base=*`, { method: "DELETE" });
    for (const k of mine) await pushOne(k, true);
    const after = await (await call(`/changes?since=0`)).json();
    await idbSet("sync:seq", after.seq);
    await idbSet("sync:known", known);
    await idbSet("sync:dirty", []);
    await idbSet("sync:base", await idbGet("meta"));
  } else {
    await idbSet("sync:dirty", mine); // merge：都当成改过的，交的时候和服务器上的合并
  }
  await startSync();
}

export async function disableSync() {
  syncState.on = false;
  clearInterval(pollTimer);
  clearTimeout(pushTimer);
  dirty.clear();
  known = {};
  seq = 0;
  for (const k of ["sync:conf", "sync:seq", "sync:known", "sync:dirty", "sync:base"]) await idbDel(k);
  syncState.url = "";
  syncState.pending = 0;
}
