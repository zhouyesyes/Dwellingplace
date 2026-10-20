// 小螃蟹的对话本：Claude Code 这边的钩子（她的私人仓库 qisuo-memory，和栖所里那条聊天是同一本）
//   node book.mjs prompt   她每发一句：先拉最新的，把栖所那边（还有别处）新写的塞给我看，再把她这句记下
//   node book.mjs stop     我回完一轮：把我这轮说的话记下，推上去
//   node book.mjs say cloud < 报告.txt   直接写一段话进去并推上去（云端派活的窗口用它写完工报告；那边不一定装得上钩子）
// 找不到仓库、没网、没权限：什么都不做，不挡着干活。不想用：环境变量 QISUO_BOOK=off
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
if (process.env.QISUO_BOOK === "off") process.exit(0);
const RAW = (() => { try { return readFileSync(0, "utf8"); } catch { return ""; } })();
const input = (() => { try { return JSON.parse(RAW); } catch { return {}; } })();
const project = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
// 私人仓库在哪：指定的 → 栖所仓库旁边 → 当前目录下面（窗口接了好几个仓库时，工作目录可能是它们的上一层）
const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."); // 栖所仓库
const DIR = [process.env.QISUO_MEMORY_DIR, join(dirname(HERE), "qisuo-memory"), join(dirname(project), "qisuo-memory"), join(project, "qisuo-memory")]
  .find(d => d && existsSync(join(d, ".git"))) || "";
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
// 带图的话：后面接上图在这台机器上的位置，我用 Read 打开就真的看得到
const fmt = e => `[${new Date(e.ts).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} · ${WHERE[e.where] || e.where}] ${WHO[e.from] || e.from}：${String(e.text).slice(0, 1500)}`
  + (Array.isArray(e.media) && e.media.length ? `\n  （图在 ${e.media.map(m => join(DIR, m.p)).join("、")} ——用 Read 打开看${e.media.some(m => m.k === "video") ? "；视频只存了第一帧" : ""}）` : "");
const cap = (s, n) => (s.length > n ? "…" + s.slice(-n) : s);

if (!DIR) process.exit(0); // 这个窗口没接私人仓库

// ---------- 图片、视频：压小了存进私人仓库的 book/media/日期/ ----------
// 图：长边 1280、jpg、几百 KB 以内；视频：不存整段，只截第一帧当缩略图。压不了（读不到文件、没有工具）就只在话后面标「附了 N 张图片」
const IMG_EXT = /\.(png|jpe?g|webp|gif|heic|heif|bmp)$/i, VID_EXT = /\.(mp4|mov|m4v|webm|mkv)$/i;
const MEDIA_MAX_KB = 400;
const run = (cmd, args) => { try { execFileSync(cmd, args, { timeout: 60000, stdio: "ignore" }); return true; } catch { return false; } };
const shrinkImage = (src, out) => {
  for (const [size, q] of [[1280, 80], [1024, 65], [800, 55]]) {
    const ok = run("convert", [`${src}[0]`, "-auto-orient", "-background", "white", "-flatten", "-resize", `${size}x${size}>`, "-quality", String(q), out])
      || run("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-frames:v", "1", "-vf", `scale='min(${size},iw)':'min(${size},ih)':force_original_aspect_ratio=decrease`, "-q:v", String(Math.round(2 + (100 - q) / 8)), out])
      || run("python3", ["-I", "-c", `import sys\nfrom PIL import Image,ImageOps\nim=ImageOps.exif_transpose(Image.open(sys.argv[1])).convert("RGB")\nim.thumbnail((${size},${size}))\nim.save(sys.argv[2],"JPEG",quality=${q})`, src, out]);
    if (!ok || !existsSync(out)) return false;
    if (statSync(out).size <= MEDIA_MAX_KB * 1024) return true;
  }
  return existsSync(out);
};
const firstFrame = (src, out) => run("ffmpeg", ["-y", "-loglevel", "error", "-ss", "0", "-i", src, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "5", out]) && existsSync(out);
// 她这句里带的图和视频：{ text: 去掉文件路径的话, media: [...], note: 要接在话后面的标记 }
function takeMedia(prompt, entryId) {
  const found = [];
  const seenPath = new Set();
  for (const m of prompt.matchAll(/@?"([^"\n]+\.\w{2,5})"|(?:^|\s)@?(\/[^\s"]+\.\w{2,5})/g)) {
    const f = m[1] || m[2];
    if (IMG_EXT.test(f) || VID_EXT.test(f)) { if (!seenPath.has(f)) { seenPath.add(f); found.push({ f, ref: m[0].trim() }); } }
  }
  const pasted = (prompt.match(/\[Image #\d+\]/g) || []).length; // 粘贴进来的图：窗口里没有文件可存
  let text = prompt;
  const media = [];
  let lostImgs = pasted, lostVids = 0;
  const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  for (const { f, ref } of found) {
    text = text.replace(ref, "").replace(/ {2,}/g, " ");
    const vid = VID_EXT.test(f);
    let ok = false, out = "";
    if (existsSync(f)) {
      const rel = `book/media/${day}/${entryId}-${media.length + 1}.jpg`;
      out = join(DIR, rel);
      mkdirSync(dirname(out), { recursive: true });
      ok = vid ? firstFrame(f, out) : shrinkImage(f, out);
      if (ok) media.push({ p: rel, k: vid ? "video" : "image", kb: Math.max(1, Math.round(statSync(out).size / 1024)) });
    }
    if (!ok) vid ? lostVids++ : lostImgs++;
  }
  const notes = media.map(m => m.k === "video" ? `（附了一段视频，第一帧缩略图：${m.p}，约 ${m.kb}KB）` : `（附图：${m.p}，约 ${m.kb}KB）`);
  if (lostImgs) notes.push(`（附了 ${lostImgs} 张图片，没能存下来）`);
  if (lostVids) notes.push(`（附了${lostVids > 1 ? ` ${lostVids} 段` : "一段"}视频，没能截到缩略图）`);
  return { text: text.trim(), media, note: notes.join("\n") };
}

const push = () => {
  if (!tryGit("status", "--porcelain")?.trim()) return;
  tryGit("add", "-A");
  tryGit("commit", "-q", "-m", `Claude Code：${mode === "say" ? "写了一段" : "新的一轮"}`);
  if (tryGit("push", "-q") === null && tryGit("pull", "--rebase", "-q") !== null) tryGit("push", "-q");
};

if (mode === "say") {
  const text = String(input.text || (Object.keys(input).length ? "" : RAW)).trim();
  tryGit("pull", "--rebase", "-q");
  if (!text) { console.error("对话本：没收到要写的话"); process.exit(1); }
  add({ id: id(), ts: Date.now(), where: process.argv[3] || "code", from: "crab", text: text.slice(0, 20000) });
  push();
  // 这里要说清楚成没成：云端窗口看得到，推不上去时能照实告诉她（例行任务默认只能推 claude/ 开头的分支）
  let err = "";
  try { execFileSync("git", ["push", "-q"], { cwd: DIR, timeout: 20000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { err = String(e.stderr || e.message).trim(); }
  if (err) {
    // 推不上 main：换成 claude/ 开头的分支推（云端任务一般允许），再让云端窗口开 PR 合进 main
    const br = `claude/book-${Date.now().toString(36)}`;
    try {
      execFileSync("git", ["push", "-q", "origin", `HEAD:refs/heads/${br}`], { cwd: DIR, timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });
      console.error(`对话本：main 推不上去，报告推到了分支 ${br}。请用 GitHub 工具在 qisuo-memory 仓库开 PR（${br} → main）并 squash 合并，栖所才收得到。\n原来的报错：${err}`);
    } catch (e) { console.error(`对话本：写进去了，但推不上去（栖所收不到）：\n${err}\n${String(e.stderr || e.message).trim()}`); }
    process.exit(1);
  }
  console.log("对话本：写进去了，也推上去了");
  process.exit(0);
}

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
  const raw = String(input.prompt || "").trim();
  if (raw.includes("【云端派活】")) st.where = "cloud"; // 栖所派到云端的窗口：这里写的都算「云端干活」
  if (raw) {
    const eid = id();
    const { text, media, note } = takeMedia(raw, eid);
    const e = { id: eid, ts: Date.now(), where: st.where || "code", from: "me", text: [text, note].filter(Boolean).join("\n").slice(0, 20000), ...(media.length ? { media } : {}) };
    add(e, st); seen.add(e.id);
  }
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
  push();
  process.exit(0);
}
