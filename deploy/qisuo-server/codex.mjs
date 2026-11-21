// GPT 的 Codex 对话、订阅额度，以及 CC 的酒馆任务（含旧报告查询）。
import { spawn, execFile } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, renameSync, mkdtempSync, lstatSync, readdirSync, openSync, fstatSync, closeSync, constants } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { bookAppend, bookReady, bookSecrets } from "./claude.mjs";
import { DEFAULT_REPO, listRepos, setRepo, resolveRepo } from "./repos.mjs";
import { TAVERN_REPO, cleanTavern, runTavernJob, tavernStatus, tavernTest } from "./tavern.mjs";

const BIN = process.env.CODEX_BIN || "codex";
const DATA = process.env.DATA_DIR || "/app/data";
const CODEX_HOME = process.env.CODEX_HOME || "/codex-home";
const GH_TOKEN = process.env.CODEX_GITHUB_TOKEN || "";
const GH_REPO = DEFAULT_REPO; // 默认仓库：栖所；别的仓库由派活指定（见 repos.mjs）
const repoUrl = full => (full === GH_REPO && process.env.CODEX_REPO_URL) || `https://github.com/${full}.git`;
const WORK = process.env.CODEX_WORK || join(DATA, "codex-work");
const JOBS_FILE = join(DATA, "codex-jobs.json");
const TIMEOUT = (Number(process.env.CODEX_TIMEOUT_MIN) || 45) * 60_000;
const KEEP = 40; // 最多留多少件的记录

// ---------- 凭据不进日志、不进报告 ----------
const secrets = () => [GH_TOKEN, GH_TOKEN && Buffer.from("x-access-token:" + GH_TOKEN).toString("base64"), ...bookSecrets()].filter(s => s && s.length > 8);
const scrub = t => secrets().reduce((s, k) => s.split(k).join("***"), String(t ?? ""))
  .replace(/(github_pat_|ghp_|gho_|sk-ant-oat|sk-)[\w-]{8,}/g, "$1***")
  .replace(/("(?:access_token|refresh_token|id_token)"\s*:\s*")[^"]+/g, "$1***");

// ---------- 记录 ----------
let jobs = [];
try { jobs = JSON.parse(readFileSync(JOBS_FILE, "utf8")); } catch { /* 还没有 */ }
const save = () => {
  jobs = jobs.slice(-KEEP);
  try { mkdirSync(DATA, { recursive: true }); const tmp = `${JOBS_FILE}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(jobs), { mode: 0o600 }); renameSync(tmp, JOBS_FILE); } catch { /* 写不了就只记在内存里 */ }
};
// 服务器中途重启过：还在排队、开工的都没了，明说，别让聊天那边一直转圈
for (const j of jobs) if (j.status === "queued" || j.status === "running") {
  Object.assign(j, { status: "failed", endedAt: Date.now(), report: "这件活没做成：服务器中途重启了（重跑安装或掉电都会这样），做到一半的不算数。需要的话让小章鱼再派一次。", error: "服务器中途重启" });
}
save();
const pub = (j, full = true) => {
  const pos = j.status === "queued" ? queue.indexOf(j) + 1 : 0;
  return { id: j.id, kind: j.kind || "codex", repo: j.repo || GH_REPO, status: j.status, createdAt: j.createdAt, startedAt: j.startedAt, endedAt: j.endedAt, position: pos, progress: (j.progress || []).slice(-6), ...(full ? { report: j.report || "", error: j.error || "" } : {}) };
};
const setProgress = (j, line) => { const l = scrub(line).replace(/\s+/g, " ").trim().slice(0, 120); if (l && j.progress.at(-1) !== l) { j.progress.push(l); if (j.progress.length > 30) j.progress.shift(); } };

// ---------- 小工具 ----------
const run = (cmd, args, opts = {}) => new Promise(resolve => {
  execFile(cmd, args, { timeout: 180_000, maxBuffer: 8_000_000, ...opts }, (err, out, errOut) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: String(out || ""), err: String(errOut || "") + (err && typeof err.code !== "number" ? err.message : "") }));
});
const codexEnv = extra => ({ ...process.env, CODEX_HOME, HOME: process.env.CODEX_USER_HOME || "/tmp", ...extra });
const authHeader = () => `AUTHORIZATION: basic ${Buffer.from("x-access-token:" + GH_TOKEN).toString("base64")}`;

async function loginStatus() {
  if (!existsSync(CODEX_HOME)) return { installed: true, loggedIn: false, text: "还没有登录凭据目录" };
  const r = await run(BIN, ["login", "status"], { env: codexEnv(), timeout: 20_000 });
  const text = scrub((r.out + "\n" + r.err).replace(/WARNING:[^\n]*\n?/g, "").trim()).slice(0, 300);
  if (/ENOENT|not found/i.test(r.err) && r.code !== 0 && !r.out) return { installed: false, loggedIn: false, text: "服务器上还没装 Codex：再运行一次安装那一行" };
  return { installed: true, loggedIn: r.code === 0 && /logged in/i.test(text) && !/not logged in/i.test(text), text };
}

// ---------- 防撞：只看 CC 那边仍然开着、没合并的 PR ----------
// 已合并的 PR、提交早已在 main 里的旧分支、没有开 PR 的分支都不算；docs/worklog.md 大家每单都会往末尾追加，也不算
const sh = async (cwd, args, env) => { const r = await run("git", args, { cwd, env: { ...process.env, ...env } }); if (r.code) throw new Error(`git ${args[0]} 没成：${scrub(r.err || r.out).trim().slice(-300)}`); return r.out; };
const gitEnv = { GIT_TERMINAL_PROMPT: "0" };

async function runJob(job) {
  job.status = "running"; job.startedAt = Date.now(); save();
  const dir = join(WORK, "tavern", job.id);
  const finish = async (status, report, error = "") => {
    job.status = status; job.endedAt = Date.now(); job.report = scrub(report).slice(0, 20000); job.error = scrub(error).slice(0, 2000); save();
    rmSync(dir, { recursive: true, force: true });
    try { await bookAppend({ id: `tavern-${job.id}`, ts: job.endedAt, where: "cloud", from: "crab", text: job.report }); }
    catch (e) { console.error("酒馆报告没写进对话本：", scrub(e.message)); }
  };
  try { await runTavernJob(job, { setProgress, finish, scrubText: scrub, timeoutMs: TIMEOUT, dir }); }
  catch (e) { await finish("failed", `这件活没做成：${scrub(e.message)}`, e.message); }
}

// ---------- 排队：一次只做一件 ----------
const queue = [];
let current = null;
function pump() {
  if (current || !queue.length) return;
  const job = queue.shift();
  current = job;
  runJob(job).catch(e => { job.status = "failed"; job.error = scrub(e.message); job.report = `这件活没做成：${scrub(e.message)}`; job.endedAt = Date.now(); save(); }).finally(() => { current = null; pump(); });
}

// 酒馆服务器的活由服务器上的 Claude Code 排队执行。
function submitTavern(text, cfg) {
  const c = cleanTavern(cfg);
  if (!tavernStatus().keyReady) throw Object.assign(new Error("服务器上还没有专用的 ssh 钥匙：再运行一次安装那一行，选装「酒馆服务器上的 CC」"), { status: 409 });
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) throw Object.assign(new Error("服务器上的 Claude 还没登录：再运行一次安装那一行，按提示登录"), { status: 409 });
  if (!bookReady()) throw Object.assign(new Error("服务器上还没放对话本的钥匙（开工前要读 qisuo-memory）：再运行一次安装那一行"), { status: 409 });
  const id = randomUUID().slice(0, 8);
  const job = { id, kind: "tavern", repo: TAVERN_REPO, tavern: c, text: text.slice(0, 8000), status: "queued", createdAt: Date.now(), progress: [] };
  jobs.push(job); queue.push(job); save(); pump();
  return pub(job, false);
}

async function submit(text, repoWant, tavern) {
  text = String(text || "").trim();
  if (text.length < 4) throw Object.assign(new Error("要做的事太短了"), { status: 400 });
  if (String(repoWant || "").trim() === TAVERN_REPO) return submitTavern(text, tavern);
  throw Object.assign(new Error("GPT 已改为在 Codex 对话里直接连接仓库"), { status: 410 });
}


// ---------- 额度：问 Codex 命令行（app-server 的 account/rateLimits/read）要当前账号的 5 小时 / 每周用了多少 ----------
// 这个请求只是读，不烧额度。最多每 10 分钟真的问一次，结果存在 DATA 里给网页读；问不到就记原因，不编数字
const LIMITS_FILE = join(DATA, "codex-limits.json");
const LIMITS_EVERY = 10 * 60_000;
let limitsCache = null, limitsBusy = null;
try { limitsCache = JSON.parse(readFileSync(LIMITS_FILE, "utf8")); } catch { /* 还没问过 */ }

function windowOf(w) {
  if (!w || typeof w.usedPercent !== "number") return null;
  const mins = Number(w.windowDurationMins);
  const label = mins ? (mins <= 600 ? `${Math.round(mins / 60)} 小时` : mins >= 7 * 1440 - 60 ? "每周" : `${Math.round(mins / 1440)} 天`) : "";
  return { label, used: Math.max(0, Math.min(100, w.usedPercent)), resetsAt: w.resetsAt ? w.resetsAt * 1000 : null };
}
export function parseRateLimits(res) {
  const snap = res?.rateLimitsByLimitId?.codex || res?.rateLimits;
  const list = [windowOf(snap?.primary), windowOf(snap?.secondary)].filter(Boolean);
  list.forEach((w, i) => { if (!w.label) w.label = i === 0 ? "5 小时" : "每周"; });
  return list;
}
// 开一个 app-server 子进程，握手、问一次、关掉
function askRateLimits() {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, ["app-server"], { env: codexEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let buf = "", done = false;
    const end = (fn, v) => { if (done) return; done = true; clearTimeout(timer); try { child.kill(); } catch { /* 已经退出 */ } fn(v); };
    const timer = setTimeout(() => end(reject, new Error("Codex 命令行 30 秒没有回应")), 30_000);
    const send = o => child.stdin.write(JSON.stringify(o) + "\n");
    child.on("error", e => end(reject, new Error(e.code === "ENOENT" ? "服务器上还没装 Codex" : scrub(e.message))));
    child.on("exit", () => end(reject, new Error("Codex 命令行提前退出了")));
    child.stdout.on("data", d => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) { send({ method: "initialized" }); send({ id: 2, method: "account/rateLimits/read", params: null }); }
        else if (m.id === 2) {
          if (m.error) end(reject, new Error(scrub(String(m.error.message || "Codex 不肯给额度")).slice(0, 200)));
          else end(resolve, m.result);
        }
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "qisuo", title: "栖所", version: "1" } } });
  });
}
async function refreshLimits() {
  const at = Date.now();
  try {
    const st = await loginStatus();
    if (!st.installed) throw new Error(st.text);
    if (!st.loggedIn) throw new Error("服务器上的 Codex 还没登录");
    const windows = parseRateLimits(await askRateLimits());
    if (!windows.length) throw new Error("Codex 没有返回 5 小时 / 每周的额度");
    limitsCache = { at, windows };
  } catch (e) {
    limitsCache = { at, error: scrub(e.message).slice(0, 200), windows: [] };
  }
  try { writeFileSync(LIMITS_FILE, JSON.stringify(limitsCache)); } catch { /* 写不了就只放内存 */ }
  return limitsCache;
}
async function getLimits() {
  if (limitsCache && Date.now() - limitsCache.at < LIMITS_EVERY) return limitsCache;
  return (limitsBusy ??= refreshLimits().finally(() => { limitsBusy = null; }));
}

// 工作区按对话和仓库分开。只在首次打开时克隆，后续保留这条对话的改动。
async function chatCheckout(thread, wanted) {
  if (typeof thread !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(thread)) throw new Error("聊天工作区编号不对");
  if (typeof wanted !== "string" || wanted.length > 200) throw new Error("仓库名不对");
  const direct = [GH_REPO, GH_REPO.split("/")[1], "栖所"].some(name => name.toLowerCase() === wanted.trim().toLowerCase());
  const target = await resolveRepo(direct ? "" : wanted);
  const root = join(DATA, "codex-chat-work", thread);
  const cwd = join(root, createHash("sha256").update(target.full).digest("hex"));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!existsSync(cwd)) {
    const staging = mkdtempSync(join(root, "clone-"));
    try {
      const args = GH_TOKEN ? ["-c", `http.https://github.com/.extraheader=${authHeader()}`] : [];
      await sh(staging, [...args, "clone", "-q", "--depth", "1", "--branch", target.branch, "--", repoUrl(target.full), "repo"], gitEnv);
      renameSync(join(staging, "repo"), cwd);
    } finally { rmSync(staging, { recursive: true, force: true }); }
  }
  if (!lstatSync(cwd).isDirectory()) throw new Error("聊天工作区无法打开");
  return { cwd, name: target.full };
}

// 截图只从这轮的目录取，只认小尺寸 PNG。拒绝软链接、硬链接和非普通文件。
function chatScreenshots(dir) {
  if (!dir || !existsSync(dir) || !lstatSync(dir).isDirectory()) return [];
  const images = [];
  for (const name of readdirSync(dir).filter(n => /^[a-zA-Z0-9_-]{1,80}\.png$/.test(n)).slice(0, 4)) {
    let fd;
    try {
      fd = openSync(join(dir, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 2_000_000) continue;
      const data = readFileSync(fd);
      if (!data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) continue;
      images.push({ name, data: data.toString("base64") });
    } catch { /* 这张图没写好或已经删掉 */ }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  return images;
}

const chatWorkspaceConfig = [
  'default_permissions="qisuo_chat"',
  'permissions.qisuo_chat.extends=":workspace"',
  'permissions.qisuo_chat.filesystem.":root"="deny"',
  'permissions.qisuo_chat.filesystem.":minimal"="read"',
  'permissions.qisuo_chat.filesystem.":slash_tmp"="deny"',
  'features.network_proxy=true',
  'permissions.qisuo_chat.network.enabled=true',
  'permissions.qisuo_chat.network.allow_upstream_proxy=false',
  'permissions.qisuo_chat.network.domains."registry.npmjs.org"="allow"',
  'permissions.qisuo_chat.network.domains."127.0.0.1"="allow"',
  'permissions.qisuo_chat.network.domains."localhost"="allow"',
].flatMap(value => ["-c", value]);

// 每轮拉起 App Server，续接它保存的线程，空闲时不常驻。
function runChatTurn({ cwd, env, args, prompt, followup, threadId, signal, progress, timeout }) {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, ["app-server", ...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const lines = createInterface({ input: child.stdout });
    let turnId, answer = "", usage = {}, stderr = "", done = false, stopping = false;
    const send = (method, params, id) => child.stdin.write(JSON.stringify({ method, params, id }) + "\n");
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(stopTimer);
      signal.removeEventListener("abort", stop);
      lines.close();
      child.kill("SIGTERM");
      const kill = setTimeout(() => child.kill("SIGKILL"), 2000);
      kill.unref();
      child.once("close", () => clearTimeout(kill));
      if (error) reject(error); else resolve(value);
    };
    let stopTimer;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      if (turnId) send("turn/interrupt", { threadId, turnId }, 4);
      stopTimer = setTimeout(() => finish(null, null), 1500);
    };
    const timer = setTimeout(() => finish(new Error("Codex 等待超时")), timeout);
    child.stdin.on("error", e => finish(stopping ? null : e, null));
    child.stderr.on("data", d => { stderr = (stderr + d).slice(-500); });
    child.on("error", e => finish(stopping ? null : e, null));
    child.on("close", () => finish(stopping ? null : new Error(stderr || "Codex App Server 提前退出"), null));
    signal.addEventListener("abort", stop, { once: true });
    lines.on("line", line => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      const p = m.params || {};
      if (m.method && m.id !== undefined) {
        // 此入口按工作区权限运行，不交互批准额外权限。
        child.stdin.write(JSON.stringify({ id: m.id, error: { code: -32601, message: "Approval unavailable" } }) + "\n");
        return;
      }
      if (stopping && m.method === "turn/completed") return finish(null, null);
      if (stopping || done) return;
      if (m.error && m.id === 2 && threadId && /not found|no rollout|does not exist|unknown thread/i.test(m.error.message)) {
        threadId = undefined;
        send("thread/start", { cwd, approvalPolicy: "never" }, 2);
      } else if (m.error) finish(new Error(m.error.message || "Codex 请求失败"));
      else if (m.id === 1) {
        send("initialized");
        send(threadId ? "thread/resume" : "thread/start", { ...(threadId ? { threadId, excludeTurns: true } : {}), cwd, approvalPolicy: "never" }, 2);
      } else if (m.id === 2) {
        const text = threadId ? followup || prompt : prompt;
        threadId = m.result.thread.id;
        send("turn/start", { threadId, input: [{ type: "text", text, text_elements: [] }], effort: "low" }, 3);
      } else if (m.id === 3) turnId = m.result.turn.id;
      else if (p.threadId === threadId) {
        if (m.method === "turn/started") turnId = p.turn.id;
        if (m.method === "item/started" && p.item.type === "commandExecution") progress("Codex 正在运行命令…");
        if (m.method === "item/started" && p.item.type === "fileChange") progress("Codex 正在修改文件…");
        if (m.method === "item/completed" && p.item.type === "agentMessage") answer = p.item.text;
        if (m.method === "thread/tokenUsage/updated") usage = p.tokenUsage.last;
        if (m.method === "turn/completed") {
          if (p.turn.status !== "completed") return finish(new Error(p.turn.error?.message || "Codex 没有完成这一轮"));
          finish(null, { threadId, text: answer, usage: { input: usage.inputTokens || 0, output: usage.outputTokens || 0, cached: usage.cachedInputTokens || 0 } });
        }
      }
    });
    send("initialize", { clientInfo: { name: "qisuo", title: "栖所", version: "1" } }, 1);
    if (signal.aborted) stop();
  });
}

// 闲聊仍在空目录只回文字。她打开仓库后，同一轮 Codex 才有工作区和执行工具。
let chatBusy = false;
async function codexChat(req, res, CORS) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 96_000) throw Object.assign(new Error("聊天内容太长了"), { status: 413 });
    chunks.push(chunk);
  }
  const { prompt, workspace, thread, previous, followup } = JSON.parse(Buffer.concat(chunks).toString());
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 24_000) throw new Error("聊天内容为空或太长了");
  if (typeof thread !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(thread) || workspace && workspace.thread !== thread) throw new Error("聊天编号不对");
  if (typeof followup !== "string" || followup.length > 12000) throw new Error("续聊内容太长");
  if (chatBusy) throw Object.assign(new Error("已有一条 Codex 聊天在回复"), { status: 429 });
  const home = mkdtempSync(join(tmpdir(), "qisuo-chat-"));
  let screenshots;
  chatBusy = true;
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  res.once("close", stop);
  try {
    const checkout = workspace ? await chatCheckout(workspace.thread, workspace.repo) : null;
    if (ctrl.signal.aborted) return null;
    const cwd = checkout?.cwd || home;
    const photoFolder = checkout ? `qisuo-shots-${randomUUID()}` : "";
    if (checkout) {
      screenshots = join(cwd, photoFolder);
      mkdirSync(screenshots, { mode: 0o700 });
    }
    const env = { PATH: process.env.PATH, CODEX_HOME, HOME: checkout ? cwd : home, TMPDIR: checkout ? screenshots : home };
    const agentPrompt = checkout ? [
      `正在栖所聊天中，当前工作区是 ${checkout.name}。按对方本轮要求调查、修改或运行；普通闲聊直接回复。改动保留在当前聊天工作区，不能推送或部署。`,
      `需要给对方发真实截图时，使用 Chromium，把 PNG 存到 ${photoFolder}/ 下（文件名只用英文字母、数字、短横线或下划线）。可用 chromium --headless --no-sandbox --disable-dev-shm-usage --window-size=390,844 --screenshot=${photoFolder}/preview.png http://127.0.0.1:端口 。用完停止预览服务。图片会随回复发送。`,
      prompt,
    ].join("\n\n") : prompt;
    const stateDir = join(DATA, "codex-chat-sessions");
    const scope = createHash("sha256").update(JSON.stringify([thread, checkout?.name || ""])).digest("hex");
    const stateFile = join(stateDir, scope + ".json");
    let session;
    try { session = JSON.parse(readFileSync(stateFile, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
    const threadId = previous && previous === session?.receipt ? session.threadId : undefined;
    if (threadId) rmSync(stateFile, { force: true });
    res.writeHead(200, { ...CORS, "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    const emit = event => { if (!res.destroyed) res.write(JSON.stringify(event) + "\n"); };
    const progress = text => emit({ type: "progress", text });
    const heartbeat = setInterval(() => emit({ type: "ping" }), 10000);
    try {
      progress(checkout ? "Codex 已打开仓库…" : "Codex 正在回复…");
      const result = await runChatTurn({
        cwd, env, signal: ctrl.signal, progress, threadId,
        prompt: agentPrompt, followup: checkout ? agentPrompt.slice(0, -prompt.length) + followup : followup,
        timeout: checkout ? 600_000 : 120_000,
        args: [
          ...(checkout ? chatWorkspaceConfig : ["-c", 'sandbox_mode="read-only"', "--disable", "shell_tool"]),
          "--disable", "apps", "--disable", "plugins", "--disable", "multi_agent",
          "-c", 'web_search="disabled"', "-c", "mcp_servers={}",
        ],
      });
      if (!result || ctrl.signal.aborted) return;
      const receipt = randomUUID();
      mkdirSync(stateDir, { recursive: true, mode: 0o700 });
      writeFileSync(stateFile + ".tmp", JSON.stringify({ receipt, threadId: result.threadId }), { mode: 0o600 });
      renameSync(stateFile + ".tmp", stateFile);
      emit({ type: "result", text: result.text, usage: result.usage, images: chatScreenshots(screenshots), receipt });
    } catch (e) { emit({ type: "error", text: scrub(e.message).slice(-500) }); }
    finally { clearInterval(heartbeat); if (!res.destroyed) res.end(); }
  } finally {
    res.off("close", stop);
    chatBusy = false;
    if (screenshots) rmSync(screenshots, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

export async function handleCodex(req, res, rest, CORS) {
  const send = (code, obj) => { res.writeHead(code, { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
  const body = async () => { const cs = []; for await (const c of req) cs.push(c); try { return JSON.parse(Buffer.concat(cs).toString() || "{}"); } catch { return {}; } };
  try {
    if (rest === "/status" && req.method === "GET") {
      const st = await loginStatus();
      return send(200, { ...st, github: !!GH_TOKEN, book: bookReady(), running: current ? current.id : null, queued: queue.length });
    }
    if (rest === "/chat" && req.method === "POST") {
      return await codexChat(req, res, CORS);
    }
    if (rest === "/limits" && req.method === "GET") return send(200, await getLimits());
    if (rest === "/job" && req.method === "POST") { const b = await body(); return send(200, await submit(b.text, b.repo, b.tavern)); }
    if (rest === "/tavern/status" && req.method === "GET") return send(200, tavernStatus());
    if (rest === "/tavern/test" && req.method === "POST") return send(200, await tavernTest(await body()));
    if (rest === "/repos" && req.method === "GET") return send(200, { repos: await listRepos(new URL(req.url, "http://x").searchParams.has("fresh")) });
    if (rest === "/repos" && req.method === "POST") { const b = await body(); return send(200, { repos: await setRepo(b.name, b.enabled) }); }
    const m = rest.match(/^\/job\/([\w-]+)$/);
    if (m && req.method === "GET") {
      const j = jobs.find(x => x.id === m[1]);
      return j ? send(200, pub(j)) : send(404, { error: { message: "没有这件活的记录（可能服务器记录已经清掉）" } });
    }
    return send(404, { error: { message: "没有这个地址" } });
  } catch (e) {
    return send(e.status || 400, { error: { message: scrub(e.message) } });
  }
}
