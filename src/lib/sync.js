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
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys, update as idbUpdate } from "idb-keyval";
import { onLocalChange, isLocalKey } from "./kv.js";
import { store, applyRemoteMeta, messageCache, flushStore, hasPendingMeta, flushMessages, hasPendingMessages } from "../store/index.js";
import { generating } from "./chat.js";
import { serverBase } from "./server.js";
import { migrateLegacy, redeemCode, showBinding } from "./deviceSync.js";

export const syncState = reactive({ on: false, url: "", busy: false, lastAt: 0, error: "", pending: 0, revoked: false });

let credential = "";
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
const fingerprint = async v => {
  if (!(v instanceof Blob)) return hashStr(JSON.stringify(v ?? null));
  const digest = await crypto.subtle.digest("SHA-256", await v.arrayBuffer());
  return `blob:${v.type}:${Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("")}`;
};

async function call(path, init = {}) {
  const r = await fetch(syncState.url + path, { cache: "no-store", signal: AbortSignal.timeout(30_000), ...init,
    headers: { ...init.headers, ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
  });
  if (r.status === 401) {
    if (credential) { syncState.revoked = true; syncState.on = false; clearInterval(pollTimer); }
    throw new Error(credential ? "这台设备凭证已失效或被撤销，请重新绑定；本地数据保留" : "旧同步已升级或口令不对，请到同步页面绑定；本地数据保留");
  }
  return r;
}
const q = k => `k=${encodeURIComponent(k)}`;

// ---------- 合并（两边都改了同一样）----------
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
const byId = a => Array.isArray(a) && a.length > 0 && a.every(x => isObj(x) && x.id != null);
const blank = v => v == null || v === "" || (Array.isArray(v) && !v.length);
// 三方合并：只有一边改了用改了的；两边都改了往里分；分不开用云端，本地另存冲突副本
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
  if (Array.isArray(mine) && Array.isArray(theirs) && (byId(mine) || !mine?.length) && (byId(theirs) || !theirs?.length) && (mine?.length || theirs?.length)) {
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
  return theirs;
}
// 没有消息基线时按 id 合在一起，调用时云端排前，同 id 用云端正文，按时间排
function mergeMsgs(mine, theirs) {
  const ids = new Set(mine.map(m => m.id));
  return [...mine, ...theirs.filter(m => !ids.has(m.id))].map((m, i) => [m, i]).sort((a, b) => (a[0].ts || 0) - (b[0].ts || 0) || a[1] - b[1]).map(x => x[0]);
}

// ---------- 把取回来的东西换上 ----------
const threadOf = k => (k.startsWith("msgs:") ? k.slice(5) : null);
const busyKey = k => { const t = threadOf(k); return (k === "meta" && hasPendingMeta()) || !!(t && (generating[t] || hasPendingMessages(t))); }; // 正在回的对话先不动

async function applyLocal(k, val, generation = edits.get(k) || 0) {
  let applied = false;
  // 同一读写事务内确认：本地刚写入的新内容不能被稍后完成的下载抹掉。
  await idbUpdate(k, current => {
    if ((edits.get(k) || 0) !== generation || busyKey(k)) return current;
    applied = true;
    return val;
  });
  if (!applied || (edits.get(k) || 0) !== generation || busyKey(k)) return false;
  if (val === undefined) {
    const t = threadOf(k);
    if (t) delete messageCache[t];
    return true;
  }
  // 给页面的是一份拷贝：别让页面上的数据和这里存着的共用同一份
  const copy = () => JSON.parse(JSON.stringify(val));
  if (k === "meta") applyRemoteMeta(copy());
  const t = threadOf(k);
  if (t && messageCache[t]) messageCache[t].splice(0, messageCache[t].length, ...copy());
  return true;
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
async function pushOne(k) {
  const generation = edits.get(k) || 0;
  const val = await idbGet(k);
  const h = val === undefined ? "del" : await fingerprint(val);
  const kn = known[k];
  if ((edits.get(k) || 0) !== generation) return;
  if (kn && kn.h === h) { dirty.delete(k); return; }
  if (!kn && val === undefined) { dirty.delete(k); return; }
  const base = kn?.rev || 0;
  const init = val === undefined ? { method: "DELETE" }
    : val instanceof Blob ? { method: "PUT", headers: { "Content-Type": val.type || "application/octet-stream" }, body: val }
    : { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(val) };
  const r = await call(`/item?${q(k)}&base=${base}`, init);
  if (r.ok) {
    const { rev } = await r.json();
    known[k] = { rev, h };
    if (threadOf(k)) await idbSet(`sync:base:${k}`, val);
    if (k === "meta") await idbSet("sync:base", val);
    // 请求发出后仍可编辑；只确认刚刚发出去的那一版。
    const current = await idbGet(k);
    const unchanged = (current === undefined ? "del" : await fingerprint(current)) === h;
    if (unchanged && (edits.get(k) || 0) === generation) dirty.delete(k);
    return;
  }
  if (r.status !== 409) throw new Error(`交「${k}」失败（${r.status}）`);
  // 别的设备先改了：取回来合并，下一轮再交
  const remote = await fetchItem(k);
  if ((edits.get(k) || 0) !== generation) return;
  // 冲突前保留完整本地副本，无法自动判断的同字段修改以云端为准。
  await idbSet(`sync:conflict:${Date.now()}:${k}`, { val, remote: remote.val, at: Date.now() });
  let merged;
  if (val === undefined || remote.val === undefined) merged = val ?? remote.val; // 一边删了一边改了：留着改了的
  else if (k === "meta") merged = merge3(await idbGet("sync:base"), val, remote.val);
  else if (threadOf(k) && Array.isArray(val) && Array.isArray(remote.val)) merged = (await idbGet(`sync:base:${k}`)) === undefined
    ? mergeMsgs(remote.val, val) : merge3(await idbGet(`sync:base:${k}`), val, remote.val);
  else merged = val; // 图片、文件：同一个 id 内容是一样的
  const remoteHash = remote.val === undefined ? "del" : await fingerprint(remote.val);
  if ((edits.get(k) || 0) !== generation) return;
  if (!same(merged, val) && !await applyLocal(k, merged, generation)) return;
  if (k === "meta" && remote.val !== undefined) await idbSet("sync:base", remote.val);
  if (threadOf(k)) await idbSet(`sync:base:${k}`, remote.val);
  known[k] = { rev: remote.rev, h: remoteHash };
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
    const generation = edits.get(it.k) || 0;
    if (it.del) {
      if (!await applyLocal(it.k, undefined, generation)) { stopped = true; break; }
      known[it.k] = { rev: it.rev, h: "del" };
    } else {
      const { rev, val } = await fetchItem(it.k);
      // 下载期间有本地编辑：交给带版本号的上传去合并，不能覆盖。
      if (dirty.has(it.k) || (edits.get(it.k) || 0) !== generation || busyKey(it.k)) { stopped = true; break; }
      if (val !== undefined) {
        if (!await applyLocal(it.k, val, generation)) { stopped = true; break; }
        known[it.k] = { rev, h: await fingerprint(val) };
        if (threadOf(it.k)) await idbSet(`sync:base:${it.k}`, val);
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
      await flushStore();
      await flushMessages();
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
      try { await saveKnown(); await saveDirty(); }
      catch (e) { syncState.error = e.message || String(e); }
      if (syncState.error || dirty.size) schedulePush(5000);
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
const edits = new Map();
// 在启动读盘前就监听，避免首次拉取期间漏掉本地保存。
onLocalChange(k => {
  edits.set(k, (edits.get(k) || 0) + 1);
  if (!syncState.on && started) return;
  dirty.add(k);
  if (syncState.on) {
    saveDirty().catch(() => {});
    schedulePush();
  }
});
let starting = null;
export function startSync() {
  if (starting) return starting;
  if (syncState.on) return syncNow();
  starting = beginSync().catch(e => { syncState.error = e.message || String(e); }).finally(() => { starting = null; });
  return starting;
}
async function beginSync() {
  let conf = await idbGet("sync:conf");
  let attemptedMigration = false;
  if (!conf?.url) {
    if (await idbGet("sync:disabled")) return;
    const base = await serverBase();
    if (!base) return;
    // 只使用已有的受口令保护的服务器地址，不猜账号、不扫描网络。
    conf = await migrateLegacy({ url: `${base}/sync` });
    attemptedMigration = true;
    if (!conf.device) await probe(conf.url);
    for (const k of await localData()) dirty.add(k);
    await saveDirty();
    await idbSet("sync:conf", conf);
  }
  // 改鉴权方式时保留 seq、known、base 和待同步项，仍是原来那份云端数据。
  if (!conf.device && !attemptedMigration) conf = await migrateLegacy(conf);
  credential = conf.device?.token || "";
  showBinding(conf);
  syncState.revoked = false;
  syncState.url = conf.url;
  syncState.on = true;
  seq = (await idbGet("sync:seq")) || 0;
  known = (await idbGet("sync:known")) || {};
  for (const k of (await idbGet("sync:dirty")) || []) dirty.add(k);
  // 浏览器可能在内容落盘后、待同步记账落盘前退出，启动时重新核对指纹。
  for (const k of await localData()) {
    const val = await idbGet(k);
    const h = val === undefined ? "del" : await fingerprint(val);
    if (known[k]?.h !== h && (val !== undefined || known[k])) dirty.add(k);
  }
  await saveDirty();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 20_000);
  if (started) return syncNow();
  started = true;
  // 回完一条就交
  watch(() => Object.keys(generating).length, n => { if (!n) schedulePush(800); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncNow();
    else if (dirty.size) syncNow(); // 切到后台前赶紧交
  });
  addEventListener("online", () => syncNow());
  addEventListener("pageshow", () => syncNow());
  addEventListener("focus", () => syncNow());
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
  const r = await fetch(url + "/changes?since=0", { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (r.status === 401) throw new Error("口令不对");
  if (!r.ok) throw new Error(`连不上（${r.status}）：服务器可能还没更新`);
  const j = await r.json();
  return { url, count: j.items.filter(x => !x.del).length };
}

// 旧入口的 server/local 参数仍可传入，但连接一律无损合并，不再清库或强制覆盖云端。
export async function enableSync(url) {
  url = trim(url);
  if (!/^https?:\/\/[^/]+\/p\/[^/]+\/sync$/.test(url)) throw new Error("请填写原来的服务器同步地址");
  const previous = await idbGet("sync:conf");
  syncState.on = false;
  if (running) await running;
  await flushStore(); await flushMessages();
  // 升级后的服务器只在 Authorization 中接收旧口令，不再向旧含口令 URL 发请求。
  const conf = await migrateLegacy({ url });
  if (!conf.device) await probe(url); // 仅保留尚未升级服务器的旧行为
  await idbDel("sync:disabled");
  await idbSet("sync:conf", conf);
  if (!previous || new URL(previous.url).origin !== new URL(conf.url).origin) {
    await idbSet("sync:seq", 0); await idbSet("sync:known", {});
    await idbDel("sync:base");
    for (const k of await idbKeys()) if (String(k).startsWith("sync:base:")) await idbDel(k);
  }
  dirty.clear();
  for (const k of await localData()) dirty.add(k);
  await saveDirty();
  return startSync();
}

export async function disableSync() {
  syncState.on = false;
  if (running) await running;
  await idbSet("sync:disabled", true);
  clearInterval(pollTimer);
  clearTimeout(pushTimer);
  dirty.clear();
  known = {};
  seq = 0;
  for (const k of await idbKeys()) if (String(k).startsWith("sync:base:")) await idbDel(k);
  for (const k of ["sync:conf", "sync:seq", "sync:known", "sync:dirty", "sync:base"]) await idbDel(k);
  syncState.url = "";
  credential = "";
  showBinding(null);
  syncState.pending = 0;
}

// 填好服务器 API 地址后即尝试接通；项目没有独立的栖所账号登录事件。
watch(() => store.apis.map(a => a.baseUrl), () => { if (!syncState.on) startSync(); }, { deep: true });

// 自动发现遇到断网也要能在恢复网络、回到前台时重试。
for (const event of ["online", "pageshow", "focus"]) addEventListener(event, () => { if (!syncState.on) startSync(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !syncState.on) startSync(); });

// 新设备第一次连接保留所有本地内容，无基线地合并云端，绝不清库或强制覆盖。
export async function bindDevice(code, name, origin) {
  syncState.on = false;
  if (running) await running;
  await flushStore(); await flushMessages();
  const previous = await idbGet("sync:conf");
  const conf = await redeemCode(code, name, origin);
  // 同一服务器的凭证更换不重置合并基线。
  if (!previous || new URL(previous.url).origin !== new URL(conf.url).origin) {
    await idbSet("sync:seq", 0); await idbSet("sync:known", {});
    await idbDel("sync:base");
    for (const k of await idbKeys()) if (String(k).startsWith("sync:base:")) await idbDel(k);
  }
  dirty.clear();
  for (const k of await localData()) dirty.add(k);
  await saveDirty();
  return startSync();
}
