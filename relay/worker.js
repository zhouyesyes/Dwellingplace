// 栖所的中转（Cloudflare Worker）
//
// 作用：
//   1. 替网页去请求搜索服务（浏览器不能直接访问它们），把结果统一成一个格式带回来
//   2. 替网页转发 MCP 请求（/mcp），这样任何 MCP 服务器都能在栖所里用
// 所有请求都需要中转密码。
//
// 在 Worker 的「设置 → 变量和机密」里可以添加：
//   RELAY_TOKEN   必填。中转密码，栖所里填同一个
//   TAVILY_KEY / BOCHA_KEY / JINA_KEY / EXA_KEY / BRAVE_KEY / SERPER_KEY
//                 可选。搜索服务的 Key 放在这里，手机上就不用填

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Relay-Token, X-Search-Key",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

const cut = (s, n = 400) => {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
};

// 每家搜索服务：怎么请求，以及怎么把结果变成 [{ title, url, snippet }]
const PROVIDERS = {
  tavily: {
    env: "TAVILY_KEY",
    async search(q, n, key) {
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query: q, max_results: n, search_depth: "basic" }),
      });
      const j = await check(r);
      return (j.results || []).map(x => ({ title: x.title, url: x.url, snippet: x.content }));
    },
  },
  bocha: {
    env: "BOCHA_KEY",
    async search(q, n, key) {
      const r = await fetch("https://api.bochaai.com/v1/web-search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query: q, count: n, summary: true }),
      });
      const j = await check(r);
      const list = j.data?.webPages?.value || j.webPages?.value || [];
      return list.map(x => ({ title: x.name, url: x.url, snippet: x.summary || x.snippet }));
    },
  },
  jina: {
    env: "JINA_KEY",
    async search(q, n, key) {
      const r = await fetch(`https://s.jina.ai/?q=${encodeURIComponent(q)}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${key}`, "X-Respond-With": "no-content" },
      });
      const j = await check(r);
      return (j.data || []).slice(0, n).map(x => ({ title: x.title, url: x.url, snippet: x.description || x.content }));
    },
  },
  exa: {
    env: "EXA_KEY",
    async search(q, n, key) {
      const r = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key },
        body: JSON.stringify({ query: q, numResults: n, contents: { text: { maxCharacters: 600 } } }),
      });
      const j = await check(r);
      return (j.results || []).map(x => ({ title: x.title, url: x.url, snippet: x.text }));
    },
  },
  brave: {
    env: "BRAVE_KEY",
    async search(q, n, key) {
      const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${n}`, {
        headers: { Accept: "application/json", "X-Subscription-Token": key },
      });
      const j = await check(r);
      return (j.web?.results || []).map(x => ({ title: x.title, url: x.url, snippet: x.description }));
    },
  },
  serper: {
    env: "SERPER_KEY",
    async search(q, n, key) {
      const r = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": key },
        body: JSON.stringify({ q, num: n }),
      });
      const j = await check(r);
      return (j.organic || []).map(x => ({ title: x.title, url: x.link, snippet: x.snippet }));
    },
  },
};

async function check(r) {
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`搜索服务返回 ${r.status}：${text.slice(0, 200)}`), { status: r.status });
  try { return JSON.parse(text); } catch { throw new Error("搜索服务返回的不是 JSON：" + text.slice(0, 120)); }
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (!env.RELAY_TOKEN) return json({ error: "中转还没有设置密码：请在 Worker 的「变量和机密」里添加 RELAY_TOKEN" }, 500);
    if (req.headers.get("X-Relay-Token") !== env.RELAY_TOKEN) return json({ error: "中转密码不对" }, 401);

    const path = new URL(req.url).pathname.replace(/\/+$/, "");

    // 测试连接：返回哪些搜索服务已经在 Worker 里配好了 Key
    if (path === "/ping") {
      const ready = Object.entries(PROVIDERS).filter(([, p]) => env[p.env]).map(([k]) => k);
      return json({ ok: true, version: 2, features: ["search", "mcp"], providers: Object.keys(PROVIDERS), ready });
    }

    if (path === "/search" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "请求格式不对" }, 400); }
      const p = PROVIDERS[body.provider];
      if (!p) return json({ error: `不支持的搜索服务：${body.provider}` }, 400);
      const key = env[p.env] || req.headers.get("X-Search-Key") || "";
      if (!key) return json({ error: `没有 ${body.provider} 的 Key：在栖所里填，或者在 Worker 里添加 ${p.env}` }, 400);
      const q = String(body.query || "").trim().slice(0, 300);
      if (!q) return json({ error: "搜索内容是空的" }, 400);
      const n = Math.min(Math.max(Number(body.count) || 5, 1), 10);
      try {
        const results = (await p.search(q, n, key))
          .filter(x => x.url)
          .slice(0, n)
          .map(x => ({ title: cut(x.title, 120), url: x.url, snippet: cut(x.snippet) }));
        return json({ query: q, provider: body.provider, results });
      } catch (e) {
        return json({ error: e.message || String(e) }, 502);
      }
    }

    // MCP：把一条 JSON-RPC 消息转发给 MCP 服务器（Streamable HTTP），原样带回结果
    if (path === "/mcp" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "请求格式不对" }, 400); }
      const target = String(body.url || "");
      const allowHttp = env.ALLOW_HTTP === "1"; // 只在本地测试时打开
      if (!/^https:\/\//i.test(target) && !(allowHttp && /^http:\/\//i.test(target))) {
        return json({ error: "MCP 地址必须以 https:// 开头" }, 400);
      }
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(body.headers && typeof body.headers === "object" ? body.headers : {}),
      };
      if (body.sessionId) headers["Mcp-Session-Id"] = body.sessionId;
      if (body.protocolVersion) headers["MCP-Protocol-Version"] = body.protocolVersion;
      try {
        const r = await fetch(target, { method: "POST", headers, body: JSON.stringify(body.message) });
        const text = await r.text();
        return json({
          status: r.status,
          sessionId: r.headers.get("mcp-session-id"),
          contentType: r.headers.get("content-type") || "",
          body: text.slice(0, 2_000_000),
        });
      } catch (e) {
        return json({ error: "连不上 MCP 服务器：" + (e.message || e) }, 502);
      }
    }

    return json({ error: "没有这个地址" }, 404);
  },
};
