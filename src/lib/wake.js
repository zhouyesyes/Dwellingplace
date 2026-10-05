// 唤醒：TA 们按设好的时间自己醒来（在你的 Cloudflare 中转上运行，见 relay/worker.js 和 docs/wake.md）
//
// 栖所这边做的事：
//   1. 把需要的东西（设定、记忆、最近的聊天、API、MCP）同步到中转
//   2. 打开栖所时，把 TA 醒来时发的消息取回来，放进聊天里
//   3. 订阅推送通知
//   4. 聊天时 TA 写的 [定闹钟:…] / [取消闹钟:…]
import { reactive, watch } from "vue";
import { store, uid, roleById, threadsOf, createThread, loadMessages, saveMessages, apiFor, modelFor, recordUsage } from "../store/index.js";
import { relayCall, searchEnabled } from "./search.js";
import { serversFor, enabledTools, headerObj } from "./mcp.js";
import { ROOT } from "./tree.js";
import { buildSystem, pathOf, touchThread, applyReplyTags, meName } from "./chat.js";
import { applyXinchaoMemoryTags, hasXinchao, xinchaoBase } from "./xinchao.js";

export const ALARM_RE = /\[(定闹钟|取消闹钟)[:：]([^\]\n]{1,200})\]/g;
export const MAX_ALARMS = 5;

// 同步、收件箱的状态（不存）
export const wakeStatus = reactive({ syncedAt: 0, syncing: false, error: "", latest: 0, checking: false });

const relayReady = () => !!(store.tools.relay?.url && store.tools.relay?.token);
export const wakeReady = () => !!store.wake?.enabled && relayReady();
export const wakeOn = role => wakeReady() && !!role?.wake?.enabled;

const pad = n => String(n).padStart(2, "0");
const dayStart = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

// 「今天 14:30」「明天 09:00」「10月8日 14:30」
export function whenLabel(at) {
  const d = new Date(at);
  const days = Math.round((dayStart(at) - dayStart(Date.now())) / 86400_000);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (days === 0) return `今天 ${hm}`;
  if (days === 1) return `明天 ${hm}`;
  if (days === 2) return `后天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

export function everyText(min) {
  min = Number(min) || 0;
  if (min % 60 === 0) return `${min / 60} 小时`;
  if (min > 60) return `${Math.floor(min / 60)} 小时 ${min % 60} 分钟`;
  return `${min} 分钟`;
}

// 一句话说清这个角色什么时候醒
export function scheduleText(role) {
  const w = role.wake || {};
  if (!w.enabled) return "没开";
  const parts = [];
  if (w.intervalOn) parts.push(`每 ${everyText(w.every)}`);
  if (w.times?.length) parts.push(w.times.join("、"));
  return parts.join(" · ") || "只在 TA 自己定的闹钟时醒";
}

const liveAlarms = role => (role.wakeAlarms || []).filter(a => a.at > Date.now());

// ---------- 给 AI 的说明 ----------
export function alarmForAI(role, who, wake) {
  if (!wakeOn(role)) return "";
  const w = role.wake;
  const list = wake
    ? "{{ALARMS}}"
    : liveAlarms(role).map(a => `#${a.id} ${whenLabel(a.at)}${a.note ? " · " + a.note : ""}`).join("；") || "（没有）";
  const sched = [w.intervalOn && `大约每 ${everyText(w.every)}一次`, w.times?.length && `每天 ${w.times.join("、")}`].filter(Boolean).join("，还有");
  return [
    `\n# 醒来和闹钟`,
    sched
      ? `就算${who}没有打开栖所，你也会自己醒来：${sched}。醒来的时候可以给${who}发消息，也可以做自己的事。`
      : `就算${who}没有打开栖所，到了闹钟的时间你也会醒来。`,
    `你可以给自己定闹钟：另起一行写 [定闹钟:时间|醒来要做什么]。时间可以写「40分钟后」「2小时后」「21:30」「明天 9:00」「10月5日 14:30」。到时间你会醒来，看到自己写的这句话。`,
    `取消闹钟写 [取消闹钟:#编号]。同时最多 ${MAX_ALARMS} 个闹钟，需要的时候再定，不用每次都定。`,
    w.quiet?.enabled ? `${w.quiet.from}–${w.quiet.to} 是${who}的免打扰时间，闹钟不能定在这段时间里。` : "",
    `现在定好的闹钟：${list}`,
  ].filter(Boolean).join("\n");
}

// 聊天时 TA 写的闹钟标记：交给中转去定 / 取消，返回去掉标记的文字和提示
export async function applyAlarmTags(role, text) {
  const ops = [...text.matchAll(ALARM_RE)];
  if (!ops.length) return { text, notes: [] };
  const clean = text.replace(ALARM_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  const notes = [];
  for (const [, op, body] of ops) {
    const add = op === "定闹钟";
    if (!wakeOn(role)) {
      notes.push(`${role.name} 想${add ? "定" : "取消"}闹钟，但 TA 的唤醒还没有打开`);
      continue;
    }
    try {
      let r;
      if (add) {
        const [when, ...rest] = body.split(/[|｜]/);
        r = await relayCall("/wake/alarm", { roleId: role.id, when: when.trim(), note: rest.join(" ").trim(), quiet: role.wake.quiet });
      } else {
        r = await relayCall("/wake/alarm", { roleId: role.id, op: "cancel", id: body.trim() });
      }
      role.wakeAlarms = r.alarms || [];
      const note = r.alarm.note ? " · " + r.alarm.note : "";
      notes.push(`${role.name} ${add ? "定了个闹钟" : "取消了闹钟"}：${r.alarm.label}${note}`);
    } catch (e) {
      notes.push(`${role.name} 想${add ? "定" : "取消"}闹钟，但没成功：${e.message}`);
    }
  }
  return { text: clean, notes };
}

// ---------- 同步到中转 ----------
const threadFor = role => threadsOf(role.id).find(t => t.id === role.lastThreadId) || threadsOf(role.id)[0] || null;

function textOf(m) {
  const att = (m.attachments || []).map(a => (a.kind === "image" ? "[图片]" : `[文件：${a.name}]`)).join(" ");
  return [att, m.text].filter(Boolean).join(" ");
}

async function snapshotRole(role) {
  const thread = threadFor(role);
  const path = thread ? pathOf(thread, await loadMessages(thread.id)) : [];
  const limit = Math.max(2, Number(store.settings.historyLimit) || 80);
  const history = path
    .filter(m => m.from !== "event" && !m.pending && !m.error)
    .slice(-limit)
    .map(m => ({ from: m.from === "user" ? "user" : "ai", text: textOf(m), ts: m.ts }));
  const api = apiFor(thread, role);
  return {
    id: role.id,
    name: role.name,
    meName: meName(role),
    wake: role.wake,
    bridge: role.wake?.bridgeOn && hasXinchao(role) && role.xinchao?.bridgeToken?.trim()
      ? { url: xinchaoBase(role), token: role.xinchao.bridgeToken.trim() } : null,
    threadId: thread?.id || null,
    system: buildSystem(role, path, { wake: true }),
    history,
    api: api && { id: api.id, type: api.type, baseUrl: api.baseUrl, key: api.key, model: modelFor(thread, role), maxTokens: api.maxTokens, effort: api.effort },
    servers: serversFor(role.id)
      .filter(s => s.tools?.length)
      .map(s => ({ name: s.name, url: s.builtin ? "" : s.url.trim(), builtin: !!s.builtin, headers: s.builtin ? {} : headerObj(s), tools: enabledTools(s).map(t => t.name) })),
  };
}

let lastSent = "";
let syncTimer = null;

export async function syncNow() {
  clearTimeout(syncTimer);
  if (!relayReady()) return;
  // 从来没开过唤醒，就不用同步；关掉以后同步一次空的，让中转不再叫醒
  if (!store.wake.enabled && !store.wake.synced) return;
  if (wakeStatus.syncing) { scheduleSync(2000); return; }
  wakeStatus.syncing = true;
  try {
    const roles = store.wake.enabled ? await Promise.all(store.roles.filter(r => r.wake?.enabled).map(snapshotRole)) : [];
    const snap = {
      v: 1,
      appUrl: location.href.split("#")[0],
      search: { enabled: searchEnabled(), provider: store.tools.search?.provider, key: store.tools.search?.key || "" },
      webSearch: !!store.tools.webSearch,
      roles,
    };
    const body = JSON.stringify(snap);
    if (body === lastSent) return;
    await relayCall("/wake/sync", snap);
    lastSent = body;
    store.wake.synced = store.wake.enabled;
    wakeStatus.syncedAt = Date.now();
    wakeStatus.error = "";
  } catch (e) {
    wakeStatus.error = e.message;
  } finally {
    wakeStatus.syncing = false;
  }
}

export function scheduleSync(ms = 30_000) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, ms);
}

// ---------- 取回 TA 醒来时发的消息 ----------
function logWake(role, item) {
  role.wakeLog = [
    { id: item.id, ts: item.ts, reasons: item.reasons, silent: item.silent, error: item.error || "", usage: item.usage, tools: item.notes.filter(n => n.detail || n.sources).map(n => n.text) },
    ...(role.wakeLog || []).filter(x => x.id !== item.id),
  ].slice(0, 30);
}

// 出错的原因写短一点（完整的放在点开的详情里）
function shortError(err) {
  const code = Number(String(err).match(/接口返回 (\d{3})/)?.[1]);
  const known = {
    401: "密钥不对（401）",
    403: "没有权限（403）",
    404: "找不到这个模型或接口（404）",
    429: "请求太频繁或额度用完了（429）",
    500: "模型那边出错了（500）",
    502: "模型那边暂时连不上（502）",
    503: "模型那边暂时太忙了（503），下次醒来会再试",
    504: "模型那边太久没回应（504）",
    529: "模型那边暂时太忙了（529），下次醒来会再试",
  };
  if (known[code]) return known[code];
  const s = String(err);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}

async function ingest(item) {
  const role = roleById(item.roleId);
  if (!role) return;
  if (item.alarms) role.wakeAlarms = item.alarms;
  const thread = store.threads.find(t => t.id === item.threadId && t.roleId === role.id) || threadFor(role) || createThread(role.id);
  const all = await loadMessages(thread.id);
  if (all.some(m => m.wakeId === item.id || m.notes?.some(n => n.wakeId === item.id))) return; // 已经取过了
  logWake(role, item);
  thread.sel ??= {};
  const path = pathOf(thread, all);
  const last = path[path.length - 1];
  // 用工具、搜索的提示放在消息前面；定闹钟之类的放在后面
  const before = item.notes.filter(n => n.detail || n.sources).map(n => ({ ...n, before: true }));
  const after = item.notes.filter(n => !(n.detail || n.sources));

  if (!item.silent && item.text) {
    const parent = last ? last.id : ROOT;
    const msg = {
      id: uid(), parentId: parent, from: "ai", text: item.text, ts: item.ts,
      notes: [{ text: `${role.name} 醒来了 · ${item.reasons.join("；")}`, before: true, wakeId: item.id }, ...before],
      apiId: item.apiId, model: item.model, usage: item.usage, wakeId: item.id,
    };
    const xm = await applyXinchaoMemoryTags(role, msg.text);
    msg.text = xm.text;
    const tagNotes = [...applyReplyTags(role, msg), ...xm.notes.map(text => ({ text }))];
    msg.notes.push(...after, ...tagNotes);
    all.push(msg);
    thread.sel[parent] = msg.id;
  } else if (last) {
    const tmp = { text: item.text || "" };
    const xm = await applyXinchaoMemoryTags(role, tmp.text);
    tmp.text = xm.text;
    const tagNotes = [...applyReplyTags(role, tmp), ...xm.notes.map(text => ({ text }))];
    const head = item.error
      ? `${role.name} 醒来时出错了：${shortError(item.error)}`
      : `${role.name} 醒来过（${item.reasons.join("；")}），没有打扰你`;
    last.notes = [...(last.notes || []), { text: head, wakeId: item.id, ...(item.error ? { detail: item.error } : {}) }, ...before.map(n => ({ ...n, before: false })), ...after, ...tagNotes];
  }
  if (item.apiId && (item.usage?.input || item.usage?.output)) recordUsage(item.apiId, item.model, item.usage.input, item.usage.output);
  if (!item.silent) touchThread(thread, all);
  saveMessages(thread.id);
}

// force：不管有没有新东西都去看一眼（打开栖所时）；否则只在中转说有新东西时才去取
export async function checkInbox(force = false) {
  if (!wakeReady() || wakeStatus.checking) return 0;
  wakeStatus.checking = true;
  try {
    const r = await relayCall(`/wake/inbox?since=${force ? 0 : wakeStatus.latest}`);
    for (const item of r.items) await ingest(item);
    if (r.items.length) {
      await syncNow(); // 先让中转知道这些消息已经在聊天里了，再把收件箱清掉
      await relayCall("/wake/ack", { ids: r.items.map(x => x.id) });
    }
    wakeStatus.latest = r.latest;
    return r.items.length;
  } catch (e) {
    wakeStatus.error = e.message;
    return 0;
  } finally {
    wakeStatus.checking = false;
  }
}

// 中转上的闹钟、下次醒来的时间、最近一次醒来
export async function fetchState() {
  const r = await relayCall("/wake/state");
  for (const [id, st] of Object.entries(r.roles || {})) {
    const role = roleById(id);
    if (role) role.wakeAlarms = st.alarms || [];
  }
  return r;
}

export async function cancelAlarm(role, id) {
  const r = await relayCall("/wake/alarm", { roleId: role.id, op: "cancel", id });
  role.wakeAlarms = r.alarms || [];
}

// 现在叫醒 TA（测试用）
export async function wakeNow(role) {
  lastSent = "";
  await syncNow();
  if (wakeStatus.error) throw new Error(wakeStatus.error);
  const r = await relayCall("/wake/now", { roleId: role.id }, 180_000);
  await checkInbox(true);
  return r.item;
}

// ---------- 推送通知 ----------
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const sameKey = (a, b) => a && b && a.byteLength === b.byteLength && new Uint8Array(a).every((x, i) => x === b[i]);

export async function enablePush() {
  if (!pushSupported()) {
    throw new Error(isIOS() && !isStandalone() ? "iPhone 要先用 Safari 把栖所「添加到主屏幕」，再从主屏幕打开栖所来开通知" : "这个浏览器不支持推送通知");
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("没有允许通知：可以去手机的系统设置里打开");
  const reg = await navigator.serviceWorker.ready;
  const { key } = await relayCall("/push/key");
  const appKey = unb64u(key);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, appKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
  await relayCall("/push/subscribe", sub.toJSON());
  store.wake.push = true;
}

export const testPush = () => relayCall("/push/test", {});

// ---------- 启动 ----------
export function startWake(router) {
  // 设定、记忆、聊天变了 → 过一会儿同步一次（中间再变就重新计时）
  watch(
    () => [store.wake.enabled, store.roles, store.memories, store.events, store.settings, store.tools, store.mcpServers, store.apis, store.threads.map(t => t.updatedAt + ":" + t.id)],
    () => scheduleSync(),
    { deep: true },
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkInbox(true);
    else syncNow(); // 离开栖所时立刻同步，TA 醒来时看到的才是最新的
  });
  setInterval(() => { if (document.visibilityState === "visible") checkInbox(false); }, 60_000);
  // 点了通知：打开对应的对话
  navigator.serviceWorker?.addEventListener("message", e => {
    if (e.data?.type === "open") {
      checkInbox(true);
      if (e.data.hash) router.push(e.data.hash.replace(/^#/, ""));
    }
  });
  checkInbox(true);
  scheduleSync(3000);
}
