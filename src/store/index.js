// 全部数据存在浏览器的 IndexedDB 里：
//   meta          角色、对话列表、API、个人资料、用量统计等（体积小）
//   msgs:<id>     某个对话的全部消息
//   img:<id>      压缩后的图片（Blob）
import { reactive, watch } from "vue";
import { get, set, del } from "idb-keyval";
import { migrateFlat } from "../lib/tree.js";

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// 代表色（日历小圆点、头像底色等）
export const PALETTE = ["#f5a3b5", "#86d1b0", "#8cc1f2", "#f5d36e", "#b9a2ef", "#f7b386", "#7fd0d6"];
// 对方气泡颜色的预设（很淡）
export const BUBBLE_COLORS = ["#eeeff3", "#fde7ec", "#e3f5ec", "#e3effd", "#fdf5d6", "#efe8fd", "#fdeadf", "#ffffff"];
export const DEFAULT_BUBBLE = BUBBLE_COLORS[0];

function defaults() {
  return {
    version: 6,
    // name 是主页的名字；userName 是 AI 们怎么称呼你
    profile: { name: "栖所", userName: "", color: PALETTE[0], avatar: null, cover: null, bioSelf: "", bios: {} },
    settings: { fontSize: "standard", historyLimit: 80, privacy: "" }, // privacy：对外保密，所有 AI 通用
    widgets: defaultWidgets(),
    chick: { state: "idle" },
    anniversaries: [], // { id, title, roleId, date: "YYYY-MM-DD", bg }
    events: [], // 日历：{ id, date: "YYYY-MM-DD", text, author: "me" | roleId, ts }
    memories: [], // 记忆卡片：{ id, roleId, title, content, img, date, author: "me" | roleId, ts }
    tools: defaultTools(),
    mcpServers: [], // 见 lib/mcp.js
    wake: { enabled: false, synced: false }, // 唤醒，见 lib/wake.js
    roles: [
      newRole({
        name: "小机",
        color: PALETTE[2],
        bubbleColor: BUBBLE_COLORS[3],
        signature: "来认识这个小 AI 吧～",
        persona: "刚搬进栖所的小 AI，好奇、温柔，有一点点笨拙，正在慢慢认识对方。",
      }),
    ],
    threads: [],
    apis: [],
    defaultApiId: null,
    usage: {}, // { "2026-10-04": { [apiId]: { input, output, calls } } }
  };
}

function defaultTools() {
  return {
    webSearch: false, // 官方 Claude 自带的搜索
    relay: { url: "", token: "" }, // Cloudflare Worker 中转
    search: { enabled: false, provider: "tavily", key: "" }, // 通过中转搜索（所有模型都能用）
    fetch: { enabled: false }, // 内置的「网页读取」工具
  };
}

function defaultWidgets() {
  return [
    { id: uid(), type: "chick", size: "small" },
    { id: uid(), type: "anniv", size: "small" },
    { id: uid(), type: "calendar", size: "large" },
  ];
}

export function newRole(over = {}) {
  return {
    id: uid(),
    name: "",
    color: PALETTE[0],
    bubbleColor: DEFAULT_BUBBLE,
    avatar: null,
    persona: "",
    signature: "",
    sigUpdatedAt: 0,
    sigCooldownHours: 12,
    calPerDay: 3, // 每天能整理几次日历
    calUses: null, // { day, count } 今天整理了几次
    sigLocked: false,
    apiId: null,
    lastThreadId: null,
    // 在这个角色面前的「我」
    me: { name: "", avatar: null, about: "" },
    wake: newWake(),
    wakeAlarms: [], // TA 自己定的闹钟（中转上的副本）
    wakeLog: [], // 最近醒来的记录
    createdAt: Date.now(),
    ...over,
  };
}

// 唤醒设置：every 是分钟；unit 只是显示用（小时 / 分钟）
export function newWake() {
  return { enabled: false, intervalOn: true, every: 120, unit: "hour", jitter: 20, times: [], quiet: { enabled: true, from: "03:00", to: "10:00" } };
}

export const store = reactive(defaults());

export async function loadStore() {
  try {
    const saved = await get("meta");
    if (saved) Object.assign(store, defaults(), saved);
    migrate();
  } catch (e) {
    console.warn("读取本地数据失败", e);
  }
  // 申请「持久存储」，降低浏览器自动清理数据的可能
  navigator.storage?.persist?.().catch(() => {});

  let timer = null;
  const flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    set("meta", JSON.parse(JSON.stringify(store))).catch(console.error);
  };
  watch(store, () => {
    clearTimeout(timer);
    timer = setTimeout(flush, 300);
  }, { deep: true });
  // 切到后台 / 关闭页面时立刻保存
  addEventListener("pagehide", () => { flush(); flushMessages(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { flush(); flushMessages(); }
  });
}

// 旧版本数据补上新字段
function migrate() {
  if (store.version < 2) {
    if (store.profile.name === "我") store.profile.name = "栖所";
    store.version = 2;
  }
  if (store.version < 3) {
    store.widgets = defaultWidgets();
    store.version = 3;
  }
  if (store.version < 4) {
    // 签名冷却从 24 小时改成 12 小时（自己改过的不动）
    for (const r of store.roles) if (r.sigCooldownHours === 24) r.sigCooldownHours = 12;
    store.version = 4;
  }
  if (store.version < 5) {
    // 签名冷却统一改成 12 小时
    for (const r of store.roles) r.sigCooldownHours = 12;
    store.version = 5;
  }
  if (store.version < 6) {
    // 对外保密从每个角色挪到设置里，所有 AI 通用：把各角色写过的合在一起
    store.settings ??= { fontSize: "standard" };
    const parts = [...new Set(store.roles.map(r => r.privacy?.trim()).filter(Boolean))];
    if (parts.length) store.settings.privacy = [store.settings.privacy?.trim(), ...parts].filter(Boolean).join("\n");
    for (const r of store.roles) delete r.privacy;
    store.version = 6;
  }
  store.settings ??= { fontSize: "standard" };
  store.settings.historyLimit ??= 80;
  store.settings.privacy ??= "";
  store.profile.userName ??= "";
  store.profile.bioSelf ??= "";
  store.profile.bios ??= {};
  store.chick ??= { state: "idle" };
  store.anniversaries ??= [];
  store.events ??= [];
  store.memories ??= [];
  store.mcpServers ??= [];
  store.wake ??= { enabled: false, synced: false };
  store.tools = { ...defaultTools(), ...(store.tools || {}) };
  for (const s of store.mcpServers || []) s.disabledTools ??= [];
  for (const r of store.roles) {
    r.bubbleColor ??= DEFAULT_BUBBLE;
    r.calPerDay ??= 3;
    r.wake = { ...newWake(), ...(r.wake || {}) };
    r.wakeAlarms ??= [];
    r.wakeLog ??= [];
    r.me ??= { name: store.profile.userName || "", avatar: null, about: "" };
  }
  for (const a of store.apis) {
    a.favModels ??= [];
    a.showThinking ??= false;
    a.contextLimit ??= 200000;
  }
  for (const t of store.threads) t.model ??= null;
}

// ---------- 查询 ----------
export const roleById = id => store.roles.find(r => r.id === id);
// 日历等处的「作者」：me 或某个角色
export function authorInfo(id) {
  if (id === "me") return { name: "我", color: store.profile.color };
  const r = roleById(id);
  return r ? { name: r.name, color: r.color } : { name: "（已删除）", color: "#c8c8d0" };
}
export const apiById = id => store.apis.find(a => a.id === id);
export const threadsOf = roleId =>
  store.threads.filter(t => t.roleId === roleId).sort((a, b) => b.updatedAt - a.updatedAt);

// 对话使用的 API：对话单独指定 > 角色指定 > 全局默认 > 第一个
export function apiFor(thread, role) {
  return apiById(thread?.apiId) || apiById(role?.apiId) || apiById(store.defaultApiId) || store.apis[0] || null;
}

// 对话使用的模型：对话里单独选过的模型 > 这个 API 的默认模型
export function modelFor(thread, role) {
  const api = apiFor(thread, role);
  if (!api) return "";
  return (thread?.apiId === api.id && thread.model) || api.model;
}

// ---------- 对话 ----------
export function createThread(roleId) {
  const t = { id: uid(), roleId, title: "新的对话", createdAt: Date.now(), updatedAt: Date.now(), bg: null, apiId: null, model: null, preview: "", sel: {} };
  store.threads.push(t);
  messageCache[t.id] = [];
  return t;
}

export async function deleteThread(id) {
  store.threads.splice(store.threads.findIndex(t => t.id === id), 1);
  delete messageCache[id];
  await del("msgs:" + id);
}

export async function deleteRole(id) {
  for (const t of store.threads.filter(t => t.roleId === id)) await deleteThread(t.id);
  store.roles.splice(store.roles.findIndex(r => r.id === id), 1);
}

// ---------- 消息（按对话分开存） ----------
export const messageCache = reactive({});

export async function loadMessages(threadId) {
  if (!messageCache[threadId]) {
    const list = (await get("msgs:" + threadId)) || [];
    messageCache[threadId] = list;
    if (migrateFlat(messageCache[threadId])) saveMessages(threadId);
  }
  return messageCache[threadId];
}

const msgTimers = {};
function writeMessages(threadId) {
  clearTimeout(msgTimers[threadId]);
  delete msgTimers[threadId];
  const list = messageCache[threadId];
  if (!list) return;
  const clean = JSON.parse(JSON.stringify(list.filter(m => !m.pending)));
  set("msgs:" + threadId, clean).catch(console.error);
}
export function saveMessages(threadId) {
  clearTimeout(msgTimers[threadId]);
  msgTimers[threadId] = setTimeout(() => writeMessages(threadId), 400);
}
function flushMessages() {
  for (const id of Object.keys(msgTimers)) writeMessages(id);
}

// ---------- 用量统计 ----------
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// usage[日期][apiId] = { input, output, calls, models: { 模型名: { input, output, calls } } }
export function recordUsage(apiId, model, input = 0, output = 0) {
  const day = (store.usage[today()] ??= {});
  const u = (day[apiId] ??= { input: 0, output: 0, calls: 0 });
  const m = ((u.models ??= {})[model] ??= { input: 0, output: 0, calls: 0 });
  for (const x of [u, m]) {
    x.input += input;
    x.output += output;
    x.calls += 1;
  }
}

const trim0 = s => s.replace(/\.0+$/, "");
export const fmtTokens = n =>
  n >= 1e6 ? trim0((n / 1e6).toFixed(2)) + "M"
  : n >= 1e5 ? Math.round(n / 1e3) + "k"
  : n >= 1e3 ? trim0((n / 1e3).toFixed(1)) + "k"
  : String(n);
