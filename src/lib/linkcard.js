// 网址卡片：聊天里的网址画成一张卡片（标题、简介、封面、网站名）。
//   他也可以自己写：[网址卡片:网址|标题|一句话说明]，单独一个气泡
//   网页信息由你的服务器去读（/preview），读过的记在这里，同一个网址不重复问
import { reactive } from "vue";
import { serverBase } from "./server.js";

export const CARD_RE = /\[网址卡片[:：]([^\]\n]{4,600})\]/;
const URL_RE = /https?:\/\/[^\s<>"'，。！？、；：（）【】「」]+[^\s<>"'，。！？、；：（）【】「」.,!?;:)\]]/g;

// 一个气泡就是一张卡片标签
export function cardOf(b) {
  const m = String(b).trim().match(new RegExp(`^${CARD_RE.source}$`));
  if (!m) return null;
  const [url, title, desc] = m[1].split(/[|｜]/).map(s => s.trim());
  return /^https?:\/\//.test(url) ? { url, title, desc } : null;
}
// 气泡里的网址（最多 3 个，重复的只算一次）
export function urlsIn(text) {
  return [...new Set(String(text || "").match(URL_RE) || [])].slice(0, 3);
}
// 气泡只有一个网址、别的什么都没有：只画卡片，不再显示那串网址
export const onlyUrl = text => { const t = String(text || "").trim(); const u = urlsIn(t); return u.length === 1 && u[0] === t; };

const infos = reactive({}); // url → { loading, title, description, image, site, icon, error }
export function previewOf(url) {
  if (!infos[url]) {
    infos[url] = { loading: true };
    (async () => {
      const base = await serverBase();
      if (!base) return (infos[url] = { error: "没找到你的服务器地址（设置 → 同步里连上服务器就好）" });
      try {
        const r = await fetch(`${base}/preview/?url=${encodeURIComponent(url)}`);
        const j = await r.json();
        if (r.status === 404 && /不认识/.test(j.error?.message || "")) throw new Error("服务器还是旧的：再运行一次安装那一行");
        if (!r.ok) throw new Error(j.error?.message || r.status);
        const img = u => (u ? `${base}/preview/img?url=${encodeURIComponent(u)}` : "");
        infos[url] = { ...j, image: img(j.image), icon: img(j.icon) };
      } catch (e) {
        infos[url] = { error: e.message };
      }
    })();
  }
  return infos[url];
}
