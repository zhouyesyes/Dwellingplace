import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

class DshError extends Error {}

async function run(key, prompt, send, signal) {
  const cwd = await mkdtemp(join(tmpdir(), "dsh-"));
  try {
    // ACP 预设仍指向旧的 Flash 名称，官方 API 适配器用的是支持图片的 deepseek-flash。
    const patch = join(cwd, "acp.yml");
    await writeFile(patch, "- id: acp\n  config:\n    model: deepseek-flash\n");
    signal.throwIfAborted();
    const child = spawn("dsh", ["--profile", "acp", "--patch", patch], {
      cwd, detached: true, stdio: ["pipe", "pipe", "ignore"],
      env: { PATH: process.env.PATH, HOME: cwd, TMPDIR: cwd, DSH_HOME: cwd + "/.dsh", DEEPSEEK_API_KEY: key },
    });
    const stopped = new Promise(resolve => child.once("close", resolve));
    const pending = new Map();
    let nextId = 0;
    const fail = () => {
      for (const { reject } of pending.values()) reject(new DshError("DSH 进程提前退出"));
      pending.clear();
    };
    const stop = () => {
      if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch (err) { if (err.code !== "ESRCH") throw err; }
      }
      fail();
    };
    const lines = createInterface({ input: child.stdout });
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.on("close", fail);
    signal.addEventListener("abort", stop, { once: true });
    const write = body => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...body }) + "\n");
    const call = (method, params) => new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const id = ++nextId;
      pending.set(id, { resolve, reject, method });
      write({ id, method, params });
    });
    lines.on("line", line => {
      let data;
      try { data = JSON.parse(line); } catch { return; }
      if (data.method === "session/request_permission") {
        write({ id: data.id, result: { outcome: { outcome: "cancelled" } } });
      } else if (data.method && data.id != null) {
        write({ id: data.id, error: { code: -32601, message: "Method not supported" } });
      } else if (data.method === "session/update") {
        const update = data.params?.update;
        if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
          send("text", update.content.text);
        } else if (update?.sessionUpdate === "tool_call" && update.title) {
          send("tool", update.title.slice(0, 240));
        }
      } else if (pending.has(data.id)) {
        const { resolve, reject, method } = pending.get(data.id);
        pending.delete(data.id);
        // 上游错误可能带原始请求内容，界面只显示固定文案。
        if (data.error) {
          const detail = typeof data.error.data === "string" ? data.error.data : "";
          const message = /\b(?:401|403|MISSING_CREDENTIAL)\b|authentication_error/i.test(detail)
            ? "DeepSeek 官方 API 拒绝了 DSH 的鉴权"
            : /\b402\b|insufficient balance/i.test(detail) ? "DeepSeek 官方 API 报告余额不足"
              : method === "initialize" ? "DSH 初始化失败"
                : method === "session/new" ? "DSH 无法建立会话，请检查官方 API 是否提供 deepseek-flash"
                  : "DSH 会话已建立，但生成回复失败";
          reject(new DshError(message));
        } else resolve(data.result);
      }
    });
    try {
      const init = await call("initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "qisuo", version: "1" } });
      if (!init.agentCapabilities?.promptCapabilities?.image && prompt.some(part => part.type === "image")) {
        throw new DshError("当前 DSH 模型无法接收图片，可以切到支持图片的聊天模型后重试");
      }
      const { sessionId } = await call("session/new", { cwd, mcpServers: [] });
      const result = await call("session/prompt", { sessionId, prompt });
      if (result.stopReason !== "end_turn") throw new DshError("DSH 提前结束了这一轮");
      await call("session/close", { sessionId });
    } finally {
      signal.removeEventListener("abort", stop);
      lines.close();
      stop();
      await stopped;
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

let busy = false;
const socket = process.env.DSH_SOCKET;
await rm(socket, { force: true });
http.createServer(async (req, res) => {
  const json = (status, message) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { message } }));
  };
  if (req.method !== "POST" || req.url !== "/chat") return json(404, "找不到 DSH 接口");
  const key = req.headers.authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!key) return json(401, "请先在栖所的 API 设置里填写 DeepSeek 官方密钥");
  if (busy) return json(409, "DSH 正在回复另一条消息，请等它回完");
  busy = true;
  const controller = new AbortController();
  res.once("close", () => controller.abort());
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)]);
  const send = (type, text) => {
    if (!res.destroyed) res.write(JSON.stringify({ type, text: text?.replaceAll(key, "••••") }) + "\n");
  };
  try {
    const chunks = [];
    let size = 0;
    // 发送上限与浏览器一致，避免图片附件把整台服务器的内存占满。
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > 10_000_000) { req.resume(); return json(413, "这次消息太大，请分次发送"); }
      chunks.push(chunk);
    }
    const { prompt } = JSON.parse(Buffer.concat(chunks));
    if (!Array.isArray(prompt) || !prompt.length || !prompt.every(p => p &&
      (p.type === "text" && typeof p.text === "string" ||
        p.type === "image" && typeof p.data === "string" && /^image\/(png|jpeg|gif|webp)$/.test(p.mimeType)))) {
      return json(400, "DSH 收到的消息格式不对");
    }
    res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
    send("tool", "正在启动 DSH…");
    await run(key, prompt, send, signal);
    send("done");
    res.end();
  } catch (err) {
    if (!res.headersSent) json(400, "DSH 没收到完整的消息");
    else {
      send("error", signal.aborted ? "DSH 这次运行超时" : err instanceof DshError ? err.message : "DSH 工作环境启动失败");
      res.end();
    }
  } finally {
    busy = false;
  }
}).listen(socket);
