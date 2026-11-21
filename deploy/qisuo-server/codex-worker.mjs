// 仓库任务专用容器，只通过共享 Unix socket 接受主服务的请求。
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { createConnection, createServer } from "node:net";
import { basename, join } from "node:path";

export const WORK_ROOT = "/codex-workspaces";
export const WORKER_SOCKET = "/codex-worker-ipc/codex.sock";

// 允许执行 Codex 生成的辅助程序。登录文件与其余 CODEX_HOME 内容仍由根目录规则禁止读取。
export const workspaceArgs = [
  'default_permissions="qisuo_chat"',
  'permissions.qisuo_chat.extends=":workspace"',
  'permissions.qisuo_chat.filesystem={":root"="deny",":minimal"="read",":slash_tmp"="deny","/codex-home/tmp/arg0-linux"="read","/codex-worker-ipc"="deny"}',
  'features.network_proxy=true',
  'permissions.qisuo_chat.network.enabled=true',
  'permissions.qisuo_chat.network.allow_upstream_proxy=false',
  'permissions.qisuo_chat.network.domains={"registry.npmjs.org"="allow","github.com"="allow","api.github.com"="allow","raw.githubusercontent.com"="allow","127.0.0.1"="allow","localhost"="allow"}',
].flatMap(value => ["-c", value]);

export const commonArgs = [
  "--disable", "apps", "--disable", "plugins", "--disable", "multi_agent",
  "-c", 'web_search="disabled"', "-c", "mcp_servers={}",
];

function serve(socketPath, root, binary) {
  rmSync(socketPath, { force: true });
  let active = false;
  const server = createServer(socket => {
    let buffer = Buffer.alloc(0), child, kill;
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      if (!child) return;
      child.kill("SIGTERM");
      kill = setTimeout(() => child.kill("SIGKILL"), 2000);
      kill.unref();
    });
    socket.setTimeout(5000, () => socket.destroy());
    const reject = message => socket.end(JSON.stringify({ id: 1, error: { message } }) + "\n");
    function start(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf(10);
      if (end === -1 && buffer.length <= 1024) return;
      socket.off("data", start);
      if (end < 0 || end > 1024) return reject("仓库执行请求格式不对");
      let cwd, tmp;
      try {
        const { workspace, shots } = JSON.parse(buffer.subarray(0, end));
        if (typeof workspace !== "string" || !/^[a-zA-Z0-9_-]{1,100}\/[0-9a-f]{64}$/.test(workspace)
          || typeof shots !== "string" || !/^qisuo-shots-[0-9a-f-]{36}$/.test(shots)) throw new Error();
        cwd = join(root, workspace);
        tmp = join(cwd, shots);
        if (realpathSync(cwd) !== cwd || realpathSync(tmp) !== tmp) throw new Error();
      } catch { return reject("仓库执行目录无效"); }
      if (active) return reject("已有仓库任务在执行");
      active = true;
      socket.setTimeout(0);
      child = spawn(binary, ["app-server", ...workspaceArgs, ...commonArgs], {
        cwd, env: { PATH: process.env.PATH, CODEX_HOME: process.env.CODEX_HOME || "/codex-home", HOME: cwd, TMPDIR: tmp },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-500); });
      child.stdin.on("error", () => {});
      child.on("error", error => { stderr = error.message; });
      child.on("close", (code) => {
        active = false;
        clearTimeout(kill);
        child = undefined;
        if (code && stderr && !socket.destroyed) socket.end(JSON.stringify({ method: "qisuo/workerError", params: { message: stderr } }) + "\n");
        else socket.end();
      });
      child.stdout.pipe(socket, { end: false });
      child.stdin.write(buffer.subarray(end + 1));
      socket.pipe(child.stdin);
    }
    socket.on("data", start);
  });
  server.listen(socketPath, () => chmodSync(socketPath, 0o600));
}

// 和网页一样走 socket，验证 App Server 能在沙箱里装载仓库指令。
async function check(socketPath, root) {
  const scratch = mkdtempSync(join(root, "check-"));
  const workspace = join(basename(scratch), "0".repeat(64));
  const cwd = join(root, workspace);
  const shots = `qisuo-shots-${randomUUID()}`;
  const socket = createConnection(socketPath);
  const lines = createInterface({ input: socket });
  try {
    mkdirSync(join(cwd, shots), { recursive: true });
    writeFileSync(join(cwd, "AGENTS.md"), "# 栖所执行环境自检\n");
    await new Promise((resolve, reject) => {
      socket.setTimeout(30000, () => reject(new Error("执行容器自检超时")));
      socket.once("error", reject);
      socket.once("close", () => reject(new Error("执行容器在自检时提前退出")));
      const send = value => socket.write(JSON.stringify(value) + "\n");
      socket.once("connect", () => {
        send({ workspace, shots });
        send({ id: 1, method: "initialize", params: { clientInfo: { name: "qisuo-check", version: "1" } } });
      });
      lines.on("line", line => {
        let reply;
        try { reply = JSON.parse(line); } catch { return; }
        if (reply.error || reply.method === "qisuo/workerError") {
          return reject(new Error(reply.error?.message || reply.params?.message || "执行容器自检失败"));
        }
        if (reply.id === 1) {
          send({ method: "initialized" });
          send({ id: 2, method: "thread/start", params: { cwd, approvalPolicy: "never", ephemeral: true } });
        }
        if (reply.id === 2 && reply.result?.thread?.id) resolve();
      });
    });
  } finally {
    lines.close();
    socket.destroy();
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.env.QISUO_CODEX_WORKER === "1") {
  const socketPath = process.env.CODEX_WORKER_SOCKET || WORKER_SOCKET;
  const root = process.env.CODEX_WORK_ROOT || WORK_ROOT;
  if (process.argv.includes("--check")) {
    await check(socketPath, root);
    console.log("Codex 仓库会话自检通过");
  } else {
    serve(socketPath, root, process.env.CODEX_BIN || "codex");
  }
}
