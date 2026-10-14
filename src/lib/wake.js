// 唤醒：TA 们按设好的时间自己醒来（在你的 Cloudflare 中转上运行，见 relay/worker.js 和 docs/wake.md）
//
// 栖所这边做的事：
//   1. 把需要的东西（设定、记忆、最近的聊天、API、MCP）同步到中转
//   2. 打开栖所时，把 TA 醒来时发的消息取回来，放进聊天里
//   3. 订阅推送通知
//   4. 聊天时 TA 写的 [定闹钟:…] / [取消闹钟:…]
import { reactive, watch } from "vue";
import { store, uid, roleById, threadsOf, mailThreadOf, createThread, loadMessages, saveMessages, apiFor, modelFor, recordUsage } from "../store/index.js";
import { relayCall, searchEnabled } from "./search.js";
import { tail, chatTokens } from "./budget.js";
import { serversFor, serversForMode, enabledTools, headerObj, toolDoc } from "./mcp.js";
import { ROOT } from "./tree.js";
import { buildSystem, pathOf, touchThread, applyReplyTags, meName, noteRecord, recentToolResults, afterSummary, summaryForAI } from "./chat.js";
import { applyXinchaoMemoryTags, hasXinchao, xinchaoBase } from "./xinchao.js";

export const ALARM_RE = /\[(定闹钟|取消闹钟)[:：]([^\]\n]{1,200})\]/g;
export const MAX_ALARMS = 5;

// 同步、收件箱的状态（不存）
export const wakeStatus = reactive({ syncedAt: 0, syncing: false, error: "", latest: 0, checking: false, busy: {} }); // busy：正在醒来的 TA

const relayReady = () => !!(store.tools.relay?.url && store.tools.relay?.token);
export const wakeReady = () => !!store.wake?.enabled && relayReady();
export const wakeOn = role => wakeReady() && !!role?.wake?.enabled;

const pad = n => String(n).padStart(2, "0");
const dayStart = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

// 「今天 14:30」「明天 09:00」「10月8日 14:30」
export function whenLabel(at) {
  const d = new Date(at);
  const days = Math.round((dayStart(at) - dayStart(Date.now())) / 86400_000);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (days === 0) return `今天 ${hm}`;
  if (days === 1) return `明天 ${hm}`;
  if (days === 2) return `后天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

export function everyText(min) {
  min = Number(min) || 0;
  if (min % 60 === 0) return `${min / 60} 小时`;
  if (min > 60) return `${Math.floor(min / 60)} 小时 ${min % 60} 分钟`;
  return `${min} 分钟`;
}

// 一句话说清这个角色什么时候醒
export function scheduleText(role) {
  const w = role.wake || {};
  if (!w.enabled) return "没开";
  const parts = [];
  if (w.intervalOn) parts.push(`每 ${everyText(w.every)}`);
  if (w.times?.length) parts.push(w.times.join("、"));
  return parts.join(" · ") || "只在他自己定的闹钟时醒";
}

const liveAlarms = role => (role.wakeAlarms || []).filter(a => a.at > Date.now());

// ---------- 给 AI 的说明 ----------
export function alarmForAI(role, who, wake) {
  if (!wakeOn(role)) return "";
  const w = role.wake;
  const list = wake
    ? "{{ALARMS}}"
    : liveAlarms(role).map(a => `#${a.id} ${whenLabel(a.at)}${a.note ? " · " + a.note : ""}`).join("；") || "（没有）";
  const note = t => (w.timeNotes?.[t] ? `（${w.timeNotes[t]}）` : "");
  const sched = [w.intervalOn && `大约每 ${everyText(w.every)}一次${w.intervalNote ? `（${w.intervalNote}）` : ""}`, w.times?.length && `每天 ${w.times.map(t => t + note(t)).join("、")}`].filter(Boolean).join("，还有");
  return [
    `\n# 醒来和闹钟`,
    sched
      ? `就算${who}没有打开栖所，你也会自己醒来：${sched}。醒来的时候可以给${who}发消息，也可以做自己的事。`
      : `就算${who}没有打开栖所，到了闹钟的时间你也会醒来。`,
    `你可以给自己定闹钟：另起一行写 [定闹钟:时间|醒来要做什么]。时间可以写「40分钟后」「2小时后」「21:30」「明天 9:00」「10月5日 14:30」。到时间你会醒来，看到自己写的这句话。`,
    `如果到时只是提醒${who}一句、内容现在就定好了（比如「15:40 该准备上课啦」），写成 [定闹钟:时间|提醒什么|到时直接发给${who}的话]：到点直接把这句话发出去，不用叫醒你、不花额度。要到时再想、再看情况的，才只写前两段。`,
    `聊天里留下了以后要追问的事（${who}明天面试、说晚点告诉你结果），也用闹钟记着：[定闹钟:明天 20:00|问问面试怎么样]。`,
    `取消闹钟写 [取消闹钟:#编号]。同时最多 ${MAX_ALARMS} 个闹钟，需要的时候再定，不用每次都定。`,
    w.quiet?.enabled ? `${w.quiet.from}–${w.quiet.to} 是${who}的免打扰时间，闹钟不能定在这段时间里。` : "",
    `现在定好的闹钟：${list}`,
  ].filter(Boolean).join("\n");
}

// 聊天时 TA 写的闹钟标记：交给中转去定 / 取消，返回去掉标记的文字和提示
export async function applyAlarmTags(role, text) {
  const ops = [...text.matchAll(ALARM_RE)];
  if (!ops.length) return { text, notes: [] };
  const clean = text.replace(ALARM_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  const notes = [];
  for (const [, op, body] of ops) {
    const add = op === "定闹钟";
    if (!wakeOn(role)) {
      notes.push(`${role.name} 想${add ? "定" : "取消"}闹钟，但他的唤醒还没有打开`);
      continue;
    }
    try {
      let r;
      if (add) {
        const [when, note = "", ...say] = body.split(/[|｜]/);
        r = await relayCall("/wake/alarm", { roleId: role.id, when: when.trim(), note: note.trim(), say: say.join(" ").trim(), quiet: role.wake.quiet });
      } else {
        r = await relayCall("/wake/alarm", { roleId: role.id, op: "cancel", id: body.trim() });
      }
      role.wakeAlarms = r.alarms || [];
      const note = r.alarm.note ? " · " + r.alarm.note : "";
      notes.push(`${role.name} ${add ? "定了个闹钟" : "取消了闹钟"}：${r.alarm.label}${note}${add && r.alarm.say ? `（到点直接发：${r.alarm.say}）` : ""}`);
    } catch (e) {
      notes.push(`${role.name} 想${add ? "定" : "取消"}闹钟，但没成功：${e.message}`);
    }
  }
  return { text: clean, notes };
}

// ---------- 同步到中转 ----------
const threadFor = role => threadsOf(role.id).find(t => t.id === role.lastThreadId) || threadsOf(role.id)[0] || null;

function textOf(m) {
  const att = (m.attachments || []).map(a => (a.kind === "image" ? "[图片]" : `[文件：${a.name}]`)).join(" ");
  return [att, m.text].filter(Boolean).join(" ");
}

// 醒来时带的聊天（小背包）：摘要 + 最近这么多 token 的聊天 + 最近用工具拿到的结果
function historyOf(thread, path) {
  // 醒来一天好几次，每次都要把聊天记录整个发一遍：单独用一个小一点的上限
  const budget = Math.min(chatTokens(), Math.max(500, Number(store.settings.wakeHistoryTokens) || 4000));
  const real = afterSummary(thread, path).filter(m => m.from !== "event" && !m.pending && !m.error); // 整理成摘要的那段：只带摘要
  const history = tail(real, budget) // 小背包：按 token 算（默认 4k），也不超过平时聊天带的原文
    .flatMap(m => {
      if (m.from === "user") return [{ from: "user", text: textOf(m), ts: m.ts }];
      // 醒来、用工具的提示条：变成系统记录，TA 才知道之前醒来做过什么
      const pre = noteRecord((m.notes || []).filter(n => n.before));
      const post = noteRecord((m.notes || []).filter(n => !n.before));
      return [pre && { from: "user", text: pre, ts: m.ts }, { from: "ai", text: textOf(m), ts: m.ts }, post && { from: "user", text: post, ts: m.ts }].filter(Boolean);
    });
  const sum = summaryForAI(thread);
  if (sum) history.unshift({ from: "user", text: sum, ts: history[0]?.ts || Date.now() });
  // 最近用工具拿到的结果：醒来时也看得见（比如上一手游戏的状态）
  const recent = recentToolResults(path);
  if (recent) history.push({ from: "user", text: recent, ts: history.length ? history[history.length - 1].ts : Date.now() });
  return history;
}
const serverPack = list => list
  .filter(s => s.tools?.length)
  .map(s => ({ name: s.name, url: s.builtin ? "" : s.url.trim(), builtin: !!s.builtin, headers: s.builtin ? {} : headerObj(s), tools: enabledTools(s).map(t => t.name),
    // 工具的完整说明：TA 醒来时查「工具说明」，中转直接从这里拿
    docs: Object.fromEntries(enabledTools(s).map(t => [t.name, toolDoc(s, t)])) }));

// ---------- 自由时间的几间屋子 ----------
// 到了自由时间，他先在「门厅」看一眼这张小清单（很小的一次请求），自己挑去哪；挑好了再带着那间屋子的小背包进去（第二次请求）。
// 聊天、信箱：和平时醒来一样（能用那里的工具）；一起读：接着往后读一段、留批注；讨论室、共写：留一段话等她来看
const ago = ts => { const m = Math.round((Date.now() - ts) / 60000); return m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`; };
// 他还没看到的事（事件唤醒用）：上一次他回你、或者上一次因为这些醒来之后，你写的信、在书里的批注、共写里改的卡片和便利贴
function eventsOf(role, path) {
  const on = role.wake?.events || {};
  if (!Object.values(on).some(Boolean)) return [];
  const me = meName(role);
  const lastAi = [...path].reverse().find(m => m.from === "ai")?.ts || 0;
  const since = Math.max(lastAi, role.wakeEvSeen || 0, Date.now() - 3 * 86400_000);
  const out = [];
  if (on.letter) for (const l of (store.letters || []).filter(l => l.roleId === role.id && l.from === "me" && !l.locked && !l.readAt && l.ts > since))
    out.push({ kind: "letter", id: l.id, ts: l.ts, room: "chat", text: `${me}给你写了一封信《${l.title || "无题"}》：\n${l.body.slice(0, 1500)}` });
  if (on.note) {
    const byBook = {};
    for (const n of (store.bookNotes || []).filter(n => n.from === "me" && n.ts > since)) (byBook[n.bookId] ??= []).push(n);
    for (const [bid, ns] of Object.entries(byBook)) {
      const b = (store.books || []).find(x => x.id === bid);
      if (!b) continue;
      out.push({ kind: "note", id: bid, ts: Math.max(...ns.map(n => n.ts)), room: `talk:${bid}`,
        text: `${me}在《${b.title}》里划了 ${ns.length} 处：${ns.slice(-5).map(n => `「${(n.quote || "").slice(0, 30)}」${n.text ? `（${me}写：${n.text.slice(0, 80)}）` : ""}`).join("；")}` });
    }
  }
  if (on.write) {
    const { projects, cardsOf, CARD_TYPES } = writingMod || {};
    for (const p of projects ? projects() : []) {
      const cards = cardsOf(p.id).filter(c => c.from === "me" && (c.ts || 0) > since);
      const notes = (store.writeNotes || []).filter(n => n.projectId === p.id && n.from === "me" && n.ts > since);
      if (!cards.length && !notes.length) continue;
      out.push({ kind: "write", id: p.id, ts: Math.max(...cards.map(c => c.ts || 0), ...notes.map(n => n.ts)), room: `write:${p.id}`,
        text: `${me}在《${p.title}》里${cards.length ? `改了 ${cards.length} 张卡片（${cards.slice(-5).map(c => `【${CARD_TYPES[c.type]?.label || "其他"}】${c.title || "无题"}`).join("、")}）` : ""}${notes.length ? `${cards.length ? "，" : ""}贴了 ${notes.length} 张便利贴（${notes.slice(-3).map(n => n.text.slice(0, 40)).join("；")}）` : ""}` });
    }
  }
  return out.sort((a, b) => a.ts - b.ts).slice(-10);
}
let writingMod = null; // 共写的模块（同步前先载好，eventsOf 是同步的）

async function roomsOf(role, thread, path, extra = []) {
  const me = meName(role);
  const rooms = [];
  const lastMsg = [...path].reverse().find(m => m.from === "user" || m.from === "ai");
  rooms.push({ key: "chat", kind: "thread", label: `找${me}聊天`, status: lastMsg ? `上一句是${lastMsg.from === "user" ? me : "你"}说的「${String(lastMsg.text || "").replace(/\s+/g, " ").slice(0, 30)}」，${ago(lastMsg.ts)}` : "还没聊过" });
  // 信箱：有邮箱工具才有
  const mailServers = serversForMode(role.id, "mail").filter(s => s.tools?.length);
  if (mailServers.length) {
    const mt = mailThreadOf(role.id);
    const mpath = pathOf(mt, await loadMessages(mt.id));
    rooms.push({ key: "mail", kind: "thread", label: "信箱", status: "看看邮件、回信（能用邮箱的工具）", threadId: mt.id,
      system: buildSystem(role, mpath, { wake: true, mail: true }), history: historyOf(mt, mpath), servers: serverPack(mailServers) });
  }
  // 一起读：最近在读、还没读完的那本，从他读到的地方往后
  const { forwardSlice, alongPrompt } = await import("./reading.js");
  const { progressOf } = await import("./books.js");
  const reading = (store.books || []).filter(b => !b.his && !b.mine && b.readAt).sort((a, b) => b.readAt - a.readAt)[0];
  if (reading) {
    const from = reading.hisPos ? { ch: reading.hisPos.ch, p: reading.hisPos.p + 1 } : reading.pos || { ch: 0, p: 0 };
    const items = await forwardSlice(reading, from, 12000);
    if (items.length) rooms.push({ key: `read:${reading.id}`, kind: "read", label: `接着读《${reading.title}》`, bookId: reading.id, from, maxChars: 12000,
      status: `${me}读到 ${Math.round(progressOf(reading) * 100)}%；你往后还有一段没读`, prompt: await alongPrompt(role, reading, items, from, { alone: true }) });
  }
  // 书的讨论室：最近读的那本；还有共读的大讨论室
  const { roomPrompt, loadRoom, HALL } = await import("./readTalk.js");
  const talkBook = [...(store.books || [])].filter(b => b.readAt).sort((a, b) => b.readAt - a.readAt)[0];
  const evBooks = extra.filter(k => k.startsWith("talk:")).map(k => k.slice(5)); // 事件要去的书的讨论室
  for (const id of [...new Set([talkBook?.id, ...evBooks, (store.books || []).length > 1 ? HALL : null])].filter(Boolean)) {
    const list = await loadRoom(id);
    const last = list.at(-1);
    const bk = (store.books || []).find(x => x.id === id);
    if (id !== HALL && !bk) continue;
    rooms.push({ key: `talk:${id}`, kind: "talk", room: "read", id, label: id === HALL ? "共读大讨论室" : `《${bk.title}》讨论室`,
      status: last ? `上次聊到「${String(last.text || "").replace(/\s+/g, " ").slice(0, 24)}」，${ago(last.ts)}` : "还没在这里聊过", prompt: await roomPrompt(role, id, "", true) });
  }
  // 共写：最近在写的那本
  const { projects, writingPrompt, loadTalk } = await import("./writing.js");
  const latest = projects().filter(x => !x.archived).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  const evProjects = extra.filter(k => k.startsWith("write:")).map(k => projects().find(x => x.id === k.slice(6))).filter(Boolean);
  for (const p of [...new Set([latest, ...evProjects])].filter(Boolean)) {
    const last = (await loadTalk(p.id)).at(-1);
    rooms.push({ key: `write:${p.id}`, kind: "talk", room: "write", id: p.id, label: `共写《${p.title}》`,
      status: last ? `上次聊到「${String(last.text || "").replace(/\s+/g, " ").slice(0, 24)}」，${ago(last.ts)}` : "还没讨论过", prompt: await writingPrompt(role, p, [], true) });
  }
  return rooms;
}

async function snapshotRole(role) {
  const thread = threadFor(role);
  const path = thread ? pathOf(thread, await loadMessages(thread.id)) : [];
  const history = historyOf(thread, path);
  writingMod ??= await import("./writing.js");
  const events = eventsOf(role, path);
  const api = apiFor(thread, role);
  return {
    id: role.id,
    name: role.name,
    meName: meName(role),
    wake: role.wake,
    bridge: role.wake?.bridgeOn && hasXinchao(role) && role.xinchao?.bridgeToken?.trim()
      ? { url: xinchaoBase(role), token: role.xinchao.bridgeToken.trim() } : null,
    threadId: thread?.id || null,
    system: buildSystem(role, path, { wake: true }),
    history,
    style: (role.style || "").trim().slice(0, 1500), // 门厅里只带这个（他是谁）
    events,
    rooms: role.wake?.freeTimes?.length || events.length ? await roomsOf(role, thread, path, events.map(e => e.room)) : [], // 开了自由时间、或者有事件才带
    api: api && { id: api.id, type: api.type, baseUrl: api.baseUrl, key: api.key, model: modelFor(thread, role), maxTokens: api.maxTokens, effort: api.effort, temperature: api.temperature },
    servers: serverPack(serversFor(role.id)),
    // 工作间（醒来时也能把活交过去）：服务器地址和有哪些项目
    workroom: store.settings.workroom?.base && store.settings.workroom.projects?.length ? { base: store.settings.workroom.base, projects: store.settings.workroom.projects } : null,
  };
}

let lastSent = "";
let syncTimer = null;

export async function syncNow() {
  clearTimeout(syncTimer);
  if (!relayReady()) return;
  // 从来没开过唤醒，就不用同步；关掉以后同步一次空的，让中转不再叫醒
  if (!store.wake.enabled && !store.wake.synced) return;
  if (wakeStatus.syncing) { scheduleSync(2000); return; }
  wakeStatus.syncing = true;
  try {
    const roles = store.wake.enabled ? await Promise.all(store.roles.filter(r => r.wake?.enabled).map(snapshotRole)) : [];
    const snap = {
      v: 1,
      appUrl: location.href.split("#")[0],
      search: { enabled: searchEnabled(), provider: store.tools.search?.provider, key: store.tools.search?.key || "" },
      webSearch: !!store.tools.webSearch,
      roles,
    };
    const body = JSON.stringify(snap);
    if (body === lastSent) return;
    await relayCall("/wake/sync", snap);
    lastSent = body;
    store.wake.synced = store.wake.enabled;
    wakeStatus.syncedAt = Date.now();
    wakeStatus.error = "";
  } catch (e) {
    wakeStatus.error = e.message;
  } finally {
    wakeStatus.syncing = false;
  }
}

export function scheduleSync(ms = 30_000) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, ms);
}

// ---------- 取回 TA 醒来时发的消息 ----------
function logWake(role, item) {
  role.wakeLog = [
    { id: item.id, ts: item.ts, reasons: item.reasons, silent: item.silent, direct: !!item.direct, error: item.error || "", usage: item.usage, tools: item.notes.filter(n => n.detail || n.sources).map(n => n.text) },
    ...(role.wakeLog || []).filter(x => x.id !== item.id),
  ].slice(0, 30);
  // 用量页「最近每一轮」：唤醒也记进去（为什么醒、发没发、带了多少上下文）
  const list = (store.turnLog ??= []);
  if (list.some(x => x.wakeId === item.id)) return;
  const u = item.usage || {};
  list.push({ ts: item.ts, apiId: item.apiId, model: item.model, rounds: u.rounds ?? (u.input ? 1 : 0), sends: 0, input: u.input || 0, output: u.output || 0, cached: u.cached || 0,
    wakeId: item.id, wake: { reasons: item.reasons, silent: !!item.silent && !item.room?.text, direct: !!item.direct, error: item.error || "", ctx: u.ctx0 || u.ctx || 0, free: item.free?.pick === "sleep" ? "接着睡了" : item.free?.label || "" } });
  list.sort((a, b) => a.ts - b.ts);
  if (list.length > 60) list.splice(0, list.length - 60);
}

// 出错的原因写短一点（完整的放在点开的详情里）
function shortError(err) {
  const code = Number(String(err).match(/接口返回 (\d{3})/)?.[1]);
  const known = {
    401: "密钥不对（401）",
    403: "没有权限（403）",
    404: "找不到这个模型或接口（404）",
    429: "请求太频繁或额度用完了（429）",
    500: "模型那边出错了（500）",
    502: "模型那边暂时连不上（502）",
    503: "模型那边暂时太忙了（503），下次醒来会再试",
    504: "模型那边太久没回应（504）",
    529: "模型那边暂时太忙了（529），下次醒来会再试",
  };
  if (known[code]) return known[code];
  const s = String(err);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}

// 自由时间去了一间屋子：他写的放进那间屋子（书里的批注、讨论室、共写的讨论），主聊天里留一条小记
async function ingestRoom(role, item) {
  if ((role.wakeLog || []).some(x => x.id === item.id)) return; // 已经取过了
  logWake(role, item);
  if (item.apiId && (item.usage?.input || item.usage?.output)) recordUsage(item.apiId, item.model, item.usage.input, item.usage.output);
  const r = item.room;
  const { visibleText } = await import("./chat.js");
  let what = r.text ? "" : "，坐了一会儿，没写什么";
  try {
    if (r.kind === "read" && r.text) {
      const b = (store.books || []).find(x => x.id === r.bookId);
      const R = await import("./reading.js");
      const { markHisPos } = await import("./books.js");
      const items = b ? await R.forwardSlice(b, r.from, r.maxChars) : [];
      if (items.length) {
        const p = await R.parseAlong(role, items, r.text);
        await R.placeAlong(b, p.notes);
        markHisPos(b, p.upTo.ch, p.upTo.p);
        b.alongTo = p.upTo;
        R.maybeGist(role, b, { ch: p.upTo.ch, p: p.upTo.p + 1 }).catch(() => {});
        R.maybeImpression(role, b, { ch: p.upTo.ch, p: p.upTo.p + 1 }).catch(() => {});
        what = `，读了一段，划了 ${p.notes.length} 处${p.memNotes.length ? "，记了读书笔记" : ""}`;
      }
    } else if (r.kind === "talk" && r.text && r.room === "read") {
      const T = await import("./readTalk.js");
      const { applyNoteTags, applyReadMemTags } = await import("./reading.js");
      const t1 = applyNoteTags(role, r.text);
      const t2 = applyReadMemTags(role, t1.text);
      const text = visibleText(t2.text.replace(/\[不说话\]/g, "")).trim();
      const list = await T.loadRoom(r.id);
      if (text && !list.some(m => m.id === `w${item.id}`)) list.push({ id: `w${item.id}`, from: "ai", text, notes: [...t1.notes, ...t2.notes, "自由时间自己来的"], ts: item.ts });
      await T.saveRoom(r.id);
      what = "，留了一段话";
    } else if (r.kind === "talk" && r.text && r.room === "write") {
      const W = await import("./writing.js");
      const text = visibleText(r.text.replace(/\[不说话\]/g, "").replace(/\[(便签|新卡片|写书进度)[:：][^\]]*\]/g, "")).trim();
      const list = await W.loadTalk(r.id);
      if (text && !list.some(m => m.id === `w${item.id}`)) list.push({ id: `w${item.id}`, from: "ai", text, notes: ["自由时间自己来的"], ts: item.ts });
      await W.saveTalk(r.id);
      what = "，留了一段话";
    }
  } catch (e) {
    what = `，但没放进去：${e.message}`;
  }
  // 主聊天里留一条小记（点开那间屋子就能看到）
  const thread = threadFor(role);
  if (!thread) return;
  const all = await loadMessages(thread.id);
  const last = pathOf(thread, all).at(-1);
  if (last) {
    last.notes = [...(last.notes || []), { text: `自由时间：${role.name} 去了「${r.label}」${what}`, wakeId: item.id }];
    saveMessages(thread.id);
  }
}

async function ingest(item) {
  const role = roleById(item.roleId);
  if (!role) return;
  // 事件的原因很长：提示条里只留一行（「离开前做了这些：」后面接第一件事）
  item.reasons = (item.reasons || []).map(r => { const ls = r.split("\n"); const t = ls.length > 1 ? ls[0] + ls[1].replace(/^· /, "") : r; return t.length > 60 || ls.length > 2 ? t.slice(0, 60) + "…" : t; });
  // 因为事件醒来过：这些事算他看过了（信也标成读过）
  if (item.events) {
    role.wakeEvSeen = Math.max(role.wakeEvSeen || 0, item.events.upTo || 0);
    for (const id of item.events.letters || []) { const l = (store.letters || []).find(x => x.id === id); if (l && !l.readAt) l.readAt = item.ts; }
  }
  if (item.room) return ingestRoom(role, item);
  if (item.alarms) role.wakeAlarms = item.alarms;
  const thread = store.threads.find(t => t.id === item.threadId && t.roleId === role.id) || threadFor(role) || createThread(role.id);
  const all = await loadMessages(thread.id);
  if (all.some(m => m.wakeId === item.id || m.notes?.some(n => n.wakeId === item.id))) return; // 已经取过了
  if (item.work?.length) await import("./workDispatch.js").then(m => m.adoptWork(item.work, item.ts)).catch(() => {});
  logWake(role, item);
  thread.sel ??= {};
  const path = pathOf(thread, all);
  const last = path[path.length - 1];
  // 用工具、搜索的提示放在消息前面；定闹钟之类的放在后面
  const before = item.notes.filter(n => n.detail || n.sources).map(n => ({ ...n, before: true }));
  const after = item.notes.filter(n => !(n.detail || n.sources));

  if (!item.silent && item.text) {
    const parent = last ? last.id : ROOT;
    const msg = {
      id: `w${item.id}`, parentId: parent, from: "ai", text: item.text, ts: item.ts, // 固定的 id：两台设备都取到了，同步时也只算一条
      notes: [{ text: item.direct ? `到点了 · ${item.reasons.join("；")}（直接发的，没有叫醒他）` : `${role.name} 醒来了 · ${item.reasons.join("；")}`, before: true, wakeId: item.id }, ...before],
      apiId: item.apiId, model: item.model, usage: item.usage, wakeId: item.id,
      ctx: item.usage?.ctx, ctx0: item.usage?.ctx0, // 上下文多大（usage.input 是用工具来回几次加起来的，不是上下文）
    };
    const xm = await applyXinchaoMemoryTags(role, msg.text);
    msg.text = xm.text;
    const tagNotes = [...applyReplyTags(role, msg), ...xm.notes.map(text => ({ text }))];
    msg.notes.push(...after, ...tagNotes);
    all.push(msg);
    thread.sel[parent] = msg.id;
  } else if (last) {
    const tmp = { text: item.text || "" };
    const xm = await applyXinchaoMemoryTags(role, tmp.text);
    tmp.text = xm.text;
    const tagNotes = [...applyReplyTags(role, tmp), ...xm.notes.map(text => ({ text }))];
    const head = item.error
      ? `${role.name} 醒来时出错了：${shortError(item.error)}`
      : `${role.name} 醒来过（${item.reasons.join("；")}），没有打扰你`;
    last.notes = [...(last.notes || []), { text: head, wakeId: item.id, ...(item.error ? { detail: item.error } : {}) }, ...before.map(({ at, ...n }) => ({ ...n, before: false })), ...after, ...tagNotes];
  }
  if (item.apiId && (item.usage?.input || item.usage?.output)) recordUsage(item.apiId, item.model, item.usage.input, item.usage.output);
  if (!item.silent) touchThread(thread, all);
  saveMessages(thread.id);
}

// force：不管有没有新东西都去看一眼（打开栖所时）；否则只在中转说有新东西时才去取
export async function checkInbox(force = false) {
  if (!wakeReady() || wakeStatus.checking) return 0;
  wakeStatus.checking = true;
  try {
    // 栖所在前台：顺便告诉中转「她在」（她 2 小时内在，就不额外叫醒他；主动找了两次没回应的，也从这里知道她回来了）
    const active = document.visibilityState === "visible" ? "&active=1" : "";
    const r = await relayCall(`/wake/inbox?since=${force ? 0 : wakeStatus.latest}${active}`);
    wakeStatus.busy = r.busy || {};
    for (const item of r.items) await ingest(item);
    if (r.items.length) {
      await syncNow(); // 先让中转知道这些消息已经在聊天里了，再把收件箱清掉
      await relayCall("/wake/ack", { ids: r.items.map(x => x.id) });
    }
    // 中转那边「有新东西」的时间有时比信箱里的东西先到（KV 要过一会儿才一致）：
    // 说有新的、却一条都没取到，就先不往前挪，下次再取一遍，免得这条一直看不到
    if (r.items.length || r.latest <= wakeStatus.latest) wakeStatus.latest = r.latest;
    return r.items.length;
  } catch (e) {
    wakeStatus.error = e.message;
    return 0;
  } finally {
    wakeStatus.checking = false;
  }
}

// 中转上的闹钟、下次醒来的时间、最近一次醒来
export async function fetchState() {
  const r = await relayCall("/wake/state");
  for (const [id, st] of Object.entries(r.roles || {})) {
    const role = roleById(id);
    if (role) role.wakeAlarms = st.alarms || [];
  }
  return r;
}

export async function cancelAlarm(role, id) {
  const r = await relayCall("/wake/alarm", { roleId: role.id, op: "cancel", id });
  role.wakeAlarms = r.alarms || [];
}

// 现在叫醒 TA（测试用）
export async function wakeNow(role, { free = false } = {}) {
  lastSent = "";
  await syncNow();
  if (wakeStatus.error) throw new Error(wakeStatus.error);
  const r = await relayCall("/wake/now", { roleId: role.id, free }, 180_000);
  await checkInbox(true);
  return r.item;
}

// ---------- 推送通知 ----------
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const sameKey = (a, b) => a && b && a.byteLength === b.byteLength && new Uint8Array(a).every((x, i) => x === b[i]);

export async function enablePush() {
  if (!pushSupported()) {
    throw new Error(isIOS() && !isStandalone() ? "iPhone 要先用 Safari 把栖所「添加到主屏幕」，再从主屏幕打开栖所来开通知" : "这个浏览器不支持推送通知");
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("没有允许通知：可以去手机的系统设置里打开");
  const reg = await navigator.serviceWorker.ready;
  const { key } = await relayCall("/push/key");
  const appKey = unb64u(key);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, appKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
  await relayCall("/push/subscribe", sub.toJSON());
  store.wake.push = true;
}

export const testPush = () => relayCall("/push/test", {});

// ---------- 启动 ----------
export function startWake(router) {
  // 设定、记忆、聊天变了 → 过一会儿同步一次（中间再变就重新计时）
  watch(
    () => [store.wake.enabled, store.roles, store.memories, store.events, store.settings, store.tools, store.mcpServers, store.apis, store.threads.map(t => t.updatedAt + ":" + t.id)],
    () => scheduleSync(),
    { deep: true },
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkInbox(true);
    else syncNow(); // 离开栖所时立刻同步，TA 醒来时看到的才是最新的
  });
  // 开着栖所时常去看看：TA 被花园叫醒、正在行动，这边很快就能看到；有人正在醒来时看得更勤
  let lastPoll = 0;
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    const gap = Object.keys(wakeStatus.busy).length ? 8_000 : 20_000;
    if (Date.now() - lastPoll < gap) return;
    lastPoll = Date.now();
    checkInbox(false);
  }, 4_000);
  // 点了通知：打开对应的对话
  navigator.serviceWorker?.addEventListener("message", e => {
    if (e.data?.type === "open") {
      checkInbox(true);
      if (e.data.hash) router.push(e.data.hash.replace(/^#/, ""));
    }
  });
  checkInbox(true);
  scheduleSync(3000);
}
