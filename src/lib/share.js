// 分享聊天记录（像微信的「合并转发」）：选几条消息，做成一张卡片发进另一处聊天。
// 卡片是目标聊天里的一条普通消息（from: "user"，text 为空），多一个 share 字段，存的是当时的一份拷贝：
//   share = { title, kind: "dm" | "group", label, items: [{ from, who, name, ts, text, media: [{ kind: "image" | "video", img, dur }] }] }
// 图片只记 id，指着原来那份压缩过的图（不重新上传、不复制）；视频只记第一帧的图。
// 原聊天里删了消息也不会删图，所以卡片和原聊天互不影响。
import { store, MAIN, CRAB, GROUP_TID, roleById, threadsOf, createThread } from "../store/index.js";

export const SHARE_MAX = 100; // 一次最多转多少条
const IMG_MAX = 12; // 给模型看的图，一张卡片最多这么多张（再多的写成 [图片]）
const TEXT_MAX = 3000;

const pad = n => String(n).padStart(2, "0");
export const clock = ts => { const d = new Date(ts); return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// 一条消息 → 卡片里的一行。text 由调用的人先整理好（AI 的话去掉标签、拆好气泡）
export function shareItem(m, { name, who, text }) {
  const media = [];
  for (const a of m.attachments || []) {
    if (a.kind === "image" && a.img) media.push({ kind: "image", img: a.img });
    else if (a.kind === "video" && a.img) media.push({ kind: "video", img: a.img, dur: a.dur });
  }
  const extra = [];
  for (const a of m.attachments || []) {
    if (a.kind === "audio") extra.push(a.text ? `[语音] ${a.text}` : "[语音]");
    else if (a.kind === "pdf" || a.kind === "text") extra.push(`[文件：${a.name}]`);
  }
  return { from: m.from === "user" ? "user" : "ai", who: who || null, name, ts: m.ts, text: [text, ...extra].filter(Boolean).join("\n").slice(0, TEXT_MAX), ...(media.length ? { media } : {}) };
}

// 做一张卡片。picked：选中的消息（已按先后排好）；toItem：一条消息 → 一行
export function makeShare(picked, { kind, role }, toItem) {
  const items = [];
  for (const m of picked) {
    if (m.share) items.push(...m.share.items); // 转发别人转来的卡片：展开一层
    else items.push(toItem(m));
  }
  const cut = items.slice(0, SHARE_MAX);
  return kind === "group"
    ? { title: `群聊${store.group.name}的聊天记录`, kind, label: `群聊「${store.group.name}」`, items: cut }
    : { title: `和${role.name}的聊天记录`, kind, label: `${role.name}的私聊`, items: cut };
}

// 卡片上的预览：前三句
export const previewLines = (share, n = 3) => share.items.slice(0, n).map(it => ({
  name: it.name,
  text: it.text ? it.text.replace(/\s+/g, " ") : it.media?.some(x => x.kind === "video") && !it.media.some(x => x.kind === "image") ? "视频" : "图片",
}));

export const shareBrief = share => `[聊天记录] ${share.title}`;

// 展开成原文给模型 / 摘要 / 对话本看。
// me：这位 AI 眼里「她」叫什么；selfId：这位 AI 自己的 id（记录里是它说的，就写「你」）；
// images：true 的话图片位置留空（图片作为图片输入另外放），false 写成 [图片]
export function shareLines(share, { me = "对方", selfId = null } = {}) {
  return shareParts(share, { me, selfId, images: false }).map(p => p.text).join("");
}

// 给模型的内容：文字和图片交替，顺序和原记录一致。readImg(id) → { data, mime }；不传就不放图
export function shareParts(share, { me = "对方", selfId = null, images = true } = {}) {
  const parts = [];
  let buf = "";
  const flush = () => { if (buf) { parts.push({ type: "text", text: buf }); buf = ""; } };
  const origin = share.kind === "group"
    ? `这是${share.label}里的聊天记录（${me}和两位 AI 一起在群里说的话）`
    : `这是${me}和${share.label.replace(/的私聊$/, "")}私聊里的聊天记录`;
  buf += `【转来的聊天记录：${share.title}】\n（${me}把这段记录转发给你看，${origin}。下面每一条写明了是谁、在什么时间说的；这些不是${me}此刻在这里说的话，也不是你说的，只是转来给你看的。共 ${share.items.length} 条。）\n`;
  let seen = 0;
  for (const it of share.items) {
    const who = it.from === "user" ? me : it.who && it.who === selfId ? `你（${it.name}）` : it.name;
    buf += `[${clock(it.ts)}] ${who}：${it.text || ""}`;
    const media = it.media || [];
    if (!media.length) { buf += "\n"; continue; }
    for (const x of media) {
      const label = x.kind === "video" ? `[视频${x.dur ? `，共 ${x.dur} 秒，下面是第一帧` : "，下面是第一帧"}]` : "[图片]";
      if (images && seen < IMG_MAX) {
        seen++;
        buf += `${it.text ? " " : ""}${label}`;
        flush();
        parts.push({ type: "image", id: x.img });
      } else buf += `${it.text ? " " : ""}${x.kind === "video" ? "[视频]" : "[图片]"}`;
    }
    if (!buf.endsWith("\n")) buf += "\n";
  }
  buf += `【转来的聊天记录到这里】\n`;
  flush();
  return parts;
}

// 卡片里所有图片的 id（对话本、统计用）
export const shareImageIds = share => share.items.flatMap(it => (it.media || []).map(x => x.img));

// 给粗略估 token 的
export const shareTokens = share => Math.ceil(share.items.reduce((n, it) => n + (it.text || "").length, 0) / 1.6) + shareImageIds(share).length * 200 + 40;

// ---------- 分享到哪 ----------
// 私聊用这个 AI 最近在聊的那个对话；没有就新开一个
export function dmThreadOf(roleId) {
  const role = roleById(roleId);
  if (!role) return null;
  const list = threadsOf(roleId);
  return list.find(t => t.id === role.lastThreadId) || list[0] || createThread(roleId);
}
export const groupThreadOf = () => store.threads.find(t => t.id === GROUP_TID) || null;

// 能分享到的地方（不含现在这一处）
export function shareTargets({ here }) {
  const out = [];
  for (const id of [CRAB, MAIN]) {
    const r = roleById(id);
    if (r && here !== id) out.push({ key: id, kind: "dm", role: r, name: r.name, sub: "私聊" });
  }
  if (here !== "group" && groupThreadOf() && roleById(MAIN) && roleById(CRAB)) out.push({ key: "group", kind: "group", name: store.group.name, sub: "群聊" });
  return out;
}
