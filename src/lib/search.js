// 通过 Cloudflare Worker 中转去联网搜索
import { store } from "../store/index.js";

export const SEARCH_PROVIDERS = {
  tavily: { label: "Tavily", note: "每月有免费额度，英文为主，中文也可以" },
  bocha: { label: "博查", note: "国内的搜索服务，中文结果好" },
  jina: { label: "Jina", note: "注册送免费额度" },
  exa: { label: "Exa", note: "偏英文内容" },
  brave: { label: "Brave", note: "需要绑卡，有免费档" },
  serper: { label: "Serper（Google）", note: "注册送免费次数" },
};

const base = () => (store.tools.relay?.url || "").trim().replace(/\/+$/, "");

export const searchEnabled = () => !!(store.tools.search?.enabled && base() && store.tools.relay?.token);

async function call(path, body) {
  if (!base()) throw new Error("还没有填中转地址");
  let res;
  try {
    res = await fetch(base() + path, {
      method: body ? "POST" : "GET",
      headers: {
        "X-Relay-Token": store.tools.relay.token || "",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(store.tools.search?.key ? { "X-Search-Key": store.tools.search.key } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout?.(25_000),
    });
  } catch {
    throw new Error("连不上中转（检查地址；workers.dev 在国内可能需要开 VPN）");
  }
  let data = null;
  try { data = await res.json(); } catch { /* 不是 JSON */ }
  if (!res.ok) throw new Error(data?.error || `中转返回 ${res.status}`);
  return data;
}

export const relayPing = () => call("/ping");

export function relaySearch(query) {
  return call("/search", { provider: store.tools.search.provider, query, count: 5 });
}

// 给 AI 看的搜索结果
export function formatResults(results) {
  if (!results.length) return "（没有找到结果）";
  return results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
}
