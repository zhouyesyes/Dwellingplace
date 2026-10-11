// 语音和画画：都按「OpenAI 兼容」的接口来（OpenAI、硅基流动、很多中转都是这个格式），以后选好哪家填进来就行
//   语音转文字：POST {地址}/audio/transcriptions（你的语音消息 → 文字，他才听得懂）
//   他的声音：  POST {地址}/audio/speech（他的 [语音:…] 和「朗读」）
//   画画：      POST {地址}/images/generations（他的 [画:…]）
import { store, uid } from "../store/index.js";
import { get, set } from "./kv.js";
import { get as idbGet, set as idbSet } from "idb-keyval";

export const defaultMedia = () => ({
  stt: { enabled: false, baseUrl: "https://api.openai.com/v1", key: "", model: "whisper-1" },
  tts: { enabled: false, baseUrl: "https://api.openai.com/v1", key: "", model: "gpt-4o-mini-tts", voice: "alloy" },
  image: { enabled: false, baseUrl: "https://api.openai.com/v1", key: "", model: "gpt-image-1", size: "1024x1024" },
});
const cfg = k => store.media?.[k] || {};
const trim = u => String(u || "").trim().replace(/\/+$/, "");
const auth = c => (c.key ? { Authorization: `Bearer ${c.key.trim()}` } : {});
export const sttReady = () => !!(cfg("stt").enabled && cfg("stt").baseUrl);
export const ttsReady = () => !!(cfg("tts").enabled && cfg("tts").baseUrl);
export const imageReady = () => !!(cfg("image").enabled && cfg("image").baseUrl);

async function fail(r, what) {
  const t = await r.text().catch(() => "");
  let m = t;
  try { m = JSON.parse(t).error?.message || t; } catch { /* 不是 JSON */ }
  throw new Error(`${what}失败（${r.status}）：${String(m).slice(0, 200)}`);
}

// ---------- 语音转文字 ----------
export async function transcribe(blob) {
  const c = cfg("stt");
  const fd = new FormData();
  const ext = /mp4|m4a|aac/.test(blob.type) ? "m4a" : /ogg/.test(blob.type) ? "ogg" : /wav/.test(blob.type) ? "wav" : "webm";
  fd.append("file", blob, `voice.${ext}`);
  fd.append("model", c.model || "whisper-1");
  const r = await fetch(`${trim(c.baseUrl)}/audio/transcriptions`, { method: "POST", headers: auth(c), body: fd });
  if (!r.ok) await fail(r, "转文字");
  const j = await r.json().catch(() => ({}));
  return String(j.text || "").trim();
}

// ---------- 他的声音（读过的存在这台设备上，不同步，下次直接放） ----------
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + s.length;
}
const ttsUrls = new Map();
export async function speak(text) {
  const c = cfg("tts");
  const key = `sync:tts:${hash(`${c.model}|${c.voice}|${text}`)}`; // sync: 开头的只在这台设备上
  if (ttsUrls.has(key)) return ttsUrls.get(key);
  let blob = await idbGet(key).catch(() => null);
  if (!blob) {
    const r = await fetch(`${trim(c.baseUrl)}/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(c) },
      body: JSON.stringify({ model: c.model, input: text.slice(0, 4000), voice: c.voice || "alloy", response_format: "mp3" }),
    });
    if (!r.ok) await fail(r, "生成语音");
    blob = await r.blob();
    idbSet(key, blob).catch(() => {});
  }
  const url = URL.createObjectURL(blob);
  ttsUrls.set(key, url);
  return url;
}

// ---------- 画画 ----------
export async function drawImage(prompt) {
  const c = cfg("image");
  const r = await fetch(`${trim(c.baseUrl)}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(c) },
    body: JSON.stringify({ model: c.model, prompt: prompt.slice(0, 4000), n: 1, ...(c.size ? { size: c.size } : {}) }),
  });
  if (!r.ok) await fail(r, "画画");
  const j = await r.json();
  const d = j.data?.[0] || {};
  let blob;
  if (d.b64_json) blob = new Blob([Uint8Array.from(atob(d.b64_json), ch => ch.charCodeAt(0))], { type: "image/png" });
  else if (d.url) { const ir = await fetch(d.url); if (!ir.ok) throw new Error(`取图片失败（${ir.status}）`); blob = await ir.blob(); }
  else throw new Error("接口没有返回图片");
  const id = uid();
  await set("img:" + id, blob);
  return id;
}

// ---------- 你的语音消息：录音 ----------
// 录音的同时，没配「语音转文字」的话试试浏览器自带的听写（有的浏览器有、免费，但不一定准）
export async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("这个浏览器录不了音");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(t => MediaRecorder.isTypeSupported?.(t)) || "";
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
  const chunks = [];
  rec.ondataavailable = e => e.data?.size && chunks.push(e.data);
  const t0 = Date.now();
  rec.start();
  let heard = "";
  let sr = null;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR && !sttReady()) {
    try {
      sr = new SR();
      sr.lang = "zh-CN";
      sr.continuous = true;
      sr.interimResults = false;
      sr.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) heard += e.results[i][0].transcript; };
      sr.onerror = () => {};
      sr.start();
    } catch { sr = null; }
  }
  const end = () => { stream.getTracks().forEach(t => t.stop()); try { sr?.stop(); } catch { /* 已经停了 */ } };
  return {
    startedAt: t0,
    stop: () => new Promise(resolve => {
      rec.onstop = async () => {
        end();
        await new Promise(r => setTimeout(r, 400)); // 等浏览器听写把最后一句交出来
        resolve({ blob: new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }), dur: Math.max(1, Math.round((Date.now() - t0) / 1000)), heard: heard.trim() });
      };
      rec.stop();
    }),
    cancel: () => { rec.onstop = null; try { rec.stop(); } catch { /* 已经停了 */ } end(); },
  };
}

// 录好的语音 → 附件（存进本地 + 同步；转文字有就带上）
export async function voiceAttachment({ blob, dur, heard }) {
  const id = uid();
  await set("file:" + id, blob);
  let text = heard || "";
  let error = "";
  if (sttReady()) {
    try { text = await transcribe(blob); } catch (e) { error = e.message; }
  }
  return { kind: "audio", file: id, dur, mime: blob.type, text, ...(error ? { sttError: error } : {}) };
}
export const voiceBlob = id => get("file:" + id);
