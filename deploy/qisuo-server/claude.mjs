// 小螃蟹（cc）住进栖所：用这台服务器上装好的 Claude Code，走你自己的 Claude 订阅额度。
//
// 只做「聊天线」：工具全关、换成栖所给的人设和记忆，每句话尽量轻（施工的工作台以后再接）。
// 栖所照常按 OpenAI 的 /chat/completions 格式发过来（和别的 API 一样），这里转给 `claude -p`，
// 再按 /chat/completions 的样子流回去。每次都是新的一次（不留会话）：前面聊过的由栖所自己带着（摘要、最近的消息）。
//
// 登录：在服务器终端里跑安装那一行，按提示登录一次（claude setup-token），token 只存在服务器的 settings 里，
//       通过环境变量 CLAUDE_CODE_OAUTH_TOKEN 给到这里，不经过浏览器。
//
// 工作室（/studio/v1/...）：和聊天一样，只是多了「看」的工具（Read、Glob、Grep），
// 当前文件夹换成栖所仓库的一份拷贝（公开仓库，从 GitHub 拉，只读，不能改、不能跑命令）。
// 小螃蟹在这里翻施工日志、提交记录，自己用 [记忆:…] 写进自己的记忆库（栖所那边照常收）。
//
// 路径（都在 /p/<口令>/claude 下面）：
//   GET  /status                        装好了没、登录了没
//   GET  /v1/models                     能选的模型
//   POST /v1/chat/completions           聊天
//   POST /studio/v1/chat/completions    工作室
import { spawn, execFile } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

const BIN = process.env.CLAUDE_BIN || "claude";
const WORK = join(tmpdir(), "qisuo-crab"); // 空文件夹：不读任何项目、任何 CLAUDE.md
// sonnet / opus / haiku 是简称，永远指向那一档最新的；后面几个是写死版本的，想固定用哪一版就选它
const MODELS = [
  { id: "sonnet", name: "Sonnet（最新的，平时聊天，省额度）" },
  { id: "opus", name: "Opus（最新的，更聪明，费额度）" },
  { id: "haiku", name: "Haiku（最新的，最省）" },
  { id: "claude-opus-5-5", name: "Opus 5.5" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", name: "Haiku 5.5" },
];

// ---------- 工作室：栖所仓库的拷贝 ----------
const REPO_URL = process.env.CRAB_REPO || "https://github.com/zhouyesyes/Dwellingplace.git";
const STUDIO = join(process.env.DATA_DIR || tmpdir(), "crab-studio");
const REPO = join(STUDIO, "Dwellingplace");
const git = (args, cwd) => new Promise((resolve, reject) => execFile("git", args, { cwd, timeout: 120000 }, (err, out) => (err ? reject(err) : resolve(String(out)))));
let pulledAt = 0;
// 最多十分钟拉一次最新的；拉不下来就用手上那份
async function refreshRepo() {
  if (Date.now() - pulledAt < 10 * 60 * 1000 && existsSync(REPO)) return;
  mkdirSync(STUDIO, { recursive: true });
  try {
    if (!existsSync(join(REPO, ".git"))) await git(["clone", "--filter=blob:none", REPO_URL, REPO], STUDIO);
    else await git(["pull", "--ff-only", "-q"], REPO);
    // 提交记录写成一个文件，不用给它跑命令的权限
    const log = await git(["log", "--date=short", "--format=%h %ad %an：%s"], REPO);
    mkdirSync(join(REPO, ".qisuo"), { recursive: true });
    writeFileSync(join(REPO, ".qisuo", "commits.txt"), log);
    pulledAt = Date.now();
  } catch (e) {
    if (!existsSync(REPO)) throw Object.assign(new Error(`工作室拿不到栖所的仓库：${e.message}（服务器上要重新跑一次安装那一行）`), { status: 502 });
  }
}
// 工作室连上仓库没：最新一条提交、什么时候拉的
async function studioStatus() {
  try {
    await refreshRepo();
    const head = (await git(["log", "-1", "--date=short", "--format=%h %ad %s"], REPO)).trim();
    const count = Number((await git(["rev-list", "--count", "HEAD"], REPO)).trim()) || 0;
    return { repo: true, head, count, pulledAt };
  } catch (e) {
    return { repo: false, error: e.message };
  }
}
const STUDIO_NOTE = `# 你现在在工作室
当前文件夹是栖所仓库的一份拷贝（只读）。你可以用 Read / Glob / Grep 自己翻：
- docs/worklog.md：大家一起施工的日志（最上面是最新的），你以前在别的窗口做过的事大多记在这里
- CLAUDE.md、AGENTS.md：给你和大家看的施工说明
- .qisuo/commits.txt：全部提交记录（一行一个，最新的在最上面）
- src/、deploy/：代码
这里不能改文件、不能跑命令。
写记忆的办法：在回复里另起一行写 [记忆:类别|标题|内容]（类别从 喜好、约定、心事、时刻、读写、日常 里选一个），栖所会把它收进你自己的记忆库，一行一张。
读到值得记住的就这样写；一次别写太多（十张以内），别和已有的记忆重复，内容写成以后的你一看就懂的一两句话。`;

// ---------- 对话本：私人仓库 qisuo-memory ----------
// 小螃蟹在栖所、Claude Code、云端说的话按时间写进同一本（book/log.jsonl，一行一条），两边都读这一本。
// 钥匙（只能碰这个仓库）只在服务器上，通过环境变量 CRAB_MEMORY_TOKEN 给到这里，不经过浏览器。
const MEM_TOKEN = process.env.CRAB_MEMORY_TOKEN || "";
const MEM_REPO = process.env.CRAB_MEMORY_REPO || "zhouyesyes/qisuo-memory";
const MEM_URL = process.env.CRAB_MEMORY_URL || `https://github.com/${MEM_REPO}.git`; // 测试时可以换成本地仓库
const MEM_DIR = join(process.env.DATA_DIR || tmpdir(), "crab-memory");
const LOG = "book/log.jsonl";
// 钥匙每次放在命令里带上，不写进仓库的设置文件
const auth = () => ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from("x-access-token:" + MEM_TOKEN).toString("base64")}`];
const mgit = args => git([...auth(), ...args], MEM_DIR);
let memQueue = Promise.resolve();
const serial = fn => (memQueue = memQueue.then(fn, fn)); // 一次只做一件，免得两边同时写打架
let memPulledAt = 0;
async function memPull(force = false) {
  if (!MEM_TOKEN) throw Object.assign(new Error("服务器上还没放对话本的钥匙：再运行一次安装那一行"), { status: 409 });
  if (!existsSync(join(MEM_DIR, ".git"))) {
    mkdirSync(dirname(MEM_DIR), { recursive: true });
    rmSync(MEM_DIR, { recursive: true, force: true });
    await git([...auth(), "clone", "-q", MEM_URL, MEM_DIR], dirname(MEM_DIR));
    await mgit(["config", "user.name", "qisuo"]);
    await mgit(["config", "user.email", "qisuo@localhost"]);
  } else if (force || Date.now() - memPulledAt > 60_000) {
    await mgit(["pull", "--rebase", "-q"]);
  }
  memPulledAt = Date.now();
}
function readLog() {
  try { return readFileSync(join(MEM_DIR, LOG), "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}
const writeIfChanged = (rel, text) => {
  const f = join(MEM_DIR, rel);
  let old = null; try { old = readFileSync(f, "utf8"); } catch { /* 还没有 */ }
  if (old === text) return false;
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, text);
  return true;
};
// 栖所写进来：新的几条（按 id 去重）+ 摘要 + 记忆卡片
const bookPush = body => serial(async () => {
  await memPull(true);
  const have = new Set(readLog().map(e => e.id));
  const add = (body.entries || []).filter(e => e?.id && e.text && !have.has(e.id))
    .map(e => JSON.stringify({ id: String(e.id), ts: Number(e.ts) || Date.now(), where: String(e.where || "qisuo"), from: e.from === "me" ? "me" : "crab", ...(e.kind ? { kind: String(e.kind) } : {}), text: String(e.text).slice(0, 20000) }));
  let changed = false;
  if (add.length) {
    mkdirSync(join(MEM_DIR, "book"), { recursive: true });
    writeFileSync(join(MEM_DIR, LOG), add.join("\n") + "\n", { flag: "a" });
    changed = true;
  }
  changed = writeIfChanged(".gitattributes", "book/*.jsonl merge=union\n") || changed; // 两边同时加行：合在一起，不算冲突
  if (typeof body.summary === "string") changed = writeIfChanged("summary.md", `# 前情摘要（栖所整理的，比 book/log.jsonl 里的原话更早）\n\n${body.summary.trim()}\n`) || changed;
  if (typeof body.memories === "string") changed = writeIfChanged("memories.md", `# 小螃蟹的记忆卡片（栖所同步过来的）\n\n${body.memories.trim()}\n`) || changed;
  if (!changed) return { added: 0 };
  await mgit(["add", "-A"]);
  await mgit(["commit", "-q", "-m", `栖所：${add.length ? `${add.length} 条新消息` : "更新摘要和记忆"}`]);
  try { await mgit(["push", "-q"]); }
  catch { await mgit(["pull", "--rebase", "-q"]); await mgit(["push", "-q"]); } // 别处刚推过：先合上再推
  return { added: add.length };
});
// 栖所拿回去：别处（Claude Code、云端、醒来）写进来的、比 since 新的
const bookPull = since => serial(async () => {
  await memPull();
  return { entries: readLog().filter(e => e.where !== "qisuo" && (Number(e.ts) || 0) > since) };
});

// ---------- 额度：每次回复 Claude Code 都会带上「5 小时」「每周」用了多少，记下最近一次 ----------
const LIMITS_FILE = join(process.env.DATA_DIR || tmpdir(), "claude-limits.json");
let limits = null;
try { limits = JSON.parse(readFileSync(LIMITS_FILE, "utf8")); } catch { /* 还没聊过 */ }
// 换成栖所认得的样子（和 ChatGPT 会员额度一样：used_percent + window_minutes + resets_at）
function saveLimits(info) {
  const w = info?.unifiedWindows || {};
  const pick = (o, mins) => o && o.utilization != null ? { used_percent: Math.round(o.utilization * 100), window_minutes: mins, resets_at: o.resetsAt } : null;
  const ev = { primary: pick(w.five_hour, 300), secondary: pick(w.seven_day, 7 * 1440) };
  if (!ev.primary && !ev.secondary) return;
  limits = { events: { claude: JSON.stringify(ev) }, at: Date.now() };
  try { writeFileSync(LIMITS_FILE, JSON.stringify(limits)); } catch { /* 写不了就只记在内存里 */ }
}

const loggedIn = () => !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
function version() {
  return new Promise(resolve => execFile(BIN, ["--version"], { timeout: 15000 }, (err, out) => resolve(err ? null : String(out).trim())));
}
async function status() {
  const v = await version();
  return { installed: !!v, version: v, loggedIn: loggedIn(), connected: loggedIn(), limits };
}

// ---------- 聊天 ----------
const textOf = c => (typeof c === "string" ? c : (c || []).filter(x => x.type === "text").map(x => x.text || "").join("\n"));
// 栖所发来的一串消息 → 系统提示（人设、记忆，后面接着前面聊过的） + 最新这一句（可以带图）
function split(messages) {
  const sys = [], history = [];
  let last = null;
  const list = messages || [];
  const lastUser = list.map(m => m.role).lastIndexOf("user");
  list.forEach((m, i) => {
    if (m.role === "system" || m.role === "developer") return sys.push(textOf(m.content));
    if (i === lastUser) return (last = m);
    const t = textOf(m.content).trim();
    if (t) history.push(`【${m.role === "assistant" ? "你" : "对方"}】${t}`);
  });
  if (history.length) sys.push(`# 前面聊过的（按时间，最后一句是对方刚说的，在下面）\n${history.join("\n\n")}`);
  const content = [];
  const parts = typeof last?.content === "string" ? [{ type: "text", text: last.content }] : last?.content || [];
  for (const p of parts) {
    if (p.type === "text" && p.text) content.push({ type: "text", text: p.text });
    if (p.type === "image_url") {
      const m = String(p.image_url?.url || p.image_url || "").match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
      if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
    }
  }
  if (!content.length) content.push({ type: "text", text: "（继续）" });
  return { system: sys.join("\n\n"), content };
}

const ERRS = [
  [/not logged in|invalid api key|authenticat|bearer token|oauth|401/i, "小螃蟹还没登录：在服务器终端里再运行一次安装那一行，按提示登录 Claude"],
  [/usage limit|rate limit|429|limit reached/i, "Claude 订阅这阵子的额度用完了（和 Claude 网页、Claude Code 共用），过一会儿再试"],
];
const LOOK = { Read: "在读", Glob: "在找文件", Grep: "在搜" };
// 认得的换成人话，后面带上原话（不认得的时候好查）
const errMsg = t => { const nice = ERRS.find(([re]) => re.test(t || ""))?.[1]; return nice ? `${nice}（原话：${String(t).slice(0, 160)}）` : t || "出错了"; };

async function chat(body, res, CORS, studio = false) {
  const { system, content } = split(body.messages);
  if (studio) await refreshRepo();
  mkdirSync(WORK, { recursive: true });
  const sysFile = join(WORK, `sys-${randomUUID()}.txt`); // 系统提示可能很长，放文件里（不放进仓库那个文件夹）
  writeFileSync(sysFile, [system || "你是小螃蟹。", studio ? STUDIO_NOTE : ""].filter(Boolean).join("\n\n"), { mode: 0o600 });
  const model = MODELS.some(m => m.id === body.model) || /^claude-/.test(body.model || "") ? body.model : "sonnet";
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // 有 API Key 就会改成按量计费：这里只用订阅
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.CLAUDE_CODE_MAX_RETRIES ??= "2"; // 登录失效时别重试十次、让你干等几分钟
  const child = spawn(BIN, [
    "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--system-prompt-file", sysFile, "--strict-mcp-config", "--no-session-persistence", "--model", model,
    // 聊天：工具全关；工作室：只能看
    ...(studio ? ["--tools", "Read,Glob,Grep", "--allowedTools", "Read", "Glob", "Grep"] : ["--tools", ""]),
  ], { cwd: studio ? REPO : WORK, env, stdio: ["pipe", "pipe", "pipe"] });
  const cleanup = () => rmSync(sysFile, { force: true });
  res.on("close", () => { if (!res.writableEnded) child.kill("SIGTERM"); }); // 栖所那边停了，这边也停
  child.stdin.end(JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n");

  const stream = body.stream !== false;
  const id = `chatcmpl-${randomUUID()}`;
  const chunk = delta => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
  if (stream) res.writeHead(200, { ...CORS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
  let text = "", thinking = "", usage = null, failed = null, streamed = false, stderr = "";
  child.stderr.on("data", d => { stderr = (stderr + d).slice(-2000); });
  let buf = "";
  const onLine = line => {
    let ev; try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === "stream_event") {
      const d = ev.event?.delta;
      if (ev.event?.type === "content_block_delta" && d?.type === "text_delta") { text += d.text; streamed = true; if (stream) res.write(chunk({ content: d.text })); }
      else if (ev.event?.type === "content_block_delta" && d?.type === "thinking_delta") { thinking += d.thinking; if (stream) { if (d.thinking) res.write(chunk({ reasoning: d.thinking })); } }
    } else if (ev.type === "assistant" && stream) {
      // 工作室里翻了什么，放在「想法」里给你看一眼
      for (const b of ev.message?.content || []) if (b.type === "tool_use") res.write(chunk({ reasoning: `\n（${LOOK[b.name] || b.name} ${b.input?.file_path?.replace(REPO + "/", "") || b.input?.pattern || ""}）\n` }));
      if (!streamed && ev.message?.model !== "<synthetic>") { const t = textOf(ev.message?.content); if (t) { text += t; res.write(chunk({ content: t })); } }
    } else if (ev.type === "assistant" && !streamed && ev.message?.model !== "<synthetic>") { // 没有一个字一个字的，就整段给（<synthetic> 是出错时它自己编的一句，不当成回复）
      const t = textOf(ev.message?.content);
      if (t) { text += t; if (stream) res.write(chunk({ content: t })); }
    } else if (ev.type === "rate_limit_event") {
      saveLimits(ev.rate_limit_info);
    } else if (ev.type === "result") {
      usage = ev.usage || null;
      if (ev.is_error || ev.subtype !== "success") failed = errMsg(ev.result || ev.subtype);
    }
  };
  child.stdout.on("data", d => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onLine(line); }
  });
  const code = await new Promise(resolve => { child.on("close", resolve); child.on("error", e => { failed = e.code === "ENOENT" ? "服务器上还没装 Claude Code：再运行一次安装那一行" : e.message; resolve(-1); }); });
  if (buf.trim()) onLine(buf.trim());
  cleanup();
  if (!failed && code !== 0 && !text) failed = errMsg(stderr.trim().split("\n").pop());
  const u = usage ? {
    prompt_tokens: (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
    completion_tokens: usage.output_tokens || 0,
    total_tokens: (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.output_tokens || 0),
    prompt_tokens_details: { cached_tokens: usage.cache_read_input_tokens || 0 },
  } : undefined;
  if (stream) {
    if (failed && !text) res.write(`data: ${JSON.stringify({ error: { message: failed } })}\n\n`);
    else res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], ...(u ? { usage: u } : {}) })}\n\n`);
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  if (failed && !text) { res.writeHead(502, { ...CORS, "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { message: failed } })); }
  res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify({ id, object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content: text, ...(thinking ? { reasoning: thinking } : {}) }, finish_reason: "stop" }], ...(u ? { usage: u } : {}) }));
}

// ---------- 路由 ----------
export async function handleClaude(req, res, rest, CORS) {
  const send = (code, obj) => { res.writeHead(code, { ...CORS, "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  const body = async () => { const cs = []; for await (const c of req) cs.push(c); try { return JSON.parse(Buffer.concat(cs).toString() || "{}"); } catch { return {}; } };
  try {
    if (rest === "/status" && req.method === "GET") return send(200, await status());
    if (rest === "/v1/models" && req.method === "GET") return send(200, { object: "list", data: MODELS.map(m => ({ ...m, object: "model", context_window: 200000 })) });
    if (rest === "/v1/chat/completions" && req.method === "POST") return await chat(await body(), res, CORS);
    if (rest === "/book/status" && req.method === "GET") return send(200, { token: !!MEM_TOKEN, repo: MEM_REPO, ...(MEM_TOKEN ? await serial(async () => { await memPull(); return { count: readLog().length }; }).catch(e => ({ error: e.message })) : {}) });
    if (rest === "/book/push" && req.method === "POST") return send(200, await bookPush(await body()));
    if (rest.startsWith("/book/pull") && req.method === "GET") return send(200, await bookPull(Number(new URL(req.url, "http://x").searchParams.get("since")) || 0));
    if (rest === "/studio/status" && req.method === "GET") return send(200, await studioStatus());
    if (rest === "/studio/v1/models" && req.method === "GET") return send(200, { object: "list", data: MODELS.map(m => ({ ...m, object: "model", context_window: 200000 })) });
    if (rest === "/studio/v1/chat/completions" && req.method === "POST") return await chat(await body(), res, CORS, true);
    return send(404, { error: { message: "没有这个地址" } });
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch { /* 已经断了 */ } return; }
    return send(e.status || 400, { error: { message: e.message } });
  }
}
