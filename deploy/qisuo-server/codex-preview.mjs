// 截图进程仅接收静态构建副本，通过 Unix socket 拿任务，在无外部网络的容器里打开页面。
import { spawn } from "node:child_process";
import { createServer as httpServer } from "node:http";
import { createServer, createConnection } from "node:net";
import { constants, openSync, fstatSync, closeSync, readFileSync, readdirSync, lstatSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, realpathSync, chmodSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.env.CODEX_PREVIEW_ROOT || "/codex-previews";
const SOCKET = join(ROOT, "preview.sock");
const mime = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".wasm": "application/wasm",
};

function safeFile(path, max) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > max) throw new Error("预览文件不可读或太大");
    return readFileSync(fd);
  } finally { closeSync(fd); }
}

function stage(root, source, destination) {
  let size = 0, count = 0;
  function visit(from, to) {
    if (realpathSync(from) !== from || !(from === source || from.startsWith(root + sep))) throw new Error("预览目录超出工作区");
    mkdirSync(to, { mode: 0o700 });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const input = join(from, entry.name), output = join(to, entry.name);
      if (++count > 6000) throw new Error("预览文件太多");
      if (entry.isDirectory()) visit(input, output);
      else if (entry.isFile()) {
        const data = safeFile(input, 32_000_000 - size);
        size += data.length;
        writeFileSync(output, data, { mode: 0o600 });
      }
    }
  }
  visit(source, destination);
}

function request(input) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(SOCKET);
    let result = "";
    socket.setTimeout(45000, () => socket.destroy(new Error("截图服务等待超时")));
    socket.once("error", reject);
    socket.once("connect", () => socket.write(JSON.stringify(input) + "\n"));
    socket.on("data", chunk => {
      result += chunk;
      if (result.length > 6_000_000) socket.destroy(new Error("截图结果太大"));
    });
    socket.once("end", () => {
      try {
        const reply = JSON.parse(result);
        if (reply.error) return reject(new Error(reply.error));
        resolve(reply.images);
      } catch (error) { reject(error); }
    });
  });
}

export async function previewFromWorkspace(cwd, manifest) {
  let input;
  try { input = JSON.parse(safeFile(manifest, 8000)); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  if (typeof input.dir !== "string" || !input.dir.trim()) throw new Error("请指定静态构建目录");
  const source = resolve(cwd, input.dir);
  if (!source.startsWith(cwd + sep) || relative(cwd, source).split(sep).some(part => part.startsWith("."))
    || !lstatSync(source).isDirectory() || realpathSync(source) !== source) throw new Error("静态构建目录必须在当前仓库里");
  safeFile(join(source, "index.html"), 2_000_000);
  const job = mkdtempSync(join(ROOT, "shot-"));
  try {
    stage(cwd, source, join(job, "site"));
    return await request({ id: basename(job), page: input.page, theme: input.theme });
  } finally { rmSync(job, { recursive: true, force: true }); }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function photograph(url, scratch, scheme) {
  const profile = join(scratch, scheme);
  const child = spawn(process.env.CODEX_CHROMIUM || "/usr/bin/chromium", [
    "--headless", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking",
    "--no-first-run", "--disable-extensions", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "about:blank",
  ], {
    env: { ...process.env, HOME: scratch, XDG_CONFIG_HOME: scratch, XDG_CACHE_HOME: scratch },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "", exit;
  const closed = new Promise(resolve => child.on("close", () => { exit = true; resolve(); }));
  child.on("error", error => { stderr = error.message; exit = true; });
  child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-400); });
  let ws;
  const stop = setTimeout(() => { ws?.close(); child.kill("SIGKILL"); }, 16000);
  try {
    let port;
    for (let i = 0; i < 50 && !exit; i++) {
      try { port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]); } catch { /* Chromium 还没启动 */ }
      if (port) break;
      await sleep(100);
    }
    if (!port) throw new Error("Chromium 启动失败：" + stderr);
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) }).then(r => r.json());
    const target = targets.find(item => item.type === "page");
    if (!target) throw new Error("Chromium 没有打开页面");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    let id = 0;
    ws.addEventListener("message", event => {
      const reply = JSON.parse(event.data);
      const call = pending.get(reply.id);
      if (!call) return;
      pending.delete(reply.id);
      if (reply.error) call.reject(new Error(reply.error.message)); else call.resolve(reply.result);
    });
    ws.addEventListener("close", () => {
      for (const call of pending.values()) call.reject(new Error("Chromium 调试连接已关闭"));
      pending.clear();
    });
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("Chromium 调试连接失败")), { once: true });
      ws.addEventListener("close", () => reject(new Error("Chromium 调试连接已关闭")), { once: true });
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    const loaded = new Promise(resolve => {
      const event = message => {
        if (JSON.parse(message.data).method !== "Page.loadEventFired") return;
        ws.removeEventListener("message", event);
        resolve();
      };
      ws.addEventListener("message", event);
    });
    const nav = await send("Page.navigate", { url });
    if (nav.errorText) throw new Error("打不开预览页面：" + nav.errorText);
    await Promise.race([loaded, sleep(2500)]);
    const readiness = await send("Runtime.evaluate", {
      expression: `(async () => {
        const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
        const deadline = performance.now() + 6500;
        while (performance.now() < deadline) {
          // Vue 的容器挂载前是空的，静态设计稿则直接检查正文。
          const content = document.querySelector("#app") || document.body;
          if (document.readyState !== "loading" &&
              content?.innerText.trim() && document.fonts.status === "loaded") {
            await nextFrame();
            await nextFrame();
            return true;
          }
          await nextFrame();
        }
        return false;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (readiness.result?.value !== true) throw new Error("预览页面没有渲染出正文，未生成截图");
    const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    return Buffer.from(result.data, "base64");
  } finally {
    clearTimeout(stop);
    ws?.close();
    if (!exit) child.kill("SIGKILL");
    await closed;
  }
}

async function capture({ id, page = "/", theme = "light" }) {
  if (typeof id !== "string" || !/^shot-[a-zA-Z0-9]{6}$/.test(id)) throw new Error("截图任务编号不对");
  if (typeof page !== "string" || !page.startsWith("/") || page.startsWith("//") || page.includes("\\") || page.length > 2000) throw new Error("截图页面必须是站内路径");
  if (!["light", "dark", "both"].includes(theme)) throw new Error("截图主题应为 light、dark 或 both");
  const site = join(ROOT, id, "site");
  if (realpathSync(site) !== site) throw new Error("截图文件目录无效");
  const scratch = mkdtempSync(join(tmpdir(), "qisuo-preview-"));
  let scheme = "light";
  const server = httpServer((req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      let file = resolve(site, "." + path);
      if (!(file === site || file.startsWith(site + sep))) throw new Error();
      if (file === site || !extname(file)) file = join(site, "index.html");
      if (realpathSync(file) !== file) throw new Error();
      let body = safeFile(file, 32_000_000);
      if (extname(file) === ".html") {
        const style = `<script>localStorage.setItem("qisuo-theme", "${scheme}");document.documentElement.dataset.theme="${scheme}";</script>`;
        body = Buffer.from(body.toString().replace(/<head(?:\s[^>]*)?>/i, head => head + style));
      }
      res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("Not found"); }
  });
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const url = new URL(page, `http://127.0.0.1:${server.address().port}`);
    if (url.hostname !== "127.0.0.1") throw new Error("截图页面必须是站内路径");
    const images = [];
    for (scheme of theme === "both" ? ["light", "dark"] : [theme]) {
      const name = `preview-${scheme}.png`;
      const png = await photograph(url.href, scratch, scheme);
      if (png.length > 2_000_000 || png.length < 24 || !png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
        || png.readUInt32BE(16) !== 390 || png.readUInt32BE(20) !== 844) throw new Error("截图尺寸不正确");
      images.push({ name, data: png.toString("base64") });
    }
    return images;
  } finally {
    server.closeAllConnections();
    server.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

function serve() {
  rmSync(SOCKET, { force: true });
  let busy = false;
  const server = createServer(socket => {
    let buffer = "";
    socket.on("error", () => socket.destroy());
    socket.setTimeout(45000, () => socket.destroy());
    socket.on("data", chunk => {
      buffer += chunk;
      if (buffer.length > 4096) return socket.destroy();
      if (!buffer.includes("\n")) return;
      socket.removeAllListeners("data");
      if (busy) return socket.end(JSON.stringify({ error: "截图服务正在处理另一张图片" }));
      busy = true;
      Promise.resolve().then(() => capture(JSON.parse(buffer)))
        .then(images => socket.end(JSON.stringify({ images })))
        .catch(error => socket.end(JSON.stringify({ error: String(error.message).slice(0, 450) })))
        .finally(() => { busy = false; });
    });
  });
  server.listen(SOCKET, () => chmodSync(SOCKET, 0o600));
}

if (process.env.QISUO_CODEX_PREVIEW === "1") {
  if (process.argv.includes("--check")) {
    const job = mkdtempSync(join(ROOT, "shot-"));
    try {
      const site = join(job, "site");
      mkdirSync(site);
      const fixture = `<html><head><style>[data-theme=dark] { background: #161b22; color: white }</style></head>
        <body><div id="app"></div><script>
          addEventListener("load", () => setTimeout(() => {
            document.getElementById("app").textContent = "Chromium";
          }, 350));
        </script></body></html>`;
      writeFileSync(join(site, "preview.html"), fixture);
      const images = await request({ id: basename(job), page: "/preview.html", theme: "both" });
      if (images?.length !== 2 || images[0].data === images[1].data) throw new Error("Chromium 截图自检没有生成不同主题的图片");
      console.log("Chromium 浅色和深色截图自检通过");
    } finally { rmSync(job, { recursive: true, force: true }); }
  } else serve();
}
