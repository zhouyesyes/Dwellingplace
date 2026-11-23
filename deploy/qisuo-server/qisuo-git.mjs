#!/usr/bin/env node
// Codex 沙箱里的受控 Git 客户端。父进程用当前路径确认仓库是否属于这条聊天。
import { createConnection } from "node:net";
let [command, ...rest] = process.argv.slice(2);
const allowed = new Set(["status", "diff", "log", "commit", "pull", "push"]);
if (command === "--version" || command === "version") { console.log("git version 2.39.5 (栖所受控通道)"); process.exit(0); }
if (command === "add") { console.log("改动将在 commit 时统一加入"); process.exit(0); }
// 兼容模型熟悉的标准写法：git commit -m "说明"。其余参数由父进程固定，不让模型扩权。
if (command === "commit") {
  const at = rest.findIndex(x => x === "-m" || x === "--message");
  rest = at >= 0 ? [rest[at + 1] || ""] : [rest.join(" ")];
}
if (!allowed.has(command)) {
  console.error("此仓库支持 git status、diff、log、add、commit -m、pull、push");
  process.exit(2);
}
const response = await new Promise(resolve => {
  const socket = createConnection(process.env.QISUO_GIT_SOCKET || "");
  let data = "";
  // 只写请求，不先关连接：父进程要等 Git 做完后从同一条连接送回结果。
  socket.on("connect", () => socket.write(JSON.stringify({ secret: process.env.QISUO_GIT_SECRET || "", cwd: process.cwd(), command, message: rest.join(" ") })));
  socket.on("data", chunk => { data += chunk; });
  socket.on("error", error => resolve({ ok: false, text: error.message }));
  socket.on("close", () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: false, text: data || "Git 通道没有回应" }); } });
  socket.setTimeout(190_000, () => socket.destroy(new Error("Git 操作等待超时")));
});
(response.ok ? console.log : console.error)(String(response.text || "").trim());
if (!response.ok) process.exit(1);
