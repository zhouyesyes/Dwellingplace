// 工作间实测：在单独的容器里，用 Codex app-server（stdio JSON-RPC）跑几个小测试，写一份报告。
// 不碰栖所的数据；报告里不写邮箱、令牌。
//
//   1. 环境：Codex 版本、内核、能不能用沙盒（bubblewrap）
//   2. 沙盒（不用登录、不花额度）：项目里能写、项目外不能写、不能联网、能不能读到项目外的文件
//   3. 登录：没登录就用设备码（屏幕上给一个网址和一串码，在手机上打开输入）
//   4. 三个小任务（会用一点 Plus 的 Codex 额度）：
//      A 只读：看看项目、说说是做什么的
//      B 修 bug：改 math.js、跑 node test.js（看命令、输出、diff、审批这些事件）
//      C 中断：让它慢慢数数，跑起来以后中断
//      每个任务前后各看一次额度
//   5. 写 /work/report.txt（贴给 cc 看）；全部事件存在 /work/logs/*.jsonl
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";

const WORK = process.env.WORK || "/work";
const HOME = process.env.HOME || "/home/codex";
const DEMO = `${WORK}/demo`;
const LOGS = `${WORK}/logs`;
fs.mkdirSync(LOGS, { recursive: true });
const report = [];
const say = s => { console.log(s); report.push(s); };
const head = s => say(`\n## ${s}`);

// ---------- 1. 环境 ----------
head("环境");
const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 60_000 }); return `${r.stdout || ""}${r.stderr || ""}`.trim(); };
say(`codex：${sh("codex", ["--version"])}`);
say(`内核：${sh("uname", ["-r"])}`);
for (const f of ["/proc/sys/kernel/unprivileged_userns_clone", "/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "/proc/sys/user/max_user_namespaces"]) {
  try { say(`${f.replace("/proc/sys/", "")} = ${fs.readFileSync(f, "utf8").trim()}`); } catch { say(`${f.replace("/proc/sys/", "")}：没有`); }
}
say(`容器安全设置：${process.env.LAB_MODE || "默认"}`);
say(`bubblewrap：${sh("sh", ["-c", "command -v bwrap && bwrap --version || echo 没装"])}`);

// ---------- 2. 沙盒（不用登录） ----------
head("沙盒（不花额度）");
const box = (profile, script) => sh("codex", ["sandbox", "-P", profile, "-C", DEMO, "--", "sh", "-c", script]).split("\n").filter(l => !/bubblewrap|WARNING|PATH aliases/.test(l)).slice(-2).join(" / ");
say(`项目里写文件（:workspace）：${box(":workspace", "echo hi > .sandbox-test && echo 能写 && rm .sandbox-test")}`);
say(`项目外写文件（:workspace）：${box(":workspace", `echo x > ${HOME}/escape.txt && echo 写出去了 || echo 挡住了`)}`);
say(`只读模式写文件（:read-only）：${box(":read-only", "echo x > ro.txt && echo 写进去了 || echo 挡住了")}`);
say(`容器本身能不能联网（Codex 自己要连 OpenAI，应该能）：${sh("sh", ["-c", "getent hosts api.openai.com >/dev/null && echo 能 || echo 不能"])}`);
say(`沙盒里的命令能不能联网（:workspace，应该不能）：${box(":workspace", "getent hosts example.com >/dev/null && echo 连上了 || echo 连不上")}`);
say(`读项目外的文件（:workspace）：${box(":workspace", "head -c 20 /etc/hostname >/dev/null && echo 能读 || echo 读不了")}`);
say(`读 Codex 自己的登录文件（:workspace）：${box(":workspace", `test -r ${HOME}/.codex/auth.json && echo 能读 || echo 读不了或还没登录`)}`);

// ---------- app-server ----------
const srv = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
srv.stderr.on("data", d => fs.appendFileSync(`${LOGS}/stderr.log`, d));
const rl = readline.createInterface({ input: srv.stdout });
let nextId = 0;
const pending = new Map();
const listeners = new Set();
let log = null; // 当前任务的事件记录
const counts = {};
rl.on("line", line => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (log) fs.appendFileSync(log, JSON.stringify(m) + "\n");
  if (m.id != null && !m.method && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method) counts[m.method] = (counts[m.method] || 0) + 1;
  for (const f of listeners) f(m);
});
const send = obj => srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\n");
const call = (method, params = {}) => new Promise((ok, bad) => {
  const id = ++nextId;
  pending.set(id, m => (m.error ? bad(new Error(`${method}: ${m.error.message}`)) : ok(m.result)));
  send({ id, method, params });
});
const waitFor = (test, ms) => new Promise((ok, bad) => {
  const f = m => { if (test(m)) { listeners.delete(f); clearTimeout(t); ok(m); } };
  const t = setTimeout(() => { listeners.delete(f); bad(new Error("等太久了")); }, ms);
  listeners.add(f);
});

await call("initialize", { clientInfo: { name: "qisuo-workroom-probe", title: "栖所工作间实测", version: "0.1" }, capabilities: { experimentalApi: true } });
send({ method: "initialized" });

// ---------- 3. 登录 ----------
head("登录");
const finish = code => { fs.writeFileSync(`${WORK}/report.txt`, report.join("\n") + "\n"); srv.kill(); process.exit(code); };
let acct = await call("account/read", { refreshToken: false });
if (!acct.account) try {
  const r = await call("account/login/start", { type: "chatgptDeviceCode" });
  console.log("\n================================================");
  console.log(" 用手机打开这个网址，登录 ChatGPT，输入下面这串码：");
  console.log(`   网址：${r.verificationUrl}`);
  console.log(`   码：  ${r.userCode}`);
  console.log(" （这串码只在 OpenAI 的页面上输入，不要发给任何人，包括 cc）");
  console.log("================================================\n");
  const done = await waitFor(m => m.method === "account/login/completed", 15 * 60_000);
  if (done.params?.success === false) { say(`登录没成功：${done.params?.error || ""}`); finish(1); }
  acct = await call("account/read", { refreshToken: false });
} catch (e) {
  say(`登录这一步出错：${e.message}（多半是这台服务器连不上 auth.openai.com）`);
  finish(1);
}
say(`登录方式：${acct.account?.type || "?"}；会员：${acct.account?.planType || "?"}`); // 不写邮箱

const limits = async label => {
  try {
    const r = await call("account/rateLimits/read", {});
    const pick = x => (x ? `${x.usedPercent}%${x.windowDurationMins ? `（${Math.round(x.windowDurationMins / 60)} 小时窗口）` : ""}` : "—");
    const rl = r.rateLimits || r;
    say(`额度 ${label}：主 ${pick(rl.primary)}；次 ${pick(rl.secondary)}`);
    return rl;
  } catch (e) { say(`额度 ${label}：读不到（${e.message}）`); return null; }
};

// 审批：只答应项目目录里的事，别的都拒绝；每次都记下来
const approvals = [];
listeners.add(m => {
  if (m.id == null || !m.method?.endsWith("/requestApproval")) return;
  const p = m.params || {};
  const inside = !p.cwd || String(p.cwd).startsWith(DEMO);
  const outside = /\/home\/|\.codex|\/etc|https?:\/\//.test(`${p.command || ""} ${p.reason || ""}`);
  const decision = inside && !outside ? "accept" : "decline";
  approvals.push({ method: m.method, command: p.command, cwd: p.cwd, reason: p.reason, decision });
  send({ id: m.id, result: { decision } });
});

// 跑一个任务：开线程、发话、等结束；可选：跑起来以后中断
async function task(name, { sandbox, text, interruptAfterMs = 0 }) {
  head(`任务 ${name}`);
  log = `${LOGS}/${name}.jsonl`;
  fs.writeFileSync(log, "");
  for (const k of Object.keys(counts)) delete counts[k];
  approvals.length = 0;
  const before = await limits("之前");
  const t0 = Date.now();
  const { thread } = await call("thread/start", { cwd: DEMO, sandbox, approvalPolicy: "on-request" });
  say(`线程 ${thread.id.slice(0, 8)}… 模型 ${thread.model}`);
  let usage = null, diff = "", cmds = [], files = [];
  const watch = m => {
    if (m.method === "thread/tokenUsage/updated") usage = m.params?.tokenUsage || m.params;
    if (m.method === "turn/diff/updated") diff = m.params?.diff || diff;
    if (m.method === "item/completed" && m.params?.item?.type === "commandExecution") cmds.push(`${m.params.item.command} → 退出码 ${m.params.item.exitCode ?? "?"}（${m.params.item.status}）`);
    if (m.method === "item/completed" && m.params?.item?.type === "fileChange") files.push(...(m.params.item.changes || []).map(c => c.path));
  };
  listeners.add(watch);
  const { turn } = await call("turn/start", { threadId: thread.id, input: [{ type: "text", text }] });
  if (interruptAfterMs) {
    await waitFor(m => m.method === "item/commandExecution/outputDelta" || m.method === "item/started", 5 * 60_000).catch(() => {});
    await new Promise(r => setTimeout(r, interruptAfterMs));
    await call("turn/interrupt", { threadId: thread.id, turnId: turn.id }).catch(e => say(`中断出错：${e.message}`));
    say(`发了中断（开工 ${Math.round((Date.now() - t0) / 1000)} 秒后）`);
  }
  const done = await waitFor(m => m.method === "turn/completed" && m.params?.turn?.id === turn.id, 15 * 60_000).catch(e => ({ error: e }));
  listeners.delete(watch);
  say(`结果：${done.error ? done.error.message : done.params.turn.status}${done.params?.turn?.error ? `（${JSON.stringify(done.params.turn.error).slice(0, 200)}）` : ""}；用时 ${Math.round((Date.now() - t0) / 1000)} 秒`);
  say(`收到的事件：${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join("，")}`);
  if (cmds.length) say(`跑过的命令：\n  ${cmds.join("\n  ")}`);
  if (files.length) say(`改过的文件：${[...new Set(files)].join("、")}`);
  if (diff) say(`diff（前 600 字）：\n${diff.slice(0, 600)}`);
  if (approvals.length) say(`审批：\n  ${approvals.map(a => `${a.method.split("/")[1]} ${a.command || ""} ${a.reason ? `（${a.reason}）` : ""} → ${a.decision}`).join("\n  ")}`);
  if (usage) say(`token：${JSON.stringify(usage).slice(0, 300)}`);
  const after = await limits("之后");
  if (before?.primary && after?.primary) say(`这个任务大约用了主额度 ${(after.primary.usedPercent - before.primary.usedPercent).toFixed(1)}%`);
  log = null;
}

try {
  await task("A-只读", { sandbox: "read-only", text: "看看这个项目里有什么文件，读一下 README，用两三句话告诉我它是做什么的。不要修改任何文件。" });
  await task("B-修bug", { sandbox: "workspace-write", text: "运行 node test.js 看看哪里不对，修好 math.js 里的问题，再运行一次确认全部通过。改动尽量小。" });
  await task("C-中断", { sandbox: "workspace-write", text: "请用 shell 一个一个地数数：依次运行 `sleep 2 && echo 1`、`sleep 2 && echo 2`……一直到 30，每个数单独运行一次命令。", interruptAfterMs: 6000 });
} catch (e) {
  say(`\n出错停下了：${e.message}`);
}
head("看看 escape 有没有写出去");
say(fs.existsSync(`${HOME}/escape.txt`) ? `⚠️ ${HOME}/escape.txt 存在（沙盒没挡住）` : "没有（好）");

fs.writeFileSync(`${WORK}/report.txt`, report.join("\n") + "\n");
console.log(`\n报告写好了：${WORK}/report.txt（宿主机上是 ~/codex-lab/work/report.txt）。把它整个复制给 cc 就行，里面没有邮箱和令牌。`);
srv.kill();
process.exit(0);
