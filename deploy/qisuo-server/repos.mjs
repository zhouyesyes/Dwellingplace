// 能派活的仓库单子：问 GitHub「这把钥匙能看到哪些仓库」，每个仓库有个「能派活」开关。
// 钥匙只在服务器上（CODEX_GITHUB_TOKEN），网页只拿到仓库名和开关；开关存在 DATA/repos.json。
// 栖所自己（Dwellingplace）永远在、永远开着，是默认；私人对话本仓库（qisuo-memory）默认关着，新出现的仓库也默认关着，要她自己去开。
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const DATA = process.env.DATA_DIR || "/app/data";
const FILE = join(DATA, "repos.json");
const API = process.env.GITHUB_API || "https://api.github.com";
export const DEFAULT_REPO = process.env.CODEX_GITHUB_REPO || "zhouyesyes/Dwellingplace";
const MEMORY_RE = /(^|\/)qisuo-memory$/i;
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

let prefs = {}; // { "owner/name": true|false }，只记她动过的
try { prefs = JSON.parse(readFileSync(FILE, "utf8")); } catch { /* 还没有 */ }
const savePrefs = () => {
  try { mkdirSync(DATA, { recursive: true }); const tmp = `${FILE}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(prefs), { mode: 0o600 }); renameSync(tmp, FILE); } catch { /* 写不了就只记在内存里 */ }
};

let cache = null; // { at, list }
const TTL = 60_000;

async function fetchAll() {
  const token = process.env.CODEX_GITHUB_TOKEN || "";
  if (!token) throw Object.assign(new Error("服务器上还没放 GitHub 钥匙：再运行一次安装那一行"), { status: 409 });
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(`${API}/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "qisuo-repos" },
    });
    if (!r.ok) throw Object.assign(new Error(`问 GitHub 要仓库单子没成（返回 ${r.status}）：钥匙可能过期了或没给读仓库的权限`), { status: 502 });
    const l = await r.json();
    for (const x of l) if (!x.archived && x.permissions?.push !== false) out.push({ full: x.full_name, private: !!x.private, branch: x.default_branch || "main" });
    if (l.length < 100) break;
  }
  return out;
}

const view = x => {
  const fixed = same(x.full, DEFAULT_REPO);
  const enabled = fixed ? true : prefs[x.full] ?? false; // 没动过的一律关着（qisuo-memory 也是）
  return { full: x.full, name: x.full.split("/")[1], private: x.private, branch: x.branch, enabled, fixed, isDefault: fixed, memory: MEMORY_RE.test(x.full) };
};

// 钥匙能看到的全部仓库 + 开关；栖所本身即使钥匙没列出来也会在
export async function listRepos(force = false) {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.list.map(view);
  let raw = [];
  let error = "";
  try { raw = await fetchAll(); }
  catch (e) { if (!cache) { if (e.status) throw e; error = e.message; } else raw = cache.list; }
  if (!raw.some(x => same(x.full, DEFAULT_REPO))) raw.unshift({ full: DEFAULT_REPO, private: false, branch: "main" });
  raw.sort((a, b) => (same(b.full, DEFAULT_REPO) - same(a.full, DEFAULT_REPO)) || a.full.localeCompare(b.full));
  cache = { at: Date.now(), list: raw };
  return raw.map(view);
}

export async function setRepo(name, enabled) {
  const list = await listRepos();
  const hit = list.find(x => same(x.full, name));
  if (!hit) throw Object.assign(new Error("钥匙看不到这个仓库"), { status: 404 });
  if (hit.fixed) throw Object.assign(new Error("栖所自己永远开着"), { status: 400 });
  prefs[hit.full] = !!enabled;
  savePrefs();
  return listRepos();
}

// 派活要改哪个仓库：不写 = 栖所；写了就必须是单子里开着的（认「名字」或「owner/名字」，不分大小写）。不行就说清楚能选哪些
export async function resolveRepo(want) {
  const w = String(want || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  if (!w) return { full: DEFAULT_REPO, branch: "main", isDefault: true };
  const list = await listRepos();
  const open = list.filter(x => x.enabled);
  const hits = open.filter(x => same(x.full, w) || same(x.name, w));
  if (hits.length === 1) return { full: hits[0].full, branch: hits[0].branch, isDefault: hits[0].isDefault };
  const names = open.map(x => x.name).join("、");
  const closed = list.find(x => !x.enabled && (same(x.full, w) || same(x.name, w)));
  throw Object.assign(new Error(
    hits.length > 1 ? `仓库「${w}」重名了，写成 owner/名字 再派` :
    closed ? `仓库「${w}」在栖所的设置里还没打开「能派活」，先不派；能选的有：${names}` :
    `没有叫「${w}」的仓库（钥匙看不到，或者名字写错了）；能选的有：${names}`
  ), { status: 400 });
}
