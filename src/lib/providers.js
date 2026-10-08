// 模型接入。两种接口格式：
//   anthropic — Claude 官方，或使用 Anthropic 格式的反代（改 baseUrl 即可）
//   openai    — 任何 OpenAI 兼容的 /chat/completions 接口（DeepSeek、各类反代、本地模型等）
//
// 统一的消息格式：{ role: "user" | "assistant", parts: [{ type: "text", text } | { type: "image", data, mime } | { type: "pdf", data, name }] }

import Anthropic from "@anthropic-ai/sdk";
import { store } from "../store/index.js";

export const API_TYPES = {
  anthropic: { label: "Anthropic 格式", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5" },
  openai: { label: "OpenAI 兼容格式", baseUrl: "https://api.openai.com/v1", model: "" },
};

export function newApi(type = "anthropic") {
  return {
    id: null, name: "", type,
    baseUrl: API_TYPES[type].baseUrl,
    key: "",
    model: API_TYPES[type].model,
    models: [],
    favModels: [],
    maxTokens: 32000,
    effort: "",
    showThinking: false,
    contextLimit: 200000,
  };
}

const trimUrl = u => (u || "").trim().replace(/\/+$/, "");

// 流式开关（工具页里，所有 API 通用）
const streaming = () => store.tools?.stream !== false;

// ---------------- Anthropic ----------------

const clients = new Map();
function anthropicClient(api) {
  const baseURL = trimUrl(api.baseUrl) || API_TYPES.anthropic.baseUrl;
  const k = baseURL + "|" + api.key;
  if (!clients.has(k)) {
    clients.set(k, new Anthropic({ apiKey: api.key, baseURL, dangerouslyAllowBrowser: true, maxRetries: 1 }));
  }
  return clients.get(k);
}

const isOfficialAnthropic = api => /(^|\/\/)api\.anthropic\.com/.test(trimUrl(api.baseUrl) || API_TYPES.anthropic.baseUrl);
// 这些模型支持服务端拒答兜底（被安全分类器拒绝时自动换模型重试）
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|fable-5-1|fable-5|sonnet-5-5)$/;

function toAnthropicContent(parts) {
  return parts.map(p => {
    if (p.type === "image") return { type: "image", source: { type: "base64", media_type: p.mime, data: p.data } };
    if (p.type === "pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.data }, title: p.name };
    return { type: "text", text: p.text };
  });
}

// 较新的模型用带动态过滤的搜索工具，老模型用基础版
const NEW_SEARCH_MODELS = /^claude-(fable-5|mythos-5|opus-5|opus-4-[6-9]|sonnet-5|sonnet-4-6)/;
const searchTool = model => ({
  type: NEW_SEARCH_MODELS.test(model) ? "web_search_20260209" : "web_search_20250305",
  name: "web_search",
  max_uses: 3,
});

async function anthropicStream({ api, model, system, messages, signal, onText, onThinking, webSearch }) {
  const client = anthropicClient(api);
  const msgs = messages.map(m => ({ role: m.role, content: toAnthropicContent(m.parts) }));
  // 提示缓存：系统提示一个断点，最后两条消息各一个断点。
  // 最后一条前面附着【此刻】，下一轮就变了，它的断点只在用工具来回时用得上；
  // 倒数第二条的断点下一轮还能对上，较早的聊天记录就按缓存价算（便宜很多）
  for (const m of msgs.slice(-2)) {
    const b = m.content?.at(-1);
    if (b) b.cache_control = { type: "ephemeral" };
  }
  const params = {
    model,
    max_tokens: Number(api.maxTokens) || 32000,
    system: system ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : undefined,
    messages: msgs,
  };
  if (api.effort) params.output_config = { effort: api.effort };
  if (webSearch) params.tools = [searchTool(model)];
  // 让模型把思考过程（摘要）返回来
  if (api.showThinking) params.thinking = { type: "adaptive", display: "summarized" };

  let text = "";
  let thinking = "";
  const usage = { input: 0, output: 0, cached: 0 };
  // 联网搜索时服务端可能会暂停（pause_turn），把已有内容带上继续
  for (let round = 0; round < 4; round++) {
    // 关了流式：一次请求拿回整条，再交给页面（思考先、正文后）
    if (!streaming()) {
      const fb = isOfficialAnthropic(api) && FALLBACK_MODELS.test(model);
      const msg = fb
        ? await client.beta.messages.create({ ...params, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] }, { signal, timeout: 600_000 })
        : await client.messages.create(params, { signal, timeout: 600_000 });
      if (msg.stop_reason === "refusal") throw new Error("这条消息被模型拒绝回答了，换个说法试试？");
      const th = msg.content.filter(b => b.type === "thinking").map(b => b.thinking).join("");
      if (th) { thinking += th; onThinking?.(th); }
      const tx = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
      if (tx) onText(tx);
      text += tx;
      const read = msg.usage?.cache_read_input_tokens ?? 0;
      usage.input += (msg.usage?.input_tokens ?? 0) + read + (msg.usage?.cache_creation_input_tokens ?? 0);
      usage.cached += read;
      usage.output += msg.usage?.output_tokens ?? 0;
      if (msg.stop_reason !== "pause_turn") break;
      params.messages = [...params.messages, { role: "assistant", content: msg.content }];
      continue;
    }
    let stream;
    if (isOfficialAnthropic(api) && FALLBACK_MODELS.test(model)) {
      stream = client.beta.messages.stream(
        { ...params, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] },
        { signal },
      );
    } else {
      stream = client.messages.stream(params, { signal });
    }
    stream.on("text", d => onText(d));
    stream.on("thinking", d => { thinking += d; onThinking?.(d); });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("这条消息被模型拒绝回答了，换个说法试试？");
    text += msg.content.filter(b => b.type === "text").map(b => b.text).join("");
    // input_tokens 只算没命中缓存的部分；加上缓存读写，才是这次一共喂进去多少
    const read = msg.usage?.cache_read_input_tokens ?? 0;
    usage.input += (msg.usage?.input_tokens ?? 0) + read + (msg.usage?.cache_creation_input_tokens ?? 0);
    usage.cached += read;
    usage.output += msg.usage?.output_tokens ?? 0;
    if (msg.stop_reason !== "pause_turn") break;
    params.messages = [...params.messages, { role: "assistant", content: msg.content }];
  }
  return { text, thinking, usage };
}

// ---------------- OpenAI 兼容 ----------------

function toOpenAIContent(parts) {
  if (parts.every(p => p.type === "text")) return parts.map(p => p.text).join("\n");
  return parts.map(p => {
    if (p.type === "image") return { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.data}` } };
    if (p.type === "pdf") return { type: "text", text: `（对方发来了 PDF「${p.name}」，但当前接口不支持读取 PDF）` };
    return { type: "text", text: p.text };
  });
}

function openaiHeaders(api) {
  return { "Content-Type": "application/json", ...(api.key ? { Authorization: `Bearer ${api.key}` } : {}) };
}

// 有些接口把思考过程写在正文的 <think>…</think> 里，拆出来
function splitThink(raw) {
  let thinking = "";
  const text = raw
    .replace(/<(think|thought|thinking)>([\s\S]*?)(<\/\1>|$)/g, (_, _t, inner, close) => {
      thinking += close ? inner : inner.replace(/<\/?[a-z]*$/i, ""); // 没收完的结束标签不算
      return "";
    })
    .replace(/<\/?[a-z]*$/i, "") // 还没收完的标签先藏起来
    .replace(/^\s+/, "");
  return { text, thinking };
}

const isOpenRouter = api => /openrouter\.ai/i.test(api.baseUrl || "");

async function openaiStream({ api, model, system, messages, signal, onText, onThinking }) {
  const stream = streaming();
  const body = {
    model,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    max_tokens: Number(api.maxTokens) || undefined,
    messages: [{ role: "system", content: system }, ...messages.map(m => ({ role: m.role, content: toOpenAIContent(m.parts) }))],
  };
  // OpenRouter：要明说才会把思考（GPT 是思考摘要）传回来；思考强度也走这里
  if (isOpenRouter(api) && (api.showThinking || api.effort)) {
    body.reasoning = { ...(api.effort ? { effort: api.effort } : {}), ...(api.showThinking ? { enabled: true } : { exclude: true }) };
  }
  const res = await fetch(`${trimUrl(api.baseUrl)}/chat/completions`, {
    method: "POST",
    signal,
    headers: { ...openaiHeaders(api), ...(isOpenRouter(api) ? { "X-Title": "Qisuo" } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text();
    if (/not available in your region|unsupported_country|country, region, or territory/i.test(raw)) {
      throw new Error("这个模型不对你现在所在的地区提供服务：开梯子再试，或者换一个模型。");
    }
    throw new Error(`接口返回 ${res.status}：${raw.slice(0, 300)}`);
  }

  // 关了流式：整条一次拿回来
  if (!stream) {
    const raw = await res.text();
    let j;
    try { j = JSON.parse(raw); } catch { throw new Error(`接口返回的不是 JSON：${raw.slice(0, 200)}`); }
    if (j.error) throw new Error(`接口报错：${j.error.message || JSON.stringify(j.error).slice(0, 200)}`);
    const m = j.choices?.[0]?.message || {};
    const c = typeof m.content === "string" ? m.content : (m.content || []).map(x => x.text || "").join("");
    const parts = splitThink(c);
    const reasoning = (m.reasoning_content ?? m.reasoning ?? (Array.isArray(m.reasoning_details) ? m.reasoning_details.map(d => d.summary ?? d.text ?? "").join("") : "")) || "";
    const thinking = reasoning + parts.thinking;
    if (thinking) onThinking?.(thinking);
    if (parts.text) onText(parts.text);
    const u = j.usage || {};
    return { text: parts.text, thinking, usage: { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, cached: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? u.cached_tokens ?? 0 } };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", content = "", text = "", thinking = "", reasoning = "", usage = { input: 0, output: 0, cached: 0 };
  // 把新的正文 / 思考按增量交出去
  const emit = () => {
    const parts = splitThink(content);
    const fullThinking = reasoning + parts.thinking;
    if (parts.text.startsWith(text) && parts.text.length > text.length) onText(parts.text.slice(text.length));
    if (fullThinking.startsWith(thinking) && fullThinking.length > thinking.length) onThinking?.(fullThinking.slice(thinking.length));
    text = parts.text;
    thinking = fullThinking;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const j = JSON.parse(data);
        const delta = j.choices?.[0]?.delta || {};
        // OpenRouter 还会把思考放在 reasoning_details 里（GPT 给的是摘要；加密的那种看不了）
        const r = delta.reasoning_content ?? delta.reasoning ?? delta.reasoning_text
          ?? (Array.isArray(delta.reasoning_details) ? delta.reasoning_details.map(d => d.summary ?? d.text ?? "").join("") || undefined : undefined);
        if (typeof r === "string" && r) reasoning += r;
        if (delta.content) content += delta.content;
        if (r || delta.content) emit();
        // 命中缓存的输入：OpenAI / Gemini 写在 prompt_tokens_details 里，DeepSeek 叫 prompt_cache_hit_tokens
        if (j.usage) usage = { input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0, cached: j.usage.prompt_tokens_details?.cached_tokens ?? j.usage.prompt_cache_hit_tokens ?? j.usage.cached_tokens ?? 0 };
      } catch { /* 不完整的行，忽略 */ }
    }
  }
  return { text, thinking, usage };
}

// ---------------- 对外接口 ----------------

export async function streamChat(opts) {
  const { api } = opts;
  if (!api) throw new Error("还没有可用的 API，请先到「设置 → API」里添加一个");
  if (!api.key && api.type === "anthropic") throw new Error(`「${api.name || "API"}」还没有填写密钥`);
  const model = opts.model || api.model;
  if (!model) throw new Error(`「${api.name || "API"}」还没有选择模型`);
  const fn = api.type === "openai" ? openaiStream : anthropicStream;
  // 网络断了（手机信号、切到后台、中转平台掐断……）：还没收到任何内容的话，自动再试两次
  let got = false;
  const o = { ...opts, model, onText: d => { got = true; opts.onText?.(d); }, onThinking: d => { got = true; opts.onThinking?.(d); } };
  for (let i = 0; ; i++) {
    try {
      return await fn(o);
    } catch (e) {
      const net = /load failed|failed to fetch|networkerror|network error|network connection|terminated|econnreset|socket/i.test(String(e?.message || e));
      if (!net || got || i >= 2 || opts.signal?.aborted) {
        if (net && !got) throw new Error(`连不上「${api.name || "API"}」（试了 ${i + 1} 次）：网络断了，或者平台那边掐断了连接。稍后点重新生成再试。`);
        throw e;
      }
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

export async function fetchModels(api) {
  if (api.type === "openai") {
    const res = await fetch(`${trimUrl(api.baseUrl)}/models`, { headers: openaiHeaders(api) });
    if (!res.ok) throw new Error(`接口返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return (j.data || j.models || []).map(m => m.id || m.name).filter(Boolean).sort();
  }
  const client = anthropicClient(api);
  const ids = [];
  for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
  return ids;
}
