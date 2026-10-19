// 小螃蟹（cc）住进栖所：用这台服务器上装好的 Claude Code，走你自己的 Claude 订阅额度。
//
// 只做「聊天线」：工具全关、换成栖所给的人设和记忆，每句话尽量轻（施工的工作台以后再接）。
// 栖所照常按 OpenAI 的 /chat/completions 格式发过来（和别的 API 一样），这里转给 `claude -p`，
// 再按 /chat/completions 的样子流回去。每次都是新的一次（不留会话）：前面聊过的由栖所自己带着（摘要、最近的消息）。
//
// 登录：在服务器终端里跑安装那一行，按提示登录一次（claude setup-token），token 只存在服务器的 settings 里，
//       通过环境变量 CLAUDE_CODE_OAUTH_TOKEN 给到这里，不经过浏览器。
//
// 路径（都在 /p/<口令>/claude 下面）：
//   GET  /status                 装好了没、登录了没
//   GET  /v1/models              能选的模型
//   POST /v1/chat/completions    聊天
import { spawn, execFile } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

const BIN = process.env.CLAUDE_BIN || "claude";
const WORK = join(tmpdir(), "qisuo-crab"); // 空文件夹：不读任何项目、任何 CLAUDE.md
const MODELS = [
  { id: "sonnet", name: "Sonnet（平时聊天，省额度）" },
  { id: "opus", name: "Opus（更聪明，费额度）" },
  { id: "haiku", name: "Haiku（最省）" },
];

const loggedIn = () => !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
function version() {
  return new Promise(resolve => execFile(BIN, ["--version"], { timeout: 15000 }, (err, out) => resolve(err ? null : String(out).trim())));
}
async function status() {
  const v = await version();
  return { installed: !!v, version: v, loggedIn: loggedIn() };
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
const errMsg = t => (ERRS.find(([re]) => re.test(t || ""))?.[1]) || t || "出错了";

async function chat(body, res, CORS) {
  const { system, content } = split(body.messages);
  mkdirSync(WORK, { recursive: true });
  const sysFile = join(WORK, `sys-${randomUUID()}.txt`); // 系统提示可能很长，放文件里
  writeFileSync(sysFile, system || "你是小螃蟹。", { mode: 0o600 });
  const model = MODELS.some(m => m.id === body.model) || /^claude-/.test(body.model || "") ? body.model : "sonnet";
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // 有 API Key 就会改成按量计费：这里只用订阅
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.CLAUDE_CODE_MAX_RETRIES ??= "2"; // 登录失效时别重试十次、让你干等几分钟
  const child = spawn(BIN, [
    "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--system-prompt-file", sysFile, "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--model", model,
  ], { cwd: WORK, env, stdio: ["pipe", "pipe", "pipe"] });
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
      else if (ev.event?.type === "content_block_delta" && d?.type === "thinking_delta") { thinking += d.thinking; if (stream) res.write(chunk({ reasoning: d.thinking })); }
    } else if (ev.type === "assistant" && !streamed && ev.message?.model !== "<synthetic>") { // 没有一个字一个字的，就整段给（<synthetic> 是出错时它自己编的一句，不当成回复）
      const t = textOf(ev.message?.content);
      if (t) { text += t; if (stream) res.write(chunk({ content: t })); }
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
    return send(404, { error: { message: "没有这个地址" } });
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch { /* 已经断了 */ } return; }
    return send(e.status || 400, { error: { message: e.message } });
  }
}
