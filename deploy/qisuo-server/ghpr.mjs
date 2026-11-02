// 给 Codex 用的 GitHub 小工具（容器里没有 gh）：开 PR、查 PR、squash 合并。钥匙从环境变量 GITHUB_TOKEN 来，不打印。
//   node /app/ghpr.mjs open <分支> <标题> <正文文件>   开 PR（合到 main），打印编号和网址
//   node /app/ghpr.mjs list                            看现在开着的 PR
//   node /app/ghpr.mjs merge <编号>                    squash 合并
const TOKEN = process.env.GITHUB_TOKEN || "";
const REPO = process.env.GITHUB_REPO || "zhouyesyes/Dwellingplace";
const API = process.env.GITHUB_API || "https://api.github.com";
import { readFileSync } from "node:fs";

async function gh(path, method = "GET", body) {
  const r = await fetch(`${API}/repos/${REPO}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "qisuo-codex", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub 返回 ${r.status}：${j.message || ""} ${JSON.stringify(j.errors || "").slice(0, 300)}`);
  return j;
}

const [cmd, a, b, c] = process.argv.slice(2);
try {
  if (!TOKEN) throw new Error("没有 GITHUB_TOKEN");
  if (cmd === "open") {
    const pr = await gh("/pulls", "POST", { head: a, base: "main", title: b, body: c ? readFileSync(c, "utf8") : "" });
    console.log(`#${pr.number} ${pr.html_url}`);
  } else if (cmd === "list") {
    const list = await gh("/pulls?state=open&per_page=30");
    for (const p of list) console.log(`#${p.number} [${p.head.ref}] ${p.title}`);
    if (!list.length) console.log("现在没有开着的 PR");
  } else if (cmd === "merge") {
    const r = await gh(`/pulls/${Number(a)}/merge`, "PUT", { merge_method: "squash" });
    console.log(r.merged ? `#${a} 已合并` : `没合并：${r.message}`);
  } else {
    console.log("用法：open <分支> <标题> <正文文件> | list | merge <编号>");
    process.exit(2);
  }
} catch (e) {
  console.error("出错了：" + e.message);
  process.exit(1);
}
