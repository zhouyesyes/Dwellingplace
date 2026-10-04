// 全部数据存在浏览器的 IndexedDB 里：
//   meta          角色、对话列表、API、个人资料、用量统计等（体积小）
//   msgs:<id>     某个对话的全部消息
//   img:<id>      压缩后的图片（Blob）
import { reactive, watch } from "vue";
import { get, set, del } from "idb-keyval";

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// 代表色（日历小圆点、头像底色等）
export const PALETTE = ["#f5a3b5", "#86d1b0", "#8cc1f2", "#f5d36e", "#b9a2ef", "#f7b386", "#7fd0d6"];
// 对方气泡颜色的预设（很淡）
export const BUBBLE_COLORS = ["#eeeff3", "#fde7ec", "#e3f5ec", "#e3effd", "#fdf5d6", "#efe8fd", "#fdeadf", "#ffffff"];
export const DEFAULT_BUBBLE = BUBBLE_COLORS[0];

function defaults() {
  return {
    version: 2,
    profile: { name: "栖所", color: PALETTE[0], avatar: null, cover: null },
    settings: { fontSize: "standard" },
    roles: [
      newRole({ name: "哥哥", color: PALETTE[2], bubbleColor: BUBBLE_COLORS[3] }),
      newRole({ name: "脆脆", color: PALETTE[3], bubbleColor: BUBBLE_COLORS[1] }),
    ],
    threads: [],
    apis: [],
    defaultApiId: null,
    usage: {}, // { "2026-10-04": { [apiId]: { input, output, calls } } }
  };
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
    sigCooldownHours: 24,
    sigLocked: false,
    apiId: null,
    lastThreadId: null,
    createdAt: Date.now(),
    ...over,
  };
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
  store.settings ??= { fontSize: "standard" };
  for (const r of store.roles) r.bubbleColor ??= DEFAULT_BUBBLE;
  for (const a of store.apis) a.favModels ??= [];
  for (const t of store.threads) t.model ??= null;
}

// ---------- 查询 ----------
export const roleById = id => store.roles.find(r => r.id === id);
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
  const t = { id: uid(), roleId, title: "新的对话", createdAt: Date.now(), updatedAt: Date.now(), bg: null, apiId: null, model: null, preview: "" };
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
  if (!messageCache[threadId]) messageCache[threadId] = (await get("msgs:" + threadId)) || [];
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

export const fmtTokens = n => (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n));
