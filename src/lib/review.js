// 记忆卡片的大整理：每隔两周（可以调），他把自己的记忆卡片从头看一遍，提出整理建议——你来把关，一条条采纳或跳过，采纳了也能撤回
//   用他自己的模型（这是他的记忆，他自己判断）。给他看：所有有效的卡（常驻、普通、归档）、待确认的、已过时的、
//   体检里看出来可能重复的、很久没用上的，还有板块记忆和最近的聊天摘要
//   他用这几种写法提建议（每条后面可以写一句为什么）：
//     [合并:#编号,#编号|新标题|新内容]   [改记忆:#编号|新标题|新内容]   [过时记忆:#编号|为什么]   [归档记忆:#编号|为什么]
//     [常驻记忆:#编号|为什么]   [取消常驻:#编号|为什么]   [确认:#编号|为什么]（待确认的）   [不要:#编号|为什么]（待确认的、没用的）   [新记忆:标题|内容]
//   最后写几句给你的话。建议存在 store.reviews [{ id, roleId, at, note, model, items: [{ op, ids, title, content, why, state, before, made }] }]
import { store, uid, apiFor, modelFor, threadsOf } from "../store/index.js";
import { memoriesOf, memKind, isLive, accessOf, newMemory, setAccess, markObsolete, trashMemory, restoreMemory, purgeMemory, PIN_MAX } from "./memoryTags.js";

export const reviewEvery = () => Number(store.settings.reviewEvery ?? 14); // 天；0 = 不自动整理
const DAY = 86400_000;
export const OPS = {
  merge: "合并", edit: "改写", obsolete: "标已过时", archive: "归档", pin: "设为常驻", unpin: "取消常驻", confirm: "确认", drop: "不要了", add: "新记一张",
};
const OP_OF = { 合并: "merge", 改记忆: "edit", 过时记忆: "obsolete", 归档记忆: "archive", 常驻记忆: "pin", 取消常驻: "unpin", 确认: "confirm", 不要: "drop", 新记忆: "add" };
const TAG_RE = /\[(合并|改记忆|过时记忆|归档记忆|常驻记忆|取消常驻|确认|不要|新记忆)[:：]([^\]]{1,1500})\]/g;

export const reviewsOf = roleId => (store.reviews || []).filter(r => r.roleId === roleId).sort((a, b) => b.at - a.at);
export const openItems = roleId => reviewsOf(roleId).flatMap(r => r.items.filter(x => x.state === "pending").map(x => ({ r, x })));
export const cardsFor = (roleId, ids) => ids.map(id => store.memories.find(m => m.roleId === roleId && m.id === id)).filter(Boolean);
const byShort = (roleId, s) => {
  const id = String(s || "").trim().replace(/^#/, "");
  return id ? store.memories.find(m => m.roleId === roleId && m.id.startsWith(id) && m.status !== "deleted") : null;
};

// 到时候了吗：离上次整理够天数，而且卡片不太少
export function reviewDue(role) {
  const every = reviewEvery();
  if (!every) return false;
  const cards = memoriesOf(role.id).filter(m => memKind(m) === "card" && m.status !== "deleted");
  if (cards.length < 6) return false;
  const last = role.lastReview || role.firstSeenReview || (role.firstSeenReview = Date.now()); // 第一次：从现在开始数
  return Date.now() - last >= every * DAY;
}

const running = {};
export async function runReview(role, { why = "auto" } = {}) {
  if (running[role.id]) throw new Error("他正在整理，等一下");
  running[role.id] = true;
  try {
    const { oneShot, meName } = await import("./chat.js");
    const { healthOf } = await import("./health.js");
    const { boardForAI } = await import("./board.js");
    const me = meName(role);
    const h = await healthOf(role, me);
    const all = memoriesOf(role.id).filter(m => memKind(m) === "card");
    const ln = m => `- #${m.id.slice(0, 4)} [${m.date}] ${m.title}：${m.content.replace(/\n+/g, " ").slice(0, 400)}${m.usedAt ? `（上次用上：${new Date(m.usedAt).toLocaleDateString("zh-CN")}）` : "（还没用上过）"}`;
    const group = (label, list) => (list.length ? `## ${label}（${list.length} 张）\n${list.map(ln).join("\n")}` : "");
    const live = all.filter(isLive);
    const sum = threadsOf(role.id).filter(t => t.summary?.text && !t.mail).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]?.summary?.text;
    const prompt = [
      role.style?.trim() ? `（这是你写给自己的：${role.style.trim()}）\n` : "",
      `这是你的记忆库里的记忆卡片。每隔一阵子，你自己从头看一遍，把它们整理干净：这是你和${me}之间的记忆，你最清楚哪些还对、哪些要紧。整理的建议会先给${me}看，${me}同意了才算数。`,
      group(`常驻的（每次都带着，最多 ${PIN_MAX} 张）`, live.filter(m => accessOf(m) === "pinned")),
      group(`普通的（按${me}说的话自动想起）`, live.filter(m => accessOf(m) === "normal")),
      group("归档的（不常用，只在翻记忆时出现）", live.filter(m => accessOf(m) === "archived")),
      group("待确认的（整理摘要时挑出来的候选，还没生效）", all.filter(m => m.status === "pending")),
      group("已过时的（留作历史）", all.filter(m => m.status === "obsolete").slice(0, 20)),
      h.pairs.length ? `## 看起来可能是同一件事的\n${h.pairs.map(x => `- #${x.a.id.slice(0, 4)}「${x.a.title}」和 #${x.b.id.slice(0, 4)}「${x.b.title}」`).join("\n")}` : "",
      boardForAI(role) ? `## 板块记忆（参考，不用整理）\n${boardForAI(role)}` : "",
      sum ? `## 最近聊天的摘要（参考：哪些事变了）\n${sum.slice(0, 2000)}` : "",
      `\n看完以后，用下面的写法提整理建议，每条另起一行，后面写一句为什么（只写真正需要的，没有要改的就不写）：`,
      `- 两张或几张说的是同一件事：[合并:#编号,#编号|新标题|合起来的内容]`,
      `- 内容要更新、写得不清楚：[改记忆:#编号|新标题|新内容]`,
      `- 已经不成立了（比如病好了、改主意了）：[过时记忆:#编号|为什么]`,
      `- 还成立但不常用了：[归档记忆:#编号|为什么]`,
      `- 特别要紧、想一直记着：[常驻记忆:#编号|为什么]；常驻里不那么要紧的：[取消常驻:#编号|为什么]`,
      `- 待确认的里面值得留的：[确认:#编号|为什么]；没用的、记错的：[不要:#编号|为什么]`,
      `- 缺了一张要紧的：[新记忆:标题|内容]`,
      `最后另起一段，写几句给${me}的话：这次整理了什么、你注意到了什么。用你自己的口吻，不超过 150 字。`,
    ].filter(Boolean).join("\n\n");
    const raw = await oneShot(role, prompt, { raw: true });
    const items = [];
    for (const [, tag, body] of raw.matchAll(TAG_RE)) {
      const op = OP_OF[tag];
      const parts = body.split(/[|｜]/).map(s => s.trim());
      if (op === "add") { if (parts[1] || parts[0]) items.push({ op, ids: [], title: parts.length > 1 ? parts[0] : parts[0].slice(0, 12), content: parts.length > 1 ? parts.slice(1).join("，") : parts[0] }); continue; }
      const ids = parts[0].split(/[,，、\s]+/).map(s => byShort(role.id, s)?.id).filter(Boolean);
      if (!ids.length || (op === "merge" && ids.length < 2)) continue;
      if (op === "merge" || op === "edit") {
        const [, title = "", ...rest] = parts;
        const content = rest.join("，").trim() || (op === "edit" ? title : "");
        if (!content) continue;
        items.push({ op, ids: [...new Set(ids)], title: rest.length ? title : "", content, why: "" });
      } else items.push({ op, ids: ids.slice(0, 1), why: parts.slice(1).join("，") });
    }
    for (const x of items) Object.assign(x, { id: uid(), state: "pending" });
    const note = raw.replace(TAG_RE, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 600);
    const r = { id: uid(), roleId: role.id, at: Date.now(), why, note, items, model: modelFor(null, role) || apiFor(null, role)?.model || "" };
    store.reviews ??= [];
    store.reviews.push(r);
    if (store.reviews.length > 20) store.reviews.splice(0, store.reviews.length - 20);
    role.lastReview = Date.now();
    return r;
  } finally {
    delete running[role.id];
  }
}

// 采纳一条：做之前把卡片原来的样子存下来，撤回时放回去
const snap = m => ({ id: m.id, title: m.title, content: m.content, status: m.status, access: m.access, statusBefore: m.statusBefore, deletedAt: m.deletedAt });
export function applyItem(role, x) {
  const cards = cardsFor(role.id, x.ids);
  if (x.op !== "add" && !cards.length) return "这张卡已经不在了";
  x.before = cards.map(snap);
  let err = "";
  if (x.op === "merge") {
    const pinned = cards.some(m => accessOf(m) === "pinned");
    cards.forEach(trashMemory);
    const m = newMemory(role, { title: x.title || cards[0].title, content: x.content, access: pinned ? "pinned" : "normal", source: { type: "review", by: "ai", label: "整理时合并的" }, tags: [...new Set(cards.flatMap(c => c.tags || []))], importance: Math.max(...cards.map(c => c.importance || 3)) });
    x.made = m.id;
  } else if (x.op === "edit") {
    const m = cards[0];
    if (x.title) m.title = x.title.slice(0, 40);
    m.content = x.content;
    m.updatedAt = Date.now();
  } else if (x.op === "obsolete") markObsolete(cards[0]);
  else if (x.op === "archive") err = setAccess(cards[0], "archived");
  else if (x.op === "pin") err = setAccess(cards[0], "pinned");
  else if (x.op === "unpin") err = setAccess(cards[0], "normal");
  else if (x.op === "confirm") { cards[0].status = "valid"; err = setAccess(cards[0], "normal"); }
  else if (x.op === "drop") trashMemory(cards[0]);
  else if (x.op === "add") x.made = newMemory(role, { title: x.title, content: x.content, source: { type: "review", by: "ai", label: "整理时补上的" } }).id;
  if (err) { delete x.before; return err; }
  x.state = "done";
  x.doneAt = Date.now();
  return "";
}
export function undoItem(role, x) {
  for (const b of x.before || []) {
    const m = store.memories.find(y => y.id === b.id);
    if (m) Object.assign(m, b);
  }
  if (x.made) { const m = store.memories.find(y => y.id === x.made); if (m) purgeMemory(m); }
  delete x.before; delete x.made;
  x.state = "pending";
}
export function skipItem(x) { x.state = "skipped"; }
export function applyAll(role, r) {
  const errs = [];
  for (const x of r.items) if (x.state === "pending") { const e = applyItem(role, x); if (e) errs.push(e); }
  return errs;
}
// 聊完一句后看看到没到时候：到了就在后台整理，聊天里留一行小记
export async function maybeReview(role, last) {
  if (!reviewDue(role) || running[role.id]) return;
  try {
    const r = await runReview(role);
    if (last) (last.notes ||= []).push({ text: `${role.name} 把记忆卡片从头整理了一遍，有 ${r.items.length} 条建议等你看（记忆库最上面）` });
  } catch (e) {
    console.warn("记忆大整理没成", e);
    role.lastReview = Date.now() - (reviewEvery() - 1) * DAY; // 过一天再试
  }
}
export { restoreMemory };
