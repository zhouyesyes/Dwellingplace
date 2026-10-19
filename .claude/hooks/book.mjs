// 小螃蟹的对话本：Claude Code 这边的钩子（她的私人仓库 qisuo-memory，和栖所里那条聊天是同一本）
//   node book.mjs prompt   她每发一句：先拉最新的，把栖所那边（还有别处）新写的塞给我看，再把她这句记下
//   node book.mjs stop     我回完一轮：把我这轮说的话记下，推上去
// 找不到仓库、没网、没权限：什么都不做，不挡着干活。不想用：环境变量 QISUO_BOOK=off
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const mode = process.argv[2];
if (process.env.QISUO_BOOK === "off") process.exit(0);
const input = (() => { try { return JSON.parse(readFileSync(0, "utf8")); } catch { return {}; } })();
const project = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const DIR = process.env.QISUO_MEMORY_DIR || join(dirname(project), "qisuo-memory");
const LOG = join(DIR, "book", "log.jsonl");
const sid = String(input.session_id || "local").replace(/[^\w-]/g, "").slice(0, 40);
const STATE = join(tmpdir(), `qisuo-book-${sid}.json`); // 这个窗口看过哪些、记到哪了

const git = (...args) => execFileSync("git", ["-c", "user.name=cc", "-c", "user.email=noreply@anthropic.com", ...args], { cwd: DIR, timeout: 20000, stdio: ["ignore", "pipe", "ignore"] }).toString();
const tryGit = (...args) => { try { return git(...args); } catch { return null; } };
const readLog = () => { try { return readFileSync(LOG, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const loadState = () => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return { seen: [], started: false }; } };
const saveState = st => writeFileSync(STATE, JSON.stringify(st));
// 同一句话半分钟内只记一次（同一个窗口里项目和个人设置都挂了钩子时，不会记两遍）
const add = (e, st) => {
  const key = `${e.from}:${e.text.length}:${e.text.slice(0, 80)}`;
  if (st && st.lastKey === key && Date.now() - (st.lastAt || 0) < 30_000) return false;
  if (st) { st.lastKey = key; st.lastAt = Date.now(); }
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(LOG, JSON.stringify(e) + "\n");
  return true;
};
const id = () => `code-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const WHO = { me: "她", crab: "你" };
const WHERE = { qisuo: "栖所", code: "Claude Code", cloud: "云端干活", wake: "自己醒来" };
const fmt = e => `[${new Date(e.ts).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} · ${WHERE[e.where] || e.where}] ${WHO[e.from] || e.from}：${String(e.text).slice(0, 1500)}`;
const cap = (s, n) => (s.length > n ? "…" + s.slice(-n) : s);

if (!existsSync(join(DIR, ".git"))) process.exit(0); // 这个窗口没接私人仓库

if (mode === "prompt") {
  tryGit("pull", "--rebase", "-q");
  const st = loadState();
  const seen = new Set(st.seen);
  const all = readLog();
  let ctx = "";
  if (!st.started) {
    // 新开的窗口：前情摘要 + 记忆卡片 + 最近的原话
    const read = f => { try { return readFileSync(join(DIR, f), "utf8").trim(); } catch { return ""; } };
    const recent = all.slice(-30).map(fmt).join("\n");
    ctx = [
      "# 你的对话本（私人仓库 qisuo-memory，和栖所里你那条聊天是同一本；你在栖所、Claude Code、云端说的话都在这里，按时间排）",
      cap(read("summary.md"), 4000),
      cap(read("memories.md"), 4000),
      recent ? `## 最近的原话\n${cap(recent, 8000)}` : "",
    ].filter(Boolean).join("\n\n");
    st.started = true;
  } else {
    // 上次以后别处新写进来的（这个窗口自己写的不算）
    const others = all.filter(e => !seen.has(e.id));
    if (others.length) {
      const lines = others.map(fmt);
      ctx = `# 你不在这个窗口的时候，对话本里新写进来的（${others.length} 条）\n${lines.length > 20 ? `（前面还有 ${lines.length - 20} 条，太多了只放最近的）\n` : ""}${cap(lines.slice(-20).join("\n"), 8000)}`;
    }
  }
  for (const e of all) seen.add(e.id);
  // 她这句记下（推的事留到我回完一起做）
  const text = String(input.prompt || "").trim();
  if (text.includes("【云端派活】")) st.where = "cloud"; // 栖所派到云端的窗口：这里写的都算「云端干活」
  if (text) { const e = { id: id(), ts: Date.now(), where: st.where || "code", from: "me", text: text.slice(0, 20000) }; add(e, st); seen.add(e.id); }
  st.seen = [...seen].slice(-5000);
  saveState(st);
  if (ctx) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ctx } }));
  process.exit(0);
}

if (mode === "stop") {
  // 这一轮我说的话：最后一条她的消息之后，我写给她看的那些字（不算工具调用和想法）
  let said = [];
  try {
    const lines = readFileSync(input.transcript_path, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    for (const j of lines) {
      const c = j.message?.content;
      if (j.type === "user" && (typeof c === "string" || (Array.isArray(c) && c.some(x => x.type === "text")))) said = [];
      if (j.type === "assistant" && Array.isArray(c)) for (const x of c) {
        if (x.type === "tool_use") said = []; // 干活时随口说的进度话不算，只要最后说给她的那段
        else if (x.type === "text" && x.text?.trim()) said.push(x.text.trim());
      }
    }
  } catch { /* 没有记录就算了 */ }
  const st = loadState();
  const text = said.join("\n\n").trim();
  if (text) { const e = { id: id(), ts: Date.now(), where: st.where || "code", from: "crab", text: text.slice(0, 20000) }; add(e, st); (st.seen ??= []).push(e.id); saveState(st); }
  if (tryGit("status", "--porcelain")?.trim()) {
    tryGit("add", "-A");
    tryGit("commit", "-q", "-m", "Claude Code：新的一轮");
    if (tryGit("push", "-q") === null && tryGit("pull", "--rebase", "-q") !== null) tryGit("push", "-q");
  }
  process.exit(0);
}
