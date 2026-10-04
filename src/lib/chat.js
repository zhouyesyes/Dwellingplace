// 聊天逻辑：组装提示词、发送、流式接收、重新生成、签名更新。
import { reactive } from "vue";
import { get, set } from "idb-keyval";
import { store, uid, roleById, apiFor, loadMessages, saveMessages, recordUsage } from "../store/index.js";
import { streamChat } from "./providers.js";
import { imageBase64 } from "./images.js";
import { nowForAI, gapForAI } from "./time.js";

// threadId -> AbortController（正在生成中）
export const generating = reactive({});

const HISTORY_LIMIT = 80;
const SIG_RE = /\n?\s*\[签名[:：]\s*([^\]\n]{1,40})\]\s*$/;

// 显示时去掉签名标记（流式输出中途也要藏起来）
export function visibleText(text) {
  return text.replace(SIG_RE, "").replace(/\n?\s*\[签名[^\]]*$/, "").trimEnd();
}

// AI 的一条回复按空行拆成几个气泡
export function splitBubbles(text) {
  return visibleText(text).split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
}

function canChangeSignature(role) {
  if (role.sigLocked) return false;
  return Date.now() - (role.sigUpdatedAt || 0) >= (Number(role.sigCooldownHours) || 0) * 3600_000;
}

function buildSystem(role, messages) {
  const me = store.profile.name || "我";
  const lastOther = [...messages].reverse().find(m => m.from !== "event" && !m.pending && m.ts < Date.now() - 1000);
  const lines = [
    `你是「${role.name}」，正在用手机和「${me}」聊天。`,
    role.persona ? `\n# 你的设定\n${role.persona}` : "",
    `\n# 现在`,
    `现在是 ${nowForAI()}。`,
    lastOther && Date.now() - lastOther.ts > 30 * 60_000
      ? `距离你们上一条消息已经过去了 ${gapForAI(Date.now() - lastOther.ts)}。` : "",
    `\n# 聊天方式`,
    `像真人用聊天软件发消息一样自然地回复。可以把回复分成几条短消息，每条之间空一行。`,
    `\n# 你的签名`,
    role.signature ? `你现在的签名是：「${role.signature}」。` : `你现在还没有签名。`,
    canChangeSignature(role)
      ? `签名会显示在聊天界面你的名字下面。如果你此刻真的想换一个签名（不要频繁换），在回复的最末尾另起一行写：[签名:新签名]，不超过 20 个字。不想换就什么都不写。`
      : `现在不能更改签名。`,
  ];
  return lines.filter(Boolean).join("\n");
}

async function partsOf(m) {
  const parts = [];
  for (const a of m.attachments || []) {
    if (a.kind === "image") {
      const { data, mime } = await imageBase64(a.img);
      parts.push({ type: "image", data, mime });
    } else if (a.kind === "pdf") {
      const blob = await get("file:" + a.file);
      if (blob) parts.push({ type: "pdf", name: a.name, data: await blobToBase64(blob) });
    } else if (a.kind === "text") {
      parts.push({ type: "text", text: `【文件：${a.name}】\n${a.text}` });
    }
  }
  if (m.text) parts.push({ type: "text", text: m.text });
  return parts;
}

async function buildMessages(list) {
  const out = [];
  for (const m of list.slice(-HISTORY_LIMIT)) {
    if (m.from === "event" || m.pending || m.error) continue;
    const role = m.from === "user" ? "user" : "assistant";
    const parts = role === "user" ? await partsOf(m) : [{ type: "text", text: m.text }];
    if (!parts.length) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.parts.push(...parts);
    else out.push({ role, parts });
  }
  if (!out.length || out[0].role !== "user") out.unshift({ role: "user", parts: [{ type: "text", text: "（开始聊天）" }] });
  if (out[out.length - 1].role !== "user") out.push({ role: "user", parts: [{ type: "text", text: "（继续）" }] });
  return out;
}

function touchThread(thread, list) {
  const last = [...list].reverse().find(m => m.from !== "event" && !m.pending);
  thread.updatedAt = Date.now();
  if (last) {
    const att = last.attachments?.length ? "[附件] " : "";
    thread.preview = att + (last.from === "ai" ? splitBubbles(last.text).join(" ") : last.text || "");
  }
}

export async function generate(thread) {
  if (generating[thread.id]) return;
  const role = roleById(thread.roleId);
  const list = await loadMessages(thread.id);
  const api = apiFor(thread, role);
  const ctrl = new AbortController();
  generating[thread.id] = ctrl;

  const msg = reactive({ id: uid(), from: "ai", text: "", ts: Date.now(), pending: true, apiId: api?.id ?? null });
  try {
    const system = buildSystem(role, list);
    const messages = await buildMessages(list);
    list.push(msg);
    const { text, usage } = await streamChat({
      api, system, messages, signal: ctrl.signal,
      onText: d => { msg.text += d; },
    });
    msg.text = text || msg.text;
    if (api) recordUsage(api.id, usage.input, usage.output);

    const sig = msg.text.match(SIG_RE);
    if (sig) {
      msg.text = msg.text.replace(SIG_RE, "").trimEnd();
      if (canChangeSignature(role) && sig[1].trim() !== role.signature) {
        role.signature = sig[1].trim();
        role.sigUpdatedAt = Date.now();
        list.push({ id: uid(), from: "event", text: `${role.name} 把签名改成了「${role.signature}」`, ts: Date.now() });
      }
    }
  } catch (err) {
    if (ctrl.signal.aborted || err?.name === "AbortError" || err?.constructor?.name === "APIUserAbortError") {
      msg.text = visibleText(msg.text);
    } else {
      msg.error = true;
      msg.text = describeError(err);
    }
    if (!list.includes(msg)) list.push(msg);
  } finally {
    delete msg.pending;
    if (!msg.text && !msg.error) list.splice(list.indexOf(msg), 1);
    delete generating[thread.id];
    touchThread(thread, list);
    saveMessages(thread.id);
  }
}

function describeError(err) {
  const status = err?.status;
  if (status === 401) return "密钥不对（401），去「设置 → API」检查一下吧";
  if (status === 403) return "没有权限（403）：密钥或接口地址可能不对";
  if (status === 404) return "找不到这个模型或接口（404），检查一下模型名和接口地址";
  if (status === 429) return "请求太频繁或额度用完了（429），稍后再试";
  if (status >= 500) return `服务暂时出问题了（${status}），稍后再试`;
  if (err instanceof TypeError && /fetch/i.test(err.message)) return "连不上接口：网络问题，或者这个平台不允许浏览器直接访问";
  return "出错了：" + (err?.message || String(err));
}

export async function sendMessage(thread, text, attachments = []) {
  const list = await loadMessages(thread.id);
  const role = roleById(thread.roleId);
  if (!list.some(m => m.from === "user")) thread.title = (text || "图片").slice(0, 16);
  list.push({ id: uid(), from: "user", text, attachments, ts: Date.now() });
  role.lastThreadId = thread.id;
  touchThread(thread, list);
  saveMessages(thread.id);
  await generate(thread);
}

// 重新生成某条 AI 回复：删掉它以及之后的所有消息
export async function regenerate(thread, msgId) {
  const list = await loadMessages(thread.id);
  const i = list.findIndex(m => m.id === msgId);
  if (i < 0) return;
  list.splice(i);
  await generate(thread);
}

// 修改自己的消息后，从这里重新回答
export async function editAndResend(thread, msgId, text) {
  const list = await loadMessages(thread.id);
  const i = list.findIndex(m => m.id === msgId);
  if (i < 0) return;
  list[i].text = text;
  list[i].edited = true;
  list.splice(i + 1);
  saveMessages(thread.id);
  await generate(thread);
}

export async function deleteMessage(thread, msgId) {
  const list = await loadMessages(thread.id);
  const i = list.findIndex(m => m.id === msgId);
  if (i >= 0) list.splice(i, 1);
  touchThread(thread, list);
  saveMessages(thread.id);
}

// ---------- 附件 ----------
const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|js|ts|py|html|css|xml|yaml|yml|log|srt)$/i;

export async function fileToAttachment(file) {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    const id = uid();
    await set("file:" + id, file);
    return { kind: "pdf", name: file.name, file: id, size: file.size };
  }
  if (file.type.startsWith("text/") || TEXT_EXT.test(file.name)) {
    const text = await file.text();
    return { kind: "text", name: file.name, text: text.slice(0, 200_000), size: file.size };
  }
  throw new Error(`暂时不支持这种文件：${file.name}（支持图片、PDF 和文本文件）`);
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
