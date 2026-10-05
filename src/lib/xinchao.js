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
export function xinchaoMemoryForAI(role, who) {
  const text = surfaced[role.id]?.text?.trim();
  return [
    `\n# 你的记忆库（心潮）`,
    `你的长期记忆都在心潮记忆库里，所有对话共用。下面是此刻自然浮现的几条，聊天时自然地记得就好，不用刻意复述：`,
    text || "（这次还没取到，需要时可以用 breath 工具找）",
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
const sessions = new Map(); // base -> { token, exp }

async function login(base, token) {
  let res;
  try {
    res = await fetch(base + "/dashboard/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token, mode: "header" }),
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
  return s;
}

export async function dash(role, path, init = {}) {
  const base = xinchaoBase(role);
  const token = dashToken(role);
  if (!base) throw new Error("这个角色还没有接心潮");
  if (!token) throw new Error("还没有填看板口令");
  let s = sessions.get(base);
  if (!s || s.exp - Date.now() < 60_000) s = await login(base, token);
  const go = sess => fetch(`${base}/dashboard/api/${path}`, {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${sess.token}` },
  });
  let res;
  try { res = await go(s); } catch { throw new Error("连不上心潮"); }
  if (res.status === 401) { s = await login(base, token); res = await go(s); }
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error || `心潮返回 ${res.status}`);
  return j;
}

export const fetchSnapshot = role => dash(role, "snapshot");
export const fetchMemoryMap = role => dash(role, "memory-map");
export const fetchBucket = (role, id) => dash(role, `memory-bucket?id=${encodeURIComponent(id)}`);
export const fetchCabin = role => dash(role, "cabin");
export const fetchTimeline = (role, limit = 40) => dash(role, `timeline?limit=${limit}`);

// 测试看板口令
export async function testDash(role) {
  sessions.delete(xinchaoBase(role));
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

// 星表里的日期
export function starDate(star) {
  const t = Date.parse(star.createdAt || star.updatedAt || star.lastActiveAt || "");
  return Number.isFinite(t) ? new Date(t) : null;
}
