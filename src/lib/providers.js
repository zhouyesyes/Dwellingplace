// 模型接入。两种接口格式：
//   anthropic — Claude 官方，或使用 Anthropic 格式的反代（改 baseUrl 即可）
//   openai    — 任何 OpenAI 兼容的 /chat/completions 接口（DeepSeek、各类反代、本地模型等）
//
// 统一的消息格式：{ role: "user" | "assistant", parts: [{ type: "text", text } | { type: "image", data, mime } | { type: "pdf", data, name }] }

import Anthropic from "@anthropic-ai/sdk";

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
  };
}

const trimUrl = u => (u || "").trim().replace(/\/+$/, "");

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
  const params = {
    model,
    max_tokens: Number(api.maxTokens) || 32000,
    system,
    messages: messages.map(m => ({ role: m.role, content: toAnthropicContent(m.parts) })),
  };
  if (api.effort) params.output_config = { effort: api.effort };
  if (webSearch) params.tools = [searchTool(model)];
  // 让模型把思考过程（摘要）返回来
  if (api.showThinking) params.thinking = { type: "adaptive", display: "summarized" };

  let text = "";
  let thinking = "";
  const usage = { input: 0, output: 0 };
  // 联网搜索时服务端可能会暂停（pause_turn），把已有内容带上继续
  for (let round = 0; round < 4; round++) {
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
    usage.input += msg.usage?.input_tokens ?? 0;
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

async function openaiStream({ api, model, system, messages, signal, onText, onThinking }) {
  const res = await fetch(`${trimUrl(api.baseUrl)}/chat/completions`, {
    method: "POST",
    signal,
    headers: openaiHeaders(api),
    body: JSON.stringify({
      model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: Number(api.maxTokens) || undefined,
      messages: [{ role: "system", content: system }, ...messages.map(m => ({ role: m.role, content: toOpenAIContent(m.parts) }))],
    }),
  });
  if (!res.ok) throw new Error(`接口返回 ${res.status}：${(await res.text()).slice(0, 300)}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", content = "", text = "", thinking = "", reasoning = "", usage = { input: 0, output: 0 };
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
        const r = delta.reasoning_content ?? delta.reasoning ?? delta.reasoning_text;
        if (typeof r === "string" && r) reasoning += r;
        if (delta.content) content += delta.content;
        if (r || delta.content) emit();
        if (j.usage) usage = { input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0 };
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
  return fn({ ...opts, model });
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
