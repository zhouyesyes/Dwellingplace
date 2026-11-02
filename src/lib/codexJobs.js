// 小章鱼派活：把活交给服务器上的 Codex（…/codex），和小螃蟹的云端派活对称。
// 派出去以后聊天里出一张进度卡片；做完（或没做成）的报告，由这里取回来，作为一条「云端干活」的消息接在那条聊天后面。
import { reactive } from "vue";
import { store, apiFor, roleById, loadMessages, saveMessages } from "../store/index.js";
import { activePath, ROOT } from "./tree.js";

// 服务器的地址：照着正在用的接口（…/p/口令/chatgpt/v1 之类）去掉后面一段，换成 /codex
export function codexBase(role, thread) {
  const pick = a => String(a?.baseUrl || "").match(/^(.*\/p\/[^/]+)\/[a-z]+(\/|$)/i)?.[1];
  const own = pick(apiFor(thread, role));
  const any = own || store.apis.map(pick).find(Boolean);
  return any ? any + "/codex" : "";
}

// 每件活的最新状态（给进度卡片看）；刷新页面后从服务器重新取
export const jobState = reactive({});
const END = ["done", "failed", "blocked"];

export async function dispatchCodex(role, thread, text) {
  const base = codexBase(role, thread);
  if (!base) throw new Error("找不到栖所服务器的地址");
  const r = await fetch(base + "/job", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `返回 ${r.status}`);
  (store.codexJobs ??= []).push({ id: j.id, roleId: role.id, threadId: thread.id, text: text.slice(0, 200), at: Date.now() });
  if (store.codexJobs.length > 30) store.codexJobs.splice(0, store.codexJobs.length - 30);
  jobState[j.id] = j;
  setTimeout(pollJobs, 1500);
  return j;
}

// 报告接在那条聊天后面（消息 id 固定，几台设备都取到也只会有一条）
async function deliver(rec, j) {
  const all = await loadMessages(rec.threadId);
  const id = `codex-${rec.id}`;
  if (!all.some(m => m.id === id)) {
    const sel = (store.threads || []).find(t => t.id === rec.threadId);
    const path = activePath(all, sel?.sel || {});
    const parentId = path.length ? path[path.length - 1].id : ROOT;
    all.push({ id, parentId, from: "ai", text: j.report || "（这件活没留下报告）", ts: j.endedAt || Date.now(), where: "cloud", notes: [] });
    if (sel) { (sel.sel ??= {})[parentId] = id; sel.updatedAt = Date.now(); sel.preview = String(j.report || "").slice(0, 60); }
    saveMessages(rec.threadId);
  }
  rec.done = true;
}

// 进度卡片出现时：这件活的状态还没取过（刷新页面后），取一次
export async function refreshJob(id) {
  if (jobState[id]) return;
  const rec = (store.codexJobs || []).find(x => x.id === id);
  const base = rec && codexBase(roleById(rec.roleId), (store.threads || []).find(t => t.id === rec.threadId));
  if (!base) return;
  try { const r = await fetch(`${base}/job/${id}`, { cache: "no-store" }); const j = await r.json(); if (r.ok) jobState[id] = j; } catch { /* 连不上就先不显示 */ }
}

let polling = false;
export async function pollJobs() {
  if (polling) return;
  polling = true;
  try {
    for (const rec of (store.codexJobs || []).filter(x => !x.done)) {
      const role = roleById(rec.roleId);
      const base = codexBase(role, (store.threads || []).find(t => t.id === rec.threadId));
      if (!base) continue;
      try {
        const r = await fetch(`${base}/job/${rec.id}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (r.status === 404) { // 服务器上没有这件活的记录了：照实告诉她，别一直转圈
          await deliver(rec, { report: "这件活在服务器上查不到记录了（可能服务器重装过），不知道做没做完。需要的话让小章鱼再派一次。", endedAt: Date.now() });
          jobState[rec.id] = { id: rec.id, status: "failed", report: "服务器上查不到这件活的记录" };
          continue;
        }
        if (!r.ok) throw new Error(j.error?.message || `返回 ${r.status}`);
        jobState[rec.id] = j;
        if (END.includes(j.status)) await deliver(rec, j);
      } catch { /* 连不上：下次再问 */ }
    }
  } finally { polling = false; }
}

// 开着栖所的时候：有没送回的活就每 10 秒问一次；切回来马上问
export function startCodexJobs() {
  const tick = () => { if (!document.hidden && (store.codexJobs || []).some(x => !x.done)) pollJobs(); };
  setTimeout(tick, 4000);
  setInterval(tick, 10_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}
