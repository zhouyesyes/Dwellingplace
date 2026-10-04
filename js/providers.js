// 每个伙伴可以接不同的模型来源：Claude、任意 OpenAI 兼容接口，或离线演示。
// 统一接口：streamReply({ companion, settings, system, messages, signal, onText }) -> 完整文本

export const PROVIDERS = {
  claude: { label: "Claude (Anthropic)", defaultModel: "claude-opus-5-5" },
  openai: { label: "OpenAI 兼容接口", defaultModel: "gpt-4o-mini" },
  demo: { label: "演示（离线，无需密钥）", defaultModel: "" },
};

export async function streamReply(opts) {
  const fn = { claude: claudeReply, openai: openaiReply, demo: demoReply }[opts.companion.provider];
  if (!fn) throw new Error(`未知的模型来源：${opts.companion.provider}`);
  return fn(opts);
}

// ---------- Claude：官方 SDK，浏览器内直连 ----------
let anthropicModule;
async function claudeReply({ companion, settings, system, messages, signal, onText }) {
  if (!settings.anthropicKey) throw new Error("还没有填写 Anthropic API Key（在「设置」里）");
  anthropicModule ??= await import("https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm");
  const Anthropic = anthropicModule.default;
  const client = new Anthropic({ apiKey: settings.anthropicKey, dangerouslyAllowBrowser: true });

  const stream = client.messages.stream(
    {
      model: companion.model || PROVIDERS.claude.defaultModel,
      max_tokens: 64000,
      output_config: { effort: "low" },
      system,
      messages,
    },
    { signal },
  );
  stream.on("text", delta => onText(delta));
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") throw new Error("对方拒绝回答了这条消息");
  return final.content.filter(b => b.type === "text").map(b => b.text).join("");
}

// ---------- OpenAI 兼容接口（DeepSeek、通义、Moonshot、本地 Ollama 等） ----------
async function openaiReply({ companion, settings, system, messages, signal, onText }) {
  const base = (companion.baseUrl || settings.openaiBaseUrl || "").replace(/\/+$/, "");
  const key = companion.apiKey || settings.openaiKey;
  if (!base) throw new Error("还没有填写接口地址");

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      model: companion.model || PROVIDERS.openai.defaultModel,
      stream: true,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!res.ok) throw new Error(`接口返回 ${res.status}：${(await res.text()).slice(0, 300)}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, "");
      if (!data || data === "[DONE]" || !line.trim().startsWith("data:")) continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) { full += delta; onText(delta); }
      } catch { /* 跳过不完整的行 */ }
    }
  }
  return full;
}

// ---------- 演示模式：不联网，用来试界面 ----------
const DEMO_LINES = [
  "我在呢。{u}，今天过得怎么样？",
  "嗯，我听到了。可以多说一点吗？",
  "这让我想起一件事——不过先听你说完。",
  "哈哈，{other}肯定有不同意见。",
  "其实我觉得慢慢来也挺好的。",
  "要不要一起想想接下来做什么？",
  "（这是演示模式。去「伙伴」里给我接上真正的模型，我就能好好回答你了。）",
];
async function demoReply({ companion, settings, signal, onText, others }) {
  const pick = DEMO_LINES[Math.floor(Math.random() * DEMO_LINES.length)];
  const text = pick
    .replace("{u}", settings.userName || "你")
    .replace("{other}", others?.[0]?.name || "别人");
  let out = "";
  for (const ch of text) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    await new Promise(r => setTimeout(r, 25 + Math.random() * 35));
    out += ch;
    onText(ch);
  }
  return out;
}
