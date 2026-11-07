// 派活能改的仓库：单子在她的服务器上（服务器拿 GitHub 钥匙去问 GitHub，钥匙不经过网页），这里只取名字和开关。
// 聊天的系统提示要同步用到「现在开着哪些」，所以这里留一份缓存，后台刷新。
import { reactive } from "vue";
import { roleById } from "../store/index.js";
import { codexBase } from "./codexJobs.js";

export const repoState = reactive({ list: null, error: "", loading: false, at: 0 });

const base = () => codexBase(roleById("main"));

async function call(path, init) {
  const b = base();
  if (!b) throw new Error("找不到栖所服务器的地址");
  const r = await fetch(b + path, { cache: "no-store", ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `返回 ${r.status}`);
  return j.repos || [];
}

export async function loadRepos(fresh = false) {
  if (repoState.loading) return;
  repoState.loading = true;
  try { repoState.list = await call("/repos" + (fresh ? "?fresh=1" : "")); repoState.error = ""; repoState.at = Date.now(); }
  catch (e) { repoState.error = e.message; }
  finally { repoState.loading = false; }
}

export async function toggleRepo(full, enabled) {
  repoState.list = await call("/repos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: full, enabled }) });
  repoState.error = "";
}

// 给系统提示用：现在开着、栖所以外的仓库名（缓存里没有就悄悄去取一次，下一轮聊天就有了）
export function otherRepoNames() {
  if (!repoState.list || Date.now() - repoState.at > 5 * 60_000) loadRepos().catch(() => {});
  return (repoState.list || []).filter(x => x.enabled && !x.isDefault && !x.memory).map(x => x.name);
}

// 派活正文开头的「仓库：名字」拆出来；没写就是栖所
export function splitRepo(job) {
  const m = String(job).match(/^\s*仓库[:：]\s*([^\s，,。;；\n]+)[ \t]*[，,。;；]?\s*/);
  return m ? { repo: m[1], text: job.slice(m[0].length).trim() } : { repo: "", text: String(job).trim() };
}
