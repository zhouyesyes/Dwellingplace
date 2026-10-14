// 工作间：你服务器上的 Codex（见 docs/workroom.md）。这里负责和服务器说话、收实时过程，把一条条事件拼成时间线。
//
// 时间线（每个线程一条）里的东西：
//   user      你说的话（插话的标「插话」）
//   agent     Codex 说的话（一个字一个字长出来）
//   reasoning Codex 的思考摘要
//   plan      计划清单（每一步的状态）
//   command   跑的命令：命令、目录、状态、输出（实时）、退出码、用时
//   files     改的文件：每个文件的 diff
//   approval  要你点的审批（自动放行的也记一笔）
//   turn      一轮的开始 / 结束（完成、中断、失败）
//   error     出错
import { reactive } from "vue";
import { serverBase } from "./server.js";
import { store } from "../store/index.js";

export const wr = reactive({
  base: "", // https://…/p/口令
  status: null, // /status 的结果
  error: "",
  live: false, // 实时过程连着没有
  lastSeq: 0,
  threads: {}, // id -> { meta, items: [], byId: {}, turnId, diffs: { turnId: diff }, usage, loaded }
  login: null, // { verificationUrl, userCode }
});

async function api(path, { method = "GET", body } = {}) {
  if (!wr.base) wr.base = await serverBase();
  if (!wr.base) throw new Error("还没有接上你自己的服务器（在「设置 → 同步」或 API 地址里填了服务器地址才找得到）");
  const r = await fetch(`${wr.base}/codex${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `服务器返回 ${r.status}`);
  return j;
}

export async function refresh() {
  try {
    wr.status = await api("/status");
    wr.error = "";
    noteWorkroom(wr.status);
    for (const t of wr.status.threads || []) thread(t.id).meta = t;
  } catch (e) {
    wr.error = e.message;
  }
  return wr.status;
}

// 工作间能用吗（登录了）、有哪些项目：存一份，聊天的系统提示和唤醒里用（不用每次都去问服务器）
export function noteWorkroom(st) {
  const next = st?.ready && st?.account ? { projects: st.projects || [], base: wr.base } : null;
  if (JSON.stringify(next) !== JSON.stringify(store.settings.workroom || null)) store.settings.workroom = next;
}

// ---------- 时间线 ----------
export function thread(id) {
  return (wr.threads[id] ??= { meta: null, items: [], byId: {}, turnId: null, diffs: {}, usage: null, loaded: false });
}
const add = (t, it) => { t.items.push(it); if (it.id) t.byId[it.id] = it; return it; };
const ITEM_KIND = { agentMessage: "agent", reasoning: "reasoning", commandExecution: "command", fileChange: "files", plan: "plan", userMessage: null, mcpToolCall: "tool", webSearch: "tool", dynamicToolCall: "tool", contextCompaction: "note" };

// 一条事件 → 改时间线
export function apply(ev) {
  const p = ev.params || {};
  if (ev.seq > wr.lastSeq) wr.lastSeq = ev.seq;
  const tid = p.threadId || p.thread?.id;
  if (ev.method === "account/rateLimits/updated" && wr.status) wr.status.rateLimits = p.rateLimits || wr.status.rateLimits;
  if (ev.method === "account/login/completed") { wr.login = null; refresh(); }
  if (!tid) return;
  const t = thread(tid);
  switch (ev.method) {
    case "qisuo/user/message":
      add(t, { kind: "user", text: p.text, attachments: p.attachments || [], steer: p.steer, ts: ev.ts });
      break;
    case "turn/started":
      t.turnId = p.turn?.id;
      add(t, { kind: "turn", state: "started", turnId: p.turn?.id, ts: ev.ts });
      break;
    case "turn/completed": {
      t.turnId = null;
      const st = p.turn?.status;
      add(t, { kind: "turn", state: st, turnId: p.turn?.id, error: p.turn?.error?.message || "", ts: ev.ts, diff: t.diffs[p.turn?.id] || "" });
      break;
    }
    case "turn/diff/updated":
      t.diffs[p.turnId] = p.diff;
      break;
    case "turn/plan/updated": {
      const id = `plan:${p.turnId}`;
      const it = t.byId[id] || add(t, { kind: "plan", id, ts: ev.ts });
      it.steps = p.plan || [];
      it.explanation = p.explanation || "";
      break;
    }
    case "item/started":
    case "item/completed": {
      const item = p.item || {};
      const kind = ITEM_KIND[item.type];
      if (!kind) break;
      const it = t.byId[item.id] || add(t, { kind, id: item.id, ts: ev.ts, text: "", output: "" });
      it.done = ev.method === "item/completed";
      if (kind === "agent" && item.text) it.text = item.text;
      if (kind === "reasoning" && item.summary?.length) it.text = item.summary.join("\n");
      if (kind === "plan" && item.text) it.text = item.text;
      if (kind === "command") Object.assign(it, { command: item.command, cwd: item.cwd, status: item.status, exitCode: item.exitCode, durationMs: item.durationMs, ...(item.aggregatedOutput != null ? { output: item.aggregatedOutput } : {}) });
      if (kind === "files") Object.assign(it, { changes: item.changes || [], status: item.status });
      if (kind === "tool") Object.assign(it, { name: item.type === "webSearch" ? `搜索 ${item.query || ""}` : `${item.server || item.namespace || ""}.${item.tool || ""}`, status: item.status });
      if (kind === "note") it.text = "上下文太长，Codex 压缩了一下前面的内容";
      break;
    }
    case "item/agentMessage/delta":
      (t.byId[p.itemId] || add(t, { kind: "agent", id: p.itemId, ts: ev.ts, text: "" })).text += p.delta || "";
      break;
    case "item/reasoning/summaryTextDelta":
      (t.byId[p.itemId] || add(t, { kind: "reasoning", id: p.itemId, ts: ev.ts, text: "" })).text += p.delta || "";
      break;
    case "item/commandExecution/outputDelta": {
      const it = t.byId[p.itemId] || add(t, { kind: "command", id: p.itemId, ts: ev.ts, output: "" });
      it.output = (it.output || "") + (p.delta || "");
      if (it.output.length > 60_000) it.output = "…" + it.output.slice(-60_000);
      break;
    }
    case "qisuo/approval/pending":
      add(t, { kind: "approval", id: `ap:${p.key}`, key: p.key, method: p.method, command: p.command, cwd: p.cwd, reason: p.reason, grantRoot: p.grantRoot, state: "pending", ts: ev.ts });
      break;
    case "qisuo/approval/answered": {
      const it = t.byId[`ap:${p.key}`];
      if (it) { it.state = "answered"; it.decision = p.decision; }
      break;
    }
    case "qisuo/approval/auto": {
      // 自动放行的：记在那条命令 / 那次改文件的卡片上（找不到才单独记一行）
      const it = p.itemId && t.byId[p.itemId];
      if (it) it.auto = true;
      else add(t, { kind: "approval", method: p.method, command: p.command, state: "auto", decision: p.decision, ts: ev.ts, itemId: p.itemId });
      break;
    }
    case "thread/tokenUsage/updated":
      t.usage = p.tokenUsage;
      break;
    case "error":
      add(t, { kind: "error", text: p.error?.message || "出错了", retrying: !!p.willRetry, ts: ev.ts });
      break;
  }
}

// 打开一个线程：先把存着的过程拉下来（断线、换设备也看得到全部）
export async function loadThread(id) {
  const t = thread(id);
  const r = await api(`/threads/${id}/events`);
  t.meta = r.thread;
  t.items = []; t.byId = {}; t.diffs = {}; t.turnId = r.thread.turnId || null;
  for (const ev of r.events) apply(ev);
  // 还在等的审批（存盘的事件里有，但可能已经答过了）：以服务器现在的为准
  const live = new Set((r.approvals || []).map(a => a.key));
  for (const it of t.items) if (it.kind === "approval" && it.state === "pending" && !live.has(it.key)) it.state = "answered";
  t.loaded = true;
  return t;
}

// ---------- 实时过程（SSE）：断了就带着最后的编号再连 ----------
// 每 50ms 合并一批增量；完成事件排在增量之后，断开时也不丢尾字。
let pendingEvents = [], batchTimer = null;
function flushEvents() {
  clearTimeout(batchTimer); batchTimer = null;
  const events = pendingEvents; pendingEvents = [];
  for (const ev of events) apply(ev);
}
function queueEvent(ev) {
  pendingEvents.push(ev);
  if (!batchTimer) batchTimer = setTimeout(flushEvents, 50);
}
let es = null, retry = null;
export async function connect() {
  if (es) return;
  if (!wr.base) wr.base = await serverBase();
  if (!wr.base) return;
  const since = wr.lastSeq || wr.status?.seq || 0;
  es = new EventSource(`${wr.base}/codex/events?since=${since}`);
  es.onopen = () => { wr.live = true; };
  es.onmessage = e => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    if (ev.method === "qisuo/gap") { flushEvents(); for (const id of Object.keys(wr.threads)) if (wr.threads[id].loaded) loadThread(id).catch(() => {}); return; }
    if (ev.seq && ev.seq <= Math.max(wr.lastSeq, pendingEvents.at(-1)?.seq || 0)) return; // 补回来的、已经有了的
    queueEvent(ev);
  };
  es.onerror = () => {
    wr.live = false;
    es?.close(); es = null;
    clearTimeout(retry);
    retry = setTimeout(connect, 3000);
  };
}
export function disconnect() { flushEvents(); clearTimeout(retry); es?.close(); es = null; wr.live = false; }

// ---------- 做事 ----------
export async function startLogin() { wr.login = await api("/login", { method: "POST" }); return wr.login; }
export const logout = () => api("/logout", { method: "POST" }).then(refresh);
export const newProject = name => api("/projects", { method: "POST", body: { name } }).then(refresh);
export const deleteProject = name => api("/projects/delete", { method: "POST", body: { name } }).then(refresh);
export async function newThread(project, title) {
  const r = await api("/threads", { method: "POST", body: { project, title } });
  thread(r.thread.id).meta = r.thread;
  await refresh();
  return r.thread;
}
export const say = (id, text, attachments = []) => api(`/threads/${id}/send`, { method: "POST", body: { text, attachments: attachments.map(a => a.id) } });
export const interrupt = id => api(`/threads/${id}/interrupt`, { method: "POST" });
export const answer = (key, decision) => api(`/approvals/${key}`, { method: "POST", body: { decision } });
export const setPolicy = p => api("/policy", { method: "POST", body: p }).then(refresh);
export const gitState = name => api("/projects/git", { method: "POST", body: { name } });
export const gitPush = name => api("/projects/push", { method: "POST", body: { name } });
export const gitPull = name => api("/projects/pull", { method: "POST", body: { name } });
export const archive = id => api(`/threads/${id}/archive`, { method: "POST" }).then(refresh);

// 额度：「主」一般是 5 小时，「次」是每周；used 是用掉的百分比
export function limitsOf(rl) {
  const win = (x, fb) => x && { label: x.windowDurationMins ? (x.windowDurationMins <= 600 ? `${Math.round(x.windowDurationMins / 60)} 小时` : "每周") : fb, used: x.usedPercent, resetsAt: x.resetsAt };
  return [win(rl?.primary, "5 小时"), win(rl?.secondary, "每周")].filter(Boolean);
}

export const attachmentUrl = (id, file) => `${wr.base}/codex/threads/${encodeURIComponent(id)}/attachments/${encodeURIComponent(file)}`;
export async function uploadAttachment(id, file) {
  const r = await fetch(`${wr.base}/codex/threads/${encodeURIComponent(id)}/attachments?name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || "附件上传失败");
  return data;
}
