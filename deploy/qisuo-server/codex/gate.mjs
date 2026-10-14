// 门卫：Codex 的容器自己上不了网，所有出门的请求都先到这里。只放行名单上的地址（OpenAI），别的一律拦下。
// 只认 HTTPS 的 CONNECT（不解密、看不到内容，只看要去哪个网站）；普通 HTTP 一律拒绝。
// 名单：OpenAI 的几个域名 + 环境变量 GATE_ALLOW 里加的（逗号隔开，比如 registry.npmjs.org）
// 被拦下的记在 /gate/denied.log，以后可以在工作间里看「他想去哪些地方」再决定放不放
import http from "node:http";
import net from "node:net";
import { appendFileSync, mkdirSync } from "node:fs";

const PORT = Number(process.env.GATE_PORT) || 3128;
const BASE = ["openai.com", "chatgpt.com", "oaistatic.com", "oaiusercontent.com"];
const allow = [...BASE, ...String(process.env.GATE_ALLOW || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)];
const ok = host => allow.some(d => host === d || host.endsWith("." + d));
const LOG = process.env.GATE_LOG || "/gate/denied.log";
try { mkdirSync("/gate", { recursive: true }); } catch { /* 挂进来的目录已经有了 */ }
const deny = (host, why) => { try { appendFileSync(LOG, `${new Date().toISOString()} ${host} ${why}\n`); } catch { /* 写不了就算了 */ } };

const server = http.createServer((req, res) => {
  deny(req.headers.host || req.url, "plain-http");
  res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("门卫：只放行 HTTPS 去 OpenAI\n");
});
server.on("connect", (req, sock, head) => {
  const [host, port = "443"] = String(req.url).toLowerCase().split(":");
  if (!ok(host) || port !== "443") {
    deny(`${host}:${port}`, "not-allowed");
    sock.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  const up = net.connect(Number(port), host, () => {
    sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head?.length) up.write(head);
    up.pipe(sock);
    sock.pipe(up);
  });
  const close = () => { up.destroy(); sock.destroy(); };
  up.on("error", close);
  sock.on("error", close);
  up.setTimeout(10 * 60_000, close);
});
server.listen(PORT, () => console.log(`门卫在 ${PORT}，放行：${allow.join("、")}`));
