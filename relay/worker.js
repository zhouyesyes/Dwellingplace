// 栖所的中转（Cloudflare Worker）
//
// 作用：
//   1. 替网页去请求搜索服务（浏览器不能直接访问它们），把结果统一成一个格式带回来
//   2. 替网页转发 MCP 请求（/mcp），这样任何 MCP 服务器都能在栖所里用
//   3. 读取一个网页的正文（/fetch），给 AI 看
//   4. 唤醒（/wake/…）：定时叫醒 AI，让 TA 自己决定要不要给你发消息、用工具；再推送通知到手机（/push/…）
// 所有请求都需要中转密码。
//
// 在 Worker 的「设置 → 变量和机密」里可以添加：
//   RELAY_TOKEN   必填。中转密码，栖所里填同一个
//   TAVILY_KEY / BOCHA_KEY / JINA_KEY / EXA_KEY / BRAVE_KEY / SERPER_KEY
//                 可选。搜索服务的 Key 放在这里，手机上就不用填
//
// 唤醒还需要（见 docs/wake.md）：
//   绑定一个 KV 命名空间，变量名 KV
//   添加一个 Cron 触发器：*/5 * * * *

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

// 把 HTML 变成干净的文字
function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(nav|footer|aside)[\s\S]*?<\/\1>/gi, "") // 导航、页脚、侧栏一般不是正文
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "· ")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s)
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: decodeEntities(title), text: s };
}

function decodeEntities(s) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", middot: "·" };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return named[e.toLowerCase()] ?? m;
  });
}

// 搜索（中转接口和唤醒时都用）
async function doSearch(env, provider, query, count, userKey) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`不支持的搜索服务：${provider}`);
  const key = env[p.env] || userKey || "";
  if (!key) throw new Error(`没有 ${provider} 的 Key：在栖所里填，或者在 Worker 里添加 ${p.env}`);
  const q = String(query || "").trim().slice(0, 300);
  if (!q) throw new Error("搜索内容是空的");
  const n = Math.min(Math.max(Number(count) || 5, 1), 10);
  const results = (await p.search(q, n, key))
    .filter(x => x.url)
    .slice(0, n)
    .map(x => ({ title: cut(x.title, 120), url: x.url, snippet: cut(x.snippet) }));
  return { query: q, provider, results };
}

// 读网页：返回标题和正文文字
async function readPage(target, maxLength) {
  target = String(target || "").trim();
  if (!/^https?:\/\//i.test(target)) throw Object.assign(new Error("网址要以 http:// 或 https:// 开头"), { status: 400 });
  const max = Math.min(Math.max(Number(maxLength) || 8000, 500), 40000);
  let r;
  try {
    r = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DwellingplaceReader/1.0)", Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw Object.assign(new Error("打不开这个网页：" + (e.message || e)), { status: 502 });
  }
  const type = r.headers.get("content-type") || "";
  if (!/text|json|xml|javascript/i.test(type)) throw Object.assign(new Error(`这个链接不是网页（${type || "未知类型"}），读不了`), { status: 415 });
  const raw = (await r.text()).slice(0, 3_000_000);
  const { title, text } = /html/i.test(type) ? htmlToText(raw) : { title: "", text: raw };
  return { status: r.status, url: r.url, title, text: text.slice(0, max), truncated: text.length > max, length: text.length };
}

// ======================================================================
// 唤醒
//
// 栖所把需要的东西（设定、记忆、最近的聊天、API、MCP）同步到 KV 里，
// 定时任务每 5 分钟看一次：哪个 AI 该醒了，就替 TA 调用一次模型。
// TA 可以发消息、用工具，也可以什么都不做；发的消息先放在「收件箱」里，
// 同时推送通知到手机，等栖所打开时取走。
//
// KV 里的东西：
//   cfg                     栖所同步上来的设置
//   sched:<角色>            下次定时醒来的时间、今天哪些固定时间已经醒过
//   alarm:<角色>:<编号>     TA 自己定的闹钟（内容在 metadata 里）
//   box:<时间>:<编号>       还没被栖所取走的消息
//   boxlatest               收件箱最后一次有新东西的时间
//   sub:<编号>              手机的推送订阅
//   vapid                   推送用的密钥（第一次用时自动生成）
// ======================================================================

const BJ = 8 * 3600_000; // 北京时间
const DAY = 86400_000;
const MAX_ALARMS = 5;
const MAX_ROUNDS = 6;
const pad = n => String(n).padStart(2, "0");
const bj = ms => new Date(ms + BJ); // 用 getUTC* 读出来就是北京时间
const bjDayStart = ms => ms - ((ms + BJ) % DAY);
const ymd = ms => { const d = bj(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const minuteOfDay = ms => { const d = bj(ms); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hm2min = s => { const [h, m] = String(s || "").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const rid = () => Math.random().toString(36).slice(2, 6);

function nowText(ms) {
  const d = bj(ms);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日 星期${"日一二三四五六"[d.getUTCDay()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function gapText(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} 分钟`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} 小时`;
  return `${Math.round(h / 24)} 天`;
}

function whenLabel(at, now = Date.now()) {
  const d = bj(at);
  const days = Math.round((bjDayStart(at) - bjDayStart(now)) / DAY);
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (days === 0) return `今天 ${hm}`;
  if (days === 1) return `明天 ${hm}`;
  if (days === 2) return `后天 ${hm}`;
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${hm}`;
}

// 免打扰时段：{ enabled, from: "03:00", to: "10:00" }，可以跨过半夜
function inQuiet(quiet, ms) {
  if (!quiet?.enabled) return false;
  const f = hm2min(quiet.from), t = hm2min(quiet.to);
  if (f === t) return false;
  const m = minuteOfDay(ms);
  return f < t ? m >= f && m < t : m >= f || m < t;
}

// 「21:30」「9点半」「晚上8点」
function parseClock(t) {
  const m = String(t || "").trim().match(/^(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2})(?:\s*(?::|点|时)\s*(半|\d{1,2})?\s*分?)?$/);
  if (!m) return null;
  let h = Number(m[2]);
  const mi = m[3] === "半" ? 30 : Number(m[3] || 0);
  if (/下午|傍晚|晚上|夜里/.test(m[1] || "") && h < 12) h += 12;
  if (m[1] === "中午" && h < 6) h += 12;
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

// AI 写的时间 → 时间戳（北京时间）。看不懂返回 null
function parseWhen(raw, now = Date.now()) {
  let s = String(raw || "").trim().replace(/：/g, ":").replace(/\s+/g, " ");
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(分钟|分|min|mins|minutes?|小时|个小时|个钟头|钟头|h|hours?|天)\s*(后|以后|之后)?$/i);
  if (m) {
    const unit = /天/.test(m[2]) ? 1440 : /小时|钟头|^h/i.test(m[2]) ? 60 : 1;
    return now + Math.round(Number(m[1]) * unit * 60000);
  }
  let base = null;
  let fixedDay = false;
  m = s.match(/^(?:(\d{4})\s*[-/.年]\s*)?(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*[日号]?\s*(.*)$/);
  if (m) {
    const d = bj(now);
    const y = m[1] ? Number(m[1]) : d.getUTCFullYear();
    base = Date.UTC(y, Number(m[2]) - 1, Number(m[3])) - BJ;
    if (!m[1] && base + DAY <= now) base = Date.UTC(y + 1, Number(m[2]) - 1, Number(m[3])) - BJ;
    s = m[4];
    fixedDay = true;
  } else {
    m = s.match(/^(今天|今早|今晚|明天|明早|明晚|后天)\s*(.*)$/);
    if (m) {
      const off = m[1].startsWith("明") ? 1 : m[1] === "后天" ? 2 : 0;
      base = bjDayStart(now) + off * DAY;
      s = (m[1].endsWith("晚") ? "晚上" : m[1].endsWith("早") ? "早上" : "") + m[2];
      fixedDay = true;
    }
  }
  const clock = s.trim() ? parseClock(s) : fixedDay ? 9 * 60 : null;
  if (clock === null) return null;
  let at = (base ?? bjDayStart(now)) + clock * 60000;
  if (!fixedDay && at <= now) at += DAY; // 只写了几点：已经过了就是明天
  return at;
}

// ---------- 闹钟 ----------
async function listAlarms(env, roleId) {
  const out = [];
  let cursor;
  do {
    const r = await env.KV.list({ prefix: roleId ? `alarm:${roleId}:` : "alarm:", cursor });
    for (const k of r.keys) {
      const [, role, id] = k.name.split(":");
      out.push({ key: k.name, roleId: role, id, at: k.metadata?.at || 0, note: k.metadata?.note || "" });
    }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out.sort((a, b) => a.at - b.at);
}

const alarmView = (a, now) => ({ id: a.id, at: a.at, note: a.note, label: whenLabel(a.at, now) });

async function addAlarm(env, roleId, when, note, quiet, now = Date.now()) {
  const at = parseWhen(when, now);
  if (!at) return { error: `看不懂这个时间「${when}」` };
  if (at < now + 60_000) return { error: "这个时间已经过去了" };
  if (at > now + 60 * DAY) return { error: "只能定 60 天以内的闹钟" };
  if (inQuiet(quiet, at)) return { error: `${quiet.from}–${quiet.to} 是免打扰时间，闹钟不能定在这段时间里` };
  const list = await listAlarms(env, roleId);
  if (list.length >= MAX_ALARMS) return { error: `已经定了 ${MAX_ALARMS} 个闹钟，等它们响完或者取消一个再定` };
  const id = rid();
  note = cut(note, 100);
  await env.KV.put(`alarm:${roleId}:${id}`, "1", { metadata: { at, note }, expiration: Math.floor(at / 1000) + 7 * 86400 });
  const alarm = alarmView({ id, at, note }, now);
  return { ok: true, alarm, alarms: [...list.map(a => alarmView(a, now)), alarm].sort((a, b) => a.at - b.at) };
}

async function cancelAlarm(env, roleId, id) {
  id = String(id || "").replace(/^#/, "").trim();
  const list = await listAlarms(env, roleId);
  const a = list.find(x => x.id === id);
  if (!a) return { error: `没有编号是 #${id} 的闹钟` };
  await env.KV.delete(a.key);
  return { ok: true, alarm: alarmView(a, Date.now()), alarms: list.filter(x => x !== a).map(x => alarmView(x, Date.now())) };
}

// ---------- 推送（Web Push：VAPID + aes128gcm） ----------
const enc = s => new TextEncoder().encode(s);
const b64u = buf => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
function concat(...parts) {
  const list = parts.map(p => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(list.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of list) { out.set(p, i); i += p.length; }
  return out;
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

async function vapidKeys(env) {
  let v = await env.KV.get("vapid", "json");
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    v = { pub: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), jwk: await crypto.subtle.exportKey("jwk", kp.privateKey) };
    await env.KV.put("vapid", JSON.stringify(v));
  }
  return v;
}

async function vapidAuth(env, endpoint) {
  const v = await vapidKeys(env);
  const head = b64u(enc(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.PUSH_CONTACT || "mailto:qisuo@users.noreply.github.com" })));
  const key = await crypto.subtle.importKey("jwk", v.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${v.pub}`;
}

// RFC 8291：用手机给的公钥加密通知内容
async function encryptPush(sub, payload) {
  const uaPub = unb64u(sub.keys.p256dh);
  const auth = unb64u(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hmac(await hmac(auth, shared), concat(enc("WebPush: info\0"), uaPub, asPub, [1]));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc("Content-Encoding: aes128gcm\0"), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc("Content-Encoding: nonce\0"), [1]))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc(payload), [2])));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPub.length;
  return concat(header, asPub, body);
}

async function subId(endpoint) {
  return b64u(await crypto.subtle.digest("SHA-256", enc(endpoint))).slice(0, 22);
}

// 推送给所有订阅过的手机。返回 { sent, failed, errors }
async function pushAll(env, data) {
  const out = { sent: 0, failed: 0, errors: [] };
  const { keys } = await env.KV.list({ prefix: "sub:" });
  for (const k of keys) {
    const sub = await env.KV.get(k.name, "json");
    if (!sub?.endpoint) continue;
    try {
      const r = await fetch(sub.endpoint, {
        method: "POST",
        headers: {
          Authorization: await vapidAuth(env, sub.endpoint),
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: "86400",
          Urgency: "high",
        },
        body: await encryptPush(sub, JSON.stringify(data)),
      });
      if (r.ok) out.sent++;
      else {
        out.failed++;
        out.errors.push(`${r.status} ${(await r.text()).slice(0, 120)}`);
        if (r.status === 404 || r.status === 410) await env.KV.delete(k.name); // 这台手机取消了订阅
      }
    } catch (e) {
      out.failed++;
      out.errors.push(String(e.message || e));
    }
  }
  return out;
}

// ---------- 调用模型 ----------
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|fable-5-1|fable-5|sonnet-5-5)$/;
const NEW_SEARCH_MODELS = /^claude-(fable-5|mythos-5|opus-5|opus-4-[6-9]|sonnet-5|sonnet-4-6)/;
const trimUrl = u => String(u || "").trim().replace(/\/+$/, "");

async function callAnthropic(api, system, messages, webSearch) {
  const base = trimUrl(api.baseUrl) || "https://api.anthropic.com";
  const headers = { "Content-Type": "application/json", "x-api-key": api.key, "anthropic-version": "2023-06-01" };
  const body = {
    model: api.model,
    max_tokens: Math.min(Number(api.maxTokens) || 8000, 16000),
    system,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  };
  if (api.effort) body.output_config = { effort: api.effort };
  if (webSearch) body.tools = [{ type: NEW_SEARCH_MODELS.test(api.model) ? "web_search_20260209" : "web_search_20250305", name: "web_search", max_uses: 3 }];
  if (/(^|\/\/)api\.anthropic\.com/.test(base) && FALLBACK_MODELS.test(api.model)) {
    body.fallbacks = "default";
    headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
  }
  let text = "";
  const usage = { input: 0, output: 0 };
  for (let round = 0; round < 4; round++) {
    const r = await fetch(`${base}/v1/messages`, { method: "POST", headers, body: JSON.stringify(body) });
    const raw = await r.text();
    if (!r.ok) throw new Error(`接口返回 ${r.status}：${raw.slice(0, 200)}`);
    const j = JSON.parse(raw);
    if (j.stop_reason === "refusal") throw new Error("模型拒绝了这次请求");
    text += (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    usage.input += j.usage?.input_tokens ?? 0;
    usage.output += j.usage?.output_tokens ?? 0;
    if (j.stop_reason !== "pause_turn") break;
    body.messages = [...body.messages, { role: "assistant", content: j.content }];
  }
  return { text, usage };
}

async function callOpenAI(api, system, messages) {
  const r = await fetch(`${trimUrl(api.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(api.key ? { Authorization: `Bearer ${api.key}` } : {}) },
    body: JSON.stringify({
      model: api.model,
      max_tokens: Number(api.maxTokens) || undefined,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  const raw = await r.text();
  if (!r.ok) throw new Error(`接口返回 ${r.status}：${raw.slice(0, 200)}`);
  const j = JSON.parse(raw);
  const content = j.choices?.[0]?.message?.content || "";
  const text = (typeof content === "string" ? content : content.map(c => c.text || "").join(""))
    .replace(/<(think|thought|thinking)>[\s\S]*?(<\/\1>|$)/g, "")
    .trim();
  return { text, usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 } };
}

function callModel(api, system, messages, webSearch) {
  if (!api?.model) throw new Error("这个角色还没有可用的 API 或模型");
  return api.type === "openai" ? callOpenAI(api, system, messages) : callAnthropic(api, system, messages, webSearch);
}

// ---------- MCP（唤醒时直接从 Worker 连） ----------
let mcpId = 1;
async function mcpPost(server, message, session) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(server.headers || {}) };
  if (session?.sessionId) headers["Mcp-Session-Id"] = session.sessionId;
  if (session?.protocolVersion) headers["MCP-Protocol-Version"] = session.protocolVersion;
  const r = await fetch(server.url, { method: "POST", headers, body: JSON.stringify(message), signal: AbortSignal.timeout(60000) });
  return { status: r.status, sessionId: r.headers.get("mcp-session-id"), contentType: r.headers.get("content-type") || "", body: await r.text() };
}

function mcpParse(r, id) {
  const text = r.body || "";
  if (r.contentType.includes("text/event-stream")) {
    let last = null;
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
      if (!data) continue;
      try {
        const msg = JSON.parse(data);
        if (msg.id === id) return msg;
        last = msg;
      } catch { /* 跳过 */ }
    }
    return last;
  }
  if (!text.trim()) return null;
  return JSON.parse(text);
}

async function mcpRpc(server, method, params, session) {
  const id = mcpId++;
  const r = await mcpPost(server, { jsonrpc: "2.0", id, method, params }, session);
  if (r.status >= 400) throw Object.assign(new Error(`MCP 返回 ${r.status}：${r.body.slice(0, 160)}`), { status: r.status });
  const msg = mcpParse(r, id);
  if (!msg) throw new Error("MCP 没有返回内容");
  if (msg.error) throw new Error(`MCP 出错：${msg.error.message || JSON.stringify(msg.error)}`);
  return { result: msg.result, sessionId: r.sessionId };
}

async function mcpCall(sessions, server, name, args) {
  const connect = async () => {
    const { result, sessionId } = await mcpRpc(server, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dwellingplace-wake", version: "1.0" } });
    const s = { sessionId, protocolVersion: result?.protocolVersion || "2025-06-18" };
    await mcpPost(server, { jsonrpc: "2.0", method: "notifications/initialized" }, s).catch(() => {});
    sessions.set(server.name, s);
    return s;
  };
  let session = sessions.get(server.name) || (await connect());
  let res;
  try {
    res = await mcpRpc(server, "tools/call", { name, arguments: args || {} }, session);
  } catch (e) {
    if (e.status !== 404 && e.status !== 400) throw e;
    session = await connect();
    res = await mcpRpc(server, "tools/call", { name, arguments: args || {} }, session);
  }
  const result = res.result;
  const parts = (result?.content || []).map(c => {
    if (c.type === "text") return c.text;
    if (c.type === "resource") return c.resource?.text || `[资源 ${c.resource?.uri || ""}]`;
    if (c.type === "image") return "[图片]";
    return JSON.stringify(c);
  });
  if (result?.structuredContent && !parts.length) parts.push(JSON.stringify(result.structuredContent));
  return { text: parts.join("\n") || "（没有返回内容）", isError: !!result?.isError };
}

function resolveTool(servers, fullName) {
  for (const s of servers) {
    if (fullName.startsWith(s.name + ".")) {
      const tool = fullName.slice(s.name.length + 1);
      if (s.tools.includes(tool)) return { server: s, tool };
    }
  }
  for (const s of servers) {
    const tool = s.tools.find(t => t === fullName || fullName.endsWith("." + t));
    if (tool) return { server: s, tool };
  }
  return null;
}

// ---------- 醒来一次 ----------
const TOOL_CALL_RE = /<tool_call\s+name="([^"]+)"\s*>([\s\S]*?)<\/tool_call>/;
const SEARCH_RE = /\[搜索[:：]\s*([^\]\n]{1,120})\]/;
const ALARM_RE = /\[(定闹钟|取消闹钟)[:：]([^\]\n]{1,200})\]/g;
const SILENT_RE = /\[不发消息\]/;
const visible = t => String(t || "")
  .replace(/\[(签名|记忆|改记忆|记日历|改日历|删日历|定闹钟|取消闹钟|搜索)[:：][^\]]*\]/g, "")
  .replace(SILENT_RE, "")
  .replace(/<tool_call[\s\S]*?(<\/tool_call>|$)/g, "")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

function toConvo(history) {
  const out = [];
  for (const m of history) {
    const role = m.from === "user" ? "user" : "assistant";
    const content = String(m.text || "").trim();
    if (!content) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content += "\n\n" + content;
    else out.push({ role, content });
  }
  if (!out.length || out[0].role !== "user") out.unshift({ role: "user", content: "（开始聊天）" });
  return out;
}

const addTurn = (convo, role, content) => {
  const last = convo[convo.length - 1];
  if (last?.role === role && typeof last.content === "string") return [...convo.slice(0, -1), { role, content: last.content + "\n\n" + content }];
  return [...convo, { role, content }];
};

// 还没被栖所取走的消息
async function pendingBox(env) {
  const out = [];
  let cursor;
  do {
    const r = await env.KV.list({ prefix: "box:", cursor });
    for (const k of r.keys) {
      const item = await env.KV.get(k.name, "json");
      if (item) out.push({ ...item, key: k.name });
    }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out.sort((a, b) => a.ts - b.ts);
}

async function runWake(env, cfg, role, reasons, now = Date.now()) {
  const me = role.meName || "对方";
  const box = (await pendingBox(env)).filter(x => x.roleId === role.id && !x.silent);
  const history = [...(role.history || []), ...box.map(x => ({ from: "ai", text: visible(x.text), ts: x.ts }))];
  const lastTs = history.length ? history[history.length - 1].ts : 0;
  const alarms = await listAlarms(env, role.id);

  const nowLine = `现在是 ${nowText(now)}（北京时间）。` + (lastTs && now - lastTs > 30 * 60_000 ? `\n距离你们上一条消息已经过去了 ${gapText(now - lastTs)}。` : "");
  const alarmList = alarms.length ? alarms.map(a => `#${a.id} ${whenLabel(a.at, now)}${a.note ? " · " + a.note : ""}`).join("；") : "（没有）";
  const system = String(role.system || `你是「${role.name}」。`)
    .replaceAll("{{NOW}}", nowLine)
    .replaceAll("{{TODAY}}", ymd(now))
    .replaceAll("{{ALARMS}}", alarmList);

  const notice = [
    `（系统通知，不是${me}发的消息）现在是 ${nowText(now)}，你醒来了：${reasons.map(r => r.text).join("；")}。`,
    `${me}现在不一定在看手机。你可以给${me}发消息，也可以先用工具做点自己的事（看看邮箱、逛逛别的地方……），做什么都随你的心意。`,
    `要发消息就像平时聊天一样直接写，可以分成几条，每条之间空一行。用了工具的话，等拿到结果再决定要不要发。`,
    `如果这次不想发消息，就只回复：[不发消息]`,
  ].join("\n");

  const servers = (role.servers || []).filter(s => s.tools?.length);
  const sessions = new Map();
  const search = cfg.search || {};
  const notes = [];
  const usage = { input: 0, output: 0 };
  let convo = addTurn(toConvo(history), "user", notice);
  let text = "";
  for (let round = 0; ; round++) {
    const r = await callModel(role.api, system, convo, !!cfg.webSearch && !search.enabled && role.api?.type !== "openai");
    usage.input += r.usage.input;
    usage.output += r.usage.output;
    text = r.text;
    if (round >= MAX_ROUNDS) break;

    const tc = servers.length ? text.match(TOOL_CALL_RE) : null;
    if (tc) {
      const name = tc[1].trim();
      const argsRaw = tc[2].trim() || "{}";
      const found = resolveTool(servers, name);
      let result;
      const note = {};
      if (!found) {
        result = `没有叫「${name}」的工具，请检查工具名。`;
        note.text = `${role.name} 想用的工具「${name}」不存在`;
      } else {
        let args = null;
        try { args = JSON.parse(argsRaw); } catch { result = "参数不是有效的 JSON，请重新调用。"; note.text = `${role.name} 调用 ${name} 时参数写错了`; }
        if (args) {
          try {
            let out;
            if (found.server.builtin) {
              const p = await readPage(args.url, Number(args.max_length) || 8000);
              const head = [p.title && `标题：${p.title}`, `网址：${p.url}`, p.truncated && `（内容太长，只读了前 ${p.text.length} 字）`].filter(Boolean).join("\n");
              out = { text: `${head}\n\n${p.text || "（网页里没有读到文字）"}`, isError: false };
            } else {
              out = await mcpCall(sessions, found.server, found.tool, args);
            }
            result = out.text;
            note.text = `${role.name} 使用了 ${found.server.name} · ${found.tool}${out.isError ? "（出错了）" : ""}`;
          } catch (e) {
            result = `调用失败：${e.message || e}`;
            note.text = `${role.name} 使用 ${found.server.name} · ${found.tool} 失败：${e.message || e}`;
          }
          note.detail = `参数：${JSON.stringify(args, null, 1)}\n\n结果：\n${String(result).slice(0, 3000)}`;
        }
      }
      notes.push(note);
      convo = addTurn(convo, "assistant", `<tool_call name="${name}">${argsRaw}</tool_call>`);
      convo = addTurn(convo, "user", `【工具结果：${name}】\n${String(result).slice(0, 8000)}\n\n（以上是工具返回的结果，不是${me}说的话。需要的话可以继续用工具；想给${me}发消息就直接写，不想发就只回复 [不发消息]。）`);
      continue;
    }

    const q = search.enabled ? text.match(SEARCH_RE)?.[1]?.trim() : null;
    if (!q) break;
    let found;
    const note = {};
    try {
      const r2 = await doSearch(env, search.provider, q, 5, search.key);
      note.text = `${role.name} 搜索了「${q}」· ${r2.results.length} 条结果`;
      note.sources = r2.results.map(x => ({ title: x.title, url: x.url }));
      found = r2.results.length ? r2.results.map((x, i) => `${i + 1}. ${x.title}\n${x.url}\n${x.snippet}`).join("\n\n") : "（没有找到结果）";
    } catch (e) {
      note.text = `搜索「${q}」失败：${e.message || e}`;
      found = `（搜索失败：${e.message || e}）`;
    }
    notes.push(note);
    convo = addTurn(convo, "assistant", `[搜索:${q}]`);
    convo = addTurn(convo, "user", `【搜索结果：${q}】\n${found}\n\n（以上是系统给你的搜索结果，不是${me}说的话。）`);
  }

  // TA 在醒着的时候定 / 取消闹钟
  const ops = [...text.matchAll(ALARM_RE)];
  text = text.replace(ALARM_RE, "");
  for (const [, op, body] of ops) {
    if (op === "定闹钟") {
      const [when, ...rest] = body.split(/[|｜]/);
      const r = await addAlarm(env, role.id, when.trim(), rest.join(" ").trim(), role.wake?.quiet, now);
      notes.push({ text: r.ok ? `${role.name} 定了个闹钟：${r.alarm.label}${r.alarm.note ? " · " + r.alarm.note : ""}` : `${role.name} 想定闹钟，但没定成：${r.error}` });
    } else {
      const r = await cancelAlarm(env, role.id, body);
      notes.push({ text: r.ok ? `${role.name} 取消了闹钟：${r.alarm.label}${r.alarm.note ? " · " + r.alarm.note : ""}` : `${role.name} 想取消闹钟，但${r.error}` });
    }
  }

  const silent = SILENT_RE.test(text) || !visible(text);
  text = text.replace(SILENT_RE, "").replace(/<tool_call[\s\S]*?(<\/tool_call>|$)/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const item = {
    id: rid() + rid(),
    roleId: role.id,
    threadId: role.threadId || null,
    ts: Date.now(),
    reasons: reasons.map(r => r.text),
    silent,
    text,
    notes,
    usage,
    apiId: role.api?.id || null,
    model: role.api?.model || "",
    alarms: (await listAlarms(env, role.id)).map(a => alarmView(a, Date.now())),
  };
  await env.KV.put(`box:${item.ts.toString(36)}:${item.id}`, JSON.stringify(item), { expirationTtl: 30 * 86400 });
  await env.KV.put("boxlatest", String(item.ts));

  if (!silent) {
    const first = visible(text).split(/\n\s*\n/)[0] || "";
    const url = cfg.appUrl ? `${cfg.appUrl}#/chat/${role.id}${role.threadId ? "/" + role.threadId : ""}` : undefined;
    item.push = await pushAll(env, { title: role.name, body: first.length > 40 ? first.slice(0, 40) + "…" : first, url, tag: "wake-" + role.id });
  }
  return item;
}

// ---------- 定时任务 ----------
function nextInterval(w, now) {
  const every = Math.max(10, Number(w.every) || 120);
  const jitter = Math.min(Math.max(0, Number(w.jitter) || 0), every / 2);
  return now + Math.round((every + (Math.random() * 2 - 1) * jitter) * 60_000);
}

async function tick(env, now = Date.now()) {
  if (!env.KV) return null;
  // 心跳：让栖所知道定时任务在跑（一小时写一次，省 KV 写入次数）
  const last = Number(await env.KV.get("tick")) || 0;
  if (now - last > 3600_000) await env.KV.put("tick", String(now));

  const cfg = await env.KV.get("cfg", "json");
  if (!cfg?.roles?.length) return null;
  const alarms = await listAlarms(env);
  const due = [];
  for (const role of cfg.roles) {
    const w = role.wake;
    if (!w?.enabled) continue;
    const key = `sched:${role.id}`;
    const sched = (await env.KV.get(key, "json")) || {};
    const reasons = [];
    let changed = false;
    // 每隔一段时间：碰上免打扰就跳过这一次
    const ih = [w.intervalOn, w.every, w.jitter].join("|");
    if (w.intervalOn) {
      if (sched.ih !== ih || !sched.nextAt) {
        sched.nextAt = nextInterval(w, now);
        sched.ih = ih;
        changed = true;
      } else if (sched.nextAt <= now) {
        if (!inQuiet(w.quiet, now)) reasons.push({ kind: "interval", text: "到了平时醒来的时间" });
        sched.nextAt = nextInterval(w, now);
        changed = true;
      }
    } else if (sched.nextAt) {
      delete sched.nextAt;
      changed = true;
    }
    // 你设的固定时间：照常醒
    sched.fired ??= {};
    const today = ymd(now);
    const mod = minuteOfDay(now);
    for (const t of w.times || []) {
      const tm = hm2min(t);
      if (mod >= tm && mod - tm < 15 && sched.fired[t] !== today) {
        reasons.push({ kind: "time", text: `到了每天 ${t} 醒来的时间` });
        sched.fired[t] = today;
        changed = true;
      }
    }
    // TA 自己定的闹钟
    const mine = alarms.filter(a => a.roleId === role.id && a.at <= now);
    for (const a of mine) reasons.push({ kind: "alarm", text: `你给自己定的闹钟响了（${a.note || "没写要做什么"}）`, key: a.key });

    if (reasons.length) due.push({ role, sched, key, reasons, overdue: Math.min(...mine.map(a => a.at), sched.nextAt || now) });
    else if (changed) await env.KV.put(key, JSON.stringify(sched));
  }
  if (!due.length) return null;

  // 免费版每次最多 50 个外部请求：一次只叫醒一个，其他的下一轮（5 分钟后）再醒
  due.sort((a, b) => a.overdue - b.overdue);
  const { role, sched, key, reasons } = due[0];
  sched.lastWakeAt = now;
  for (const r of reasons) if (r.key) await env.KV.delete(r.key);
  try {
    const item = await runWake(env, cfg, role, reasons, now);
    sched.last = { at: now, reasons: item.reasons, silent: item.silent, usage: item.usage };
  } catch (e) {
    sched.last = { at: now, reasons: reasons.map(r => r.text), error: String(e.message || e) };
    // 出错也告诉栖所一声
    const item = { id: rid() + rid(), roleId: role.id, threadId: role.threadId || null, ts: Date.now(), reasons: reasons.map(r => r.text), silent: true, error: String(e.message || e), text: "", notes: [], usage: { input: 0, output: 0 } };
    await env.KV.put(`box:${item.ts.toString(36)}:${item.id}`, JSON.stringify(item), { expirationTtl: 30 * 86400 });
    await env.KV.put("boxlatest", String(item.ts));
  }
  await env.KV.put(key, JSON.stringify(sched));
  return sched.last;
}

// ---------- 唤醒相关的接口 ----------
async function wakeRoute(path, req, env) {
  if (!env.KV) return json({ error: "Worker 还没有绑定 KV：请按说明添加一个 KV 命名空间，变量名填 KV" }, 501);
  const url = new URL(req.url);
  const body = req.method === "POST" ? await req.json().catch(() => null) : null;
  if (req.method === "POST" && !body) return json({ error: "请求格式不对" }, 400);

  if (path === "/wake/sync") {
    if (!Array.isArray(body.roles)) return json({ error: "请求格式不对" }, 400);
    await env.KV.put("cfg", JSON.stringify({ ...body, syncedAt: Date.now() }));
    return json({ ok: true, at: Date.now() });
  }

  if (path === "/wake/state") {
    const cfg = (await env.KV.get("cfg", "json")) || { roles: [] };
    const alarms = await listAlarms(env);
    const now = Date.now();
    const roles = {};
    for (const r of cfg.roles) {
      const sched = (await env.KV.get(`sched:${r.id}`, "json")) || {};
      roles[r.id] = { alarms: alarms.filter(a => a.roleId === r.id).map(a => alarmView(a, now)), nextAt: sched.nextAt || null, last: sched.last || null };
    }
    const subs = await env.KV.list({ prefix: "sub:" });
    return json({ roles, syncedAt: cfg.syncedAt || 0, tick: Number(await env.KV.get("tick")) || 0, devices: subs.keys.length });
  }

  if (path === "/wake/alarm") {
    const roleId = String(body.roleId || "");
    if (!roleId) return json({ error: "缺少角色" }, 400);
    const r = body.op === "cancel"
      ? await cancelAlarm(env, roleId, body.id)
      : await addAlarm(env, roleId, body.when, body.note, body.quiet);
    return json(r, r.ok ? 200 : 400);
  }

  // 现在就叫醒 TA（测试用）
  if (path === "/wake/now") {
    const cfg = await env.KV.get("cfg", "json");
    const role = cfg?.roles?.find(r => r.id === body.roleId);
    if (!role) return json({ error: "还没有同步这个角色：先打开 TA 的唤醒，等几秒再试" }, 404);
    try {
      const item = await runWake(env, cfg, role, [{ kind: "test", text: "对方在栖所里点了「现在叫醒 TA」" }]);
      return json({ ok: true, item });
    } catch (e) {
      return json({ error: e.message || String(e) }, 502);
    }
  }

  if (path === "/wake/inbox") {
    const latest = Number(await env.KV.get("boxlatest")) || 0;
    const since = Number(url.searchParams.get("since")) || 0;
    if (since && latest <= since) return json({ latest, items: [] });
    const items = (await pendingBox(env)).map(({ key, ...x }) => x);
    return json({ latest, items });
  }

  if (path === "/wake/ack") {
    const ids = new Set(body.ids || []);
    const { keys } = await env.KV.list({ prefix: "box:" });
    for (const k of keys) if (ids.has(k.name.split(":")[2])) await env.KV.delete(k.name);
    return json({ ok: true });
  }

  if (path === "/push/key") return json({ key: (await vapidKeys(env)).pub });

  if (path === "/push/subscribe") {
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) return json({ error: "订阅信息不完整" }, 400);
    await env.KV.put(`sub:${await subId(body.endpoint)}`, JSON.stringify({ endpoint: body.endpoint, keys: body.keys, at: Date.now() }));
    return json({ ok: true });
  }

  if (path === "/push/unsubscribe") {
    if (body.endpoint) await env.KV.delete(`sub:${await subId(body.endpoint)}`);
    return json({ ok: true });
  }

  if (path === "/push/test") {
    const r = await pushAll(env, { title: "栖所", body: body.text || "通知打开啦～以后 TA 们醒来给你发消息，这里会提醒你", tag: "test" });
    return json(r);
  }

  return json({ error: "没有这个地址" }, 404);
}

// ======================================================================

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (!env.RELAY_TOKEN) return json({ error: "中转还没有设置密码：请在 Worker 的「变量和机密」里添加 RELAY_TOKEN" }, 500);
    if (req.headers.get("X-Relay-Token") !== env.RELAY_TOKEN) return json({ error: "中转密码不对" }, 401);

    const path = new URL(req.url).pathname.replace(/\/+$/, "");

    // 测试连接：返回哪些搜索服务已经在 Worker 里配好了 Key
    if (path === "/ping") {
      const ready = Object.entries(PROVIDERS).filter(([, p]) => env[p.env]).map(([k]) => k);
      const tick = env.KV ? Number(await env.KV.get("tick")) || 0 : 0;
      return json({ ok: true, version: 4, features: ["search", "mcp", "fetch", ...(env.KV ? ["wake"] : [])], providers: Object.keys(PROVIDERS), ready, kv: !!env.KV, tick });
    }

    if (path === "/search" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "请求格式不对" }, 400); }
      try {
        return json(await doSearch(env, body.provider, body.query, body.count, req.headers.get("X-Search-Key")));
      } catch (e) {
        return json({ error: e.message || String(e) }, e.status ? 502 : 400);
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

    // 读网页：返回标题和正文文字
    if (path === "/fetch" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "请求格式不对" }, 400); }
      try {
        return json(await readPage(body.url, body.maxLength));
      } catch (e) {
        return json({ error: e.message || String(e) }, e.status || 502);
      }
    }

    if (path.startsWith("/wake/") || path.startsWith("/push/")) return wakeRoute(path, req, env);

    return json({ error: "没有这个地址" }, 404);
  },

  // 定时任务（Cron 触发器）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env, event.scheduledTime || Date.now()).catch(e => console.error("唤醒出错", e)));
  },
};
