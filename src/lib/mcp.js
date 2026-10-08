// MCP 客户端（Streamable HTTP）。默认通过 Cloudflare 中转发送，也可以直连（服务器允许浏览器访问时）。
//
// 服务器配置（存在 store.mcpServers 里）：
//   { id, name, url, headers: [{ key, value }], viaRelay, roleIds: [], tools: [], toolsAt, enabled }
import { store, uid } from "../store/index.js";
import { relayFetch } from "./search.js";

const PROTOCOL = "2025-06-18";
const sessions = new Map(); // serverId -> { sessionId, protocolVersion }
let rpcId = 1;

export function newServer(over = {}) {
  return { id: uid(), name: "", url: "", headers: [{ key: "Authorization", value: "" }], viaRelay: true, roleIds: [], tools: [], toolsAt: 0, enabled: true, disabledTools: [], ...over };
}

// 内置工具：网页读取（通过中转）
export const BUILTIN_FETCH = {
  id: "builtin-fetch",
  name: "网页",
  builtin: true,
  disabledTools: [],
  tools: [{
    name: "fetch",
    description: "打开一个网址，读取网页的正文内容。对方发来链接、或者需要看某个具体网页时用。",
    inputSchema: { type: "object", properties: { url: { type: "string" }, max_length: { type: "number" } }, required: ["url"] },
  }],
};

export const serversFor = roleId => {
  const list = (store.mcpServers || []).filter(s => s.enabled && s.roleIds?.includes(roleId) && s.url);
  if (store.tools.fetch?.enabled && store.tools.relay?.url) list.push(BUILTIN_FETCH);
  return list;
};

// 这个服务器里开着的工具
export const enabledTools = s => (s.tools || []).filter(t => !(s.disabledTools || []).includes(t.name));

const relayBase = () => (store.tools.relay?.url || "").trim().replace(/\/+$/, "");
// 空的请求头不发（比如没填 token 的 Authorization）
export const headerObj = server => Object.fromEntries((server.headers || []).filter(h => h.key?.trim() && String(h.value ?? "").trim()).map(h => [h.key.trim(), h.value.trim()]));

// 发送一条 JSON-RPC 消息，返回 { status, sessionId, contentType, body }
async function post(server, message, session) {
  if (server.viaRelay) {
    if (!relayBase()) throw new Error("还没有设置中转（设置 → 工具 → 中转）");
    let res;
    try {
      res = await fetch(relayBase() + "/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Relay-Token": store.tools.relay.token || "" },
        body: JSON.stringify({ url: server.url.trim(), headers: headerObj(server), message, sessionId: session?.sessionId, protocolVersion: session?.protocolVersion }),
        signal: AbortSignal.timeout?.(60_000),
      });
    } catch {
      throw new Error("连不上中转（workers.dev 在国内可能需要开 VPN）");
    }
    const data = await res.json().catch(() => null);
    if (res.status === 404) throw new Error("中转还是旧版本，不支持 MCP：请按说明更新一下 Worker 的代码");
    if (!res.ok) throw new Error(data?.error || `中转返回 ${res.status}`);
    return data;
  }
  // 直连
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headerObj(server) };
  if (session?.sessionId) headers["Mcp-Session-Id"] = session.sessionId;
  if (session?.protocolVersion) headers["MCP-Protocol-Version"] = session.protocolVersion;
  let res;
  try {
    res = await fetch(server.url.trim(), { method: "POST", headers, body: JSON.stringify(message), signal: AbortSignal.timeout?.(60_000) });
  } catch {
    throw new Error("直连失败：这个 MCP 可能不允许浏览器直接访问，试试打开「通过中转」");
  }
  return { status: res.status, sessionId: res.headers.get("mcp-session-id"), contentType: res.headers.get("content-type") || "", body: await res.text() };
}

// 回复可能是普通 JSON，也可能是 SSE（一行行 data:）
function parseReply(r, id) {
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
  try { return JSON.parse(text); } catch { throw new Error("MCP 返回的内容看不懂：" + text.slice(0, 120)); }
}

function httpError(r) {
  if (r.status === 401 || r.status === 403) return new Error(`MCP 拒绝了（${r.status}）：token 可能不对或已失效`);
  return new Error(`MCP 返回 ${r.status}：${(r.body || "").slice(0, 160)}`);
}

async function rpc(server, method, params, session) {
  const id = rpcId++;
  const r = await post(server, { jsonrpc: "2.0", id, method, params }, session);
  if (r.status >= 400) throw Object.assign(httpError(r), { status: r.status });
  const msg = parseReply(r, id);
  if (!msg) throw new Error("MCP 没有返回内容");
  if (msg.error) throw new Error(`MCP 出错：${msg.error.message || JSON.stringify(msg.error)}`);
  return { result: msg.result, sessionId: r.sessionId };
}

async function connect(server) {
  const { result, sessionId } = await rpc(server, "initialize", {
    protocolVersion: PROTOCOL,
    capabilities: {},
    clientInfo: { name: "dwellingplace", version: "1.0" },
  });
  const session = { sessionId, protocolVersion: result?.protocolVersion || PROTOCOL, serverInfo: result?.serverInfo };
  // 通知服务器初始化完成（没有回复）
  await post(server, { jsonrpc: "2.0", method: "notifications/initialized" }, session).catch(() => {});
  sessions.set(server.id, session);
  return session;
}

async function withSession(server, fn) {
  let session = sessions.get(server.id) || (await connect(server));
  try {
    return await fn(session);
  } catch (e) {
    // 会话过期：重新连一次再试
    if (e.status === 404 || e.status === 400) {
      session = await connect(server);
      return fn(session);
    }
    throw e;
  }
}

// 读取工具列表（存起来，聊天时不用每次都读）
export async function refreshTools(server) {
  sessions.delete(server.id);
  const tools = [];
  let serverInfo = null;
  await withSession(server, async session => {
    serverInfo = session.serverInfo;
    let cursor;
    do {
      const { result } = await rpc(server, "tools/list", cursor ? { cursor } : {}, session);
      tools.push(...(result?.tools || []));
      cursor = result?.nextCursor;
    } while (cursor);
  });
  server.tools = tools.map(t => ({ name: t.name, description: t.description || "", inputSchema: t.inputSchema || {} }));
  server.toolsAt = Date.now();
  return { tools: server.tools, serverInfo };
}

// 调用一个工具，返回给 AI 看的文字
export async function callTool(server, name, args) {
  if (server.builtin) {
    const url = String(args?.url || "").trim();
    if (!url) return { text: "没有给网址", isError: true };
    const r = await relayFetch(url, Number(args?.max_length) || 8000);
    const head = [r.title && `标题：${r.title}`, `网址：${r.url}`, r.truncated && `（内容太长，只读了前 ${r.text.length} 字，全文约 ${r.length} 字）`].filter(Boolean).join("\n");
    return { text: `${head}\n\n${r.text || "（网页里没有读到文字）"}`, isError: false };
  }
  const result = await callToolRaw(server, name, args);
  return { text: resultText(result), isError: !!result?.isError };
}

export function resultText(result) {
  const parts = (result?.content || []).map(c => {
    if (c.type === "text") return c.text;
    if (c.type === "resource") return c.resource?.text || `[资源 ${c.resource?.uri || ""}]`;
    if (c.type === "image") return "[图片]";
    return JSON.stringify(c);
  });
  if (result?.structuredContent && !parts.length) parts.push(JSON.stringify(result.structuredContent));
  return parts.join("\n") || "（没有返回内容）";
}

// 调用工具，返回原始结果（content / structuredContent / isError）
export function callToolRaw(server, name, args) {
  return withSession(server, async session => (await rpc(server, "tools/call", { name, arguments: args || {} }, session)).result);
}

// ---------- 从粘贴的 JSON 读出服务器 ----------
// 支持 { "mcpServers": { name: { url, headers } } }、单个 { url, headers }，以及 { name: { url } }
export function parseMcpJson(text) {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error("不是有效的 JSON，检查一下有没有复制完整"); }
  const map = j.mcpServers || j.servers || (j.url ? { "": j } : j);
  const out = [];
  for (const [name, cfg] of Object.entries(map || {})) {
    if (!cfg || typeof cfg !== "object") continue;
    const url = cfg.url || cfg.serverUrl || cfg.endpoint;
    if (!url) {
      if (cfg.command) throw new Error(`「${name}」是需要在电脑上运行的本地 MCP（command），网页里用不了，只支持带 url 的远程 MCP`);
      continue;
    }
    const headers = Object.entries(cfg.headers || {}).map(([key, value]) => ({ key, value: String(value) }));
    out.push({ name, url, headers: headers.length ? headers : [{ key: "Authorization", value: "" }] });
  }
  if (!out.length) throw new Error("没有在 JSON 里找到 MCP 地址（url）");
  return out;
}

// ---------- 给 AI 的工具说明 ----------
const typeOf = s => (s?.type ? (Array.isArray(s.type) ? s.type.join("|") : s.type) : s?.enum ? "enum" : "any");

function signature(tool) {
  const props = tool.inputSchema?.properties || {};
  const req = new Set(tool.inputSchema?.required || []);
  const args = Object.entries(props).map(([k, v]) => {
    const enumHint = v?.enum ? `=${v.enum.slice(0, 6).join("/")}` : "";
    return `${k}${req.has(k) ? "" : "?"}: ${typeOf(v)}${enumHint}`;
  });
  return `${tool.name}(${args.join(", ")})`;
}

// 一句话用途：说明的第一句，最多 50 字
export function shortDesc(desc) {
  const d = String(desc || "").replace(/\s+/g, " ").trim();
  const m = d.match(/^.{6,}?[。！？；.!?;](?=\s|$|[^\d])/);
  const first = (m ? m[0] : d).trim();
  return first.length > 50 ? first.slice(0, 49) + "…" : first;
}

// 一个工具的完整说明：用途 + 每个参数（AI 用「工具说明」查的就是这个；醒来时中转也用它）
export function toolDoc(server, tool) {
  const props = tool.inputSchema?.properties || {};
  const req = new Set(tool.inputSchema?.required || []);
  const params = Object.entries(props).map(([k, v]) => {
    const bits = [typeOf(v), req.has(k) ? "必填" : "可选"];
    if (v?.enum) bits.push(`可选值：${v.enum.slice(0, 20).join(" / ")}`);
    if (v?.items?.type) bits.push(`元素：${v.items.type}`);
    const d = String(v?.description || "").replace(/\s+/g, " ").trim().slice(0, 300);
    return `- ${k}（${bits.join("，")}）${d ? "：" + d : ""}`;
  });
  return [
    `${server.name}.${signature(tool)}`,
    String(tool.description || "（没有说明）").trim().slice(0, 2000),
    params.length ? `参数：\n${params.join("\n")}` : "参数：无（写 {}）",
  ].join("\n");
}

// 查说明用的内置工具名
export const TOOL_SHOW = "工具说明";
export const isToolShow = name => /^(工具说明|tool_show)$/i.test(String(name).replace(/^.*\./, "").trim());

// 给 AI 的只是一份目录：工具名 + 一句话用途。要用哪个、拿不准参数，先查「工具说明」拿完整说明。
// 工具再多，每轮多出来的也只有一行一个
export function toolsForAI(servers) {
  const lines = [];
  for (const s of servers) {
    const tools = enabledTools(s);
    if (!tools.length) continue;
    lines.push(`\n## ${s.name}`);
    for (const t of tools) {
      const desc = shortDesc(t.description);
      lines.push(`- ${s.name}.${t.name}${desc ? " — " + desc : ""}`);
    }
  }
  if (!lines.length) return "";
  return [
    `\n# 你可以用的工具（MCP）`,
    `下面只是目录（工具名 + 一句话用途）。需要用工具时，只回复一段：<tool_call name="服务名.工具名">{"参数名": 参数值}</tool_call>（JSON 格式，没有参数就写 {}），不要写别的。系统会把结果发给你，你再继续。`,
    `不确定某个工具怎么用、要哪些参数时，先查说明：<tool_call name="${TOOL_SHOW}">{"name": "服务名.工具名"}</tool_call>，系统会把完整说明发给你（这一次对话里查过的不用再查）。查任何服务的工具都用「${TOOL_SHOW}」，不要用某个服务自带的查参数工具（比如 get_tool_schema）去查别的服务的工具。`,
    `工具名要照目录里的写法完整写上「服务名.工具名」，服务名就是目录里 ## 后面那个。`,
    `一次只调用一个工具；普通聊天不需要用工具。`,
    `用工具对外发东西（发邮件、在别的平台发帖或回复）时，代表的是你自己。没有得到对方明确同意，不要透露对方的个人信息（真实姓名、住址、电话、学校或工作、各种账号、笔名，以及对方告诉你的私事）。`,
    ...lines,
  ].join("\n");
}

// 要不要当成「工具说明」：本来就是查说明；或者拿某个服务自带的查参数工具（比如花园的 get_tool_schema）
// 去查别的服务的工具——那个服务当然不认识，这里替它查，免得一直报 unknown tool
export function showRequest(servers, name, argsRaw) {
  let args = {};
  try { args = JSON.parse(argsRaw || "{}"); } catch { /* 当成没写 */ }
  if (isToolShow(name)) return args;
  if (!/schema|describe|tool_?info|tool_?help/i.test(String(name).replace(/^.*\./, ""))) return null;
  const want = String(args?.tool_name ?? args?.name ?? args?.tool ?? "").trim();
  if (!want) return null;
  const owner = resolveToolCall(servers, name)?.server;
  const f = resolveToolCall(servers, want);
  if (f && f.server !== owner) return { name: want }; // 查的是别的服务的工具
  if (!f && want.includes(".")) return { name: want }; // 带着别的服务名、哪儿都找不到
  return null; // 查自己服务里的工具：交给它自己
}

// 「工具说明」：找到工具，返回完整说明
export function showTool(servers, args) {
  const want = String(args?.name || args?.tool || "").trim();
  if (!want) return { text: `要查哪个工具？写成 {"name": "服务名.工具名"}。`, label: "" };
  const found = resolveToolCall(servers, want);
  if (!found) return { text: `没有叫「${want}」的工具，请对照目录里的名字再查。`, label: want };
  return { text: toolDoc(found.server, found.tool), label: `${found.server.name} · ${found.tool.name}` };
}

export const TOOL_CALL_RE = /<tool_call\s+name="([^"]+)"\s*>([\s\S]*?)<\/tool_call>/;

// 有的模型（比如 DeepSeek）不按约定写 <tool_call>，而是写成 <invoke name="…"><parameter name="…">…</parameter></invoke>
// 外面可能还包着 <function_calls>、<｜DSML｜…> 之类。这里把它换成约定的 <tool_call name="…">{JSON}</tool_call>
export function normalizeToolCalls(text) {
  if (!text) return text;
  // 还有一种：<tool_call>{"name": "…", "arguments": {…}}</tool_call>（不少模型习惯这样写）、名字用单引号
  text = text.replace(/<tool_call\s+name='([^']+)'\s*>/g, '<tool_call name="$1">');
  text = text.replace(/<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g, (all, body) => {
    try {
      const j = JSON.parse(body);
      const name = j.name || j.tool || j.function?.name;
      let args = j.arguments ?? j.parameters ?? j.args ?? j.input ?? j.function?.arguments ?? {};
      if (typeof args === "string") { try { args = JSON.parse(args); } catch { /* 原样 */ } }
      return name ? `<tool_call name="${name}">${JSON.stringify(args)}</tool_call>` : all;
    } catch { return all; }
  });
  if (!/<[^>]{0,20}invoke\s+name=/.test(text)) return text;
  const m = text.match(/<[^>]{0,20}invoke\s+name="([^"]+)"\s*>([\s\S]*?)(?:<\/[^>]{0,20}invoke>|$)/);
  if (!m) return text;
  const args = {};
  const re = /<[^>]{0,20}parameter\s+name="([^"]+)"([^>]*)>([\s\S]*?)(?=<\/[^>]{0,20}parameter>|<[^>]{0,20}parameter\s+name=|$)/g;
  for (const [, k, attrs, raw] of m[2].matchAll(re)) {
    const v = raw.trim();
    if (!/string="true"/.test(attrs) && /^(true|false|null|-?\d{1,9}(\.\d+)?)$/.test(v) || /^[[{]/.test(v)) { try { args[k] = JSON.parse(v); continue; } catch { /* 当字符串 */ } }
    args[k] = v;
  }
  const call = `<tool_call name="${m[1]}">${JSON.stringify(args)}</tool_call>`;
  // 去掉包在外面的 <function_calls> / DSML 标记
  return (text.slice(0, m.index) + call + text.slice(m.index + m[0].length))
    .replace(/<\/?[^>]{0,20}function_calls>/g, "")
    .replace(/<\/?｜DSML｜[^>]*>/g, "");
}


// 找到 AI 要调用的工具
export function resolveToolCall(servers, fullName) {
  for (const s of servers) {
    const prefix = s.name + ".";
    if (fullName.startsWith(prefix)) {
      const tool = enabledTools(s).find(t => t.name === fullName.slice(prefix.length));
      if (tool) return { server: s, tool };
    }
  }
  // 没写服务名：在所有服务里找同名工具
  for (const s of servers) {
    const tool = enabledTools(s).find(t => t.name === fullName || fullName.endsWith("." + t.name));
    if (tool) return { server: s, tool };
  }
  return null;
}
