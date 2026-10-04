// AI 在回复里用小标记整理日历：
//   [记日历:2026-10-04|发生了什么]
//   [改日历:#ab12|新的内容]   或   [改日历:#ab12|2026-10-05|新的内容]
//   [删日历:#ab12]
//
// 规则：一条回复里出现日历标记 = 一次「整理」。每天能整理的次数有限（每天凌晨 5 点重置），
// 一次整理最多 5 条。超出的不会丢掉，会变成「待确认」的提示，由你决定要不要帮 TA 记上。
import { store, uid } from "../store/index.js";
import { todayYmd } from "./dates.js";

export const CAL_TAG_RE = /\[(记日历|改日历|删日历)[:：]([^\]\n]{1,200})\]/g;
const DATE_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;
const PER_TIME = 5; // 一次整理最多几条
const DAY_START_HOUR = 5; // 每天几点算新的一天

const shortId = e => e.id.slice(0, 4);
const normDate = s => s.split("-").map((x, i) => (i ? x.padStart(2, "0") : x)).join("-");
const md = d => d.slice(5).replace("-", ".");

// 凌晨 5 点前还算前一天
const dayKey = (ts = Date.now()) => new Date(ts - DAY_START_HOUR * 3600_000).toDateString();
const limitOf = role => Math.max(0, Number(role.calPerDay ?? 3));
function usesToday(role) {
  const u = role.calUses;
  return u && u.day === dayKey() ? u.count : 0;
}
const leftToday = role => Math.max(0, limitOf(role) - usesToday(role));

// 给 AI 看的最近记录（带短 id，方便它修改）
export function calendarForAI(role, meName, today = todayYmd()) {
  const list = [...store.events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const who = e => (e.author === "me" ? meName : e.author === role.id ? "你" : "别人");
  const lines = list.map(e => `- #${shortId(e)} ${e.date} ${e.text}（${who(e)}记的）`);
  const left = leftToday(role);
  return [
    `\n# 共同的日历`,
    `你和${meName}有一个共用的日历，记着你们之间值得纪念的小事。今天是 ${today}。`,
    lines.length ? `最近的记录：\n${lines.join("\n")}` : "日历上还没有记录。",
    `新增：[记日历:YYYY-MM-DD|发生了什么]　修改：[改日历:#编号|新的内容]（改日期写 [改日历:#编号|YYYY-MM-DD|新的内容]）　删除：[删日历:#编号]，写在回复末尾。`,
    `日历每天只能整理 ${limitOf(role)} 次（每天早上 5 点重新开始）。一条回复里不管记、改、删几条，都算一次整理，一次最多 ${PER_TIME} 条。`,
    left > 0
      ? `今天还剩 ${left} 次。平时聊到值得记的事可以先放在心里，等晚一点的时候再一起整理，不用聊到一件记一件。`
      : `今天的整理次数已经用完了，等明天早上 5 点以后再整理。`,
  ].join("\n");
}

// 执行一条日历操作（不管次数），返回提示文字
export function runCalendarOp(role, op) {
  if (op.op === "add") {
    store.events.push({ id: uid(), date: op.date, text: op.text, author: role.id, ts: Date.now() });
    return `${role.name} 在日历上记了一笔：${md(op.date)} ${op.text}`;
  }
  const ev = store.events.find(e => e.id.startsWith(op.id));
  if (!ev) return `${role.name} 想修改的那条日历已经不在了`;
  if (op.op === "del") {
    store.events.splice(store.events.indexOf(ev), 1);
    return `${role.name} 删掉了日历上的「${ev.text}」`;
  }
  if (op.date) ev.date = op.date;
  if (op.text) ev.text = op.text;
  ev.editedBy = role.id;
  return `${role.name} 修改了日历：${md(ev.date)} ${ev.text}`;
}

// 待确认的操作用什么话描述
export function describeOp(role, op) {
  if (op.op === "add") return `${role.name} 想在日历上记：${md(op.date)} ${op.text}`;
  const ev = store.events.find(e => e.id.startsWith(op.id));
  const name = ev ? `「${ev.text}」` : "一条记录";
  if (op.op === "del") return `${role.name} 想删掉日历上的${name}`;
  return `${role.name} 想把日历上的${name}改成：${op.text || ""}`;
}
export const opButton = op => (op.op === "add" ? "帮 TA 记上" : op.op === "del" ? "帮 TA 删掉" : "帮 TA 改上");

function parse(op, body) {
  const parts = body.split(/[|｜]/).map(s => s.trim());
  if (op === "记日历") {
    let [date, ...rest] = parts;
    let text = rest.join(" ").trim();
    if (!DATE_RE.test(date)) { text = parts.join(" ").trim(); date = todayYmd(); }
    return text ? { op: "add", date: normDate(date), text: text.slice(0, 80) } : null;
  }
  const id = parts[0].replace(/^#/, "");
  if (!id) return null;
  if (op === "删日历") return { op: "del", id };
  const rest = parts.slice(1);
  const date = rest.length > 1 && DATE_RE.test(rest[0]) ? normDate(rest.shift()) : null;
  const text = rest.join(" ").trim().slice(0, 80);
  return date || text ? { op: "edit", id, date, text } : null;
}

// 处理回复里的日历标记。返回去掉标记后的文字，以及要显示的提示：
//   { text: "...", pending?: op }   pending 表示没执行、等你确认
export function applyCalendarTags(role, text) {
  const ops = [];
  const clean = text.replace(CAL_TAG_RE, (_, op, body) => {
    const parsed = parse(op, body);
    if (parsed) ops.push(parsed);
    return "";
  });
  const notes = [];
  if (ops.length) {
    const allowed = leftToday(role) > 0;
    if (allowed) role.calUses = { day: dayKey(), count: usesToday(role) + 1 };
    ops.forEach((op, i) => {
      if (allowed && i < PER_TIME) notes.push({ text: runCalendarOp(role, op) });
      else notes.push({ text: describeOp(role, op) + (allowed ? "（超过了一次 5 条）" : "（今天的整理次数用完了）"), pending: op });
    });
  }
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), notes };
}
