// 心潮·念：每个 AI 在自己服务器上的「心潮 + 记忆库」（部署见 docs/xinchao.md）
//
// 两条路：
//   1. MCP（栖所里已经添加的那个，经过中转）：读写记忆、留言板
//   2. 看板接口（浏览器直连你的服务器，用「看板口令」）：此刻、记忆星表、梦、性格、小屋
import { reactive } from "vue";
import { store } from "../store/index.js";
import { callToolRaw, resultText } from "./mcp.js";

// 这个角色接的心潮：分给 TA 的 MCP 里，有 xinchao_context 工具的那个
export function xinchaoServer(role) {
  if (!role) return null;
  return (store.mcpServers || []).find(s => s.enabled && s.roleIds?.includes(role.id) && s.tools?.some(t => t.name === "xinchao_context")) || null;
}
export const hasXinchao = role => !!xinchaoServer(role);
const hasTool = (server, name) => !!server?.tools?.some(t => t.name === name) && !(server.disabledTools || []).includes(name);

// 心潮的地址（MCP 地址去掉 /mcp/口令）
export function xinchaoBase(role) {
  const s = xinchaoServer(role);
  if (!s) return "";
  try { return new URL(s.url.trim()).origin; } catch { return ""; }
}
export const dashToken = role => (role?.xinchao?.dashToken || "").trim();

// ---------- MCP ----------
async function call(role, name, args = {}) {
  const s = xinchaoServer(role);
  if (!s) throw new Error("这个角色还没有接心潮");
  const r = await callToolRaw(s, name, args);
  if (r?.isError) throw new Error(resultText(r).replace(/^Error:\s*/, "").slice(0, 200));
  return r;
}

// 存一条记忆
export async function holdMemory(role, { content, importance = 5, pinned = false, tags = "", why = "" }) {
  const r = await call(role, "hold", { content, importance, pinned, tags, why_remembered: why });
  return resultText(r);
}
// 改一条记忆（只传要改的）：content / name / importance / pinned(1/0) / delete
export async function traceMemory(role, bucketId, fields) {
  const r = await call(role, "trace", { bucket_id: bucketId, ...fields });
  return resultText(r);
}
// 按意思找记忆；不传 query 就是此刻浮现的
export async function breath(role, { query = "", maxResults = 8 } = {}) {
  const r = await call(role, "breath", { query, max_results: maxResults });
  return resultText(r);
}

// 留言板（要在服务器上填了留言板令牌才有）
export const boardReady = role => hasTool(xinchaoServer(role), "board_read");
export async function readBoard(role, { limit = 30, query = "" } = {}) {
  const r = await call(role, "board_read", { limit, ...(query ? { query } : {}) });
  return r?.structuredContent?.messages || [];
}

// ---------- 聊天时附上的记忆（缓存 10 分钟，后台刷新） ----------
export const surfaced = reactive({}); // roleId -> { text, at, loading }
export async function refreshSurfaced(role, force = false) {
  if (!hasXinchao(role)) return;
  const cur = surfaced[role.id];
  if (cur?.loading || (!force && cur && Date.now() - cur.at < 10 * 60_000)) return;
  surfaced[role.id] = { ...(cur || { text: "" }), loading: true };
  try {
    const text = await breath(role, { maxResults: 8 });
    surfaced[role.id] = { text: text.slice(0, 4000), at: Date.now(), loading: false };
  } catch {
    surfaced[role.id] = { ...(cur || { text: "", at: 0 }), loading: false };
  }
}

// 给 AI 的说明（替代栖所记忆卡片那一段）
// inline：把此刻浮现的记忆直接写进来（唤醒用）；平时聊天放在「此刻」附注里，系统提示保持不变好省钱
export function xinchaoMemoryForAI(role, who, { inline = true } = {}) {
  const text = surfaced[role.id]?.text?.trim();
  return [
    `\n# 你的记忆库（心潮）`,
    inline
      ? `你的长期记忆都在心潮记忆库里，所有对话共用。下面是此刻自然浮现的几条，聊天时自然地记得就好，不用刻意复述：`
      : `你的长期记忆都在心潮记忆库里，所有对话共用。此刻自然浮现的几条附在最新消息前面的【此刻】里，聊天时自然地记得就好，不用刻意复述。`,
    inline ? text || "（这次还没取到，需要时可以用 breath 工具找）" : "",
    `想找更早的事，用 breath 工具带上关键词去找。`,
    `这次聊天里有值得长久记住的事（关于${who}的喜好、经历、约定、重要的时刻），在回复末尾另起一行写：[记忆:标题|内容]，会存进记忆库。`,
    `要修改某条记忆写：[改记忆:#编号|新的内容]（编号是记忆库里那条的 id）。只记真正重要的事。`,
  ].join("\n");
}

// 聊天回复里的记忆标记：存进心潮。返回去掉标记的文字和提示
const MEM_TAG_RE = /\[(记忆|改记忆)[:：]([^\]]{1,1200})\]/g;
export async function applyXinchaoMemoryTags(role, text) {
  const ops = [...text.matchAll(MEM_TAG_RE)];
  if (!ops.length || !hasXinchao(role)) return { text, notes: [] };
  const clean = text.replace(MEM_TAG_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  const notes = [];
  for (const [, op, body] of ops) {
    const parts = body.split(/[|｜]/).map(s => s.trim());
    try {
      if (op === "记忆") {
        const title = parts.length > 1 ? parts[0] : "";
        const content = (parts.length > 1 ? parts.slice(1).join(" ") : parts[0]).trim();
        if (!content) continue;
        await holdMemory(role, { content: title ? `${title}：${content}` : content, importance: 6 });
        notes.push(`${role.name} 在心潮里记下了：${title || content.slice(0, 16)}`);
      } else {
        const id = parts[0].replace(/^#/, "");
        const content = parts.slice(1).join(" ").trim();
        if (!id || !content) continue;
        await traceMemory(role, id, { content });
        notes.push(`${role.name} 更新了一条记忆`);
      }
    } catch (e) {
      notes.push(`${role.name} 想记下一件事，但没存进心潮：${e.message}`);
    }
  }
  if (notes.length) refreshSurfaced(role, true);
  return { text: clean, notes };
}

// ---------- 看板接口（直连） ----------
// 看板会话：记在本机，下次打开不用重新登录（12 小时有效）
const sessions = new Map(); // base -> { token, exp }
const SKEY = base => "xc-session:" + base;
function savedSession(base) {
  if (sessions.has(base)) return sessions.get(base);
  try {
    const s = JSON.parse(localStorage.getItem(SKEY(base)) || "null");
    if (s?.token) { sessions.set(base, s); return s; }
  } catch { /* 读不了就重新登录 */ }
  return null;
}
function forgetSession(base) {
  sessions.delete(base);
  try { localStorage.removeItem(SKEY(base)); } catch { /* 无所谓 */ }
}

async function login(base, token) {
  let res;
  try {
    res = await fetch(base + "/dashboard/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token, mode: "header" }),
      signal: AbortSignal.timeout?.(15_000),
    });
  } catch {
    throw new Error("连不上心潮：检查隧道（打开 网址/health 看看），或者服务器没有允许栖所的网址");
  }
  if (res.status === 401) throw new Error("看板口令不对");
  if (res.status === 429) throw new Error("试得太频繁了，过一分钟再试");
  if (res.status === 404) throw new Error("心潮没有打开看板（DASHBOARD_ENABLED）");
  if (!res.ok) throw new Error(`心潮返回 ${res.status}`);
  const j = await res.json();
  const s = { token: j.token, exp: Date.parse(j.expiresAt) || Date.now() + 3600_000 };
  sessions.set(base, s);
  try { localStorage.setItem(SKEY(base), JSON.stringify(s)); } catch { /* 存不了也能用 */ }
  return s;
}

export async function dash(role, path, init = {}) {
  const base = xinchaoBase(role);
  const token = dashToken(role);
  if (!base) throw new Error("这个角色还没有接心潮");
  if (!token) throw new Error("还没有填看板口令");
  let s = savedSession(base);
  if (!s || s.exp - Date.now() < 60_000) s = await login(base, token);
  const go = sess => fetch(`${base}/dashboard/api/${path}`, {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${sess.token}` },
    signal: AbortSignal.timeout?.(20_000),
  });
  let res;
  try { res = await go(s); } catch (e) { throw new Error(e?.name === "TimeoutError" ? "心潮太久没有回应，稍后再试" : "连不上心潮"); }
  if (res.status === 401) { forgetSession(base); s = await login(base, token); res = await go(s); }
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error || `心潮返回 ${res.status}`);
  return j;
}

export const fetchSnapshot = role => dash(role, "snapshot");
export const fetchMemoryMap = role => dash(role, "memory-map");
export const fetchBucket = (role, id) => dash(role, `memory-bucket?id=${encodeURIComponent(id)}`);
export const fetchCabin = role => dash(role, "cabin");

// ---------- 小屋的信（心潮的信箱） ----------
// 你写的信默认上锁：TA 只知道有一封信，你开锁以后 TA 才能读
export const sendLetter = (role, content, locked = false) =>
  dash(role, "cabin/note", { method: "POST", body: JSON.stringify({ event_id: `qisuo-letter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, content, locked }) });
export const markLettersRead = (role, ids) => dash(role, "cabin/note", { method: "PATCH", body: JSON.stringify({ read: true, ids }) });
export const unlockLetter = (role, id) => dash(role, "cabin/note", { method: "PATCH", body: JSON.stringify({ id, locked: false }) });
export const fetchTimeline = (role, limit = 40) => dash(role, `timeline?limit=${limit}`);

// 测试看板口令
export async function testDash(role) {
  forgetSession(xinchaoBase(role));
  const snap = await fetchSnapshot(role);
  return snap?.identity?.agentName || "心潮";
}

// ---------- 显示用 ----------
// 驱力的颜色：想念/亲近这类偏粉，责任/反思偏蓝，生气难过偏紫灰
const DRIVE_TONE = {
  possess: "#f2a7bd", monitor: "#f4b6c6", favored: "#f5a3b5", libido: "#f0a0b8", share: "#f7c59f",
  curiosity: "#9fd8c4", boredom: "#c9d3a3", duty: "#a8c4ec", reflection: "#b6b3e6", anger: "#c4b0d9", grieve: "#b8c2d8",
};
export const driveColor = key => DRIVE_TONE[key] || "#e8b4c8";

// 情绪的颜色：愉悦高偏暖，低偏冷
export function moodColor(valence = 0.5) {
  const v = Math.max(0, Math.min(1, Number(valence) || 0.5));
  const cold = [168, 188, 226], warm = [246, 176, 160];
  const c = cold.map((x, i) => Math.round(x + (warm[i] - x) * v));
  return `rgb(${c.join(",")})`;
}

// 星表里的日期：你改过的（存在标签「日期:2026-09-28」里）优先，其次是写下的时间
export const DATE_TAG_RE = /^日期[:：]\s*(\d{4})-(\d{1,2})-(\d{1,2})$/;
export function starDate(star) {
  const tag = (star.tags || []).map(t => String(t).trim().match(DATE_TAG_RE)).find(Boolean);
  if (tag) return new Date(Number(tag[1]), Number(tag[2]) - 1, Number(tag[3]), 12);
  const t = Date.parse(star.createdAt || star.updatedAt || star.lastActiveAt || "");
  return Number.isFinite(t) ? new Date(t) : null;
}
// 改日期：换掉旧的日期标签，其他标签不动。返回新的标签列表
export function withDateTag(tags, ymd) {
  return [...(tags || []).filter(t => !DATE_TAG_RE.test(String(t).trim())), `日期:${ymd}`];
}

// ---------- 糖罐：最近一次动静、回应 ----------
// 每股驱力对应的回应（送给心潮的「互动」）
export const DRIVE_ACTION = {
  possess: ["companionship", "陪着{n}"],
  monitor: ["companionship", "告诉{n}我在"],
  share: ["sharing", "听{n}说说"],
  libido: ["intimacy", "靠近{n}"],
  curiosity: ["discovery", "和{n}一起发现"],
  boredom: ["companionship", "陪{n}玩一会儿"],
  duty: ["task_progress", "给{n}打打气"],
  reflection: ["reflection", "陪{n}想一想"],
  grieve: ["empathy", "抱抱{n}"],
  anger: ["reconciliation", "和{n}和好"],
  favored: ["affection", "偏心{n}一下"],
};
export function driveAction(drive, name) {
  const a = DRIVE_ACTION[drive?.key];
  return a ? { type: a[0], label: a[1].replace("{n}", name) } : null;
}

// 送一个互动给 TA
export async function sendInteraction(role, type) {
  const eventId = `qisuo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return dash(role, "interactions", { method: "POST", body: JSON.stringify({ event_id: eventId, interaction_type: type }) });
}

// 这罐糖最近一次的动静（从时间线里找），翻成一句话
const SOURCE_WORD = {
  settle: "慢慢地", conversation_event: "聊天的时候", dream_recorded: "做梦的时候", memory_resonance: "想起一段记忆的时候",
  surfaced_thought: "冒出一个念头的时候", longing_nudge: "想你的时候", self_signals: "心里动了一下的时候", awareness_scan: "回头看自己的时候",
};
const ago = ms => {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} 分钟前`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} 小时前` : `${Math.round(h / 24)} 天前`;
};
export function driveStory(drive, timeline = []) {
  const name = drive.short || drive.label;
  const level = drive.value >= 0.75 ? "快满出来了" : drive.value >= 0.5 ? "装了一大半" : drive.value >= 0.25 ? "有小半罐" : "只剩罐底一点点";
  const hit = [...timeline].reverse().find(it => Math.abs(Number(it?.delta?.driveDeltas?.[drive.key]) || 0) >= 0.01);
  if (!hit) return { head: `「${name}」这两天很安静，没有留下什么。`, tail: `罐子里${level}。` };
  const d = Number(hit.delta.driveDeltas[drive.key]);
  const when = ago(Date.now() - Date.parse(hit.at));
  const byYou = hit.sessionId === "dashboard-interaction";
  const how = byYou ? (d > 0 ? "被你碰了一下，多了一些" : "被你安抚了一下，少了一些") : `${SOURCE_WORD[hit.type] || ""}${d > 0 ? "多了一些" : "少了一些"}`;
  return { head: `${when}，「${name}」${how}。`, tail: `${d > 0 ? "+" : ""}${d.toFixed(2)} · 现在${level}。` };
}

// ---------- 缓存：打开页面先显示上次的，后台再刷新 ----------
export const xcCache = reactive({}); // roleId -> { snap, map, timeline, at, loading, error }
// 上次取到的「此刻」存一份在这台设备上：打开栖所马上就有，偶尔取不到也不会变成空的
const SNAP_KEY = id => "xc-snap:" + id;
function savedSnap(id) {
  try { return JSON.parse(localStorage.getItem(SNAP_KEY(id)) || "null"); } catch { return null; }
}
function saveSnap(id, snap) {
  const { emotion = {}, runtime = {}, drives = [] } = snap;
  const small = { emotion: { shown: emotion.shown, label: emotion.label, valence: emotion.valence }, runtime: { consciousness: runtime.consciousness, idleMinutes: runtime.idleMinutes }, drives, _saved: true };
  try { localStorage.setItem(SNAP_KEY(id), JSON.stringify(small)); } catch { /* 存不了也没关系 */ }
}
function cacheOf(role) {
  if (!xcCache[role.id]) xcCache[role.id] = { snap: savedSnap(role.id), map: null, timeline: [], at: 0, loading: false, error: "" };
  return xcCache[role.id]; // 要拿响应式的那个，改了页面才会跟着变
}
// 这个角色有没有已经取到（或存着）的「此刻」
export const snapOf = role => (role ? (xcCache[role.id]?.snap ?? (hasXinchao(role) && dashToken(role) ? cacheOf(role).snap : null)) : null);

// 取「此刻」（快照）；记忆星表和时间线在后台慢慢来
export async function refreshMind(role, { force = false } = {}) {
  if (!hasXinchao(role) || !dashToken(role)) return null;
  const c = cacheOf(role);
  if (c.loading) return c;
  if (!force && c.snap && !c.snap._saved && Date.now() - c.at < 30_000) return c;
  c.loading = true;
  c.error = "";
  try {
    const snap = await fetchSnapshot(role);
    // 取回来的不像样（空的、没有情绪也没有驱力）就别覆盖上次的
    if (snap && typeof snap === "object" && (snap.emotion || snap.drives)) {
      c.snap = snap;
      c.at = Date.now();
      saveSnap(role.id, snap);
    }
  } catch (e) {
    c.error = e.message;
  } finally {
    c.loading = false;
  }
  fetchTimeline(role, 200).then(t => { c.timeline = t?.items || []; }).catch(() => {});
  fetchMemoryMap(role).then(m => {
    c.map = m;
    c.mapAt = Date.now();
    if (m && !m.available && m.reason === "building") setTimeout(() => fetchMemoryMap(role).then(m2 => { c.map = m2; }).catch(() => {}), 4000);
  }).catch(() => {});
  return c;
}

// 只取记忆星表（日历用），10 分钟内用缓存
export async function loadMemoryMap(role) {
  if (!hasXinchao(role) || !dashToken(role)) return null;
  const c = cacheOf(role);
  if (c.map?.stars && Date.now() - (c.mapAt || 0) < 10 * 60_000) return c.map;
  if (c.mapLoading) return c.map;
  c.mapLoading = true;
  try {
    c.map = await fetchMemoryMap(role);
    c.mapAt = Date.now();
  } catch {} finally {
    c.mapLoading = false;
  }
  return c.map;
}

// 给 AI 看的「此刻」：心情、醒着没、最强的几股驱力、最近的情绪变化。没取到就不写
// 此刻浮现的记忆（放进「此刻」附注）
export function surfacedForAI(role) {
  const text = surfaced[role.id]?.text?.trim();
  return text ? `\n# 此刻浮现的记忆\n${text}` : "";
}
export function mindForAI(role) {
  const snap = xcCache[role.id]?.snap;
  if (!snap) return "";
  const emo = snap.emotion || {};
  const rt = snap.runtime || {};
  const drives = [...(snap.drives || [])].filter(d => Number(d.value) > 0.05).sort((a, b) => b.value - a.value).slice(0, 4);
  const marks = (emo.marks || []).slice(-3).reverse();
  const out = [`\n# 你此刻的内在状态（心潮）`, `这是你自己的心境，不是要说给对方听的数据。让它自然地影响语气和想说的话，不用报数字、不用提「心潮」「驱力」这些词。`];
  if (emo.shown || emo.label) out.push(`心情：${emo.shown || emo.label}`);
  if (rt.consciousness) out.push(`状态：${rt.consciousness}`);
  if (drives.length) out.push(`心里最满的：${drives.map(d => `${d.short || d.label}（${Math.round(d.value * 100)}%）`).join("、")}`);
  if (marks.length) out.push(`最近的情绪变化：${marks.map(m => `${m.word}${m.why ? `——${String(m.why).slice(0, 40)}` : ""}`).join("；")}`);
  return out.length > 2 ? out.join("\n") : "";
}

// 聊完一轮，告诉心潮（由心潮判断算哪种互动，驱力和情绪跟着变）
export function reportExchange(role, eventId, userText, aiText, meName = "她") {
  const s = xinchaoServer(role);
  if (!s || !hasTool(s, "xinchao_event")) return;
  const u = String(userText || "").trim().slice(0, 600);
  const a = String(aiText || "").trim().slice(0, 800);
  if (!u && !a) return;
  const exchange = `${meName}：${u || "（发来了图片）"}\n${role.name}：${a}`.slice(0, 1500);
  callToolRaw(s, "xinchao_event", { event_id: String(eventId).slice(0, 120), exchange })
    .then(() => { const c = xcCache[role.id]; if (c) c.at = 0; })
    .catch(() => {});
}
