// 工作间的连接程序：在 Codex 的容器里，看住 Codex（app-server，stdio JSON-RPC），把它干活的过程、审批交给栖所。
// 只用 Node 自带的东西。
//
// 谁能做什么：
//   - 这个程序以 root 运行，Codex 和它跑的命令以 codex 用户（1001）运行：命令读不到这里的钥匙和记录（/bridge）
//   - 外面要带 X-Bridge-Key 才能用；栖所服务器在内部网络里转发，钥匙只有它知道
//   - 容器自己上不了网，出门都经过门卫（gate.mjs，只放行 OpenAI）
//
// 接口（栖所服务器转发到这里：/p/<口令>/codex/… → /…）：
//   GET  /status                       登录了没、额度、项目、线程、还在等你的审批
//   POST /login                        设备码登录：返回网址和码（码只在 OpenAI 的页面上输入）
//   POST /logout
//   GET  /projects   POST /projects {name}            /work 下面的项目文件夹
//   POST /threads {project, title, instructions}     开一个新线程（在那个项目文件夹里干活）
//   POST /threads/:id/resume                          重启以后接着用以前的线程
//   GET  /threads/:id/events?since=N                  这个线程的全部过程（存着的）
//   POST /threads/:id/send {text}                     说话：没在干活就开始一轮，正在干活就插一句
//   POST /threads/:id/interrupt                       中断这一轮
//   POST /approvals/:key {decision}                   回答审批：accept / acceptForSession / decline / cancel
//   GET  /policy   POST /policy {...}                 哪些事不用问你
//   GET  /events?since=N                              实时过程（SSE）；断线了带上最后的编号再连，从断点补回
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual, randomUUID } from "node:crypto";

const PORT = Number(process.env.BRIDGE_PORT) || 7700;
const KEY = process.env.BRIDGE_KEY || "";
const WORK = process.env.WORK_DIR || "/work";
const DATA = process.env.BRIDGE_DATA || "/bridge";
const UID = Number(process.env.CODEX_UID) || 1001;
const CODEX_HOME = process.env.CODEX_HOME_DIR || "/home/codex/.codex";
if (!KEY) { console.error("缺少 BRIDGE_KEY"); process.exit(1); }
fs.mkdirSync(path.join(DATA, "threads"), { recursive: true, mode: 0o700 });

// ---------- 存的东西 ----------
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJSON = (f, v) => { const t = `${f}.tmp`; fs.writeFileSync(t, JSON.stringify(v, null, 1), { mode: 0o600 }); fs.renameSync(t, f); };
const THREADS = path.join(DATA, "threads.json");
const POLICY = path.join(DATA, "policy.json");
let threads = readJSON(THREADS, {}); // id -> { id, project, title, createdAt, updatedAt, status, turnId }
let policy = { autoRead: true, autoTest: true, autoEdit: true, ...readJSON(POLICY, {}) };
const saveThreads = () => writeJSON(THREADS, threads);

// ---------- 事件：编号、内存里留最近的，每个线程另外存一份 ----------
let seq = readJSON(path.join(DATA, "seq.json"), 0) + 100; // 每 50 条才存一次编号：重启后往前跳 100，编号不会重复
const ring = [];
const RING_MAX = 4000;
const clients = new Set();
const OUT_MAX = 20_000; // 一条命令输出最多存多少字（实时还是全给）
function emit(method, params) {
  const ev = { seq: ++seq, ts: Date.now(), method, params };
  ring.push(ev);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  const tid = params?.threadId || params?.thread?.id;
  if (tid) {
    let saved = ev;
    // 存盘的命令输出截短（实时推送的还是完整的）
    if (method === "item/commandExecution/outputDelta" && String(params.delta || "").length > OUT_MAX) saved = { ...ev, params: { ...params, delta: params.delta.slice(0, OUT_MAX) + "\n…（太长，后面没存）" } };
    try { fs.appendFileSync(path.join(DATA, "threads", `${tid}.jsonl`), JSON.stringify(saved) + "\n"); } catch { /* 写不了就算了 */ }
    if (threads[tid]) threads[tid].updatedAt = ev.ts;
  }
  const line = `id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`;
  for (const c of clients) c.write(line);
  if (seq % 50 === 0) writeJSON(path.join(DATA, "seq.json"), seq);
}

// ---------- Codex（app-server） ----------
let srv = null, ready = false, rpcId = 0, version = "";
const pending = new Map(); // 我们问 Codex、等它回
const approvals = new Map(); // Codex 问我们、等你回：key -> { id, method, params, ts }
let account = null, rateLimits = null;

function start() {
  ready = false;
  srv = spawn("codex", ["app-server"], {
    uid: UID, gid: UID, cwd: WORK,
    env: { PATH: process.env.PATH, HOME: path.dirname(CODEX_HOME), CODEX_HOME, HTTPS_PROXY: process.env.HTTPS_PROXY || "", HTTP_PROXY: process.env.HTTP_PROXY || "", NO_PROXY: "localhost,127.0.0.1", LANG: "C.UTF-8" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  srv.stderr.on("data", d => process.stderr.write(d));
  const rl = readline.createInterface({ input: srv.stdout });
  rl.on("line", onLine);
  srv.on("exit", code => {
    ready = false;
    for (const [, p] of pending) p.reject(new Error("Codex 停了"));
    pending.clear();
    for (const k of [...approvals.keys()]) { approvals.delete(k); emit("qisuo/approval/cleared", { key: k, why: "Codex 重启了" }); }
    emit("qisuo/codex/exited", { code });
    setTimeout(start, 3000); // 停了就再开
  });
  init().catch(e => { console.error("初始化失败", e); emit("qisuo/codex/error", { message: e.message }); });
}
const send = obj => srv?.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\n");
function call(method, params = {}, ms = 120_000) {
  return new Promise((resolve, reject) => {
    const id = ++rpcId;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 太久没回`)); }, ms);
    pending.set(id, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } });
    send({ id, method, params });
  });
}
async function init() {
  const r = await call("initialize", { clientInfo: { name: "qisuo-workroom", title: "栖所工作间", version: "0.1" }, capabilities: { experimentalApi: true } });
  version = r.userAgent || "";
  send({ method: "initialized" });
  ready = true;
  await refreshAccount();
  // 以前开着的线程：重新接上（Codex 重启以后要 resume 才收得到它的事件）
  for (const t of Object.values(threads)) if (t.status !== "archived") call("thread/resume", { threadId: t.id }).catch(() => {});
  emit("qisuo/codex/ready", { version });
}
async function refreshAccount() {
  try { account = (await call("account/read", { refreshToken: false })).account || null; } catch { account = null; }
  if (account) try { rateLimits = (await call("account/rateLimits/read", {})).rateLimits || null; } catch { /* 读不到就算了 */ }
}

function onLine(line) {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  // Codex 回我们的
  if (m.id != null && !m.method) {
    const p = pending.get(m.id);
    if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error.message || "出错了")) : p.resolve(m.result); }
    return;
  }
  // Codex 问我们的（审批之类）
  if (m.id != null && m.method) return onRequest(m);
  // Codex 告诉我们的
  const p = m.params || {};
  if (m.method === "turn/started" && threads[p.threadId]) threads[p.threadId].turnId = p.turn?.id;
  if (m.method === "turn/completed" && threads[p.threadId]) { delete threads[p.threadId].turnId; saveThreads(); }
  if (m.method === "account/rateLimits/updated") rateLimits = p.rateLimits || rateLimits;
  if (m.method === "account/login/completed" || m.method === "account/updated") refreshAccount();
  emit(m.method, p);
}

// ---------- 审批：先看规则能不能直接答，不能就等你 ----------
const SAFE_CMD = /^(rg|grep|cat|ls|head|tail|wc|pwd|echo|stat|file|tree|du|diff|which|sed -n|awk|sort|uniq|cut|find|git (status|diff|log|show|branch|rev-parse|ls-files))\b/;
const TEST_CMD = /^((npm|pnpm|yarn) (test|run (test|lint|build|check))|npx (vitest|jest|eslint|tsc)|node --test|node [\w./-]*test[\w./-]*\.m?js|pytest|python3? -m (pytest|unittest)|cargo (test|check|build)|go (test|vet|build))\b/;
const RISKY = /[>`]|\$\(|\b(rm|mv|cp|chmod|chown|curl|wget|nc|ssh|scp|sudo|su|dd|mkfs|kill|pkill|npm (i|install|add)|pip install|apt|git (push|pull|fetch|clone|reset|checkout|commit|remote))\b|-exec\b|-delete\b/;
function unwrap(cmd) {
  const s = String(cmd || "").trim();
  const m = s.match(/^\/bin\/(?:ba)?sh -l?c (["'])([\s\S]*)\1$/);
  return m ? m[2] : s;
}
function autoDecision(method, p) {
  const inside = d => { const r = path.resolve(String(d || WORK)); return r === WORK || r.startsWith(WORK + "/"); };
  if (method === "item/commandExecution/requestApproval") {
    if (!inside(p.cwd) || p.networkApprovalContext) return null;
    const body = unwrap(p.command);
    if (RISKY.test(body)) return null;
    const parts = body.split(/\s*(?:&&|\|\||;|\|)\s*/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    const okPart = s => (policy.autoRead && SAFE_CMD.test(s)) || (policy.autoTest && TEST_CMD.test(s)) || /^(cd [\w./-]+|true|:)$/.test(s);
    return parts.every(okPart) ? "accept" : null;
  }
  if (method === "item/fileChange/requestApproval") {
    if (!policy.autoEdit) return null;
    if (p.grantRoot && !inside(p.grantRoot)) return null; // 要改项目外面：问你
    return "accept";
  }
  return null;
}
function onRequest(m) {
  const p = m.params || {};
  if (/requestApproval$/.test(m.method)) {
    const auto = autoDecision(m.method, p);
    if (auto) {
      send({ id: m.id, result: { decision: auto } });
      emit("qisuo/approval/auto", { threadId: p.threadId, turnId: p.turnId, itemId: p.itemId, method: m.method, command: p.command, decision: auto });
      return;
    }
    const key = randomUUID();
    approvals.set(key, { id: m.id, method: m.method, params: p, ts: Date.now() });
    emit("qisuo/approval/pending", { key, threadId: p.threadId, turnId: p.turnId, itemId: p.itemId, method: m.method, command: p.command, cwd: p.cwd, reason: p.reason, grantRoot: p.grantRoot });
    return;
  }
  // 别的（问你问题、MCP 要确认……）先都交给你
  if (m.method === "item/tool/requestUserInput" || m.method === "mcpServer/elicitation/request") {
    const key = randomUUID();
    approvals.set(key, { id: m.id, method: m.method, params: p, ts: Date.now() });
    emit("qisuo/approval/pending", { key, threadId: p.threadId, method: m.method, params: p });
    return;
  }
  send({ id: m.id, error: { code: -32601, message: "栖所工作间还不支持这个请求" } });
}

// ---------- HTTP ----------
const sameKey = k => { const a = Buffer.from(String(k || "")), b = Buffer.from(KEY); return a.length === b.length && timingSafeEqual(a, b); };
const json = (res, code, v) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(v)); };
async function body(req) { const c = []; for await (const x of req) c.push(x); try { return c.length ? JSON.parse(Buffer.concat(c)) : {}; } catch { return {}; } }
const projectName = s => String(s || "").trim().replace(/[^\w一-龥.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 60);
const listProjects = () => { try { return fs.readdirSync(WORK, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith(".")).map(d => d.name); } catch { return []; } };
const pendingList = () => [...approvals].map(([key, a]) => ({ key, method: a.method, ts: a.ts, threadId: a.params.threadId, command: a.params.command, cwd: a.params.cwd, reason: a.params.reason, grantRoot: a.params.grantRoot }));

async function route(req, res, url) {
  const p = url.pathname;
  const need = () => { if (!ready) { json(res, 503, { error: { message: "Codex 还没准备好，等几秒" } }); return false; } return true; };
  if (p === "/status") {
    if (ready && account) await refreshAccount();
    return json(res, 200, { ready, version, account: account && { type: account.type, planType: account.planType }, rateLimits, projects: listProjects(), threads: Object.values(threads).sort((a, b) => b.updatedAt - a.updatedAt), approvals: pendingList(), policy, seq });
  }
  if (p === "/events") return sse(req, res, Math.max(Number(url.searchParams.get("since")) || 0, Number(req.headers["last-event-id"]) || 0)); // 浏览器自己重连时带着最后收到的编号
  if (req.method !== "POST" && !/^\/threads\/[^/]+\/events$/.test(p) && p !== "/projects" && p !== "/policy") return json(res, 405, { error: { message: "要用 POST" } });

  if (p === "/login") { if (!need()) return; const r = await call("account/login/start", { type: "chatgptDeviceCode" }); return json(res, 200, { verificationUrl: r.verificationUrl, userCode: r.userCode, loginId: r.loginId }); }
  if (p === "/logout") { if (!need()) return; await call("account/logout", {}); account = null; return json(res, 200, { ok: true }); }
  if (p === "/policy") {
    if (req.method === "POST") { const b = await body(req); for (const k of ["autoRead", "autoTest", "autoEdit"]) if (typeof b[k] === "boolean") policy[k] = b[k]; writeJSON(POLICY, policy); }
    return json(res, 200, policy);
  }
  if (p === "/projects") {
    if (req.method === "POST") {
      const name = projectName((await body(req)).name);
      if (!name) return json(res, 400, { error: { message: "项目名不能为空" } });
      // 以 codex 用户建（这个程序虽然是 root，但去掉了全部特权，动不了 codex 的文件夹）
      const r = spawnSync("mkdir", ["-p", path.join(WORK, name)], { uid: UID, gid: UID, encoding: "utf8" });
      if (r.status) return json(res, 500, { error: { message: `建不了：${r.stderr}` } });
    }
    return json(res, 200, { projects: listProjects() });
  }
  if (p === "/projects/delete") {
    const name = projectName((await body(req)).name);
    if (!name || !listProjects().includes(name)) return json(res, 404, { error: { message: "没有这个项目" } });
    if (Object.values(threads).some(t => t.project === name && t.turnId)) return json(res, 409, { error: { message: "这个项目里还有任务在干活，先让它停下" } });
    // 以 codex 用户删（文件是它的）；任务记录收起来（不删，记录还在 /bridge 里）
    const r = spawnSync("rm", ["-rf", "--", path.join(WORK, name)], { uid: UID, gid: UID, encoding: "utf8" });
    if (r.status) return json(res, 500, { error: { message: `删不了：${r.stderr}` } });
    for (const t of Object.values(threads)) if (t.project === name) t.status = "archived";
    saveThreads();
    return json(res, 200, { projects: listProjects() });
  }
  if (p === "/threads") {
    if (!need()) return;
    const b = await body(req);
    const project = projectName(b.project);
    if (!project || !listProjects().includes(project)) return json(res, 400, { error: { message: "没有这个项目" } });
    const r = await call("thread/start", { cwd: path.join(WORK, project), sandbox: "danger-full-access", approvalPolicy: "untrusted", ...(b.instructions ? { developerInstructions: String(b.instructions).slice(0, 20_000) } : {}), ...(b.model ? { model: b.model } : {}) });
    const t = { id: r.thread.id, project, title: String(b.title || "").slice(0, 60) || project, createdAt: Date.now(), updatedAt: Date.now(), status: "open", model: r.thread.model };
    threads[t.id] = t;
    saveThreads();
    return json(res, 200, { thread: t });
  }
  const tm = p.match(/^\/threads\/([\w-]+)\/(resume|events|send|interrupt|archive)$/);
  if (tm) {
    const [, id, what] = tm;
    const t = threads[id];
    if (!t) return json(res, 404, { error: { message: "没有这个线程" } });
    if (what === "events") {
      const since = Number(url.searchParams.get("since") || 0);
      let lines = [];
      try { lines = fs.readFileSync(path.join(DATA, "threads", `${id}.jsonl`), "utf8").split("\n").filter(Boolean); } catch { /* 还没有 */ }
      const evs = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(e => e && e.seq > since);
      return json(res, 200, { thread: t, events: evs.slice(-3000), approvals: pendingList().filter(a => a.threadId === id) });
    }
    if (!need()) return;
    if (what === "resume") { await call("thread/resume", { threadId: id }); return json(res, 200, { ok: true }); }
    if (what === "archive") { t.status = "archived"; saveThreads(); await call("thread/archive", { threadId: id }).catch(() => {}); return json(res, 200, { ok: true }); }
    if (what === "interrupt") {
      if (!t.turnId) return json(res, 200, { ok: true, idle: true });
      await call("turn/interrupt", { threadId: id, turnId: t.turnId });
      return json(res, 200, { ok: true });
    }
    if (what === "send") {
      const text = String((await body(req)).text || "").trim();
      if (!text) return json(res, 400, { error: { message: "说点什么" } });
      const input = [{ type: "text", text }];
      emit("qisuo/user/message", { threadId: id, text, steer: !!t.turnId });
      if (t.turnId) { const r = await call("turn/steer", { threadId: id, input, expectedTurnId: t.turnId }); return json(res, 200, { turnId: r.turnId, steer: true }); }
      const r = await call("turn/start", { threadId: id, input });
      t.turnId = r.turn?.id;
      saveThreads();
      return json(res, 200, { turnId: t.turnId });
    }
  }
  const am = p.match(/^\/approvals\/([\w-]+)$/);
  if (am) {
    const a = approvals.get(am[1]);
    if (!a) return json(res, 404, { error: { message: "这个审批已经处理过了" } });
    const b = await body(req);
    approvals.delete(am[1]);
    if (/requestApproval$/.test(a.method)) {
      const decision = ["accept", "acceptForSession", "decline", "cancel"].includes(b.decision) ? b.decision : "decline";
      send({ id: a.id, result: { decision } });
      emit("qisuo/approval/answered", { key: am[1], threadId: a.params.threadId, decision });
    } else {
      send({ id: a.id, result: b.result ?? {} }); // 问你问题这类：栖所那边按 Codex 要的格式回
      emit("qisuo/approval/answered", { key: am[1], threadId: a.params.threadId });
    }
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: { message: "没有这个地址" } });
}

function sse(req, res, since) {
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no", Connection: "keep-alive" });
  // 断线补回：内存里还留着的都补上；太早的（已经不在内存里）告诉栖所去按线程拉
  const first = ring[0]?.seq ?? seq + 1;
  if (since && since + 1 < first) res.write(`data: ${JSON.stringify({ seq: 0, method: "qisuo/gap", params: { since, first } })}\n\n`);
  for (const ev of ring) if (ev.seq > since) res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
  clients.add(res);
  const beat = setInterval(() => res.write(": 还在\n\n"), 20_000);
  req.on("close", () => { clearInterval(beat); clients.delete(res); });
}

http.createServer(async (req, res) => {
  try {
    if (!sameKey(req.headers["x-bridge-key"])) return json(res, 401, { error: { message: "钥匙不对" } });
    await route(req, res, new URL(req.url, "http://x"));
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: { message: e.message } });
    else res.end();
  }
}).listen(PORT, () => console.log(`工作间连接程序在 ${PORT}`));
process.on("exit", () => writeJSON(path.join(DATA, "seq.json"), seq));
start();
