// 日记本：大多是他写，她也能写一页。存在 store.diary [{ id, date: "YYYY-MM-DD", title, text, from: "ai" | "me", ts }]
// 他在回复里写 [日记:标题|内容] 就记下一页（聊天、醒来时都行）；一天写一两篇就好，不用每次都写
import { store, uid } from "../store/index.js";
import { todayYmd } from "./dates.js";

// 日记总开关（10/20）：先收起来。关着时页面不出现日记，也不教他们写；万一还是写了，照样存下、从显示文字里去掉。改成 true 就全接回来
export const SHOW_DIARY = false;
export const DIARY_RE = /\[日记[:：]([^\]]{2,6000})\]/g;
export const diaryList = () => [...(store.diary || [])].sort((a, b) => a.ts - b.ts);

export function addDiary({ title, text, from, date = todayYmd() }) {
  store.diary ??= [];
  const e = { id: uid(), date, title: String(title || "").trim().slice(0, 60), text: String(text || "").trim().slice(0, 6000), from, ts: Date.now() };
  store.diary.push(e);
  return e;
}
export function removeDiary(e) {
  const i = (store.diary || []).indexOf(e);
  if (i >= 0) store.diary.splice(i, 1);
}

export function diaryForAI(role, who) {
  if (!SHOW_DIARY) return "";
  const mine = (store.diary || []).filter(e => e.from === "ai").slice(-3);
  return [
    `\n# 日记本`,
    `你和${who}有一本日记本，大多是你在写，${who}也会写几页。想把今天的事、心里的感受记下来时，在回复末尾另起一行写：[日记:标题|内容]，会变成日记本里新的一页。想写再写，一天一两篇就够了。`,
    mine.length ? `你最近写的几页：${mine.map(e => `「${e.title || e.date}」（${e.date}）`).join("、")}` : "",
  ].filter(Boolean).join("\n");
}

export function applyDiaryTags(role, text) {
  const notes = [];
  const clean = String(text || "").replace(DIARY_RE, (_, inner) => {
    const [head, ...rest] = inner.split(/[|｜]/);
    const body = rest.join("｜").trim() || head.trim();
    const title = rest.length ? head.trim() : "";
    if (body) { addDiary({ title, text: body, from: "ai" }); notes.push(`${role.name} 写了一页日记${title ? `：「${title}」` : ""}`); }
    return "";
  });
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), notes };
}
