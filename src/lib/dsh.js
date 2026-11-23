import { store, apiFor } from "../store/index.js";
import { codexBase } from "./codexJobs.js";

export function dshApi(role, thread) {
  const official = api => {
    if (!api?.key) return false;
    try {
      const url = new URL(api.baseUrl);
      return (url.origin === "https://api.deepseek.com" && /^\/(?:v1\/?)?$/.test(url.pathname)) ||
        (/^https?:$/.test(url.protocol) && /^\/p\/[^/]+\/deepseek(?:\/v1)?\/?$/.test(url.pathname));
    } catch { return false; }
  };
  const current = apiFor(thread, role);
  return official(current) ? current : store.apis.find(official);
}

export async function dshReply(role, thread, api, system, messages, signal, onUpdate) {
  const base = codexBase(role, thread)?.replace(/\/codex$/, "/dsh");
  if (!base) throw new Error("找不到栖所服务器的地址");
  if (!api) throw new Error("先在「设置 → API」添加 DeepSeek 官方 API 和密钥，再使用 DSH");
  const past = messages.slice(0, -1).map(m => {
    const text = m.parts.map(p => p.type === "text" ? p.text : "[附件]").join("\n");
    return `${m.role === "assistant" ? "你" : "对方"}：${text}`;
  }).join("\n\n");
  const prompt = [{ type: "text", text: [system, past, "【本轮消息】"].filter(Boolean).join("\n\n") }];
  for (const part of messages.at(-1)?.parts || []) {
    if (part.type === "text") prompt.push({ type: "text", text: part.text });
    else if (part.type === "image" && /^image\/(png|jpeg|gif|webp)$/.test(part.mime)) {
      prompt.push({ type: "image", mimeType: part.mime, data: part.data });
    } else prompt.push({ type: "text", text: "[附件]" });
  }
  const body = JSON.stringify({ prompt });
  if (new Blob([body]).size > 10_000_000) throw new Error("这次的消息或附件太大，请分次发送");
  const res = await fetch(base + "/chat", {
    method: "POST", signal, body, redirect: "error",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.key}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error?.message || `DSH 聊天接口返回 ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "", text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("DSH 的连接提前断开了，可以重试这条消息");
      const lines = (buffer + chunk.value).split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const event = JSON.parse(line);
        if (event.type === "error") throw new Error(event.text);
        if (event.type === "done") return { text, usage: { input: 0, output: 0 } };
        if (event.type === "text") text += event.text;
        onUpdate(event, text);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
