// 信箱：你和他互相写信。
//   你的信：自己挑信纸。可以上锁——上锁的他只知道有这封信，你开锁后他才读得到。
//   他的信：他在回复里写 [写信:标题|正文] 或 [写信:标题|正文|信纸名]，没写信纸就用星夜（醒来时写的也算）
// 他读信：没上锁、他还没读过的信，下一次聊天时附在【此刻】里给他看，看过就记下来
import { store, uid, MAIN, roleById } from "../store/index.js";
import { todayYmd } from "./dates.js";
import { PAPERS, paperByName, DEFAULT_HIS } from "./stationery.js";

export const LETTER_RE = /\[写信[:：]([^\]]{1,4000})\]/g;

export const lettersOf = (roleId = MAIN) => (store.letters || []).filter(l => l.roleId === roleId).sort((a, b) => a.ts - b.ts);

export function writeLetter({ title, body, sign, date, locked, paper }, roleId = MAIN) {
  store.letters ??= [];
  const l = { id: uid(), roleId, from: "me", title: title.trim().slice(0, 60), body: body.trim(), sign: (sign || "").trim().slice(0, 30), date: date || todayYmd(), ts: Date.now(), locked: !!locked, readAt: null, paper };
  store.letters.push(l);
  return l;
}

// 他回复里的 [写信:标题|正文]：存成他的信，返回提示
export function applyLetterTags(role, text) {
  const notes = [];
  const clean = text.replace(LETTER_RE, (_, inner) => {
    const i = inner.search(/[|｜]/);
    const title = (i >= 0 ? inner.slice(0, i) : "").trim().slice(0, 60) || "给你的信";
    let body = (i >= 0 ? inner.slice(i + 1) : inner).replace(/\\n/g, "\n").replace(/[|｜\s]+$/, "").trim();
    // 最后一段正好是信纸的名字：用那套信纸
    const j = Math.max(body.lastIndexOf("|"), body.lastIndexOf("｜"));
    const picked = j >= 0 && paperByName(body.slice(j + 1));
    if (picked) body = body.slice(0, j).trim();
    if (!body) return "";
    store.letters ??= [];
    store.letters.push({ id: uid(), roleId: role.id, from: "ai", title, body, sign: role.name, date: todayYmd(), ts: Date.now(), locked: false, readAt: null, paper: picked ? picked.id : DEFAULT_HIS });
    notes.push(`${role.name} 给你写了一封信：「${title}」（在小世界的信箱里）`);
    return "";
  });
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), notes };
}

// 给他看的说明（不常变，放系统提示里）
export function lettersForAI(role, who) {
  return [
    `\n# 写信`,
    `你和${who}有一个信箱，可以互相写信。信比聊天郑重、私密，适合写平时说不出口、或者想好好说的话。`,
    `想给${who}写信时，在回复末尾另起一行写：[写信:标题|正文]。正文可以长，分段就换行；署名和日期会自动写上。不要常写，想写的时候再写。`,
    `想挑信纸就在最后加一段：[写信:标题|正文|信纸名]。信纸有：${PAPERS.map(p => p.name).join("、")}；不写就是星夜。`,
    `${who}写给你的信，会附在最新消息前面的【此刻】里；上了锁的信你只知道有，等${who}开锁才能读。`,
  ].join("\n");
}

// 【此刻】里附上的：他还没读过、没上锁的来信（读过就记下）；上锁的只说有几封
export function newLettersForAI(role, who, { peek = false } = {}) {
  const mine = lettersOf(role.id).filter(l => l.from === "me");
  const unread = mine.filter(l => !l.locked && !l.readAt);
  const locked = mine.filter(l => l.locked).length;
  const parts = [];
  for (const l of unread.slice(0, 3)) {
    parts.push(`${who}寄来一封信（${l.date}）——\n标题：${l.title || "（没有标题）"}\n${l.body}\n${l.sign ? `——${l.sign}` : ""}`);
    if (!peek) l.readAt = Date.now();
  }
  if (locked) parts.push(`（信箱里还有 ${locked} 封${who}上了锁的信，你还读不到。）`);
  return parts.length ? `\n# 信箱\n${parts.join("\n\n")}` : "";
}

export const authorOf = l => (l.from === "me" ? "me" : roleById(l.roleId) || null);
