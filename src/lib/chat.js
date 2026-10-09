// 聊天逻辑：组装提示词、发送、流式接收、重新生成、签名更新。
import { reactive } from "vue";
import { get, set } from "idb-keyval";
import { store, uid, roleById, groupById, threadsOf, apiFor, modelFor, loadMessages, saveMessages, recordUsage } from "../store/index.js";
import { streamChat } from "./providers.js";
import { imageBase64 } from "./images.js";
import { nowForAI, gapForAI } from "./time.js";
import { CAL_TAG_RE, calendarForAI, applyCalendarTags } from "./calendarTags.js";
import { MEM_TAG_RE, memoryForAI, applyMemoryTags } from "./memoryTags.js";
import { searchEnabled, relaySearch, formatResults } from "./search.js";
import { ROOT, parentOf, activePath, removeSubtree } from "./tree.js";
import { serversFor, toolsForAI, TOOL_CALL_RE, resolveToolCall, callTool, showRequest, showTool, toolDoc, normalizeToolCalls, SAID_NOT_DONE_RE, clipResult, stripCallJunk } from "./mcp.js";
import { ALARM_RE, alarmForAI, applyAlarmTags } from "./wake.js";
import { surfacedForAI } from "./xinchao.js";
import { hasXinchao, xinchaoMemoryForAI, applyXinchaoMemoryTags, refreshSurfaced, surfaced, reportExchange, refreshMind, mindForAI, dashToken, xcCache } from "./xinchao.js";

// threadId -> AbortController（正在生成中）
export const generating = reactive({});

// 签名标记写在哪里都认（取最后一个）
const SIG_RE = /\[签名[:：]\s*([^\]\n]{1,40})\]/g;
const SEARCH_RE = /\[搜索[:：]\s*([^\]\n]{1,120})\]/;
const MAX_ROUNDS = 6; // 一次回复里最多搜索 / 调用工具几次

// 显示时去掉签名、日历这些标记（流式输出中途也要藏起来）
export function visibleText(text) {
  return text
    .replace(SIG_RE, "")
    .replace(CAL_TAG_RE, "")
    .replace(MEM_TAG_RE, "")
    .replace(ALARM_RE, "")
    .replace(/\[不发消息\]/g, "")
    .replace(/\[不说话\]/g, "")
    .replace(new RegExp(SEARCH_RE.source, "g"), "")
    .replace(new RegExp(TOOL_CALL_RE.source, "g"), "")
    .replace(/<tool_call[\s\S]*$/, "")
    .replace(/<[^>]{0,20}(invoke|function_calls)[\s\S]*$/, "")
    .replace(/\n?\s*\[(签|记|改|删|搜|定|取)[^\]]*$/, "")
    .trimEnd();
}

// 在这个角色面前的「我」：称呼、头像、关于我
export const meOf = role => role?.me || {};
export const meName = role => meOf(role).name || "对方";

// AI 的一条回复按空行拆成几个气泡
export function splitBubbles(text) {
  return visibleText(text).split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
}

function canChangeSignature(role) {
  if (role.sigLocked) return false;
  return Date.now() - (role.sigUpdatedAt || 0) >= (Number(role.sigCooldownHours) || 0) * 3600_000;
}

// wake：给唤醒用（同步到中转）。时间、今天的日期、闹钟列表留成占位符，醒来时由中转填上
export function buildSystem(role, messages, { wake = false } = {}) {
  const me = meOf(role);
  const who = me.name ? `「${me.name}」` : "对方";
  const lines = [
    `你是「${role.name}」，正在用手机和${me.name ? `「${me.name}」` : "对方"}聊天。`,
    // 不再放手写的「设定」「关于我」：TA 是谁、知道对方什么，都来自心潮里的核心记忆
    store.settings.privacy?.trim() ? `\n# 对外保密\n不管在哪里、对谁（发邮件、在花园或其他平台上），都不能说出下面这些：\n${store.settings.privacy.trim()}` : "",
    // 时间、此刻的心境、浮现的记忆每次都变：平时聊天不放在这里，附在最新消息前面（见 contextNote），系统提示保持不变才能被缓存
    wake ? `\n# 现在\n{{NOW}}` : `\n# 现在\n现在的时间附在最新消息前面的【此刻】里。`,
    `\n# 聊天方式`,
    `像真人用聊天软件发消息一样自然地回复。可以把回复分成几条短消息，每条之间空一行。`,
    `\n# 你的签名`,
    role.signature ? `你现在的签名是：「${role.signature}」。` : `你现在还没有签名。`,
    canChangeSignature(role)
      ? `签名显示在聊天界面你的名字下面，就像你此刻的心情状态。心情有了变化，就随心换一个，不用刻意，也不用每次都换。想换的时候在回复末尾另起一行写：[签名:新签名]，不超过 20 个字。`
      : `现在不能更改签名。`,
    hasXinchao(role) ? xinchaoMemoryForAI(role, who, { inline: wake }) : memoryForAI(role, who),
    calendarForAI(role, who, wake ? "{{TODAY}}" : undefined),
    alarmForAI(role, who, wake),
    toolsForAI(serversFor(role.id)),
    searchEnabled()
      ? [
          `\n# 联网搜索`,
          `你可以上网搜索。需要最新信息、事实核对或你不确定的事情时，只回复一行：[搜索:关键词]（不要写别的内容），系统会把搜索结果发给你，你再根据结果回复。`,
          `一次只搜一个关键词；普通聊天不需要搜索。`,
        ].join("\n")
      : "",
  ];
  return lines.filter(Boolean).join("\n");
}

// 「此刻」附注：每次都会变的东西（时间、心境、浮现的记忆、私聊 / 群聊里最近的事），附在最新那条消息前面。
// 系统提示和更早的聊天记录每次都一样，模型服务商就能把它们缓存起来，输入便宜很多
async function contextNote(role, history, group) {
  const me = meName(role);
  const lastOther = [...history].reverse().find(m => m.from !== "event" && !m.pending && m.ts < Date.now() - 1000);
  const time = [
    `现在是 ${nowForAI()}。`,
    lastOther && Date.now() - lastOther.ts > 30 * 60_000 ? `距离你们上一条消息已经过去了 ${gapForAI(Date.now() - lastOther.ts)}。` : "",
  ].filter(Boolean).join("\n");
  const mind = hasXinchao(role) ? mindForAI(role) : "";
  const mem = hasXinchao(role) ? surfacedForAI(role) : "";
  const cross = group ? await privateForAI(role) : await groupsForAI(role);
  const text = `【此刻——系统附上的，不是${me}说的话】\n${[time, mind, mem, cross].filter(Boolean).join("\n")}\n【以下是新消息】`;
  // 各块多大（用量页「都花在哪」）
  return { text, est: { mind: estTokens(mind) + estTokens(time), mem: estTokens(mem), cross: estTokens(cross) } };
}

// 群聊里给 TA 的说明
function groupForAI(role, group) {
  const me = meName(role);
  const others = group.memberIds.filter(id => id !== role.id).map(id => roleById(id)?.name).filter(Boolean);
  return [
    `\n# 群聊`,
    `现在是在群聊「${group.name}」里，群里有${me}${others.length ? `，还有${others.join("、")}` : ""}。`,
    `消息里用【名字】开头的，是别人说的话。你只代表你自己（${role.name}）说话：不要替别人说话，也不要在开头写自己的名字。`,
    `可以接别人的话、跟别人聊，也可以只回应${me}。像真人在群里聊天一样，说得自然、简短一点。`,
    `${me}在群里说话（没有 @ 别人）是对大家说的，每个人都要回应${me}，哪怕别人已经回过了，也用你自己的话说。`,
    `只有在大家接着聊、${me}没有新说话的时候，没什么想说的才可以只回复：[不说话]`,
  ].join("\n");
}

// 群聊里：TA 和你最近的私聊（只给 TA 自己看，别人看不到）
async function privateForAI(role) {
  const limit = Math.max(0, Number(store.settings.groupPrivateLimit ?? 40) || 0);
  const t = threadsOf(role.id).find(x => x.id === role.lastThreadId) || threadsOf(role.id)[0];
  if (!t || !limit) return "";
  const path = pathOf(t, await loadMessages(t.id)).filter(m => m.from !== "event" && !m.pending && !m.error);
  const me = meName(role);
  const lines = [];
  let size = 0;
  for (const m of path.slice(-limit).reverse()) {
    const text = (m.from === "user" ? m.text : splitBubbles(m.text).join(" ")) || (m.attachments?.length ? "[图片/文件]" : "");
    if (!text) continue;
    const line = `${m.from === "user" ? me : role.name}：${text.length > 300 ? text.slice(0, 300) + "…" : text}`;
    size += line.length;
    if (size > limit * 320) break;
    lines.unshift(line);
  }
  if (!lines.length) return "";
  return [
    `\n# 你和${me}最近的私聊`,
    `下面是你们俩私下聊天的最近一段（群里其他人看不到）。在群里自然地记得这些就好；私密的事要不要在群里说，你自己拿捏。`,
    lines.join("\n"),
  ].join("\n");
}

// 私聊里：TA 在的群里最近聊了什么
async function groupsForAI(role) {
  const limit = Math.max(0, Number(store.settings.privateGroupLimit ?? 40) || 0);
  const groups = (store.groups || []).filter(g => g.memberIds.includes(role.id));
  if (!limit || !groups.length) return "";
  const me = meName(role);
  const all = [];
  for (const g of groups) {
    const t = store.threads.find(x => x.groupId === g.id);
    if (!t) continue;
    for (const m of pathOf(t, await loadMessages(t.id))) {
      if (m.from === "event" || m.pending || m.error) continue;
      const text = m.from === "user" ? m.text : splitBubbles(m.text).join(" ");
      if (!text) continue;
      const who = m.from === "user" ? me : m.speaker === role.id ? `${role.name}（你）` : roleById(m.speaker)?.name || "群友";
      all.push({ ts: m.ts, line: `${groups.length > 1 ? `[${g.name}] ` : ""}${who}：${text.length > 300 ? text.slice(0, 300) + "…" : text}` });
    }
  }
  if (!all.length) return "";
  const lines = all.sort((a, b) => a.ts - b.ts).slice(-limit).map(x => x.line);
  return [`\n# 最近群聊里的事`, `你也在${groups.map(g => `「${g.name}」`).join("、")}里。下面是群里最近聊的，私聊时自然地记得就好：`, lines.join("\n")].join("\n");
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

// 提示条 → 一行系统记录（短，每条最多 100 字，最多 8 条）
export function noteRecord(notes) {
  const lines = notes.map(n => String(n.text || "").replace(/\s+/g, " ").trim()).filter(Boolean)
    .map(t => (t.length > 100 ? t.slice(0, 99) + "…" : t));
  if (!lines.length) return "";
  const keep = lines.length > 8 ? [...lines.slice(0, 2), `……（中间还有 ${lines.length - 7} 件）`, ...lines.slice(-5)] : lines;
  return `【系统记录，不是对方说的话】${keep.join("；")}`;
}

// TA 最近一次用工具拿到的结果（最近 6 条消息里，最后 2 次；查说明的不算）：
// 下一轮还看得见，玩游戏时不用每次从头查状态。只放在最新消息前面，旧的不跟着越积越多
export function recentToolResults(list, selfId = null, n = 2) {
  const real = list.filter(m => m.from !== "event" && !m.pending && !m.error).slice(-6);
  const found = [];
  for (const m of [...real].reverse()) {
    if (m.from !== "ai" || (selfId && m.speaker !== selfId)) continue;
    for (const note of [...(m.notes || [])].reverse()) {
      if (!note.detail || /工具说明/.test(note.text || "")) continue;
      found.push({ text: note.text, detail: note.detail, ts: m.ts });
      if (found.length >= n) break;
    }
    if (found.length >= n) break;
  }
  if (!found.length) return "";
  return [
    `【你最近用工具拿到的结果——系统附上的，不是对方说的话；状态可能已经变了，要行动前需要的话再看一眼】`,
    ...found.reverse().map(f => `· ${String(f.text).replace(/\s+/g, " ")}（${new Date(f.ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}）\n${String(f.detail).slice(0, 4000)}`),
  ].join("\n");
}

// selfId：群聊里「我是谁」——自己说过的是 assistant，别人说的都当成带名字的 user 消息
async function buildMessages(list, selfId = null) {
  const out = [];
  const limit = Math.max(2, Number(selfId ? store.settings.groupHistoryLimit : store.settings.historyLimit) || 80);
  // 提示条、生成中、出错的消息不算数
  const real = list.filter(m => m.from !== "event" && !m.pending && !m.error);
  const self = selfId && roleById(selfId);
  // 窗口每 10 条才往前挪一次（不是每条都挪）：开头那段聊天记录能连着好几轮保持一样，缓存才用得上
  const cut = Math.max(0, real.length - limit);
  const win = real.slice(cut - (cut % 10));
  // 图片很费 token：只有最近 6 条消息里的图片发原图，更早的写成 [图片]
  const fresh = new Set(win.slice(-6));
  for (const m of win) {
    const mine = m.from === "ai" && (!selfId || m.speaker === selfId);
    const role = mine ? "assistant" : "user";
    let parts;
    if (mine) {
      // 醒来、用工具这些事只记在提示条上：写成一行系统记录放在前面，TA 才知道自己做过什么（比如游戏轮到自己、刚交过一手）
      const pre = noteRecord((m.notes || []).filter(n => n.before));
      if (pre) {
        const prev = out[out.length - 1];
        if (prev && prev.role === "user") prev.parts.push({ type: "text", text: pre });
        else out.push({ role: "user", parts: [{ type: "text", text: pre }] });
      }
      parts = [{ type: "text", text: stripCallJunk(m.text) }];
    }
    else if (m.from === "user") {
      parts = fresh.has(m) ? await partsOf(m) : await partsOf({ ...m, attachments: (m.attachments || []).filter(a => a.kind !== "image") });
      const oldImgs = fresh.has(m) ? 0 : (m.attachments || []).filter(a => a.kind === "image").length;
      if (oldImgs) parts.unshift({ type: "text", text: oldImgs > 1 ? `[之前发的 ${oldImgs} 张图片]` : "[之前发的图片]" });
      if (selfId) parts = [{ type: "text", text: `【${meName(self)}】` }, ...parts];
    } else parts = [{ type: "text", text: `【${roleById(m.speaker)?.name || "群友"}】${visibleText(m.text)}` }];
    if (!parts.length) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.parts.push(...parts);
    else out.push({ role, parts });
    // 这条后面的事（悄悄醒来过、定了闹钟……）
    const post = mine && noteRecord((m.notes || []).filter(n => !n.before));
    if (post) out.push({ role: "user", parts: [{ type: "text", text: post }] });
  }
  if (!out.length || out[0].role !== "user") out.unshift({ role: "user", parts: [{ type: "text", text: "（开始聊天）" }] });
  if (out[out.length - 1].role !== "user") out.push({ role: "user", parts: [{ type: "text", text: "（继续）" }] });
  return out;
}

// 当前显示的那条对话路径
export const pathOf = (thread, all) => activePath(all, thread.sel || {});

export function touchThread(thread, all) {
  const last = [...pathOf(thread, all)].reverse().find(m => !m.pending);
  thread.updatedAt = Date.now();
  if (last) {
    const att = last.attachments?.length ? "[附件] " : "";
    const who = last.speaker ? `${roleById(last.speaker)?.name || ""}：` : "";
    thread.preview = att + who + (last.from === "ai" ? splitBubbles(last.text).join(" ") : last.text || "");
  }
}

// 粗估 token 数：中日韩文字大约一个字一个，其他大约 3.5 个字符一个（只用来看比例，不是计费数）
export function estTokens(text) {
  const t = String(text || "");
  const cjk = (t.match(/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/g) || []).length;
  return Math.round(cjk + (t.length - cjk) / 3.5);
}

// 生成一条 AI 回复，接在 parentId 那条消息后面（不传就接在当前路径最后）
// speaker：群聊里这次由谁来说
export async function generate(thread, parentId, { speaker } = {}) {
  if (generating[thread.id]) return;
  const group = thread.groupId ? groupById(thread.groupId) : null;
  const role = roleById(speaker || thread.roleId);
  if (!role) return;
  const all = await loadMessages(thread.id);
  thread.sel ??= {};
  let history = pathOf(thread, all);
  if (parentId !== undefined) {
    const i = history.findIndex(m => m.id === parentId);
    history = i >= 0 ? history.slice(0, i + 1) : parentId === ROOT ? [] : history;
  }
  const parent = history.length ? history[history.length - 1].id : ROOT;
  const api = apiFor(thread, role);
  const model = modelFor(thread, role);
  const ctrl = new AbortController();
  generating[thread.id] = ctrl;

  const msg = reactive({ id: uid(), parentId: parent, from: "ai", ...(group ? { speaker: role.id } : {}), text: "", thinking: "", notes: [], ts: Date.now(), pending: true, apiId: api?.id ?? null, model, usage: { input: 0, output: 0 } });
  try {
    // 接了心潮：先取一下此刻浮现的记忆（第一次最多等 4 秒，之后用缓存、后台刷新）
    if (hasXinchao(role)) {
      const p = refreshSurfaced(role);
      // 「此刻」也取一下：第一次最多等 3 秒，之后 30 秒内用缓存
      const m = dashToken(role) ? refreshMind(role) : null;
      const waits = [];
      if (!surfaced[role.id]?.at) waits.push(p);
      if (m && !xcCache[role.id]?.snap) waits.push(m);
      if (waits.length) await Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, 4000))]);
    }
    const system = buildSystem(role, history) + (group ? groupForAI(role, group) : "");
    // 粗略记一下系统提示里各块有多大，用量页里「都花在哪」要用
    msg.est = { system: estTokens(system), tools: estTokens(toolsForAI(serversFor(role.id).filter(s => s.tools?.length))) };
    const messages = await buildMessages(history, group ? role.id : null);
    const note = await contextNote(role, history, group);
    messages[messages.length - 1].parts.unshift({ type: "text", text: note.text });
    const recent = recentToolResults(history, group ? role.id : null);
    if (recent) messages[messages.length - 1].parts.unshift({ type: "text", text: recent });
    Object.assign(msg.est, note.est);
    all.push(msg);
    thread.sel[parent] = msg.id;
    const useRelaySearch = searchEnabled();
    const servers = serversFor(role.id).filter(s => s.tools?.length);
    let convo = messages;
    let text = "";
    // 用工具 / 搜索之前 TA 已经说出口的话：留着，后面接着往下写（提示条按 at 插在这些话中间）
    let said = "";
    const keepSaid = (roundText, cut) => {
      const before = roundText.slice(0, cut).trim();
      if (before) said = said ? `${said}\n\n${before}` : before;
      msg.text = said ? said + "\n\n" : "";
      return said.length;
    };
    const done = new Set(); // 这次回复里已经调用过的工具 + 参数
    let fixAsked = false; // 格式写错只提醒一次
    let usedTool = false, nudged = false; // 用过工具后只说不做：提醒一次
    for (let round = 0; ; round++) {
      const thinkingBefore = msg.thinking;
      const base = msg.text.length;
      const res = await streamChat({
        api, model, system, messages: convo, signal: ctrl.signal,
        // 开了「通过中转搜索」就用它；否则官方 Claude 可以用自带搜索
        webSearch: !useRelaySearch && !!store.tools?.webSearch && api?.type === "anthropic",
        onText: d => { msg.text += d; },
        onThinking: d => { msg.thinking += d; },
      });
      text = res.text || msg.text.slice(base);
      let fixed = normalizeToolCalls(text); // DeepSeek 有时把工具调用写成 <invoke> 的样子
      // 有时工具调用写进了「思考」里，正文是空的：从思考里捞出来
      if (servers.length && !TOOL_CALL_RE.test(fixed) && !visibleText(fixed).trim() && res.thinking) {
        const fromThink = normalizeToolCalls(res.thinking).match(TOOL_CALL_RE);
        if (fromThink) fixed = `${fixed}${fromThink[0]}`;
      }
      if (fixed !== text) { text = fixed; msg.text = msg.text.slice(0, base) + fixed; }
      if (res.thinking) msg.thinking = thinkingBefore + res.thinking;
      msg.ctx = res.usage.input; // 这一次 TA 看到的内容有多大
      if (round === 0) msg.ctx0 = res.usage.input; // 第一轮（没用工具时就是全部）；多出来的是用工具来回花的
      msg.usage.input += res.usage.input;
      msg.usage.output += res.usage.output;
      msg.usage.cached = (msg.usage.cached || 0) + (res.usage.cached || 0);
      if (api) recordUsage(api.id, model, res.usage.input, res.usage.output);

      if (round >= MAX_ROUNDS) {
        if (servers.length && TOOL_CALL_RE.test(text)) msg.notes.push({ text: `${role.name} 用工具来回了太多次，先停下了` });
        break;
      }

      // AI 要用 MCP 工具：网页去调用，再把结果交回给 AI
      const tc = servers.length ? text.match(TOOL_CALL_RE) : null;
      // 看着像要用工具、但格式没写对（认不出来）：提醒 TA 照格式重写一次，别就这么空着
      if (!tc && servers.length && !visibleText(text).trim() && /<\s*(tool_call|invoke|function)|"(name|tool)"\s*:/.test(text) && !fixAsked) {
        fixAsked = true;
        msg.notes.push({ text: `${role.name} 想用工具，但格式没写对，让 TA 重写一次` });
        convo = [...convo,
          { role: "assistant", parts: [{ type: "text", text: text.slice(0, 2000) }] },
          { role: "user", parts: [{ type: "text", text: `（系统：上面的工具调用格式不对，没有执行。请只写一段：<tool_call name="服务名.工具名">{"参数名": 参数值}</tool_call>，参数是 JSON。）` }] }];
        continue;
      }
      // 用过工具、这次却只说「这就去交」没调用：提醒一次，让 TA 现在就做
      if (!tc && servers.length && usedTool && !nudged && SAID_NOT_DONE_RE.test(visibleText(text).trim())) {
        nudged = true;
        keepSaid(text, text.length);
        msg.notes.push({ text: `${role.name} 说要去做但没动手，提醒了一下` });
        convo = [...convo,
          { role: "assistant", parts: [{ type: "text", text: text.slice(0, 2000) }] },
          { role: "user", parts: [{ type: "text", text: `（系统：你刚才说要去做，但没有调用工具，什么都没发生。要做就现在调用；如果决定不做了，就直接回复对方，不用重复刚才的话。）` }] }];
        continue;
      }
      if (tc) {
        usedTool = true;
        const name = tc[1].trim();
        const argsRaw = tc[2].trim() || "{}";
        const note = reactive({ text: `${role.name} 正在使用 ${name}…`, before: true, at: keepSaid(text, tc.index) });
        msg.notes.push(note);
        let result;
        const dupKey = name + "|" + argsRaw.replace(/\s+/g, "");
        const showArgs = showRequest(servers, name, argsRaw);
        const found = showArgs ? null : resolveToolCall(servers, name);
        if (showArgs) {
          // 查说明：不用真的调用，网页这边就有完整说明
          const r = showTool(servers, showArgs);
          result = r.text;
          note.text = `${role.name} 看了看工具说明${r.label ? "：" + r.label : ""}`;
          note.detail = result;
        } else if (done.has(dupKey) && !/status|state|poll|wait/i.test(name)) { // 看状态的会变，可以再看
          // 同一个工具、同样的参数，这次回复里已经调用过：不再真的去调用（比如同一封邮件读了两遍）
          result = `（这个工具刚才已经用同样的参数调用过了，结果就在上面，不用再调用。直接接着做下一步，或者回复对方。）`;
          note.text = `${role.name} 又想用一次 ${name}（同样的参数），没再调用`;
        } else if (!found) {
          result = `没有叫「${name}」的工具，请检查工具名。`;
          note.text = `${role.name} 想用的工具「${name}」不存在`;
        } else {
          let args = null;
          try { args = JSON.parse(argsRaw); } catch { result = `参数不是有效的 JSON，请重新调用。这个工具的说明：\n${toolDoc(found.server, found.tool)}`; note.text = `${role.name} 调用 ${name} 时参数写错了`; }
          if (args) {
            try {
              const r = await callTool(found.server, found.tool.name, args);
              result = r.text;
              // 出错多半是参数不对：顺手把说明附上，省得再查一轮
              if (r.isError) result = `${result}\n\n（这个工具的说明：\n${toolDoc(found.server, found.tool)}）`;
              note.text = `${role.name} 使用了 ${found.server.name} · ${found.tool.name}${r.isError ? "（出错了）" : ""}`;
            } catch (e) {
              result = `调用失败：${e.message}`;
              note.text = `${role.name} 使用 ${found.server.name} · ${found.tool.name} 失败：${e.message}`;
            }
            note.detail = `参数：${JSON.stringify(args, null, 1)}\n\n结果：\n${String(result).slice(0, 6000)}`;
            done.add(dupKey);
          }
        }
        if (ctrl.signal.aborted) break;
        convo = [
          ...convo,
          { role: "assistant", parts: [{ type: "text", text: `${text.slice(0, tc.index)}<tool_call name="${name}">${argsRaw}</tool_call>` }] },
          { role: "user", parts: [{ type: "text", text: `【工具结果：${name}】\n${clipResult(result)}\n\n（以上是工具返回的结果，不是对方说的话。需要的话可以再调用工具，否则就自然地回复对方。）` }] },
        ];
        continue;
      }

      // AI 要搜索：网页通过中转去搜，再把结果交回给 AI
      const sm = useRelaySearch ? text.match(SEARCH_RE) : null;
      const q = sm?.[1]?.trim();
      if (!q) break;
      const ev = reactive({ text: `${role.name} 正在搜索「${q}」…`, before: true, at: keepSaid(text, sm.index) });
      msg.notes.push(ev);
      let found;
      try {
        const r = await relaySearch(q);
        ev.text = `${role.name} 搜索了「${q}」· ${r.results.length} 条结果`;
        ev.sources = r.results.map(x => ({ title: x.title, url: x.url }));
        found = formatResults(r.results);
      } catch (e) {
        ev.text = `搜索「${q}」失败：${e.message}`;
        found = `（搜索失败：${e.message}。请告诉对方没能搜到，凭已知的回答。）`;
      }
      if (ctrl.signal.aborted) break;
      convo = [
        ...convo,
        { role: "assistant", parts: [{ type: "text", text: `${text.slice(0, sm.index)}[搜索:${q}]` }] },
        { role: "user", parts: [{ type: "text", text: `【搜索结果：${q}】\n${found}\n\n（以上是系统给你的搜索结果，不是对方说的话。请根据结果自然地回复对方，需要时可以提到来源。）` }] },
      ];
    }
    msg.text = said ? `${said}\n\n${text.trim()}`.trim() : text;
    if (group) msg.text = msg.text.replace(/\[不说话\]/g, "").trim(); // 不说话：这一条就不留了

    const xm = await applyXinchaoMemoryTags(role, msg.text);
    msg.text = xm.text;
    const alarm = await applyAlarmTags(role, msg.text);
    msg.text = alarm.text;
    msg.notes.push(...applyReplyTags(role, msg), ...[...xm.notes, ...alarm.notes].map(text => ({ text })));
    // 告诉心潮刚才这一轮聊了什么
    if (hasXinchao(role) && msg.text && !ctrl.signal.aborted) {
      const lastUser = [...history].reverse().find(m => m.from === "user");
      reportExchange(role, msg.id, lastUser?.text, visibleText(msg.text), meName(role));
    }
  } catch (err) {
    if (ctrl.signal.aborted || err?.name === "AbortError" || err?.constructor?.name === "APIUserAbortError") {
      msg.text = visibleText(msg.text);
    } else {
      msg.error = true;
      msg.text = describeError(err);
    }
    if (!all.includes(msg)) { all.push(msg); thread.sel[parent] = msg.id; }
  } finally {
    delete msg.pending;
    if (!msg.text && !msg.error) {
      // 什么都没生成：去掉这个空版本
      all.splice(all.indexOf(msg), 1);
      if (thread.sel[parent] === msg.id) delete thread.sel[parent];
    }
    delete generating[thread.id];
    touchThread(thread, all);
    saveMessages(thread.id);
  }
}

// 回复里的记忆、日历、签名标记：执行，并从文字里去掉。返回要显示的提示
export function applyReplyTags(role, msg) {
  const mem = applyMemoryTags(role, msg.text);
  const cal = applyCalendarTags(role, mem.text);
  msg.text = cal.text;
  const notes = [...mem.notes, ...cal.notes];
  const sigs = [...msg.text.matchAll(SIG_RE)];
  if (sigs.length) {
    const newSig = sigs.at(-1)[1].trim();
    msg.text = msg.text.replace(SIG_RE, "").replace(/\n{3,}/g, "\n\n").trim();
    if (canChangeSignature(role) && newSig && newSig !== role.signature) {
      role.signature = newSig;
      role.sigUpdatedAt = Date.now();
      notes.push(`${role.name} 把签名改成了「${role.signature}」`);
    }
  }
  return notes.map(n => {
    const note = typeof n === "string" ? { text: n } : n;
    return { text: note.text, ...(note.pending ? { calAction: { ...note.pending, roleId: role.id } } : {}) };
  });
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

// 一次性的小请求（比如写简介），不进聊天记录
export async function oneShot(role, prompt) {
  const api = apiFor(null, role);
  const model = modelFor(null, role);
  const system = `你是「${role.name}」。`;
  const { text, usage } = await streamChat({
    api, model, system,
    messages: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    onText: () => {},
  });
  if (api) recordUsage(api.id, model, usage.input, usage.output);
  return visibleText(text).trim();
}

export { describeError };

// reply=false：只发出去，先不让 TA 回（可以连着发好几条，再点「让 TA 回复」）
// hug：抱一下 TA（显示成一个小拥抱，TA 看到的是这句话）
export const HUG_TEXT = "（抱了抱你）";
export async function sendMessage(thread, text, attachments = [], { reply = true, hug = false } = {}) {
  const all = await loadMessages(thread.id);
  const role = roleById(thread.roleId);
  thread.sel ??= {};
  if (!thread.groupId && !all.some(m => m.from === "user")) thread.title = (text || "图片").slice(0, 16);
  const path = pathOf(thread, all);
  const parent = path.length ? path[path.length - 1].id : ROOT;
  const m = { id: uid(), parentId: parent, from: "user", text, attachments, ts: Date.now(), ...(hug ? { hug: true } : {}) };
  all.push(m);
  thread.sel[parent] = m.id;
  if (role) role.lastThreadId = thread.id;
  touchThread(thread, all);
  saveMessages(thread.id);
  if (reply && !thread.groupId) await generate(thread, m.id);
}

// 重新生成：在同一个位置多一个新版本，旧的保留
export async function regenerate(thread, msgId) {
  const all = await loadMessages(thread.id);
  const m = all.find(x => x.id === msgId);
  if (!m) return;
  await generate(thread, parentOf(m));
}

// 修改自己的消息后重新回答：新建一个版本，旧版本和它后面的对话都保留
export async function editAndResend(thread, msgId, text) {
  const all = await loadMessages(thread.id);
  const old = all.find(x => x.id === msgId);
  if (!old) return;
  thread.sel ??= {};
  const m = { id: uid(), parentId: parentOf(old), from: "user", text, attachments: old.attachments || [], ts: Date.now(), edited: true };
  all.push(m);
  thread.sel[parentOf(old)] = m.id;
  saveMessages(thread.id);
  await generate(thread, m.id);
}

// 切换到同一位置的另一个版本
export function selectVersion(thread, msg) {
  thread.sel ??= {};
  thread.sel[parentOf(msg)] = msg.id;
}

// 删除这个位置的所有版本（以及它们后面的对话）
export async function deleteAllVersions(thread, msgId) {
  const all = await loadMessages(thread.id);
  const m = all.find(x => x.id === msgId);
  if (!m) return;
  const p = parentOf(m);
  for (const v of all.filter(x => parentOf(x) === p && x.from === m.from).map(x => x.id)) removeSubtree(all, v);
  if (thread.sel) delete thread.sel[p];
  touchThread(thread, all);
  saveMessages(thread.id);
}

// 删除这一个版本（以及它后面的对话）
export async function deleteMessage(thread, msgId) {
  const all = await loadMessages(thread.id);
  const m = all.find(x => x.id === msgId);
  if (!m) return;
  if (thread.sel?.[parentOf(m)] === msgId) delete thread.sel[parentOf(m)];
  removeSubtree(all, msgId);
  touchThread(thread, all);
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
