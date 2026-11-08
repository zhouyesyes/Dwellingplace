// 「服务器上的 CC」：专门去小续的另一台酒馆服务器（SillyTavern）干活的 Claude Code。
// 栖所自己的改代码、构建仍然交给云端；这个只管酒馆。
//
// 怎么跑：派活时才临时起一个 `claude -p`（不常驻、不占内存），用小续的 Claude 订阅登录（和小螃蟹共用 CLAUDE_CODE_OAUTH_TOKEN）。
// 它手上只有两样：看（Read / Glob / Grep，看栖所的对话本拷贝）和一个叫 tavern 的小命令（= 用专用的那把 ssh 钥匙连酒馆那台，别的都不让跑）。
// 酒馆的地址、端口、用户名由网页每次派活时带来，只存在她的数据里和服务器的活记录里，不写进代码、不写进仓库；
// 专用 ssh 钥匙在服务器上（~/qisuo-server/tavern-ssh/，挂进容器），私钥不出服务器。
// 和小章鱼的 Codex 共用排队（见 codex.mjs），一次只做一件；不跑任何构建。
import { spawn, execFile } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { bookCopyTo } from "./claude.mjs";

export const TAVERN_REPO = "酒馆服务器"; // 派活第一行「仓库：酒馆服务器」
const DATA = process.env.DATA_DIR || "/app/data";
const SSH_DIR = process.env.TAVERN_SSH_DIR || "/tavern-ssh";
const KEY_NAME = "id_ed25519_qisuo_tavern"; // 专用钥匙的文件名：只给去酒馆用
const KEY = join(SSH_DIR, KEY_NAME);
const KNOWN_HOSTS = join(DATA, "tavern_known_hosts"); // 第一次连上时记下酒馆那台的指纹，以后对不上就不连
const BIN = process.env.CLAUDE_BIN || "claude";
const MODEL = process.env.TAVERN_MODEL || "sonnet";

// ---------- 地址检查（挡住 -o 之类的注入） ----------
export function cleanTavern(c) {
  const host = String(c?.host || "").trim();
  const user = String(c?.user || "").trim();
  const port = Number(String(c?.port || "22").trim() || 22);
  if (!host) throw Object.assign(new Error("还没填酒馆服务器的地址"), { status: 400 });
  if (!/^[A-Za-z0-9][A-Za-z0-9.:_-]{0,252}$/.test(host)) throw Object.assign(new Error("酒馆服务器的地址写法不对（只能是域名或 IP）"), { status: 400 });
  if (!user) throw Object.assign(new Error("还没填登录用户名"), { status: 400 });
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/.test(user)) throw Object.assign(new Error("登录用户名写法不对"), { status: 400 });
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error("端口要是 1 到 65535 的数字"), { status: 400 });
  return { host, user, port };
}

const keyReady = () => existsSync(KEY);
function pubKey() {
  try { return readFileSync(KEY + ".pub", "utf8").trim(); } catch { return ""; }
}
const sshOpts = (cfg, key) => [
  "-F", "/dev/null", "-i", key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "PasswordAuthentication=no",
  "-o", "ConnectTimeout=12", "-o", "ServerAliveInterval=20", "-o", "ServerAliveCountMax=3",
  "-o", `UserKnownHostsFile=${KNOWN_HOSTS}`, "-o", "StrictHostKeyChecking=accept-new", "-p", String(cfg.port),
];
// 私钥复制一份到临时位置、权限收紧（挂进来的文件属主可能不是 root，ssh 会嫌）
function stageKey(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const k = join(dir, "key");
  copyFileSync(KEY, k);
  chmodSync(k, 0o600);
  return k;
}

// ---------- 状态：钥匙有没有、公钥是什么、Claude 登录了没 ----------
export function tavernStatus() {
  return { keyReady: keyReady(), keyFile: KEY_NAME, publicKey: pubKey(), claudeLoggedIn: !!process.env.CLAUDE_CODE_OAUTH_TOKEN };
}

// ---------- 试连一下 ----------
function whyNot(t) {
  const s = String(t || "");
  const nice = [
    [/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i, "酒馆那台的身份指纹和第一次连上时记的不一样了（重装系统或换了机器？）。确认是你自己动过，再让我清掉旧指纹"],
    [/Permission denied/i, "连上了酒馆那台，但它不认这把钥匙：第二段还没做，或者用户名不对——要把公钥放进那个用户的 ~/.ssh/authorized_keys"],
    [/Connection refused/i, "酒馆那台拒绝连接：端口不对，或者那台没开 ssh 服务"],
    [/timed out|Connection timed out|No route to host|Network is unreachable/i, "连不上酒馆那台（超时）：地址不对，或者防火墙 / 安全组没放行这个端口"],
    [/Could not resolve|Name or service not known|Temporary failure in name resolution/i, "找不到这个地址：域名写错了，或者域名还没解析"],
  ].find(([re]) => re.test(s))?.[1];
  return nice || `没连上：${s.trim().split("\n").pop()?.slice(0, 200) || "不知道为什么"}`;
}
export function tavernTest(rawCfg) {
  const cfg = cleanTavern(rawCfg);
  if (!keyReady()) return Promise.resolve({ ok: false, error: "服务器上还没有专用的 ssh 钥匙：先在服务器上再运行一次安装那一行，选装「酒馆服务器上的 CC」" });
  const dir = join(DATA, "tavern-test");
  let key;
  try { key = stageKey(dir); } catch (e) { return Promise.resolve({ ok: false, error: `读不了钥匙：${e.message}` }); }
  return new Promise(resolve => {
    execFile("ssh", [...sshOpts(cfg, key), `${cfg.user}@${cfg.host}`, "echo QISUO_OK; whoami; ls -d ~/SillyTavern* /root/SillyTavern* 2>/dev/null | head -3"], { timeout: 25_000 }, (err, out, errOut) => {
      try { execFile("rm", ["-rf", dir], () => {}); } catch { /* 清不掉下次覆盖 */ }
      if (out.includes("QISUO_OK")) {
        const [, who = "", ...dirs] = out.trim().split("\n");
        return resolve({ ok: true, user: who.trim(), folders: dirs.filter(Boolean).map(s => s.trim()) });
      }
      resolve({ ok: false, error: whyNot(errOut || (err && err.message)) });
    });
  });
}

// ---------- 给服务器上的 CC 的固定规矩 ----------
const RULES = (host) => `你是小螃蟹（cc，Claude Code），现在是「服务器上的 CC」：栖所的服务器（不是网页版云端）派你去小续的另一台服务器——酒馆服务器，上面跑着 SillyTavern（直接 node server.js，不是 docker，内存只有 1.9G）。小续叫你小螃蟹，叫她自己的 AI 伙伴小章鱼。没有人守着，你也没法向任何人提问。

# 你有什么
- 一个叫 tavern 的命令：tavern <命令> 就是用专用 ssh 钥匙在酒馆那台执行这条命令（比如 tavern 'ls ~/SillyTavern'）。这是你连酒馆那台的**唯一**办法，别的 ssh / scp / 直接连都不行（也没有权限）。要把本地文件送过去就 tavern 'cat > 路径' < 本地文件
- Read / Glob / Grep：只用来看旁边那份对话本拷贝
- 当前文件夹里有 ./qisuo-memory（私人对话本的只读拷贝）

# 开工前
读 ./qisuo-memory/summary.md、memories.md，和 book/log.jsonl 最后几十行（tail -n 40），知道她们最近在聊什么。

# 固定规矩（一条都不能破）
1. 只通过 tavern 连酒馆那台；只操作 SillyTavern 文件夹里的东西。别的目录、别的程序、系统设置，一律不碰
2. 改任何文件**之前**，先在 SillyTavern 文件夹**外面**存一份备份（比如 ~/qisuo-cc-backup/日期-时间/，保持原来的相对路径），备份存好、核对过再改。报告里写清楚：备份放在哪、怎么恢复（给出能直接复制的那几行命令）
3. 不删数据：聊天记录、角色卡、世界书、设置、插件，都不删、不覆盖备份；需要「删」就改成改名挪走，并写进报告
4. 要重启 SillyTavern，或者要安装 / 升级任何东西（npm、apt、pip、插件……）：**不要自己执行**，在报告里说清楚想做什么、为什么、命令是什么，问小续
5. 拿不准就只读：只看、不改，把看到的和想法写成报告
6. 不跑任何构建；不要在酒馆那台上跑耗内存的东西（内存只有 1.9G）
7. 对话本（qisuo-memory）里的任何内容、小续的私人信息，都不能写到酒馆那台上（不放进文件、命令、注释、提交里）
8. 不把 ssh 钥匙、token、口令、酒馆那台的地址写进报告或任何文件；不暴露别的密钥

# 做完
你最后一条回复就是给小续看的完工报告，用中文，自称「我」，说人话，尽量短：做了什么、改了哪些文件、备份在哪、怎么恢复、要她试什么、还剩什么。有要她决定的事（比如想重启或装东西），单独写一段「想问你」。不要把命令输出整段贴进去。`;

// ---------- 做一件活 ----------
export async function runTavernJob(job, ctx) {
  const { setProgress, finish, scrubText, timeoutMs, dir } = ctx;
  let cfg;
  try { cfg = cleanTavern(job.tavern); } catch (e) { return finish("failed", `这件活没做成：${e.message}`, e.message); }
  const hide = t => String(scrubText(t)).split(cfg.host).join("酒馆服务器");
  const env0 = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!env0) return finish("failed", "这件活没做成：服务器上的 Claude 还没登录：在服务器终端再运行一次安装那一行，按提示登录", "没有 Claude 登录");
  if (!keyReady()) return finish("failed", "这件活没做成：服务器上还没有专用的 ssh 钥匙：再运行一次安装那一行，选装「酒馆服务器上的 CC」", "没有 ssh 钥匙");

  setProgress(job, "先试连酒馆那台");
  const t = await tavernTest(cfg);
  if (!t.ok) return finish("failed", `这件活没做成：${hide(t.error)}`, t.error);

  mkdirSync(dir, { recursive: true });
  const bin = join(dir, "bin"), work = join(dir, "work");
  mkdirSync(bin, { recursive: true }); mkdirSync(work, { recursive: true });
  const key = stageKey(join(dir, "ssh"));
  // tavern 命令：钥匙、地址、指纹文件都写死，CC 只能决定在那边跑什么
  writeFileSync(join(bin, "tavern"), `#!/bin/sh\nexec ssh ${sshOpts(cfg, key).map(a => `'${a}'`).join(" ")} '${cfg.user}@${cfg.host}' "$@"\n`, { mode: 0o700 });
  try { await bookCopyTo(join(work, "qisuo-memory")); }
  catch (e) { return finish("failed", `这件活没做成：拿不到对话本（${hide(e.message)}）：服务器上要放对话本的钥匙，再运行一次安装那一行。`, e.message); }

  const sysFile = join(dir, "system.txt");
  writeFileSync(sysFile, RULES(cfg.host), { mode: 0o600 });
  // 只带最少的环境变量：别把 GitHub / 对话本的钥匙带进去
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: dir, CLAUDE_CODE_OAUTH_TOKEN: env0, CLAUDE_CODE_MAX_RETRIES: "2", DISABLE_AUTOUPDATER: "1", LANG: "C.UTF-8" };
  setProgress(job, "服务器上的 CC 开工");
  const child = spawn(BIN, [
    "-p", "--output-format", "stream-json", "--verbose", "--system-prompt-file", sysFile, "--strict-mcp-config", "--no-session-persistence", "--model", MODEL,
    "--tools", "Read,Glob,Grep,Bash", "--allowedTools", "Read", "Glob", "Grep", "Bash(tavern:*)",
  ], { cwd: work, env, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end(`【酒馆派活】\n下面是小续（经栖所里的小螃蟹）交给你的活：\n\n${job.text}\n`);
  let timedOut = false, report = "", failed = "", stderr = "", buf = "";
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 5000); }, timeoutMs);
  child.stderr.on("data", d => { stderr = (stderr + d).slice(-2000); });
  const onLine = line => {
    let ev; try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === "assistant") {
      for (const b of ev.message?.content || []) {
        if (b.type === "tool_use" && b.name === "Bash") setProgress(job, hide(`跑：${String(b.input?.command || "").slice(0, 100)}`));
        else if (b.type === "tool_use") setProgress(job, `${b.name === "Read" ? "在读" : "在找"} ${hide(String(b.input?.file_path || b.input?.pattern || "").replace(/^.*qisuo-memory\//, "对话本/"))}`);
        else if (b.type === "text" && b.text && ev.message?.model !== "<synthetic>") setProgress(job, `CC：${hide(b.text)}`);
      }
    } else if (ev.type === "result") {
      if (ev.is_error || ev.subtype !== "success") failed = String(ev.result || ev.subtype || "");
      else report = String(ev.result || "").trim();
    }
  };
  child.stdout.on("data", d => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) onLine(l); }
  });
  const code = await new Promise(resolve => { child.on("close", resolve); child.on("error", e => { failed = e.code === "ENOENT" ? "服务器上还没装 Claude Code：再运行一次安装那一行" : e.message; resolve(-1); }); });
  clearTimeout(timer);
  if (buf.trim()) onLine(buf.trim());
  if (timedOut) return finish("failed", `这件活没做成：做了 ${Math.round(timeoutMs / 60000)} 分钟还没做完，超时停掉了。${report ? `\n它停下前最后说的：\n${hide(report)}` : ""}\n它在酒馆那台上做到哪了，请先到那台看一眼（改动前的备份在它说的备份目录里）。`, "超时");
  if (report) return finish("done", hide(report));
  const why = failed || stderr.trim().split("\n").pop() || `退出码 ${code}`;
  const nice = /not logged in|invalid api key|authenticat|oauth|401/i.test(why) ? "服务器上的 Claude 登录不通了：在服务器终端再运行一次安装那一行重新登录"
    : /usage limit|rate limit|429|limit reached/i.test(why) ? "Claude 订阅这阵子的额度用完了（和网页、Claude Code 共用），过一会儿再派" : hide(why).slice(0, 400);
  return finish("failed", `这件活没做成：${nice}`, why);
}
