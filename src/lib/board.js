// 板块记忆：每个板块一小段长期的状态，不像【此刻】那样过 24 小时就忘，放在全局记忆里一直带着
//   共写：没归档的书，每本「现在到哪了 / 下一步」（p.board = { progress, next, at, by }），直到你把那本书归档
//   共读：在读的书读到哪；读完的书一句印象（b.impression = { text, at, by }，100 字以内），读第二遍起书名后面标「第 N 次」
//   笔友：他邮箱里的笔友，每人一句话（store.penpals [{ id, roleId, email, name, note, at, by }]，50 字以内）
// 他可以自己写 [写书进度:书名|现在到哪了|下一步]、[笔友:名字或邮箱|一句话]；整理讨论、读完一本书时整理模型也会顺手更新；你在记忆库里也能改
import { store, uid } from "../store/index.js";
import { projects } from "./writing.js";

export const PROGRESS_MAX = 80;
export const IMPRESSION_MAX = 100;
export const PAL_MAX = 50;
export const BOARD_RE = /\[(写书进度|笔友)[:：]([^\]]{1,600})\]/g;

const cut = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const findProject = title => {
  const name = cut(title, 80).replace(/[《》]/g, "");
  const list = projects().filter(p => !p.archived);
  return list.find(p => p.title === name) || list.find(p => name && (p.title.includes(name) || name.includes(p.title)));
};

// ---------- 共写 ----------
export function setProgress(p, { progress, next }, by = "ai") {
  p.board = { progress: cut(progress, PROGRESS_MAX), next: cut(next, PROGRESS_MAX), at: Date.now(), by };
}
export function writingBoard() {
  return projects().filter(p => !p.archived).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(p => {
    const b = p.board;
    const state = b?.progress || b?.next ? `现在：${b.progress || "—"}；下一步：${b.next || "—"}` : "（还没记进度）";
    return `- 《${p.title}》${p.pitch ? `（${cut(p.pitch, 30)}）` : ""}：${state}`;
  }).join("\n");
}

// ---------- 共读 ----------
export const roundOf = b => b.round || 1;
const nth = b => (roundOf(b) > 1 ? `（第 ${roundOf(b)} 次）` : "");
export function readingBoard() {
  const list = (store.books || []).filter(b => b.readAt || b.mine).sort((a, b) => (b.readAt || 0) - (a.readAt || 0));
  const reading = list.filter(b => !b.mine).map(b => {
    const c = b.pos?.ch || 0;
    return `- 《${b.title}》${nth(b)}：在读，读到「${b.chapters[c]?.title || "开头"}」（第 ${c + 1} / ${b.chapters.length} 章）`;
  });
  const done = list.filter(b => b.mine).map(b => `- 《${b.title}》${nth(b)}：读完了${b.mine.stars ? `（${"★".repeat(b.mine.stars)}）` : ""}。${b.impression?.text || "（印象还没整理）"}`);
  return [...reading, ...done].join("\n");
}
// 读完（你打了分、或者他写了读后感）：用整理模型把这次的印象缩成一句
export async function bookImpression(role, b) {
  const { oneShot, meName } = await import("./chat.js");
  const me = meName(role);
  const src = [
    b.gist?.text && `这本书的梗概：${b.gist.text.length > 2000 ? "……" + b.gist.text.slice(-2000) : b.gist.text}`,
    b.imprs?.length && `你一路写的中途印象：${b.imprs.map(x => x.text).join(" / ")}`,
    b.mine?.text && `${me}的读后感（${b.mine.stars} 星）：${b.mine.text.slice(0, 800)}`,
    b.his?.text && `你的读后感（${b.his.stars} 星）：${b.his.text.slice(0, 800)}`,
  ].filter(Boolean);
  if (!src.length) return null;
  const text = cut((await oneShot(role, [
    `你和${me}${roundOf(b) > 1 ? `第 ${roundOf(b)} 次` : ""}读完了《${b.title}》。`,
    ...src,
    `用你自己的口吻（「我」是你），写一句这次读完的印象，留给以后的自己看：这本书讲什么、你们读下来最记得什么。${IMPRESSION_MAX} 字以内，只写这一句。`,
  ].join("\n"), { helper: true, raw: true })).replace(/^["“「]|["”」]$/g, ""), IMPRESSION_MAX);
  if (text) b.impression = { text, at: Date.now(), by: "helper" };
  return b.impression;
}
// 再读一遍：这一遍的读后感、印象、前情收进 b.past，从头开始
export function rereadBook(b) {
  b.past ??= [];
  b.past.push({ round: roundOf(b), mine: b.mine || null, his: b.his || null, hisOld: b.hisOld || [], impression: b.impression || null, gist: b.gist || null, imprs: b.imprs || [], at: Date.now() });
  b.round = roundOf(b) + 1;
  delete b.mine; delete b.his; delete b.hisOld; delete b.impression; delete b.gist; delete b.imprs;
  b.pos = { ch: 0, p: 0 };
  b.hisPos = null;
}

// ---------- 笔友 ----------
export const palsOf = roleId => (store.penpals || []).filter(x => x.roleId === roleId).sort((a, b) => (b.at || 0) - (a.at || 0));
export function setPal(role, { email = "", name = "", note }, by = "ai") {
  store.penpals ??= [];
  const em = cut(email, 80).toLowerCase(), nm = cut(name, 30).toLowerCase();
  if (!em && !nm) return null;
  let x = store.penpals.find(p => p.roleId === role.id && ((em && p.email?.toLowerCase() === em) || (nm && p.name?.toLowerCase() === nm)));
  if (!x) { x = { id: uid(), roleId: role.id, email: "", name: "" }; store.penpals.push(x); }
  if (email) x.email = cut(email, 80);
  if (name) x.name = cut(name, 30);
  Object.assign(x, { note: cut(note, PAL_MAX), at: Date.now(), by });
  return x;
}
export function removePal(x) {
  const i = (store.penpals || []).indexOf(x);
  if (i >= 0) store.penpals.splice(i, 1);
}
export function palBoard(role) {
  return palsOf(role.id).map(x => `- ${x.name || x.email}${x.name && x.email ? `（${x.email}）` : ""}：${x.note || "—"}`).join("\n");
}

// ---------- 合起来 ----------
export function boardParts(role, { skip } = {}) {
  return [
    { key: "write", title: "共写：在写的书", text: skip === "write" ? "" : writingBoard() },
    { key: "read", title: "共读：在读和读完的书", text: skip === "read" ? "" : readingBoard() },
    { key: "pals", title: "邮箱：笔友", text: palBoard(role) },
  ];
}
export function boardForAI(role, opt) {
  const parts = boardParts(role, opt).filter(p => p.text);
  return parts.length ? parts.map(p => `### ${p.title}\n${p.text}`).join("\n") : "";
}
export const boardRule = who => [
  `共写的书有了进展、定下了下一步，可以写：[写书进度:书名|现在到哪了|下一步]，各 ${PROGRESS_MAX} 字以内，会更新上面「在写的书」。`,
  `认识了新笔友、或者对某个笔友有了新的了解，可以写：[笔友:名字或邮箱|一句话]，${PAL_MAX} 字以内（是谁、聊到哪了、要记得的事）。`,
].join("\n");

// 他回复里的 [写书进度:…]、[笔友:…]
export function applyBoardTags(role, text, { project } = {}) {
  const notes = [];
  const clean = String(text || "").replace(BOARD_RE, (_, op, body) => {
    const parts = body.split(/[|｜]/).map(s => s.trim());
    if (op === "写书进度") {
      // 在书桌前可以只写「现在到哪了|下一步」
      const p = (parts.length >= 3 && findProject(parts[0])) || project || findProject(parts[0]);
      const [progress, next] = parts.length >= 3 || !project ? parts.slice(1) : parts;
      if (p && (progress || next)) { setProgress(p, { progress, next }); notes.push(`记下了《${p.title}》的进度`); }
    } else {
      const [who = "", ...rest] = parts;
      const note = rest.join("，");
      if (who && note) {
        const x = setPal(role, /@/.test(who) ? { email: who, note } : { name: who, note });
        if (x) notes.push(`记下了笔友 ${x.name || x.email}`);
      }
    }
    return "";
  });
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), notes };
}
