// AI 在回复里用小标记操作日历：
//   [记日历:2026-10-04|发生了什么]
//   [改日历:#ab12|新的内容]   或   [改日历:#ab12|2026-10-05|新的内容]
//   [删日历:#ab12]
import { store, uid } from "../store/index.js";
import { todayYmd } from "./dates.js";

export const CAL_TAG_RE = /\[(记日历|改日历|删日历)[:：]([^\]\n]{1,200})\]/g;
const DATE_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;

const shortId = e => e.id.slice(0, 4);
const normDate = s => s.split("-").map((x, i) => (i ? x.padStart(2, "0") : x)).join("-");
const md = d => d.slice(5).replace("-", ".");

// 给 AI 看的最近记录（带短 id，方便它修改）
export function calendarForAI(role, meName) {
  const list = [...store.events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  const who = e => (e.author === "me" ? meName : e.author === role.id ? "你" : "别人");
  const lines = list.map(e => `- #${shortId(e)} ${e.date} ${e.text}（${who(e)}记的）`);
  return [
    `\n# 共同的日历`,
    `你和${meName}有一个共用的日历，记着你们之间值得纪念的小事。今天是 ${todayYmd()}。`,
    lines.length ? `最近的记录：\n${lines.join("\n")}` : "日历上还没有记录。",
    `如果聊天里发生了值得记下的事，可以在回复末尾另起一行写：[记日历:YYYY-MM-DD|发生了什么]`,
    `需要修改某条记录时写：[改日历:#编号|新的内容]（要改日期就写 [改日历:#编号|YYYY-MM-DD|新的内容]）；删除写：[删日历:#编号]。`,
    `不要每次都记，只记真正有意义的事；内容一句话就好。`,
  ].join("\n");
}

// 执行回复里的日历标记，返回去掉标记后的文字和要显示的提示
export function applyCalendarTags(role, text) {
  const notes = [];
  const clean = text.replace(CAL_TAG_RE, (_, op, body) => {
    const parts = body.split(/[|｜]/).map(s => s.trim());
    if (op === "记日历") {
      let [date, ...rest] = parts;
      let content = rest.join(" ").trim();
      if (!DATE_RE.test(date)) { content = parts.join(" ").trim(); date = todayYmd(); }
      if (content) {
        date = normDate(date);
        store.events.push({ id: uid(), date, text: content.slice(0, 80), author: role.id, ts: Date.now() });
        notes.push(`${role.name} 在日历上记了一笔：${md(date)} ${content}`);
      }
    } else {
      const id = parts[0].replace(/^#/, "");
      const ev = id && store.events.find(e => e.id.startsWith(id));
      if (!ev) return "";
      if (op === "删日历") {
        store.events.splice(store.events.indexOf(ev), 1);
        notes.push(`${role.name} 删掉了日历上的「${ev.text}」`);
      } else {
        const rest = parts.slice(1);
        if (rest.length > 1 && DATE_RE.test(rest[0])) ev.date = normDate(rest.shift());
        const content = rest.join(" ").trim();
        if (content) ev.text = content.slice(0, 80);
        ev.editedBy = role.id;
        notes.push(`${role.name} 修改了日历：${md(ev.date)} ${ev.text}`);
      }
    }
    return "";
  });
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), notes };
}
