// 仓库任务专用容器，只通过共享 Unix socket 接受主服务的请求。
import { spawn } from "node:child_process";
import { chmodSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

export const WORK_ROOT = "/codex-workspaces";
export const WORKER_SOCKET = "/codex-worker-ipc/codex.sock";

export const workspaceArgs = [
  'default_permissions="qisuo_chat"',
  'permissions.qisuo_chat.extends=":workspace"',
  'permissions.qisuo_chat.filesystem={":root"="deny",":minimal"="read",":slash_tmp"="deny","/codex-home"="deny","/codex-worker-ipc"="deny"}',
  'features.network_proxy=true',
  'permissions.qisuo_chat.network.enabled=true',
  'permissions.qisuo_chat.network.allow_upstream_proxy=false',
  'permissions.qisuo_chat.network.domains={"registry.npmjs.org"="allow","127.0.0.1"="allow","localhost"="allow"}',
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

if (process.env.QISUO_CODEX_WORKER === "1") {
  serve(process.env.CODEX_WORKER_SOCKET || WORKER_SOCKET, process.env.CODEX_WORK_ROOT || WORK_ROOT, process.env.CODEX_BIN || "codex");
}
