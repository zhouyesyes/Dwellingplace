// 仓库任务专用容器，只通过共享 Unix socket 接受主服务的请求。
import { execFile, spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { Socket, createServer } from "node:net";
import { basename, join } from "node:path";

export const WORK_ROOT = "/codex-workspaces";
export const WORKER_SOCKET = "/codex-worker-ipc/codex.sock";
export const GIT_SOCKET = "/codex-worker-ipc/git/git.sock";
const REAL_GIT = process.env.QISUO_REAL_GIT || "/usr/bin/git";

// 允许执行 Codex 生成的辅助程序。登录文件与其余 CODEX_HOME 内容仍由根目录规则禁止读取。
export const workspaceArgs = [
  'default_permissions="qisuo_chat"',
  'permissions.qisuo_chat.extends=":workspace"',
  'permissions.qisuo_chat.filesystem={":root"="deny",":minimal"="read",":slash_tmp"="deny","/app/qisuo-git.mjs"="read","/app/codex-bin"="read","/codex-home/tmp/arg0-linux"="read","/codex-worker-ipc"="deny","/codex-worker-ipc/git"="write"}',
  'shell_environment_policy.ignore_default_excludes=true',
  'shell_environment_policy.include_only=["PATH","HOME","TMPDIR","QISUO_GIT_SOCKET","QISUO_GIT_SECRET"]',
  'features.network_proxy=true',
  'permissions.qisuo_chat.network.enabled=true',
  'permissions.qisuo_chat.network.allow_upstream_proxy=false',
  'permissions.qisuo_chat.network.domains={"registry.npmjs.org"="allow","github.com"="allow","api.github.com"="allow","raw.githubusercontent.com"="allow","127.0.0.1"="allow","localhost"="allow"}',
].flatMap(value => ["-c", value]);

export const commonArgs = [
  "--disable", "apps", "--disable", "plugins", "--disable", "multi_agent",
  "-c", 'web_search="disabled"', "-c", "mcp_servers={}",
];

// Git 元数据不交给模型的文件沙箱直接写。这个小桥只替当前打开的仓库执行几种必要操作，
// GitHub 钥匙留在父进程里，不放进 App Server 的环境，也不会出现在命令或日志中。
export function gitBridge(cwd, socketPath, token) {
  const secret = randomUUID();
  rmSync(socketPath, { force: true });
  const allowed = new Set(["status", "diff", "log", "commit", "pull", "push"]);
  const run = args => new Promise(resolve => execFile(REAL_GIT, args, {
    cwd, timeout: 180_000, maxBuffer: 4_000_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }, (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, text: String(stdout || "") + String(stderr || "") })));
  const auth = token ? ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from("x-access-token:" + token).toString("base64")}`] : [];
  const server = createServer(socket => socket.once("data", async chunk => {
    let body; try { body = JSON.parse(chunk.toString()); } catch { body = {}; }
    const reply = (ok, text) => socket.end(JSON.stringify({ ok, text }));
    if (body.secret !== secret || !allowed.has(body.command)) return reply(false, "Git 操作不允许");
    let args;
    if (body.command === "status") args = ["status", "--short", "--branch"];
    else if (body.command === "diff") args = ["diff", "--", "."];
    else if (body.command === "log") args = ["log", "--oneline", "-10"];
    else if (body.command === "commit") {
      const message = String(body.message || "").trim();
      if (!message || message.length > 200) return reply(false, "提交说明不能为空，最多 200 字");
      const added = await run(["add", "-A"]);
      if (added.code) return reply(false, added.text);
      args = ["-c", "user.name=栖所 Codex", "-c", "user.email=codex@qisuo.local", "commit", "-m", message];
    } else {
      if (!token) return reply(false, "服务器还没有 GitHub 写入钥匙，请重新运行安装并按提示粘贴");
      args = body.command === "pull" ? [...auth, "pull", "--rebase", "origin"] : [...auth, "push", "origin", "HEAD"];
    }
    const result = await run(args);
    reply(!result.code, result.text || (result.code ? "Git 操作失败" : "完成"));
  }));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      try { chmodSync(socketPath, 0o600); resolve({ server, secret, socketPath }); }
      catch (error) { server.close(); reject(error); }
    });
  });
}

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
      // Git 通道是异步启动的；这期间先暂停读取，让后续的 App Server 初始化消息留在 Socket 缓冲区。
      // 否则手机/服务器稍快一点时，initialize 会落在「还没 pipe」的空档里而丢失。
      socket.pause();
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
      let bridge;
      // Unix Socket 路径上限很短，不能放进「对话/仓库/截图目录」的长路径里。
      // 一次只跑一个仓库任务，所以使用 IPC 目录下的固定短路径。
      gitBridge(cwd, process.env.QISUO_GIT_SOCKET || GIT_SOCKET, process.env.CODEX_GITHUB_TOKEN || "").then(opened => {
        bridge = opened;
        child = spawn(binary, ["app-server", ...workspaceArgs, ...commonArgs], {
        cwd, env: { PATH: `/app/codex-bin:${process.env.PATH}`, CODEX_HOME: process.env.CODEX_HOME || "/codex-home", HOME: cwd, TMPDIR: tmp, QISUO_GIT_SOCKET: bridge.socketPath, QISUO_GIT_SECRET: bridge.secret },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-500); });
      child.stdin.on("error", () => {});
      child.on("error", error => { stderr = error.message; });
      child.on("close", (code) => {
        active = false;
        bridge.server.close();
        clearTimeout(kill);
        child = undefined;
        if (code && stderr && !socket.destroyed) socket.end(JSON.stringify({ method: "qisuo/workerError", params: { message: stderr } }) + "\n");
        else socket.end();
      });
      child.stdout.pipe(socket, { end: false });
      child.stdin.write(buffer.subarray(end + 1));
      socket.pipe(child.stdin);
      socket.resume();
      }).catch(error => { active = false; reject(`Git 通道启动失败：${error.message}`); });
    }
    socket.on("data", start);
  });
  server.listen(socketPath, () => chmodSync(socketPath, 0o600));
}

// 和网页一样走 socket，验证 App Server 能在沙箱里装载仓库指令。
export async function check(socketPath, root) {
  const scratch = mkdtempSync(join(root, "check-"));
  const workspace = join(basename(scratch), "0".repeat(64));
  const cwd = join(root, workspace);
  const shots = `qisuo-shots-${randomUUID()}`;
  // 先备好仓库，再连接。Git 初始化期间 connect 事件可能已经发生，晚挂监听会漏掉握手。
  const socket = new Socket();
  const lines = createInterface({ input: socket });
  try {
    mkdirSync(join(cwd, shots), { recursive: true });
    writeFileSync(join(cwd, "AGENTS.md"), "# 栖所执行环境自检\n");
    await new Promise((resolve, reject) => execFile(REAL_GIT, ["init", "-q", "-b", "main"], { cwd }, error => error ? reject(error) : resolve()));
    await new Promise((resolve, reject) => {
      socket.setTimeout(30000, () => reject(new Error("执行容器自检超时")));
      socket.once("error", reject);
      socket.once("close", () => reject(new Error("执行容器在自检时提前退出")));
      const send = value => socket.write(JSON.stringify(value) + "\n");
      socket.once("connect", () => {
        send({ workspace, shots });
        send({ id: 1, method: "initialize", params: { clientInfo: { name: "qisuo-check", version: "1" } } });
      });
      socket.connect(socketPath);
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
        if (reply.id === 2 && reply.result?.thread?.id) {
          // 真实进入命令沙箱，验证入口脚本、解释器、环境变量和 Git 通道都可用，不消耗模型额度。
          send({ id: 3, method: "command/exec", params: { cwd, command: ["/usr/bin/git", "status"] } });
        }
        if (reply.id === 3) {
          if (reply.result?.exitCode !== 0) return reject(new Error("沙箱 Git 自检失败：" + (reply.result?.stderr || reply.result?.stdout || JSON.stringify(reply.result))));
          resolve();
        }
      });
    });
  } finally {
    lines.close();
    socket.destroy();
    rmSync(scratch, { recursive: true, force: true });
  }
}

// 安装时真实走一遍受控 Git 通道；不碰远端，也不需要 GitHub 钥匙。
async function checkGitBridge(root) {
  const scratch = mkdtempSync(join(root, "git-check-"));
  const tmp = join(scratch, "tmp");
  mkdirSync(tmp);
  const run = (file, args, options = {}) => new Promise((resolve, reject) => execFile(file, args, options, (error, stdout, stderr) => error ? reject(new Error(String(stderr || error.message))) : resolve(String(stdout || ""))));
  let bridge;
  try {
    await run(REAL_GIT, ["init", "-q", "-b", "main"], { cwd: scratch });
    writeFileSync(join(scratch, "README.md"), "受控 Git 自检\n");
    bridge = await gitBridge(scratch, join(tmp, "git.sock"), "");
    const env = { ...process.env, PATH: `/app/codex-bin:${process.env.PATH}`, QISUO_GIT_SOCKET: bridge.socketPath, QISUO_GIT_SECRET: bridge.secret };
    await run("/usr/bin/git", ["commit", "-m", "受控 Git 自检"], { env });
    const log = await run(REAL_GIT, ["log", "-1", "--pretty=%s"], { cwd: scratch });
    if (log.trim() !== "受控 Git 自检") throw new Error("受控 Git 没有写入提交");
  } finally {
    if (bridge) await new Promise(resolve => bridge.server.close(resolve));
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.env.QISUO_CODEX_WORKER === "1") {
  const socketPath = process.env.CODEX_WORKER_SOCKET || WORKER_SOCKET;
  const root = process.env.CODEX_WORK_ROOT || WORK_ROOT;
  if (process.argv.includes("--check")) {
    await checkGitBridge(root);
    await check(socketPath, root);
    console.log("Codex 仓库会话和受控 Git 自检通过");
  } else {
    serve(socketPath, root, process.env.CODEX_BIN || "codex");
  }
}
