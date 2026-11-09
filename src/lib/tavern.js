// 酒馆服务器（SillyTavern）：派活去「服务器上的 CC」。
// 地址、端口、登录用户名只存在她自己的数据里（store.settings.tavern），每次派活由网页带给服务器；不写进代码、不写进任何仓库。
import { store, roleById } from "../store/index.js";
import { codexBase } from "./codexJobs.js";

export const TAVERN_REPO = "酒馆服务器";

export const tavernCfg = () => (store.settings.tavern ??= { enabled: false, host: "", port: "22", user: "" });
// 酒馆网页的网址（主页最后一条 Tavern 点了打开它）：也只存在她自己的数据里；没填就不显示那一条
export const tavernWebUrl = () => {
  const u = (store.settings?.tavern?.web || "").trim();
  if (!u) return "";
  return /^https?:\/\//i.test(u) ? u : "http://" + u;
};
// 开着、而且三项都填了，才算能派活
export const tavernReady = () => { const c = store.settings?.tavern; return !!(c?.enabled && c.host?.trim() && c.user?.trim()); };
export const tavernBody = () => { const c = tavernCfg(); return { host: c.host.trim(), port: String(c.port || "22").trim(), user: c.user.trim() }; };

async function call(path, init) {
  const b = codexBase(roleById("main"));
  if (!b) throw new Error("找不到栖所服务器的地址");
  const r = await fetch(b + path, { cache: "no-store", ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `返回 ${r.status}`);
  return j;
}
export const tavernStatus = () => call("/tavern/status");
export const tavernTest = () => call("/tavern/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tavernBody()) });
