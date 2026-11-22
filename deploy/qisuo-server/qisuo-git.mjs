// Codex 沙箱里的受控 Git 客户端。真正的 Git 和钥匙在父进程；这里只能操作当前仓库。
import { createConnection } from "node:net";
const [command, ...rest] = process.argv.slice(2);
const allowed = new Set(["status", "diff", "log", "commit", "pull", "push"]);
if (!allowed.has(command) || (command !== "commit" && rest.length)) {
  console.error("用法：node /app/qisuo-git.mjs status|diff|log|pull|push，或 commit \"提交说明\"");
  process.exit(2);
}
const response = await new Promise(resolve => {
  const socket = createConnection(process.env.QISUO_GIT_SOCKET || "");
  let data = "";
  // 只写请求，不先关连接：父进程要等 Git 做完后从同一条连接送回结果。
  socket.on("connect", () => socket.write(JSON.stringify({ secret: process.env.QISUO_GIT_SECRET || "", command, message: rest.join(" ") })));
  socket.on("data", chunk => { data += chunk; });
  socket.on("error", error => resolve({ ok: false, text: error.message }));
  socket.on("close", () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: false, text: data || "Git 通道没有回应" }); } });
  socket.setTimeout(190_000, () => socket.destroy(new Error("Git 操作等待超时")));
});
(response.ok ? console.log : console.error)(String(response.text || "").trim());
if (!response.ok) process.exit(1);
