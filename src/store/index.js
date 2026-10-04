// 全部数据存在浏览器的 IndexedDB 里：
//   meta          角色、对话列表、API、个人资料、用量统计等（体积小）
//   msgs:<id>     某个对话的全部消息
//   img:<id>      压缩后的图片（Blob）
import { reactive, watch } from "vue";
import { get, set, del } from "idb-keyval";

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const PALETTE = ["#e8a3a3", "#9cc5a1", "#f0cf7a", "#9db8dc", "#c7a6d8", "#f2b48c", "#8fc9c6"];

function defaults() {
  return {
    version: 1,
    profile: { name: "我", color: "#e8a3a3", avatar: null, cover: null },
    roles: [
      newRole({ name: "哥哥", color: "#9db8dc" }),
      newRole({ name: "脆脆", color: "#f0cf7a" }),
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

// ---------- 查询 ----------
export const roleById = id => store.roles.find(r => r.id === id);
export const apiById = id => store.apis.find(a => a.id === id);
export const threadsOf = roleId =>
  store.threads.filter(t => t.roleId === roleId).sort((a, b) => b.updatedAt - a.updatedAt);

// 对话使用的 API：对话单独指定 > 角色指定 > 全局默认 > 第一个
export function apiFor(thread, role) {
  return apiById(thread?.apiId) || apiById(role?.apiId) || apiById(store.defaultApiId) || store.apis[0] || null;
}

// ---------- 对话 ----------
export function createThread(roleId) {
  const t = { id: uid(), roleId, title: "新的对话", createdAt: Date.now(), updatedAt: Date.now(), bg: null, apiId: null, preview: "" };
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

export function recordUsage(apiId, input = 0, output = 0) {
  const day = (store.usage[today()] ??= {});
  const u = (day[apiId] ??= { input: 0, output: 0, calls: 0 });
  u.input += input;
  u.output += output;
  u.calls += 1;
}
