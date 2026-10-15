// 栖所自己的服务器：放网页（不用再从 GitHub Pages 打开），顺便转发 API（国内不开梯子也能用 OpenRouter）。
// 只用 Node 自带的东西，不装别的包。
//
//   /                    栖所网页（dist 里构建好的文件）
//   /health              看看活着没
//   /p/<口令>/<去哪>/…   转发 API：<去哪> 见下面的 TARGETS，比如
//                        https://app.你的域名/p/口令/openrouter/v1  ≈  https://openrouter.ai/api/v1
import http from "node:http";
import { createReadStream, statSync, writeFileSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { handleChatGPT } from "./chatgpt.mjs";
import { handleSync } from "./sync.mjs";
import { handlePreview } from "./preview.mjs";

const PORT = Number(process.env.PORT) || 8080;
const DIST = process.env.DIST || "/app/dist";
const TOKEN = process.env.PROXY_TOKEN || "";

// 只转发到这几家，不是谁都能拿来当跳板
const TARGETS = {
  openrouter: "https://openrouter.ai/api",
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  deepseek: "https://api.deepseek.com",
  gemini: "https://generativelanguage.googleapis.com",
};
// 他的浏览器（chrome-mcp-bridge，在 docker 内部网络里，自己没有口令，只能经过这里的口令转发）
if (process.env.CHROME_URL) TARGETS.chrome = process.env.CHROME_URL;
if (process.env.CHROME_CTL_URL) TARGETS.chromectl = process.env.CHROME_CTL_URL; // 遥控：你登录网站用
// 工作间（Codex，在单独的内部网络里）：带上它的钥匙转过去
const CODEX_URL = process.env.CODEX_URL || "";
const CODEX_KEY = process.env.CODEX_KEY || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "*",
  "Access-Control-Max-Age": "86400",
};
// 浏览器、Cloudflare 带来的这些头不往外传
const DROP_REQ = /^(host|origin|referer|connection|content-length|cookie|accept-encoding|x-forwarded-.*|x-real-ip|cf-.*|cdn-loop|true-client-ip|sec-.*)$/i;
const DROP_RES = /^(content-encoding|content-length|transfer-encoding|connection|keep-alive|access-control-.*|set-cookie)$/i;

const sameToken = t => {
  if (!TOKEN || !t) return false;
  const a = Buffer.from(t), b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
};

async function proxy(req, res, target, rest, search, extra = {}) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!DROP_REQ.test(k)) headers[k] = v;
  Object.assign(headers, extra);
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (target === CODEX_URL && size > 20 * 1024 * 1024) {
      res.writeHead(413, { ...CORS, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "请求不能超过 20 MB" } }));
      return;
    }
    chunks.push(c);
  }
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const ctrl = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ctrl.abort(); }); // 栖所那边停了，这边也停
  let up;
  try {
    up = await fetch(target + rest + search, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body, signal: ctrl.signal });
  } catch (e) {
    res.writeHead(502, { ...CORS, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: { message: `服务器连不上 ${new URL(target).host}：${e.message}` } }));
  }
  const out = { ...CORS };
  up.headers.forEach((v, k) => { if (!DROP_RES.test(k)) out[k] = v; });
  out["Cache-Control"] = "no-store";
  out["X-Accel-Buffering"] = "no";
  res.writeHead(up.status, out);
  res.flushHeaders(); // 先把头送出去（实时过程靠这个才「连上」）
  if (!up.body) return res.end();
  try {
    for await (const chunk of up.body) res.write(chunk); // 流式回复一块一块往回送
  } catch { /* 中途断了 */ }
  res.end();
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".gif": "image/gif", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};

function serveFile(req, res, pathname) {
  let rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, rel);
  if (!file.startsWith(DIST)) file = join(DIST, "index.html");
  let st;
  try { st = statSync(file); if (st.isDirectory()) { file = join(file, "index.html"); st = statSync(file); } }
  catch { file = join(DIST, "index.html"); try { st = statSync(file); } catch { res.writeHead(404); return res.end("还没有网页文件"); } }
  const ext = extname(file);
  // 带哈希的资源可以一直缓存；index.html、sw.js、manifest 每次都要新的，更新才能马上生效
  const longCache = /\/assets\//.test(file) && ext !== ".html";
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": st.size,
    "Cache-Control": longCache ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/health") {
      res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, proxy: !!TOKEN, targets: Object.keys(TARGETS) }));
    }
    const m = url.pathname.match(/^\/p\/([^/]+)\/([a-z]+)(\/.*)?$/);
    if (m) {
      if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
      if (!sameToken(m[1])) { res.writeHead(401, { ...CORS, "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { message: "转发口令不对" } })); }
      if (m[2] === "sync") return await handleSync(req, res, m[3] || "", url.searchParams, CORS); // 多设备同步
      if (m[2] === "preview") return await handlePreview(req, res, m[3] || "", url.searchParams, CORS); // 网址卡片
      // 清空他的浏览器（退出所有登录、换账号）：在共享的资料目录里放个记号，浏览器那边看到就清空重开
      if (m[2] === "chrome" && m[3] === "/__reset" && req.method === "POST") {
        const dir = process.env.CHROME_PROFILE;
        if (!dir) { res.writeHead(404, { ...CORS, "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { message: "服务器没装浏览器" } })); }
        writeFileSync(join(dir, ".reset"), String(Date.now()));
        res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (m[2] === "chatgpt") return await handleChatGPT(req, res, m[3] || "", CORS); // ChatGPT 会员额度（登录信息只存在服务器上）
      if (m[2] === "codex") {
        if (!CODEX_URL) { res.writeHead(404, { ...CORS, "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { message: "服务器没装工作间" } })); }
        return await proxy(req, res, CODEX_URL, m[3] || "/status", url.search, { "x-bridge-key": CODEX_KEY });
      }
      const target = TARGETS[m[2]];
      if (!target) { res.writeHead(404, { ...CORS, "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { message: `不认识「${m[2]}」，只能转发：${Object.keys(TARGETS).join("、")}` } })); }
      return await proxy(req, res, target, m[3] || "", url.search);
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    serveFile(req, res, url.pathname);
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("出错了：" + e.message);
  }
}).listen(PORT, () => console.log(`栖所服务器在 ${PORT} 端口`));
