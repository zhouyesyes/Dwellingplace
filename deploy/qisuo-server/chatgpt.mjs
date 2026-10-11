// 用 ChatGPT 会员额度聊天（OpenAI 官方的 Sign in with ChatGPT · ChatGPT plan usage，开源应用 + 自己的服务器）
//
// 登录：服务器生成授权链接 → 你在手机/平板上打开、登录、同意 → 浏览器跳到 127.0.0.1（打不开没关系）
//       → 把地址栏整串地址粘回栖所 → 服务器换到通行证，存在服务器上（不放浏览器里）
// 聊天：栖所照常按 OpenAI 的 /chat/completions 格式发过来，这里转成 Responses API（store:false, stream:true），
//       再按 /chat/completions 的样子流回去。通行证快过期时自己续期。
//
// 路径（都在 /p/<口令>/chatgpt 下面）：
//   GET  /status                 登录了没、哪个账号
//   POST /login/start            → { url }  授权链接
//   POST /login/finish {url}     把跳转后的地址交上来
//   POST /logout                 退出（撤销续期用的通行证）
//   GET  /v1/models              这个会员能用的模型
//   POST /v1/chat/completions    聊天
import { randomBytes, createHash, createPublicKey, verify as verifySig, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const AUTH = "https://auth.openai.com";
const API = "https://api.openai.com/v1";
const REDIRECT = "http://127.0.0.1:1455/auth/callback";
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const APP_NAME = "Qisuo";

const DATA = process.env.DATA_DIR || "/app/data";
const STATE_FILE = join(DATA, "chatgpt-state.json"); // 这台服务器的门牌号、正在进行的登录
const CRED_FILE = join(DATA, "chatgpt-credentials.json"); // 通行证（只有这台服务器能读）

const b64url = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const readJSON = f => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
function writeJSON(f, obj) { // 先写临时文件再改名，权限只给自己
  mkdirSync(DATA, { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  renameSync(tmp, f);
}
function hostState() {
  const s = readJSON(STATE_FILE) || {};
  if (!s.hostId) { s.hostId = `urn:uuid:${randomUUID()}`; writeJSON(STATE_FILE, s); }
  return s;
}
const creds = () => readJSON(CRED_FILE);

// ---------- 登录 ----------
function startLogin() {
  const s = hostState();
  // 退出过、或者上次换通行证没成功：也沿用之前发下来的 client_id，不重新注册
  const c = creds() || s.lastClient || (s.issuedClient ? { client_id: s.issuedClient } : null);
  const verifier = b64url(randomBytes(48));
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  s.pending = { state, nonce, verifier, clientId: c?.client_id || null, at: Date.now() };
  writeJSON(STATE_FILE, s);
  const q = new URLSearchParams({
    response_type: "code",
    client_id: c?.client_id || "dynamic_agent_client",
    redirect_uri: REDIRECT,
    scope: SCOPES,
    resource: API,
    state, nonce,
    code_challenge_method: "S256",
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    ext_agent_host_id: s.hostId,
  });
  if (c?.client_id) { if (c.email) q.set("login_hint", c.email); } // 再次登录：用已经发下来的 client_id
  else q.set("agent_name_hint", APP_NAME); // 第一次：注册一个新的
  return { url: `${AUTH}/api/accounts/authorize?${q}` };
}

let jwksCache = null;
async function jwks() {
  if (jwksCache && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const conf = await (await fetch(`${AUTH}/.well-known/openid-configuration`)).json();
  const keys = (await (await fetch(conf.jwks_uri)).json()).keys || [];
  jwksCache = { at: Date.now(), keys, conf };
  return keys;
}
// 验 ID 令牌：签名、签发方、给谁的、过期没、nonce
async function checkIdToken(idToken, clientId, nonce) {
  const [h, p, sig] = String(idToken || "").split(".");
  if (!sig) throw new Error("没有拿到 ID 令牌");
  const header = JSON.parse(Buffer.from(h, "base64url"));
  const claims = JSON.parse(Buffer.from(p, "base64url"));
  const jwk = (await jwks()).find(k => k.kid === header.kid);
  if (!jwk) throw new Error("ID 令牌的签名钥匙找不到");
  const algo = header.alg === "RS256" ? "sha256" : header.alg === "ES256" ? "sha256" : null;
  if (!algo) throw new Error(`不认识的签名方式 ${header.alg}`);
  const ok = verifySig(algo, Buffer.from(`${h}.${p}`), header.alg === "ES256" ? { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" } : createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(sig, "base64url"));
  if (!ok) throw new Error("ID 令牌签名不对");
  if (claims.iss !== AUTH && claims.iss !== `${AUTH}/`) throw new Error("ID 令牌不是 OpenAI 签发的");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new Error("ID 令牌不是给这个应用的");
  if (claims.exp * 1000 < Date.now() - 60_000) throw new Error("ID 令牌过期了");
  if (nonce && claims.nonce !== nonce) throw new Error("ID 令牌对不上这次登录");
  return claims;
}

async function tokenRequest(form) {
  const r = await fetch(`${AUTH}/api/accounts/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error_description || j.error || `换通行证失败（${r.status}）`); e.code = j.error; throw e; }
  return j;
}

async function finishLogin(pasted) {
  const s = hostState();
  const p = s.pending;
  if (!p || Date.now() - p.at > 30 * 60_000) throw new Error("没有进行中的登录（或者超过半小时了），重新点一次登录");
  let u;
  try { u = new URL(String(pasted || "").trim()); } catch { throw new Error("粘贴的不是一个完整的地址"); }
  const q = u.searchParams;
  if (q.get("state") !== p.state) throw new Error("这个地址不是这次登录的（state 对不上），重新点一次登录");
  if (q.get("error")) { delete s.pending; writeJSON(STATE_FILE, s); throw new Error(q.get("error") === "access_denied" ? "没有同意授权" : `授权出错：${q.get("error")}`); }
  const code = q.get("code");
  const clientId = p.clientId || q.get("client_id");
  if (!code) throw new Error("地址里没有授权码");
  if (!clientId || clientId === "dynamic_agent_client") throw new Error("地址里没有发下来的 client_id，注册没完成，重新登录一次");
  if (p.clientId && q.get("client_id") && q.get("client_id") !== p.clientId) throw new Error("返回的 client_id 和之前的不一样，没有保存");
  if (!p.clientId) { s.issuedClient = clientId; writeJSON(STATE_FILE, s); } // 新注册发下来的 client_id 先记住，这次没成功下次也用它
  let t;
  try {
    t = await tokenRequest({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: p.verifier, redirect_uri: REDIRECT, resource: API });
  } catch (e) {
    // 授权码只能用一次、几分钟就过期：这个作废，重新来一次
    delete s.pending; writeJSON(STATE_FILE, s);
    if (e.code === "invalid_grant") throw new Error("授权码失效了（多半是从登录完到点「完成」隔得太久，授权码几分钟就过期）。重新点「用 ChatGPT 登录」，这次登录完马上复制地址、粘贴、点完成。");
    throw e;
  }
  const claims = await checkIdToken(t.id_token, clientId, p.nonce);
  const scopes = String(t.scope || q.get("scope") || "").split(/[\s+]+/).filter(Boolean);
  const old = creds();
  if (old?.subject && old.subject !== claims.sub && old.client_id === clientId) throw new Error("登录的不是之前那个账号");
  const rec = {
    email: claims.email || "", issuer: claims.iss, subject: claims.sub, client_id: clientId,
    ext_agent_host_id: s.hostId, id_token: t.id_token, access_token: t.access_token, refresh_token: t.refresh_token,
    token_type: t.token_type || "Bearer", expires_in: t.expires_in, scopes, saved_at: new Date().toISOString(),
    expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000,
  };
  writeJSON(CRED_FILE, rec);
  delete s.pending; delete s.issuedClient; writeJSON(STATE_FILE, s);
  return status();
}

// 额度：OpenAI 回复时带的响应头里，凡是像「限额 / 用量 / 重置」的都记下来（最近一次的），给栖所的用量页看
let limits = null; // { at, headers: { 名字: 值 } }
const LIMIT_HEADER = /ratelimit|rate-limit|limit|usage|percent|reset|quota|credit|remaining|plan/i;
function noteLimits(headers) {
  const h = {};
  for (const [k, v] of headers) if (LIMIT_HEADER.test(k) && !/authorization|cookie|token/i.test(k)) h[k] = String(v).slice(0, 200);
  if (Object.keys(h).length) limits = { at: Date.now(), headers: h };
}

function status() {
  const c = creds();
  if (!c) return { connected: false };
  return { connected: true, email: c.email, planUsage: c.scopes?.includes("chatgpt.tokens.use.direct"), expiresAt: c.expires_at, limits };
}

async function logout() {
  const c = creds();
  if (!c) return { connected: false };
  let revoked = false;
  try {
    await jwks();
    const ep = jwksCache?.conf?.revocation_endpoint;
    if (ep && c.refresh_token) {
      const r = await fetch(ep, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: c.refresh_token, token_type_hint: "refresh_token", client_id: c.client_id }) });
      revoked = r.ok;
    }
  } catch { /* 撤销没成功也照样清掉 */ }
  // 账号和 client_id 留着，下次登录还用同一个；通行证清掉
  const s = hostState();
  s.lastClient = { client_id: c.client_id, email: c.email, subject: c.subject };
  writeJSON(STATE_FILE, s);
  try { unlinkSync(CRED_FILE); } catch { /* 本来就没有 */ }
  return { connected: false, revoked };
}

// ---------- 续期（同一时间只续一次）----------
let refreshing = null;
async function accessToken(force = false) {
  const c = creds();
  if (!c) { const e = new Error("还没有用 ChatGPT 登录：去栖所「设置 → API」里登录"); e.status = 401; throw e; }
  if (!c.scopes?.includes("chatgpt.tokens.use.direct")) { const e = new Error("登录时没有允许使用会员额度：重新登录，在授权页里允许"); e.status = 403; throw e; }
  if (!force && c.expires_at - Date.now() > 5 * 60_000) return c.access_token;
  refreshing ??= (async () => {
    try {
      const cur = creds();
      const t = await tokenRequest({ grant_type: "refresh_token", client_id: cur.client_id, refresh_token: cur.refresh_token, resource: API });
      const next = { ...cur, access_token: t.access_token, refresh_token: t.refresh_token || cur.refresh_token, expires_in: t.expires_in,
        expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000, saved_at: new Date().toISOString(),
        ...(t.scope ? { scopes: String(t.scope).split(/\s+/).filter(Boolean) } : {}), ...(t.id_token ? { id_token: t.id_token } : {}) };
      writeJSON(CRED_FILE, next);
      return next.access_token;
    } catch (e) {
      if (e.code === "invalid_grant") { const x = new Error("登录已经失效：去栖所「设置 → API」里重新用 ChatGPT 登录"); x.status = 401; throw x; }
      throw e;
    } finally { refreshing = null; }
  })();
  return refreshing;
}
async function openai(path, init, retried = false) {
  const token = await accessToken();
  const r = await fetch(`${API}${path}`, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` } });
  if (r.status === 401 && !retried) { await accessToken(true); return openai(path, init, true); }
  return r;
}

// ---------- 模型 ----------
async function models() {
  const r = await openai("/models", { method: "GET" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `拿不到模型列表（${r.status}）`), { status: r.status });
  const list = (j.models || j.data || []).filter(m => !m.visibility || m.visibility === "list");
  // 上下文上限：OpenAI 给了就带上（字段名不一定，几个常见的都认）
  const ctxOf = m => Number(m.context_window ?? m.max_context_window ?? m.context_length ?? m.max_input_tokens) || undefined;
  return { object: "list", data: list.map(m => ({ id: m.slug || m.id, name: m.display_name || m.slug || m.id, object: "model", context_window: ctxOf(m) })) };
}

// ---------- 聊天：/chat/completions ⇄ Responses ----------
function toInput(messages) {
  const instructions = [];
  const input = [];
  for (const m of messages || []) {
    if (m.role === "system" || m.role === "developer") {
      instructions.push(typeof m.content === "string" ? m.content : (m.content || []).map(c => c.text || "").join("\n"));
      continue;
    }
    const assistant = m.role === "assistant";
    const parts = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content || []);
    const content = parts.map(c => {
      if (c.type === "image_url" && !assistant) return { type: "input_image", image_url: c.image_url?.url || c.image_url };
      const text = c.text ?? "";
      return { type: assistant ? "output_text" : "input_text", text };
    }).filter(c => c.type.endsWith("image") || c.text);
    if (content.length) input.push({ role: assistant ? "assistant" : "user", content });
  }
  return { instructions: instructions.join("\n\n"), input };
}

const USAGE_CODES = { subscription_sharing_usage_limit_exceeded: "ChatGPT 会员这阵子的用量用完了（Plus 每 5 小时、每周都有上限），过一会儿再试，或者在 ChatGPT 设置 → 用量里调高栖所的上限", subscription_sharing_usage_unavailable: "现在用不了会员额度，过一会儿再试" };
const errMsg = err => USAGE_CODES[err?.code] || err?.message || err?.code || "出错了";

let noCacheKey = false; // prompt_cache_key 被拒过一次就不再发

async function chat(body, res, CORS) {
  const { instructions, input } = toInput(body.messages);
  const req = {
    model: body.model,
    input,
    store: false,
    stream: true,
    ...(instructions ? { instructions } : {}),
    ...(body.max_tokens ? { max_output_tokens: Number(body.max_tokens) } : {}),
    ...(body.prompt_cache_key && !noCacheKey ? { prompt_cache_key: String(body.prompt_cache_key).slice(0, 64) } : {}),
    ...(body.reasoning?.effort ? { reasoning: { effort: body.reasoning.effort, ...(body.reasoning.enabled ? { summary: "auto" } : {}) } } : body.reasoning?.enabled ? { reasoning: { summary: "auto" } } : {}),
  };
  const ctrl = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ctrl.abort(); });
  let up = await openai("/responses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req), signal: ctrl.signal });
  if (up.status === 400 && req.prompt_cache_key) {
    const raw = await up.clone().text();
    if (/prompt_cache_key/i.test(raw)) { // 会员额度这条路不认：记住，去掉再发一次
      noCacheKey = true;
      delete req.prompt_cache_key;
      up = await openai("/responses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req), signal: ctrl.signal });
    }
  }
  noteLimits(up.headers);
  if (!up.ok || !up.body) {
    const j = await up.json().catch(() => ({}));
    res.writeHead(up.status === 401 ? 401 : up.status || 502, { ...CORS, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: { message: errMsg(j.error) || `接口返回 ${up.status}` } }));
  }
  const stream = body.stream !== false;
  const id = `chatcmpl-${randomUUID()}`;
  const chunk = delta => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
  if (stream) res.writeHead(200, { ...CORS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
  let text = "", reasoning = "", usage = null, failed = null, done = false;
  const dec = new TextDecoder();
  let buf = "";
  try {
    for await (const piece of up.body) {
      buf += dec.decode(piece, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = block.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
        if (!data || data === "[DONE]") continue;
        let ev; try { ev = JSON.parse(data); } catch { continue; }
        if (ev.type === "response.output_text.delta") { text += ev.delta; if (stream) res.write(chunk({ content: ev.delta })); }
        else if (ev.type === "response.reasoning_summary_text.delta" || ev.type === "response.reasoning_text.delta") { reasoning += ev.delta; if (stream) res.write(chunk({ reasoning: ev.delta })); }
        else if (ev.type === "response.completed") { done = true; usage = ev.response?.usage; }
        else if (ev.type === "response.incomplete") { done = true; usage = ev.response?.usage; }
        else if (ev.type === "response.failed") failed = ev.response?.error || { message: "回复失败" };
        else if (ev.type === "error") failed = ev.error || ev;
      }
    }
  } catch (e) { if (!failed && !ctrl.signal.aborted) failed = { message: `连接断了：${e.message}` }; }
  const u = usage ? { prompt_tokens: usage.input_tokens || 0, completion_tokens: usage.output_tokens || 0, total_tokens: usage.total_tokens || 0, prompt_tokens_details: { cached_tokens: usage.input_tokens_details?.cached_tokens || 0 } } : undefined;
  if (stream) {
    if (failed) res.write(`data: ${JSON.stringify({ error: { message: errMsg(failed) } })}\n\n`);
    else {
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: done ? "stop" : "length" }], ...(u ? { usage: u } : {}) })}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  if (failed) { res.writeHead(502, { ...CORS, "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { message: errMsg(failed) } })); }
  res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify({ id, object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: text, ...(reasoning ? { reasoning } : {}) }, finish_reason: "stop" }], ...(u ? { usage: u } : {}) }));
}

// ---------- 路由 ----------
export async function handleChatGPT(req, res, rest, CORS) {
  const send = (code, obj) => { res.writeHead(code, { ...CORS, "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  const body = async () => { const cs = []; for await (const c of req) cs.push(c); try { return JSON.parse(Buffer.concat(cs).toString() || "{}"); } catch { return {}; } };
  try {
    if (rest === "/status" && req.method === "GET") return send(200, status());
    if (rest === "/login/start" && req.method === "POST") return send(200, startLogin());
    if (rest === "/login/finish" && req.method === "POST") return send(200, await finishLogin((await body()).url));
    if (rest === "/logout" && req.method === "POST") return send(200, await logout());
    if (rest === "/v1/models" && req.method === "GET") return send(200, await models());
    if (rest === "/v1/chat/completions" && req.method === "POST") return await chat(await body(), res, CORS);
    return send(404, { error: { message: "没有这个地址" } });
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch { /* 已经断了 */ } return; }
    return send(e.status || 400, { error: { message: e.message } });
  }
}
