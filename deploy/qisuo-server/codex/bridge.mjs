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
//   POST /projects/git {name}                        和 GitHub 上的比：还没推上去的提交、没提交的改动
//   POST /projects/push {name}                       推上线（她点了才推；钥匙只有这个程序拿得到，Codex 自己推不了）
//   POST /projects/pull {name}                       拉最新的（她点的；有没提交的改动、有冲突就不动，交给 Codex）
//   GET  /policy   POST /policy {...}                 哪些事不用问你
//   GET  /events?since=N                              实时过程（SSE）；断线了带上最后的编号再连，从断点补回
import http from "node:http";
import { collectPreviews, collectOutputs } from "./previews.mjs";
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
// 连着 GitHub 的项目（可以推上线的只有这一个）；钥匙放在 /bridge 里，codex 用户读不到
const GIT_PROJECT = process.env.GIT_PROJECT || "栖所";
const GIT_REPO = process.env.GIT_REPO || "zhouyesyes/Dwellingplace";
const GIT_BRANCH = process.env.GIT_BRANCH || "main";
const GIT_TOKEN_FILE = path.join(process.env.BRIDGE_DATA || "/bridge", "github-token");
// Codex 提交时署的名字
const GIT_ID = { GIT_AUTHOR_NAME: "Codex（栖所工作间）", GIT_AUTHOR_EMAIL: "codex@qisuo.local", GIT_COMMITTER_NAME: "Codex（栖所工作间）", GIT_COMMITTER_EMAIL: "codex@qisuo.local" };
if (!KEY) { console.error("缺少 BRIDGE_KEY"); process.exit(1); }
fs.mkdirSync(path.join(DATA, "threads"), { recursive: true, mode: 0o700 });

// ---------- 存的东西 ----------
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJSON = (f, v) => { const t = `${f}.tmp`; fs.writeFileSync(t, JSON.stringify(v, null, 1), { mode: 0o600 }); fs.renameSync(t, f); };
const THREADS = path.join(DATA, "threads.json");
const POLICY = path.join(DATA, "policy.json");
let threads = readJSON(THREADS, {}); // id -> { id, project, title, createdAt, updatedAt, status, turnId }
let policy = { autoRead: true, autoTest: true, autoEdit: true, autoAll: false, ...readJSON(POLICY, {}) }; // autoAll 要她自己打开
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

// ---------- 任务编号 ----------
// 栖所这边的任务编号一直不变；Codex 那边找不到原来的线程时（比如重启前还没干过活，没留底），会接一个新的，记在 t.codex
const cid = t => t.codex || t.id;
const ours = codexId => Object.values(threads).find(t => t.codex === codexId)?.id || codexId;
const NOT_FOUND = /thread not found|no rollout found|no such thread|unknown thread/i; // Codex 说法不止一种
// 不套 Codex 自己的隔离罩（容器已经隔开了，容器里也套不上），审批按栖所的规则来。开新线程、接上旧线程都带着，不然重启后接上的线程会退回 Codex 的默认
const RUN_OPTS = { sandbox: "danger-full-access", approvalPolicy: "untrusted" };
const startOpts = t => ({ cwd: path.join(WORK, t.project), ...RUN_OPTS, developerInstructions: [BASE_INSTRUCTIONS, t.instructions || "", "界面任务截图：优先运行项目 scripts/ui-preview.cjs，按当前消息给出的任务编号传 --task，并按任务选择 --route；不可导入生产凭据或隐私数据。"].filter(Boolean).join("\n\n"), ...(t.model ? { model: t.model } : {}) });
// 先照常做；Codex 说找不到这个线程：先试着接上，接不上就开一个新的，再做一次
async function withThread(t, run) {
  try { return await run(cid(t)); } catch (e) { if (!NOT_FOUND.test(e.message)) throw e; }
  try { await call("thread/resume", { threadId: cid(t), ...RUN_OPTS }); return await run(cid(t)); } catch (e) { if (!NOT_FOUND.test(e.message)) throw e; }
  const r = await call("thread/start", startOpts(t));
  t.codex = r.thread.id;
  delete t.turnId;
  saveThreads();
  return run(cid(t));
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
    env: { PATH: process.env.PATH, HOME: path.dirname(CODEX_HOME), CODEX_HOME, HTTPS_PROXY: process.env.HTTPS_PROXY || "", HTTP_PROXY: process.env.HTTP_PROXY || "", NO_PROXY: "localhost,127.0.0.1", LANG: "C.UTF-8",
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || "", NODE_PATH: process.env.NODE_PATH || "", // 浏览器（截图检查用）
      ...GIT_ID },
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
  // 以前开着的线程：重新接上（Codex 重启以后要 resume 才收得到它的事件）；重启了就没有还在干的活
  for (const t of Object.values(threads)) delete t.turnId;
  saveThreads();
  for (const t of Object.values(threads)) if (t.status !== "archived") call("thread/resume", { threadId: cid(t), ...RUN_OPTS }).catch(() => {});
  emit("qisuo/codex/ready", { version });
}
async function refreshAccount() {
  try { account = (await call("account/read", { refreshToken: false })).account || null; } catch { account = null; }
  if (account) try { rateLimits = (await call("account/rateLimits/read", {})).rateLimits || null; } catch { /* 读不到就算了 */ }
}

function onLine(line) {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.params?.threadId) m.params.threadId = ours(m.params.threadId);
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
  if (m.method === "turn/completed" && threads[p.threadId]) {
    const t = threads[p.threadId];
    t.previewRuns ||= [];
    collectPreviews(path.resolve(WORK, t.project), t.id, t.previewRuns, async (name, data) => {
      let metadata;
      const res = { writeHead() {}, end(value) { metadata = JSON.parse(value); } };
      await attachmentRoute({ method: "POST", headers: { "content-type": "image/png" }, async *[Symbol.asyncIterator]() { yield data; } }, res, new URL(`http://local/?name=${encodeURIComponent(name)}`), [null, t.id]);
      return metadata;
    }, attachments => {
      if (attachments.length) emit("qisuo/preview/ready", { threadId: t.id, attachments });
    }, () => emit("qisuo/preview/error", { threadId: t.id, message: "有预览截图未能收取，请检查清单和附件目录。" })).then(() => saveThreads()).catch(() => emit("qisuo/preview/error", { threadId: t.id, message: "预览截图收取失败，请检查清单和附件目录；未收取的截图可在修复后重试。" }))
      // 一般产物（做好的图片）：.qisuo-outputs/<任务编号>/ 里的，收了显示给她
      .then(() => { t.outputKeys ||= []; return collectOutputs(path.resolve(WORK, t.project), t.id, t.outputKeys, async (name, data, type) => {
        let metadata;
        const res = { writeHead() {}, end(value) { metadata = JSON.parse(value); } };
        await attachmentRoute({ method: "POST", headers: { "content-type": type }, async *[Symbol.asyncIterator]() { yield data; } }, res, new URL(`http://local/?name=${encodeURIComponent(name)}`), [null, t.id]);
        return metadata;
      }); })
      .then(files => { if (files?.length) { emit("qisuo/preview/ready", { threadId: t.id, attachments: files }); saveThreads(); } })
      .catch(() => {})
      .finally(() => emit(m.method, p));
    return;
  }
  emit(m.method, p);
}

// ---------- 审批：先看规则能不能直接答，不能就等你 ----------
const SAFE_CMD = /^(rg|grep|cat|ls|head|tail|wc|pwd|echo|stat|file|tree|du|diff|which|sed -n|awk|sort|uniq|cut|find|git (status|diff|log|show|branch|rev-parse|ls-files))\b/;
const TEST_CMD = /^((npm|pnpm|yarn) (ci|test|run (test|lint|build|check))|npx (vitest|jest|eslint|tsc|vite build)|node --test|node [\w./-]*test[\w./-]*\.m?js|pytest|python3? -m (pytest|unittest)|cargo (test|check|build)|go (test|vet|build))\b/;
const RISKY = /[>`]|\$\(|\b(rm|mv|cp|chmod|chown|curl|wget|nc|ssh|scp|sudo|su|dd|mkfs|kill|pkill|npm (i|install|add)|pip install|apt|git (push|clone|reset|remote|config|filter-branch|update-ref))\b|\s--?(force|hard)\b|-exec\b|-delete\b/;
// 本地的 git（提交、切分支、拉最新的）：和改文件一样算「改东西」；推上去不在这里（Codex 也没有钥匙）
const LOCAL_GIT = /^git (add|commit|switch|checkout|stash|restore|fetch|pull|merge|rebase --abort|merge --abort)\b/;
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
    if (policy.autoAll) return "accept"; // 放手让它做（她打开的）：项目里面、不删不装不联网的，都不问
    const parts = body.split(/\s*(?:&&|\|\||;|\|)\s*/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    const okPart = s => (policy.autoRead && SAFE_CMD.test(s)) || (policy.autoTest && TEST_CMD.test(s)) || (policy.autoEdit && LOCAL_GIT.test(s)) || /^(cd [\w./-]+|true|:)$/.test(s);
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

// 每个新任务都告诉 Codex 的几句：用中文；有浏览器可以截图检查；只能上 OpenAI
const BASE_INSTRUCTIONS = [
  "用中文回复。",
  "这台机器上有一个没有界面的浏览器：Playwright + Chromium 已经全局装好（在 node 里直接 require('playwright') 或 import 'playwright'），带中文字体。改了网页、要看界面对不对时，可以写个小脚本：起一个本地服务（比如 npx vite --port 5199 或 node 的 http 模块），用 chromium.launch() 打开，按手机尺寸（390×844）截图存到 /tmp，再用看图工具看截图。",
  "做好的图片（贴纸、效果图之类）要给她看：复制一份到项目里的 .qisuo-outputs/<当前工作间任务编号>/ 下面（png/jpg/webp/gif），这一轮结束会自动显示在她的页面上；别只说文件路径，她看不到。",
  "她发来的视频（录屏）：浏览器解不了 iPhone 的 H.264 / HEVC，用 ffmpeg 拆成截图再看，比如 ffmpeg -i 视频 -vf fps=1,scale=480:-1 /tmp/frame-%02d.png（长的就把 fps 调低），拆完用看图工具看。",
  "网络：只能连 OpenAI，再加上她放行的几个网站（一般有 GitHub 和 npm）；别的连不上，需要的话先说明，让她决定要不要放行。",
  `「${GIT_PROJECT}」项目是 GitHub 上 ${GIT_REPO} 的代码，动手前先 git pull、读根目录的 AGENTS.md（大家的施工说明）和 docs/worklog.md 最上面几条（cc 和你都在改这个仓库），做完在日志最上面记一条。你可以在本地提交（git commit），但推不上去：推上线要她在工作间里点「推上线」。`,
].join("\n");

// ---------- GitHub：看还没推上去的、她点了再推 ----------
// git 以 codex 用户跑（文件是它的）；推的时候钥匙只在这一次的环境里，用完就没了。
// 关掉仓库里可能写进去的钩子，地址写死成 GitHub 上那一个仓库。
function git(dir, args, extraEnv = {}, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const c = spawn("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], {
      uid: UID, gid: UID, cwd: dir, timeout,
      env: { PATH: process.env.PATH, HOME: path.dirname(CODEX_HOME), HTTPS_PROXY: process.env.HTTPS_PROXY || "", LANG: "C.UTF-8", GIT_TERMINAL_PROMPT: "0", ...GIT_ID, ...extraEnv },
    });
    let out = "", err = "";
    c.stdout.on("data", d => (out += d));
    c.stderr.on("data", d => (err += d));
    c.on("error", reject);
    c.on("close", code => (code ? reject(new Error((err || out).trim().slice(-600) || `git 退出码 ${code}`)) : resolve(out)));
  });
}
const repoUrl = () => `https://github.com/${GIT_REPO}.git`;
const hasToken = () => { try { return !!fs.readFileSync(GIT_TOKEN_FILE, "utf8").trim(); } catch { return false; } };
async function gitState(name) {
  const dir = path.join(WORK, name);
  if (!fs.existsSync(path.join(dir, ".git"))) return { repo: GIT_REPO, cloned: false, canPush: hasToken() };
  await git(dir, ["fetch", "-q", repoUrl(), GIT_BRANCH]); // 公开仓库，拉不用钥匙
  const branch = (await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const ahead = (await git(dir, ["log", "--format=%h%x09%s", "FETCH_HEAD..HEAD"])).split("\n").filter(Boolean).map(l => { const [sha, ...r] = l.split("\t"); return { sha, subject: r.join("\t") }; });
  const behind = Number((await git(dir, ["rev-list", "--count", "HEAD..FETCH_HEAD"])).trim()) || 0;
  const dirty = (await git(dir, ["status", "--porcelain"])).split("\n").filter(Boolean).map(l => l.slice(3));
  return { repo: GIT_REPO, branch: GIT_BRANCH, cloned: true, head: branch, ahead, behind, dirty, canPush: hasToken() };
}
async function gitPush(name) {
  const dir = path.join(WORK, name);
  const token = fs.existsSync(GIT_TOKEN_FILE) ? fs.readFileSync(GIT_TOKEN_FILE, "utf8").trim() : "";
  if (!token) throw new Error("服务器上还没放 GitHub 钥匙（重新运行一次安装那一行，按提示放）");
  const before = await gitState(name);
  if (!before.ahead.length) throw new Error("没有要推的提交");
  if (before.behind) throw new Error(`GitHub 上有 ${before.behind} 个新提交这里还没有，先让 Codex 拉一下最新的（git pull）再推`);
  const helper = `!f() { test "$1" = get && echo username=x-access-token && echo "password=$QS_GH"; }; f`;
  await git(dir, ["-c", "credential.helper=", "-c", `credential.https://github.com.helper=${helper}`, "push", "-q", repoUrl(), `HEAD:refs/heads/${GIT_BRANCH}`], { QS_GH: token });
  emit("qisuo/git/pushed", { project: name, commits: before.ahead });
  return { ok: true, pushed: before.ahead };
}

// 拉最新的：只在干净的时候拉；本地有提交就合并，合不上就原样退回去
async function gitPull(name) {
  const dir = path.join(WORK, name);
  if (Object.values(threads).some(t => t.project === name && t.turnId)) throw new Error("Codex 正在这个项目里干活，等它做完再拉");
  const before = await gitState(name);
  if (!before.cloned) throw new Error("这里还没有栖所的代码");
  if (!before.behind) return { ok: true, pulled: 0 };
  if (before.dirty.length) throw new Error(`还有 ${before.dirty.length} 个文件改了没提交，先让 Codex 提交了再拉`);
  if (!before.ahead.length) await git(dir, ["merge", "--ff-only", "-q", "FETCH_HEAD"]);
  else {
    try { await git(dir, ["merge", "--no-edit", "-q", "FETCH_HEAD"]); }
    catch { await git(dir, ["merge", "--abort"]).catch(() => {}); throw new Error("和这里没推上去的提交有冲突，没动它：让 Codex 来拉（git pull）并解决冲突"); }
  }
  emit("qisuo/git/pulled", { project: name, count: before.behind });
  return { ok: true, pulled: before.behind };
}

// ---------- HTTP ----------
const sameKey = k => { const a = Buffer.from(String(k || "")), b = Buffer.from(KEY); return a.length === b.length && timingSafeEqual(a, b); };
const json = (res, code, v) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(v)); };
async function body(req) { const data = await readLimited(req, 1024 * 1024); return data.length ? JSON.parse(data) : {}; }
const projectName = s => String(s || "").trim().replace(/[^\w一-龥.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 60);
const listProjects = () => { try { return fs.readdirSync(WORK, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith(".")).map(d => d.name); } catch { return []; } };
const pendingList = () => [...approvals].map(([key, a]) => ({ key, method: a.method, ts: a.ts, threadId: a.params.threadId, command: a.params.command, cwd: a.params.cwd, reason: a.params.reason, grantRoot: a.params.grantRoot }));

// 附件留在自有服务器；随机目录隔离文件名，Codex 只能读，浏览器访问仍经过两层鉴权。
const FILE_MAX = 20 * 1024 * 1024;
const FILE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", webm: "video/webm", pdf: "application/pdf", txt: "text/plain", md: "text/plain", csv: "text/csv", json: "application/json", zip: "application/zip" };
async function readLimited(req, max) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > max) throw new Error("请求体超过大小限制"); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function fileMeta(t, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("附件编号不合法");
  const meta = readJSON(path.join(DATA, "attachments", t.id, `${id}.json`), null);
  if (!meta) throw new Error("附件不存在或不属于这个任务");
  safeOriginal(meta.path);
  return meta;
}
async function attachmentRoute(req, res, url, match, sourceTask) {
  const t = sourceTask || threads[match[1]];
  if (!t) return json(res, 404, { error: { message: "没有这个任务" } });
  if (req.method === "GET" && !match[2]) return json(res, 200, { attachments: listAttachments(t) });
  if (req.method === "GET" && match[2]) {
    const meta = fileMeta(t, match[2]);
    res.writeHead(200, { "Content-Type": meta.type, "Content-Length": meta.size, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": `${!url.searchParams.has("download") && /^(image|video)\//.test(meta.type) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(meta.name)}` });
    return fs.createReadStream(null, { fd:openOriginal(meta.path), autoClose:true }).on("error", () => res.destroy()).pipe(res);
  }
  if (req.method !== "POST" || match[2]) return json(res, 405, { error: { message: "请求方法不支持" } });
  const name = String(url.searchParams.get("name") || "").normalize("NFC").replace(/[\/\\\x00-\x1f\x7f]/g, "_").replace(/^\.+/, "_").slice(0, 120);
  const ext = name.split(".").pop().toLowerCase();
  const type = Object.hasOwn(FILE_TYPES, ext) ? FILE_TYPES[ext] : null;
  const claimed = String(req.headers["content-type"] || "").split(";")[0];
  if (!type || (claimed && claimed !== type && claimed !== "application/octet-stream" && !(ext === "md" && claimed === "text/markdown"))) throw new Error("不支持这个文件类型，或扩展名和 MIME 不一致");
  const data = await readLimited(req, FILE_MAX);
  if (!data.length) throw new Error("附件不能为空");
  const hex = data.subarray(0, 12).toString("hex"), ascii = data.subarray(0, 12).toString("ascii");
  const valid = { png: hex.startsWith("89504e470d0a1a0a"), jpg: hex.startsWith("ffd8ff"), jpeg: hex.startsWith("ffd8ff"), gif: /^GIF8[79]a/.test(ascii), webp: ascii.startsWith("RIFF") && ascii.slice(8) === "WEBP", mp4: ascii.slice(4, 8) === "ftyp", webm: hex.startsWith("1a45dfa3"), pdf: ascii.startsWith("%PDF-"), zip: hex.startsWith("504b0304") };
  if (valid[ext] === false || (["txt", "md", "csv", "json"].includes(ext) && data.includes(0))) throw new Error("文件内容与类型不一致");
  if (ext === "json") JSON.parse(data.toString("utf8"));
  const id = randomUUID();
  const root = path.join(WORK, ".qisuo-attachments");
  if (fs.existsSync(root) && (fs.lstatSync(root).isSymbolicLink() || fs.statSync(root).uid !== 0)) throw new Error("附件目录不安全");
  // 这个目录由安装脚本建好（归 root）；连接程序没有越权写的本事，自己建不了
  if (!fs.existsSync(root)) throw new Error("附件文件夹还没建好：在服务器上重新运行一次栖所服务器的安装那一行");
  const scope = path.join(root, "tasks", t.id);
  const dir = path.join(scope, id);
  const file = path.join(dir, name);
  protectedDir(dir, anchored => fs.writeFileSync(path.join(anchored,name), data, { flag:"wx", mode:0o644 }));
  const meta = { id, name, type, size: data.length, path: file, purpose: String(url.searchParams.get("purpose") || "").slice(0, 2000), createdAt: Date.now(), notification: "pending", notificationRevision: randomUUID() };
  const metadataDir = path.join(DATA, "attachments", t.id);
  fs.mkdirSync(metadataDir, { recursive: true, mode: 0o700 });
  writeJSON(path.join(metadataDir, `${id}.json`), meta);
  return json(res, 200, meta);
}

// 原件目录全部归 bridge 管；任何读取/链接前逐层拒绝符号链接，Codex 仅有读取权限。
function protectedDir(dir, run = () => {}, create = true) {
  const root = path.join(WORK, ".qisuo-attachments");
  const relative = path.relative(root, dir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("目录不安全");
  const handles = [];
  const open = file => {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    handles.push(fd);
    const st = fs.fstatSync(fd);
    if (st.uid !== 0 || (st.mode & 0o022)) throw new Error("目录不安全");
    return `/proc/self/fd/${fd}`;
  };
  try {
    let anchored = open(root);
    for (const part of relative.split(path.sep).filter(Boolean)) {
      const child = path.join(anchored, part);
      if (create && !fs.existsSync(child)) fs.mkdirSync(child, { mode:0o755 });
      anchored = open(child);
    }
    return run(anchored);
  } catch (e) {
    if (["ELOOP","ENOTDIR"].includes(e.code)) throw new Error("文件目录不安全");
    throw e;
  } finally { for (const fd of handles.reverse()) fs.closeSync(fd); }
}
function openOriginal(file) {
  return protectedDir(path.dirname(file), anchored => {
    const leaf = path.join(anchored,path.basename(file));
    if (fs.lstatSync(leaf).isSymbolicLink()) throw new Error("文件目录不安全");
    const fd = fs.openSync(leaf, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.uid !== 0 || (st.mode & 0o022)) { fs.closeSync(fd); throw new Error("文件不安全"); }
    return fd;
  }, false);
}
function safeOriginal(file) { fs.closeSync(openOriginal(file)); }
function linkOriginal(source, target) {
  // 两边的父目录描述符固定住，目录被改名也不会跟到别处。
  protectedDir(path.dirname(source), from => {
    safeOriginal(source);
    protectedDir(path.dirname(target), to => {
      const original = path.join(from,path.basename(source)), destination = path.join(to,path.basename(target));
      try { fs.linkSync(original,destination); }
      catch (e) {
        if (e.code !== "EEXIST") throw e;
        // 链接已完成而元数据落盘失败时可以重试；不同文件和符号链接绝不覆盖。
        const a = fs.lstatSync(original), b = fs.lstatSync(destination);
        if (!a.isFile() || !b.isFile() || a.dev !== b.dev || a.ino !== b.ino) throw new Error("目标已存在且不是同一原件");
      }
    });
  }, false);
}
function listAttachments(t) {
  const dir = path.join(DATA, "attachments", t.id);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).map(n => fileMeta(t, n.slice(0, -5)));
}
function materialDir(project) {
  if (!listProjects().includes(project) || projectName(project) !== project) throw new Error("没有这个项目");
  const dir = path.join(DATA, "materials", project);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
function materialMeta(project, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("素材编号不合法");
  const meta = readJSON(path.join(materialDir(project), id + ".json"), null);
  if (!meta) throw new Error("素材不存在或不属于这个项目");
  safeOriginal(meta.path);
  return meta;
}
function saveMaterial(project, a, taskId) {
  const dir = materialDir(project);
  const existing = readJSON(path.join(dir, a.id + ".json"), null);
  if (existing) {
    safeOriginal(existing.path);
    // 她再次主动保存这个任务附件时，恢复收件箱入口；不迁移原件。
    if (existing.deletedAt) { delete existing.deletedAt; writeJSON(path.join(dir, a.id + ".json"), existing); }
    if (taskId) {
      existing.tasks = [...new Set([...(existing.tasks || []),taskId])];
      if (a.notification === "delivered") {
        existing.usedTasks = [...new Set([...(existing.usedTasks || []),taskId])];
        if (existing.status !== "archived") existing.status = "used";
      }
      writeJSON(path.join(dir, a.id + ".json"),existing);
    }
    return existing;
  }
  safeOriginal(a.path);
  // 链接原件，不移动它；任务与收件箱始终能读到同一份字节。
  const dest = path.join(WORK, ".qisuo-attachments", "projects", project, "inbox", a.id);
  protectedDir(dest);
  const file = path.join(dest, path.basename(a.path));
  linkOriginal(a.path, file);
  const meta = { ...a, path: file, projectPath: path.relative(path.join(WORK,project), file), originalPath: a.path, originalName: a.name, project, status: taskId && a.notification === "delivered" ? "used" : "pending", tasks: taskId ? [taskId] : [], usedTasks: taskId && a.notification === "delivered" ? [taskId] : [], sourceTask: taskId || null };
  writeJSON(path.join(dir, a.id + ".json"), meta);
  return meta;
}
async function materialRoute(req, res, url, project, id, action) {
  const dir = materialDir(project);
  if (!id && req.method === "GET") return json(res, 200, { materials: fs.readdirSync(dir).filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).map(n => materialMeta(project, n.slice(0,-5))).filter(a => !a.deletedAt) });
  if (!id && req.method === "POST") {
    // 复用同一上传校验；专用来源槽位不创建 Codex 线程。
    const slot = { id: "materials-" + project, project };
    let uploaded;
    await attachmentRoute(req, { writeHead() {}, end(value) { uploaded = JSON.parse(value); } }, url, [null, slot.id], slot);
    return json(res, 200, saveMaterial(project, uploaded));
  }
  // 先读完请求体，再读取当前元数据，避免慢请求覆盖期间发生的归档/使用记录。
  const b = req.method === "POST" ? await body(req) : {};
  const a = materialMeta(project, id);
  if (req.method === "GET" && !action) {
    res.writeHead(200, { "Content-Type": a.type, "Content-Length": a.size, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": `${!url.searchParams.has("download") && /^image\//.test(a.type) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.name)}` });
    return fs.createReadStream(null, { fd:openOriginal(a.path), autoClose:true }).on("error", () => res.destroy()).pipe(res);
  }
  if (req.method !== "POST") throw new Error("请求方法不支持");
  if (action === "delete") {
    // 只移出本项目收件箱，历史派单和素材库的原件路径永久保留。
    a.deletedAt = new Date().toISOString();
  } else if (a.deletedAt) {
    throw new Error("素材已从收件箱删除，请刷新列表");
  } else if (action === "rename") {
    const name = String(b.name || "").normalize("NFC");
    if (!name || name.length > 120 || /[\/\\\x00-\x1f\x7f]/.test(name) || name.startsWith(".") || path.extname(name).toLowerCase() !== path.extname(a.originalName).toLowerCase()) throw new Error("名称不合法，需保留原扩展名");
    a.name = name; // 显示名可改，原件路径永久稳定。
  } else if (action === "archive") {
    const library = path.join(WORK, ".qisuo-attachments", "projects", project, "library", a.id);
    protectedDir(library);
    const target = path.join(library, path.basename(a.path));
    if (!a.libraryPath) linkOriginal(a.path, target);
    a.libraryPath = target;
    a.libraryProjectPath = path.relative(path.join(WORK,project),target);
    a.status = "archived";
  } else if (action === "attach") {
    const t = threads[b.taskId];
    if (!t || t.project !== project || t.status === "archived") throw new Error("请选择同项目的有效任务");
    const metadataDir = path.join(DATA, "attachments", t.id);
    fs.mkdirSync(metadataDir, { recursive:true, mode:0o700 });
    const attached = { ...a, purpose: String(b.purpose || a.purpose || "").slice(0,2000), materialId: a.id, notification:"pending" };
    const old = readJSON(path.join(metadataDir, a.id + ".json"), null);
    const linked = { ...(old || attached), purpose: attached.purpose, materialId:a.id, notification:"pending", notificationRevision:randomUUID() };
    writeJSON(path.join(metadataDir, a.id + ".json"), linked);
    // 先登记挂接关系，通知失败也必须纳入清理时的引用检查；不冒充已使用。
    a.tasks = [...new Set([...(a.tasks || []),t.id])];
    writeJSON(path.join(dir, a.id + ".json"),a);
    return json(res, 200, linked);
  } else throw new Error("不支持这个素材操作");
  writeJSON(path.join(dir, id + ".json"), a);
  return json(res, 200, a);
}
function attachmentsDelivered(t, attachments, text = "") {
  // 派单直接给收件箱路径也记录来源；只匹配本项目已登记的原件。
  const dir = path.join(DATA, "materials", t.project);
  if (text && fs.existsSync(dir)) for (const name of fs.readdirSync(dir).filter(n => /^[a-f0-9-]{36}\.json$/.test(n))) {
    const m = readJSON(path.join(dir,name), null);
    if (m && [m.path,m.libraryPath,m.projectPath,m.libraryProjectPath].filter(Boolean).some(p => text.includes(p))) {
      m.tasks = [...new Set([...(m.tasks || []),t.id])];
      m.usedTasks = [...new Set([...(m.usedTasks || []),t.id])];
      if (m.status !== "archived") m.status = "used";
      writeJSON(path.join(dir,name),m);
    }
  }
  for (const a of attachments) {
    const current = fileMeta(t,a.id);
    a.notification = "delivered";
    // 旧 RPC 晚返回时不能覆盖另一设备新挂接的用途/待通知状态。
    if (current.notificationRevision === a.notificationRevision) {
      writeJSON(path.join(DATA, "attachments", t.id, a.id + ".json"), { ...current, notification:"delivered" });
    }
    const f = path.join(DATA, "materials", t.project, (a.materialId || a.id) + ".json");
    const m = readJSON(f, null);
    if (m) { m.tasks = [...new Set([...(m.tasks || []), t.id])]; m.usedTasks = [...new Set([...(m.usedTasks || []),t.id])]; if (m.status !== "archived") m.status = "used"; writeJSON(f,m); }
  }
}

async function route(req, res, url) {
  const p = url.pathname;
  const groups = p.match(/^\/projects\/([^/]+)\/material-groups$/);
  if (groups) {
    const project = decodeURIComponent(groups[1]), dir = materialDir(project);
    const file = path.join(dir, "groups.json");
    if (req.method === "GET") return json(res, 200, { groups:readJSON(file, []) });
    if (req.method !== "POST") throw new Error("请求方法不支持");
    const b = await body(req), current = readJSON(file, []);
    if (b.action === "create") {
      const name = String(b.name || "").trim().normalize("NFC");
      if (!name || name.length > 120) throw new Error("名称需为 1–120 字");
      current.push({ id:randomUUID(), name, files:[] });
    } else {
      const group = current.find(g => g.id === b.id);
      if (!group) throw new Error("文件夹不存在，请刷新");
      if (b.action === "rename") {
        const name = String(b.name || "").trim().normalize("NFC");
        if (!name || name.length > 120) throw new Error("名称需为 1–120 字");
        group.name = name;
      } else if (b.action === "append") {
        if (!Array.isArray(b.files) || b.files.length > 500) throw new Error("文件列表不合法");
        for (const id of b.files) {
          const a = materialMeta(project, id);
          if (a.deletedAt) throw new Error("素材已删除");
        }
        for (const g of current) g.files = g.files.filter(id => !b.files.includes(id));
        group.files = [...new Set([...group.files, ...b.files])];
      } else if (b.action === "delete") {
        // 删除仅作用于此组引用的素材，保留原字节、历史任务及素材库。
        for (const id of group.files) {
          const a = materialMeta(project, id);
          a.deletedAt ||= new Date().toISOString();
          writeJSON(path.join(dir, id + ".json"), a);
        }
        current.splice(current.indexOf(group), 1);
      } else throw new Error("不支持的文件夹操作");
    }
    writeJSON(file, current);
    return json(res, 200, { groups:current });
  }
  const materials = p.match(/^\/projects\/([^/]+)\/materials(?:\/([a-f0-9-]{36})(?:\/(rename|archive|attach|delete))?)?$/);
  if (materials) return materialRoute(req, res, url, decodeURIComponent(materials[1]), materials[2], materials[3]);
  const save = p.match(/^\/threads\/([\w-]+)\/attachments\/([a-f0-9-]{36})\/material$/);
  if (save && req.method === "POST") {
    const t = threads[save[1]];
    if (!t) throw new Error("没有这个任务");
    return json(res, 200, saveMaterial(t.project, fileMeta(t, save[2]), t.id));
  }
  const attachment = p.match(/^\/threads\/([\w-]+)\/attachments(?:\/([a-f0-9-]{36}))?$/);
  if (attachment) return attachmentRoute(req, res, url, attachment);
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
    if (req.method === "POST") { const b = await body(req); for (const k of ["autoRead", "autoTest", "autoEdit", "autoAll"]) if (typeof b[k] === "boolean") policy[k] = b[k]; writeJSON(POLICY, policy); }
    return json(res, 200, policy);
  }
  if (p === "/projects") {
    if (req.method === "POST") {
      const name = projectName((await body(req)).name);
      if (!name) return json(res, 400, { error: { message: "项目名不能为空" } });
      // 以 codex 用户建（这个程序虽然是 root，但去掉了全部特权，动不了 codex 的文件夹）
      const r = spawnSync("mkdir", ["-p", path.join(WORK, name)], { uid: UID, gid: UID, encoding: "utf8" });
      if (r.status) return json(res, 500, { error: { message: `建不了：${r.stderr}` } });
      return json(res,200,{name,projects:listProjects()});
    }
    return json(res, 200, { projects: listProjects() });
  }
  if (p === "/projects/git" || p === "/projects/push" || p === "/projects/pull") {
    const name = projectName((await body(req)).name);
    if (name !== GIT_PROJECT || !listProjects().includes(name)) return json(res, 404, { error: { message: `只有「${GIT_PROJECT}」这个项目连着 GitHub` } });
    try { return json(res, 200, p === "/projects/git" ? await gitState(name) : p === "/projects/push" ? await gitPush(name) : await gitPull(name)); }
    catch (e) { return json(res, 500, { error: { message: e.message } }); }
  }
  if (p === "/projects/delete") {
    const name = projectName((await body(req)).name);
    if (!name || !listProjects().includes(name)) return json(res, 404, { error: { message: "没有这个项目" } });
    // 栖所自己的代码：不让删（她点错删过一次，没推上去的改动全没了）
    if (name === GIT_PROJECT) return json(res, 403, { error: { message: `「${GIT_PROJECT}」是栖所自己的代码，不能删` } });
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
    const instructions = String(b.instructions || "").slice(0, 20_000);
    const r = await call("thread/start", startOpts({ project, instructions, model: b.model }));
    const t = { id: r.thread.id, project, title: String(b.title || "").slice(0, 60) || project, createdAt: Date.now(), updatedAt: Date.now(), status: "open", model: r.thread.model, ...(instructions ? { instructions } : {}) };
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
    if (what === "resume") { await call("thread/resume", { threadId: cid(t), ...RUN_OPTS }); return json(res, 200, { ok: true }); }
    if (what === "archive") { t.status = "archived"; saveThreads(); await call("thread/archive", { threadId: cid(t) }).catch(() => {}); return json(res, 200, { ok: true }); }
    if (what === "interrupt") {
      if (!t.turnId) return json(res, 200, { ok: true, idle: true });
      await call("turn/interrupt", { threadId: cid(t), turnId: t.turnId });
      return json(res, 200, { ok: true });
    }
    if (what === "send") {
      const b = await body(req);
      const text = String(b.text || "").trim();
      if (!Array.isArray(b.attachments || []) || (b.attachments || []).length > 4) throw new Error("每条消息最多 4 个附件");
      const attachments = (b.attachments || []).map(file => fileMeta(t, file));
      if (!text && !attachments.length) return json(res, 400, { error: { message: "说点什么" } });
      // 文件都写上只读路径，Codex 用工具去读；图片另外按 localImage 直接给它看（不认这种输入就退回只给路径）
      const description = attachments.map(a => `附件：${a.name} (${a.type}, ${a.size} 字节)，本地只读路径：${a.path}；用途：${a.purpose || "未填写"}`).join("\n");
      const plain = [{ type: "text", text: [text, description, `当前工作间任务编号：${t.id}。界面验收运行 node scripts/ui-preview.cjs --task ${t.id} --route /settings（按任务更换路由），产物将在本轮结束自动收取；不部署生产环境。`].filter(Boolean).join("\n\n") }];
      const images = attachments.filter(a => /^image\/(png|jpeg|gif|webp)$/.test(a.type)).map(a => ({ type: "localImage", path: a.path }));
      const withImages = async run => { if (images.length) { try { return await run([...plain, ...images]); } catch { /* 退回只给路径 */ } } return run(plain); };
      const delivered = steer => { attachmentsDelivered(t, attachments, text); emit("qisuo/user/message", { threadId: id, text, attachments, steer }); };
      if (t.turnId) {
        try { const r = await withImages(input => call("turn/steer", { threadId: cid(t), input, expectedTurnId: t.turnId })); delivered(true); return json(res, 200, { turnId: r.turnId, steer: true, notified: true }); }
        catch (e) { if (!NOT_FOUND.test(e.message)) throw e; delete t.turnId; } // 那一轮已经不在了：当新的一轮开始
      }
      const r = await withThread(t, threadId => withImages(input => call("turn/start", { threadId, input })));
      delivered(false);
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
  res.write(": 连上了\n\n"); // 马上回一句：不然要等到第一条消息或 20 秒的心跳，栖所才知道连上了
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
