// 记忆健康检查：一页看清记忆库现在的样子
//   卡片各有多少、哪些可能重复或打架、哪些很久没用上；各个房间的摘要什么时候整理的、被反复压了几次；
//   哪些房间快到整理的门槛了；每次大概带多少 token；最近自动想起了哪些卡片、他翻过什么
import { store, threadsOf, loadMessages } from "../store/index.js";
import { memoriesOf, memKind, isLive, accessOf, memoryForAI, PIN_MAX } from "./memoryTags.js";
import { boardForAI } from "./board.js";
import { momentForAI } from "./moment.js";
import { estTokens, sumTokens, chatTokens, tailFrom, AUTO } from "./budget.js";
import { toks } from "./rank.js";

const DAY = 86400_000;
export const STALE_DAYS = 30;
export const SQUASH_WARN = 8; // 一份摘要被重新压了这么多次，提醒对一对

// 两张卡说的是不是同一件事：拆成小块（太常见的不算），标题有对上的、内容又对上一两处，或者大半重合，就算「可能重复或打架」
// （「她爱吃辣」和「她不吃辣了」说法不一样，但其实是一件事，旧的该标已过时）
function similarPairs(cards) {
  const sets = cards.map(m => ({ all: new Set(toks(`${m.title} ${m.content}`)), title: new Set(toks(m.title)) }));
  const df = {};
  for (const s of sets) for (const w of s.all) df[w] = (df[w] || 0) + 1;
  const common = Math.max(3, cards.length * 0.3);
  const keep = set => new Set([...set].filter(w => df[w] <= common));
  const f = sets.map(s => ({ all: keep(s.all), title: keep(s.title) }));
  const pairs = [];
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = f[i], b = f[j];
    if (!a.all.size || !b.all.size) continue;
    let n = 0, t = 0;
    for (const w of a.all) if (b.all.has(w)) n++;
    for (const w of a.title) if (b.title.has(w)) t++;
    const s = n / Math.min(a.all.size, b.all.size);
    if ((t >= 1 && n >= 2) || s >= 0.5) pairs.push({ a: cards[i], b: cards[j], s: s + t * 0.2 });
  }
  return pairs;
}

export async function healthOf(role, me) {
  const { pathOf, afterSummary, buildSystem, summaryForAI, autoAt } = await import("./chat.js");
  const { projects, loadTalk, talkAfterSum, talkAutoAt, ideaBox } = await import("./writing.js");
  const { rawSince, sumEvery, imprEvery } = await import("./reading.js");
  const all = memoriesOf(role.id);
  const cards = all.filter(m => memKind(m) === "card");
  const live = cards.filter(isLive);
  const count = {
    all: cards.filter(m => m.status !== "deleted").length,
    pinned: live.filter(m => accessOf(m) === "pinned").length,
    normal: live.filter(m => accessOf(m) === "normal").length,
    archived: live.filter(m => accessOf(m) === "archived").length,
    pending: cards.filter(m => m.status === "pending").length,
    obsolete: cards.filter(m => m.status === "obsolete").length,
    trash: cards.filter(m => m.status === "deleted").length,
    derived: all.filter(m => memKind(m) !== "card" && memKind(m) !== "insight" && isLive(m)).length,
  };
  // 可能重复或打架：有效的卡两两比一比
  const pairs = similarPairs(live.filter(m => m.status === "valid" || !m.status));
  pairs.sort((x, y) => y.s - x.s);
  // 很久没用上：普通、归档的卡，一个月没被自动想起、也没被翻到
  const now = Date.now();
  const stale = live.filter(m => accessOf(m) !== "pinned" && now - (m.usedAt || m.createdAt || m.ts || now) > STALE_DAYS * DAY)
    .sort((a, b) => (a.usedAt || a.createdAt || a.ts || 0) - (b.usedAt || b.createdAt || b.ts || 0));

  // 各个房间的摘要 + 离整理还差多少
  const rooms = [];
  let mainThread = null;
  for (const t of threadsOf(role.id).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) {
    const path = pathOf(t, await loadMessages(t.id)).filter(m => m.from !== "event" && !m.pending && !m.error);
    if (!path.length) continue;
    if (!mainThread && !t.mail) mainThread = { t, path };
    const rest = sumTokens(afterSummary(t, path));
    rooms.push({ kind: t.mail ? "邮箱" : "聊天", name: t.title || "对话", at: t.summary?.at, times: (t.summaryVers?.length || 0) + (t.summary?.text ? 1 : 0), now: rest, limit: autoAt(), unit: "token", sum: !!t.summary?.text });
  }
  for (const p of [...projects().filter(p => !p.archived), ...(ideaBox() ? [ideaBox()] : [])]) {
    const list = await loadTalk(p.id);
    if (!list.length) continue;
    rooms.push({ kind: "共写", name: p.kind === "ideas" ? "灵感抽屉" : `《${p.title}》`, at: p.talkSum?.at, times: (p.talkSumVers?.length || 0) + (p.talkSum?.text ? 1 : 0), now: sumTokens(talkAfterSum(p, list)), limit: talkAutoAt(), unit: "token", sum: !!p.talkSum?.text });
  }
  for (const b of (store.books || []).filter(b => b.readAt && !b.mine)) {
    const segs = b.gist?.segs?.length || (b.gist?.text ? 1 : 0);
    rooms.push({ kind: "共读", name: `《${b.title}》`, at: b.gist?.at, times: segs, segs: true, now: await rawSince(b), limit: sumEvery(), unit: "字", sum: segs > 0, impr: b.imprs?.length || 0 });
  }
  rooms.forEach(r => (r.pct = r.limit ? Math.min(100, Math.round((r.now / r.limit) * 100)) : 0));

  // 每次聊天大概带多少（按字数估的）
  const system = buildSystem(role, []);
  const mem = memoryForAI(role, me);
  const board = boardForAI(role);
  const moment = momentForAI(role, me, { peek: true });
  const summary = mainThread ? summaryForAI(mainThread.t) : "";
  const rest = mainThread ? afterSummary(mainThread.t, mainThread.path) : [];
  const raw = sumTokens(rest.slice(tailFrom(rest, chatTokens())));
  const tokens = [
    { label: "系统提示（不算记忆）", n: Math.max(0, estTokens(system) - estTokens(mem)) },
    { label: "全局记忆：常驻卡片、信等", n: Math.max(0, estTokens(mem) - estTokens(board)) },
    { label: "板块记忆", n: estTokens(board) },
    { label: "此刻（最近 24 小时）", n: estTokens(moment) },
    { label: "聊天摘要", n: estTokens(summary) },
    { label: "摘要后面的聊天原文", n: raw },
  ];
  const total = tokens.reduce((a, x) => a + x.n, 0);
  tokens.forEach(x => (x.pct = total ? Math.round((x.n / total) * 100) : 0));

  const byId = Object.fromEntries(all.map(m => [m.id, m]));
  const recalls = (store.recallLog || []).filter(x => x.roleId === role.id).slice(0, 12).map(x => ({ ...x, cards: x.ids.map(id => byId[id]).filter(Boolean) }));
  const searches = (store.searchLog || []).filter(x => x.roleId === role.id).slice(0, 12).map(x => ({ ...x, cards: (x.ids || []).map(id => byId[id]).filter(Boolean) }));

  // 要留意的：挑几条最要紧的放在最上面
  const tips = [];
  if (count.pinned >= PIN_MAX) tips.push(`常驻已经满 ${PIN_MAX} 张了，新的要先取消一张`);
  if (count.pending) tips.push(`有 ${count.pending} 张候选记忆等你确认`);
  if (pairs.length) tips.push(`有 ${pairs.length} 对卡片说的可能是同一件事，看看要不要合并，或者把旧的标已过时`);
  const squashed = rooms.filter(r => !r.segs && r.times >= SQUASH_WARN);
  if (squashed.length) tips.push(`${squashed.map(r => r.name).join("、")}的摘要已经被重新压了 ${SQUASH_WARN} 次以上，可以翻翻历史版本，看有没有细节丢了`);
  const near = rooms.filter(r => r.pct >= 90);
  if (near.length) tips.push(`${near.map(r => `${r.kind}${r.name}`).join("、")}快到整理的时候了`);
  const { openItems } = await import("./review.js");
  const waiting = openItems(role.id).length;
  if (waiting) tips.push(`${role.name}的整理建议还有 ${waiting} 条等你看`);
  if (stale.length) tips.push(`有 ${stale.length} 张卡片一个多月没被想起、也没被翻到，可以考虑归档或者设成常驻`);

  return { count, pairs: pairs.slice(0, 12), stale, rooms, tokens, total, recalls, searches, tips, auto: AUTO, imprEvery: imprEvery() };
}
