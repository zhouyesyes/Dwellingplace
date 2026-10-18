// AI 在回复里用小标记整理日历：
//   [记日历:2026-10-04|发生了什么]
//   [改日历:#ab12|新的内容]   或   [改日历:#ab12|2026-10-05|新的内容]
//   [删日历:#ab12]
//
// 规则：一条回复里最多 5 条，超出的不会丢掉，会变成「待确认」的提示，由你决定要不要帮 TA 记上。
// （每天能整理几次的上限 10/18 去掉了；现在也不在系统提示里教他记日历，见 chat.js）
import { store, uid } from "../store/index.js";
import { todayYmd } from "./dates.js";

export const CAL_TAG_RE = /\[(记日历|改日历|删日历)[:：]([^\]\n]{1,200})\]/g;
const DATE_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;
const PER_TIME = 5; // 一次整理最多几条

const shortId = e => e.id.slice(0, 4);
const normDate = s => s.split("-").map((x, i) => (i ? x.padStart(2, "0") : x)).join("-");
const md = d => d.slice(5).replace("-", ".");



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
export const opButton = op => (op.op === "add" ? "帮他记上" : op.op === "del" ? "帮他删掉" : "帮他改上");

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
    ops.forEach((op, i) => {
      if (i < PER_TIME) notes.push({ text: runCalendarOp(role, op) });
      else notes.push({ text: describeOp(role, op) + "（超过了一次 5 条）", pending: op });
    });
  }
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), notes };
}
