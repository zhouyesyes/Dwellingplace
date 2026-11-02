// 小章鱼（ChatGPT）派活：服务器上的 Codex 命令行，用小续的 ChatGPT 账号登录（设备验证码方式，不用 API 钥匙）。
// 和小螃蟹的云端派活对称：聊天里点头了就派，这里在后台开工，做完的报告写进对话本、送回小章鱼的聊天。
//
// 登录：登录凭据在 CODEX_HOME（服务器上的持久目录，挂进容器），只在服务器终端里跑登录脚本登一次，不经过浏览器。
// 一次只做一件，后来的排队；开工前查 CC 那边有没有开着、改同一个代码文件的 PR，撞上就先不动（已合并的、没开 PR 的旧分支、只在 worklog 末尾追加都不算）。
//
// 路径（都在 /p/<口令>/codex 下面）：
//   GET  /status        装好了没、登录了没、GitHub 钥匙和对话本有没有、排队情况
//   POST /job {text}    派一件活 → { id, status, position }
//   GET  /job/<id>      这件活做到哪了（排队 / 开工 / 完成 / 没做成 / 没动）、最后的报告
import { spawn, execFile } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { bookAppend, bookCopyTo, bookReady, bookSecrets } from "./claude.mjs";

const BIN = process.env.CODEX_BIN || "codex";
const DATA = process.env.DATA_DIR || "/app/data";
const CODEX_HOME = process.env.CODEX_HOME || "/codex-home";
const GH_TOKEN = process.env.CODEX_GITHUB_TOKEN || "";
const GH_REPO = process.env.CODEX_GITHUB_REPO || "zhouyesyes/Dwellingplace";
const GH_API = process.env.GITHUB_API || "https://api.github.com";
const REPO_URL = process.env.CODEX_REPO_URL || `https://github.com/${GH_REPO}.git`;
const WORK = process.env.CODEX_WORK || join(DATA, "codex-work");
const JOBS_FILE = join(DATA, "codex-jobs.json");
const TIMEOUT = (Number(process.env.CODEX_TIMEOUT_MIN) || 45) * 60_000;
const KEEP = 40; // 最多留多少件的记录

// ---------- 凭据不进日志、不进报告 ----------
const secrets = () => [GH_TOKEN, GH_TOKEN && Buffer.from("x-access-token:" + GH_TOKEN).toString("base64"), ...bookSecrets()].filter(s => s && s.length > 8);
const scrub = t => secrets().reduce((s, k) => s.split(k).join("***"), String(t ?? ""))
  .replace(/(github_pat_|ghp_|gho_|sk-ant-oat|sk-)[\w-]{8,}/g, "$1***")
  .replace(/("(?:access_token|refresh_token|id_token)"\s*:\s*")[^"]+/g, "$1***");

// ---------- 记录 ----------
let jobs = [];
try { jobs = JSON.parse(readFileSync(JOBS_FILE, "utf8")); } catch { /* 还没有 */ }
const save = () => {
  jobs = jobs.slice(-KEEP);
  try { mkdirSync(DATA, { recursive: true }); const tmp = `${JOBS_FILE}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(jobs), { mode: 0o600 }); renameSync(tmp, JOBS_FILE); } catch { /* 写不了就只记在内存里 */ }
};
// 服务器中途重启过：还在排队、开工的都没了，明说，别让聊天那边一直转圈
for (const j of jobs) if (j.status === "queued" || j.status === "running") {
  Object.assign(j, { status: "failed", endedAt: Date.now(), report: "这件活没做成：服务器中途重启了（重跑安装或掉电都会这样），做到一半的不算数。需要的话让小章鱼再派一次。", error: "服务器中途重启" });
}
save();
const pub = (j, full = true) => {
  const pos = j.status === "queued" ? queue.indexOf(j) + 1 : 0;
  return { id: j.id, status: j.status, createdAt: j.createdAt, startedAt: j.startedAt, endedAt: j.endedAt, position: pos, progress: (j.progress || []).slice(-6), ...(full ? { report: j.report || "", error: j.error || "" } : {}) };
};
const setProgress = (j, line) => { const l = scrub(line).replace(/\s+/g, " ").trim().slice(0, 120); if (l && j.progress.at(-1) !== l) { j.progress.push(l); if (j.progress.length > 30) j.progress.shift(); } };

// ---------- 小工具 ----------
const run = (cmd, args, opts = {}) => new Promise(resolve => {
  execFile(cmd, args, { timeout: 180_000, maxBuffer: 8_000_000, ...opts }, (err, out, errOut) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: String(out || ""), err: String(errOut || "") + (err && typeof err.code !== "number" ? err.message : "") }));
});
const codexEnv = extra => ({ ...process.env, CODEX_HOME, HOME: process.env.CODEX_USER_HOME || "/tmp", ...extra });
const authHeader = () => `AUTHORIZATION: basic ${Buffer.from("x-access-token:" + GH_TOKEN).toString("base64")}`;

async function ghApi(path) {
  const r = await fetch(`${GH_API}/repos/${GH_REPO}${path}`, { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "qisuo-codex" } });
  if (!r.ok) throw new Error(`GitHub 返回 ${r.status}（${path.split("?")[0]}）`);
  return r.json();
}

async function loginStatus() {
  if (!existsSync(CODEX_HOME)) return { installed: true, loggedIn: false, text: "还没有登录凭据目录" };
  const r = await run(BIN, ["login", "status"], { env: codexEnv(), timeout: 20_000 });
  const text = scrub((r.out + "\n" + r.err).replace(/WARNING:[^\n]*\n?/g, "").trim()).slice(0, 300);
  if (/ENOENT|not found/i.test(r.err) && r.code !== 0 && !r.out) return { installed: false, loggedIn: false, text: "服务器上还没装 Codex：再运行一次安装那一行" };
  return { installed: true, loggedIn: r.code === 0 && /logged in/i.test(text) && !/not logged in/i.test(text), text };
}

// ---------- 防撞：只看 CC 那边仍然开着、没合并的 PR ----------
// 已合并的 PR、提交早已在 main 里的旧分支、没有开 PR 的分支都不算；docs/worklog.md 大家每单都会往末尾追加，也不算
const SHARED_DOCS = new Set(["docs/worklog.md"]);
async function ccWork() {
  const list = [];
  const prs = (await ghApi("/pulls?state=open&per_page=30")).filter(p => !p.head.ref.startsWith("codex/") && !p.merged_at);
  for (const p of prs.slice(0, 12)) {
    const files = await ghApi(`/pulls/${p.number}/files?per_page=100`).then(l => l.map(f => f.filename).filter(f => !SHARED_DOCS.has(f))).catch(() => []);
    if (files.length) list.push({ kind: "PR", name: `#${p.number} ${p.title}`, branch: p.head.ref, files });
  }
  return list;
}
// 活的描述里提到的文件，和对方改的文件撞不撞（认文件名，或者长一点的文件主名，比如 ChatView）
function clash(text, others) {
  const named = new Set((String(text).match(/[\w./-]+\.(?:vue|js|mjs|css|sh|md|json|html|toml)/gi) || []).map(s => s.toLowerCase()));
  const stems = [...String(text).matchAll(/\b([A-Z][A-Za-z]{4,}(?:View|Drawer|Sheet|Card|Panel|Room|Page))\b/g)].map(m => m[1].toLowerCase());
  const hits = [];
  for (const o of others) {
    const bad = o.files.filter(f => { const lf = f.toLowerCase(); const base = lf.split("/").pop(); return named.has(lf) || named.has(base) || stems.some(s => base.startsWith(s + ".")); });
    if (bad.length) hits.push({ ...o, bad });
  }
  return hits;
}

// ---------- 给 Codex 的开工说明（照 CC 云端派活那份写） ----------
function promptFor(job, others, dir) {
  const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  return `【云端派活】
你是 Codex，在栖所仓库里干活（小续的 AI 伙伴小章鱼把活派给你；小续叫小章鱼「他」，叫 CC「小螃蟹」）。她在栖所里和小章鱼商量好、派过来的活，写在最后「要做的事」里。
你在一台服务器的容器里，没有人守着，也不能向任何人提问：拿不准、要她决定的地方别猜，先别合并，在报告里写清楚要问她什么。

工作目录：
- 栖所仓库（Dwellingplace）：${dir}/Dwellingplace，已经是最新 main 的干净副本，当前在分支 ${job.branch}（从最新 main 开的）
- 旁边是私人仓库的只读拷贝：${dir}/qisuo-memory。你推不上去也不要往里写；私人仓库里的内容不要写进公开仓库（Dwellingplace）

开工前：
1. 进栖所仓库目录，读 CLAUDE.md 和 AGENTS.md，按里面的规矩做（你不是 cc，所以其中「cc 的」那几条以本说明为准：分支用 ${job.branch}，不要自己换分支名）
2. 读 ../qisuo-memory 里的 summary.md、memories.md，和 book/log.jsonl 最后几十行（tail -n 40），知道她们最近在聊什么
3. 看一眼 docs/worklog.md 最上面几条，知道别人刚做了什么
${others.length ? `4. 现在 CC 那边有这些还开着、没合并的 PR（改动文件在括号里，worklog 不算）：\n${others.map(o => `   - ${o.kind} ${o.name}（${o.files.slice(0, 12).join("、")}${o.files.length > 12 ? "…" : ""}）`).join("\n")}\n   你要改的文件如果和它们撞了：**一个文件都别动**，直接在报告里说明撞在哪、建议等对方合并后再派。\n` : "4. 现在 CC 那边没有开着的 PR。\n"}
干活：
- 改 → 跑 npm ci（第一次）→ npx vite build 必须通过 → 提交（中文说明，一件事一个提交）→ git push -u origin ${job.branch}
- 开 PR 和合并用这个小工具（环境里已经有钥匙，不要打印、不要写进任何文件）：
  node /app/ghpr.mjs open ${job.branch} "标题" 正文文件   （开 PR 合到 main，正文用中文写清楚改了什么）
  node /app/ghpr.mjs merge 编号                            （squash 合并）
- 能合并就 squash 合并；拿不准、要她决定的就先不合并，PR 留着
- 在 docs/worklog.md 最上面记一条（${day} · Codex：做了什么、还剩什么、要别人注意什么；规矩看文件里已有的写法），和代码改动一起提交
- 这个容器里没有浏览器，没法截图：改了界面的话，报告里明说「没截图」，让她自己看
- 只做被要求的这件事；不碰密钥、口令、settings.env，不把她的邮箱、口令写进代码、提交或报告
- 做完不要留一堆临时文件在仓库里

做完：你最后一条回复就是给她看的完工报告，用中文，自称「我」，尽量短：改了什么（合并了的写 PR 编号）、看起来什么样、要她试什么、还剩什么、要不要重跑服务器安装（deploy/qisuo-server/ 下面有改动才要）、要不要重部署中转（relay/ 有改动才要）。有要她决定的事，单独写一段「想问你」。不要把命令输出整段贴进去。

要做的事：
${job.text}
`;
}

// ---------- 做一件活 ----------
const sh = async (cwd, args, env) => { const r = await run("git", args, { cwd, env: { ...process.env, ...env } }); if (r.code) throw new Error(`git ${args[0]} 没成：${scrub(r.err || r.out).trim().slice(-300)}`); return r.out; };
const gitEnv = { GIT_TERMINAL_PROMPT: "0" };

function friendly(t) {
  const s = scrub(t).trim();
  const nice = [
    [/not logged in|401|unauthori[sz]ed|sign in again|token.*(expired|invalid)/i, "Codex 的 ChatGPT 登录不通了：在服务器终端运行 ~/qisuo-server/codex-login.sh 重新登录"],
    [/usage limit|rate limit|429|quota|limit reached|try again (later|in)/i, "ChatGPT 订阅里 Codex 的额度这阵子用完了，过一会儿再派"],
  ].find(([re]) => re.test(s))?.[1];
  return nice ? `${nice}（原话：${s.slice(0, 400)}）` : s.slice(0, 800);
}

async function runJob(job) {
  job.status = "running"; job.startedAt = Date.now(); save();
  const dir = join(WORK, job.id);
  const finish = async (status, report, error = "") => {
    job.status = status; job.endedAt = Date.now(); job.report = scrub(report).slice(0, 20000); job.error = scrub(error).slice(0, 2000); save();
    rmSync(dir, { recursive: true, force: true });
    try { await bookAppend({ id: `codex-${job.id}`, ts: job.endedAt, where: "cloud", from: "octopus", text: job.report }); }
    catch (e) { console.error("codex 报告没写进对话本：", scrub(e.message)); }
  };
  try {
    const st = await loginStatus();
    if (!st.installed) return await finish("failed", `这件活没做成：${st.text}`, st.text);
    if (!st.loggedIn) return await finish("failed", `这件活没做成：${friendly("not logged in")}`, st.text);
    if (!GH_TOKEN) return await finish("failed", "这件活没做成：服务器上还没放 GitHub 钥匙（开分支、开 PR 要用）：再运行一次安装那一行。", "没有 GitHub 钥匙");
    if (!bookReady()) return await finish("failed", "这件活没做成：服务器上还没放对话本的钥匙（要读 qisuo-memory、写回报告）：再运行一次安装那一行。", "没有对话本钥匙");

    setProgress(job, "查 CC 那边有没有开着的 PR 撞车");
    let others = [];
    try { others = await ccWork(); }
    catch (e) { return await finish("failed", `这件活没做成：查 CC 那边的 PR 时出错了（${scrub(e.message)}），为了不撞车先没动。`, e.message); }
    const hit = clash(job.text, others);
    if (hit.length) {
      return await finish("blocked", `我先没动手：这件活要改的文件，CC 那边正在改——\n${hit.map(h => `- ${h.kind} ${h.name}：${h.bad.slice(0, 6).join("、")}`).join("\n")}\n等 CC 那边合并（或你说可以一起改）以后，再让小章鱼派一次。`);
    }

    setProgress(job, "拉最新的 main");
    mkdirSync(dir, { recursive: true });
    const repo = join(dir, "Dwellingplace");
    await sh(dir, ["-c", `http.https://github.com/.extraheader=${authHeader()}`, "clone", "-q", "--depth", "200", REPO_URL, repo], gitEnv);
    await sh(repo, ["config", "user.name", "Codex"], gitEnv);
    await sh(repo, ["config", "user.email", "codex@qisuo.local"], gitEnv);
    await sh(repo, ["config", "http.https://github.com/.extraheader", authHeader()], gitEnv); // 只在这份临时拷贝里，做完整个删掉
    await sh(repo, ["checkout", "-q", "-b", job.branch], gitEnv);
    await bookCopyTo(join(dir, "qisuo-memory"));

    setProgress(job, "Codex 开工");
    const outFile = join(dir, "report.txt");
    const child = spawn(BIN, ["exec", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "--json", "-C", repo, "-o", outFile, "-"], {
      cwd: repo, env: codexEnv({ GITHUB_TOKEN: GH_TOKEN, GITHUB_REPO: GH_REPO, GITHUB_API: GH_API, ...gitEnv }), stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end(promptFor(job, others, dir));
    let timedOut = false, errs = [], stderr = "", buf = "";
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 5000); }, TIMEOUT);
    child.stderr.on("data", d => { stderr = (stderr + d).slice(-3000); });
    const onLine = line => {
      let ev; try { ev = JSON.parse(line); } catch { return; }
      const it = ev.item || ev.msg || {};
      const kind = String(ev.type || "");
      if (it.type === "command_execution" && kind.endsWith("completed")) setProgress(job, `跑：${String(it.command || "").replace(/^\S*sh -lc\s+/, "")}`);
      else if (it.type === "agent_message" && kind.endsWith("completed") && it.text) setProgress(job, `Codex：${it.text}`);
      else if (it.type === "file_change" && kind.endsWith("completed")) setProgress(job, `改了 ${(it.changes || []).length || ""} 个文件`);
      if (/error|fail/i.test(kind)) { const m = ev.message || ev.error?.message || it.message || ev.error; if (m) errs.push(typeof m === "string" ? m : JSON.stringify(m)); }
    };
    child.stdout.on("data", d => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) onLine(l); }
    });
    const code = await new Promise(resolve => { child.on("close", resolve); child.on("error", e => { errs.push(e.code === "ENOENT" ? "服务器上还没装 Codex：再运行一次安装那一行" : e.message); resolve(-1); }); });
    clearTimeout(timer);
    if (buf.trim()) onLine(buf.trim());
    const said = existsSync(outFile) ? readFileSync(outFile, "utf8").trim() : "";
    if (timedOut) return await finish("failed", `这件活没做成：做了 ${Math.round(TIMEOUT / 60000)} 分钟还没做完，超时停掉了。${said ? `\n它停下前最后说的：\n${said}` : ""}\n分支 ${job.branch} 上做到哪了，可以去 GitHub 看。`, "超时");
    if (code !== 0 && !said) {
      const why = errs.at(-1) || stderr.trim().split("\n").filter(l => !/^WARNING/.test(l)).pop() || `退出码 ${code}`;
      return await finish("failed", `这件活没做成：${friendly(why)}`, why);
    }
    if (!said) return await finish("failed", "这件活没做成：Codex 跑完了，但没留下报告。分支 " + job.branch + " 上有没有改动，可以去 GitHub 看。", "没有报告");
    return await finish("done", said);
  } catch (e) {
    return await finish("failed", `这件活没做成：${friendly(e.message)}`, e.message);
  }
}

// ---------- 排队：一次只做一件 ----------
const queue = [];
let current = null;
function pump() {
  if (current || !queue.length) return;
  const job = queue.shift();
  current = job;
  runJob(job).catch(e => { job.status = "failed"; job.error = scrub(e.message); job.report = `这件活没做成：${scrub(e.message)}`; job.endedAt = Date.now(); save(); }).finally(() => { current = null; pump(); });
}

async function submit(text) {
  text = String(text || "").trim();
  if (text.length < 4) throw Object.assign(new Error("要做的事太短了"), { status: 400 });
  const st = await loginStatus();
  if (!st.installed) throw Object.assign(new Error(st.text), { status: 409 });
  if (!st.loggedIn) throw Object.assign(new Error(`Codex 还没登录 ChatGPT：在服务器终端运行 ~/qisuo-server/codex-login.sh 登录一次（${st.text}）`), { status: 409 });
  const id = randomUUID().slice(0, 8);
  const job = { id, text: text.slice(0, 8000), branch: `codex/job-${id}`, status: "queued", createdAt: Date.now(), progress: [] };
  jobs.push(job); queue.push(job); save(); pump();
  return pub(job, false);
}

export async function handleCodex(req, res, rest, CORS) {
  const send = (code, obj) => { res.writeHead(code, { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
  const body = async () => { const cs = []; for await (const c of req) cs.push(c); try { return JSON.parse(Buffer.concat(cs).toString() || "{}"); } catch { return {}; } };
  try {
    if (rest === "/status" && req.method === "GET") {
      const st = await loginStatus();
      return send(200, { ...st, github: !!GH_TOKEN, book: bookReady(), running: current ? current.id : null, queued: queue.length });
    }
    if (rest === "/job" && req.method === "POST") return send(200, await submit((await body()).text));
    const m = rest.match(/^\/job\/([\w-]+)$/);
    if (m && req.method === "GET") {
      const j = jobs.find(x => x.id === m[1]);
      return j ? send(200, pub(j)) : send(404, { error: { message: "没有这件活的记录（可能服务器记录已经清掉）" } });
    }
    return send(404, { error: { message: "没有这个地址" } });
  } catch (e) {
    return send(e.status || 400, { error: { message: scrub(e.message) } });
  }
}
