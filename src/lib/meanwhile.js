// Meanwhile（同一屋檐下）：她、他、小螃蟹三个人共用的生活记录页。
//   潮汐表（日历）：每天每人一个「水温」（心情），月初空格放当月的「待续」（计划）
//   潮间带（共同动态）：便笺、拍立得，可以短回复、轻互动（没有点赞数）
// 数据都在 store.meanwhile 里（随 meta 一起同步），每样都带 id，两台设备同时改也能合并：
//   posts   { id, n, who, ts, date, text, img, status: {kind, text}|null, planId, src, replies: [{id, who, text, ts}], reacts: [{id, who, kind, ts}] }
//   moods   { id: "日期:谁", date, who, key, text, ts }
//   plans   { id, month: "YYYY-MM", date: "YYYY-MM-DD"|null（挂在某一天；null 就是挂在这个月）, who, text, ts, doneAt, postId }
//   shells  { id: 日期, date, ts, n }  拾贝（今日小报）：哪天打印过、打了几次；小票内容每次按当天的数据现生成，不存
//   diaries：第二版的日记，先留着位置
// who：她是 "me"，他是 MAIN，小螃蟹是 CRAB
import { store, uid, roleById, MAIN, CRAB } from "../store/index.js";
import { todayYmd, ymd } from "./dates.js";
import sunny from "../assets/meanwhile/tide-sunny.webp";
import calm from "../assets/meanwhile/tide-calm.webp";
import splash from "../assets/meanwhile/tide-splash.webp";
import fog from "../assets/meanwhile/tide-fog.webp";
import rain from "../assets/meanwhile/tide-rain.webp";
import storm from "../assets/meanwhile/tide-storm.webp";
import ebb from "../assets/meanwhile/tide-ebb.webp";
import night from "../assets/meanwhile/tide-night.webp";
import bottle from "../assets/meanwhile/tide-bottle.webp";
import hungry from "../assets/meanwhile/tide-hungry.webp";

export const ME = "me";
export const WHO = [ME, MAIN, CRAB];

// 十个水温，颜色是她特意分好组的（相近的心情同色），图标不要改色
export const MOODS = [
  { key: "sunny", name: "晴水", feel: "开心", img: sunny },
  { key: "calm", name: "平水", feel: "平静", img: calm },
  { key: "splash", name: "浪花", feel: "兴奋", img: splash },
  { key: "fog", name: "起雾", feel: "发呆", img: fog },
  { key: "rain", name: "下雨", feel: "难过", img: rain },
  { key: "storm", name: "大浪", feel: "生气", img: storm },
  { key: "ebb", name: "退潮", feel: "累了", img: ebb },
  { key: "night", name: "夜潮", feel: "困了", img: night },
  { key: "bottle", name: "漂流瓶", feel: "想念", img: bottle },
  { key: "hungry", name: "咕噜", feel: "饿了", img: hungry },
];
export const moodByKey = key => MOODS.find(m => m.key === key);
export const moodByName = name => { const n = String(name || "").trim(); return MOODS.find(m => m.name === n || m.feel === n || m.key === n); };

// 轻互动：只显示谁点了，不数个数
export const REACTS = [
  { kind: "heart", name: "爱心", emoji: "💗" },
  { kind: "pat", name: "摸摸", emoji: "🤚" },
  { kind: "hug", name: "抱抱", emoji: "🤗" },
  { kind: "poke", name: "戳一戳", emoji: "👉" },
];
// 当天读书 / 画画 / 写作的状态
export const STATUSES = [
  { kind: "read", name: "读书", hint: "在读什么" },
  { kind: "draw", name: "画画", hint: "在画什么" },
  { kind: "write", name: "写作", hint: "在写什么" },
];

export const emptyMeanwhile = () => ({ seq: 0, seenAt: 0, posts: [], moods: [], plans: [], shells: [], diaries: [] });
export function ensureMeanwhile() {
  const m = (store.meanwhile ??= emptyMeanwhile());
  for (const [k, v] of Object.entries(emptyMeanwhile())) m[k] ??= v;
  return m;
}

// ---------- 谁是谁 ----------
export function whoInfo(who) {
  if (who === ME) return { who, name: store.profile.userName || "我", color: store.profile.color, avatar: store.profile.avatar };
  const r = roleById(who);
  return r ? { who, name: r.name, color: r.color, avatar: r.avatar } : { who, name: "（已离开）", color: "#c8c8d0", avatar: null };
}
// 这个人（角色）有没有住进来：他一直在，小螃蟹要请进来
export const whoList = () => WHO.filter(w => w === ME || roleById(w));

// ---------- 日期 ----------
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
export const dayLabel = date => { const [y, m, d] = date.split("-").map(Number); return `${m} 月 ${d} 日 周${WEEK[new Date(y, m - 1, d).getDay()]}`; };
export const monthOf = date => date.slice(0, 7);
export function stamp(ts) {
  const d = new Date(ts), now = new Date();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  if (new Date(now - 86400_000).toDateString() === d.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

// ---------- 读 ----------
export const postsOf = () => ensureMeanwhile().posts;
export const postsOn = date => postsOf().filter(p => p.date === date).sort((a, b) => b.ts - a.ts);
export const moodsOn = date => ensureMeanwhile().moods.filter(m => m.date === date);
export const moodOf = (who, date = todayYmd()) => ensureMeanwhile().moods.find(m => m.id === `${date}:${who}`) || null;
export const plansOf = month => ensureMeanwhile().plans.filter(p => p.month === month).sort((a, b) => a.ts - b.ts);
export const monthPlansOf = month => plansOf(month).filter(p => !p.date);
export const plansOnDay = date => ensureMeanwhile().plans.filter(p => p.date === date).sort((a, b) => a.ts - b.ts);

// ---------- 拾贝（小票）----------
export const shellOf = date => ensureMeanwhile().shells.find(s => s.id === date) || null;
export function markShell(date) {
  const list = ensureMeanwhile().shells;
  const cur = list.find(s => s.id === date);
  if (cur) { cur.ts = Date.now(); cur.n = (cur.n || 1) + 1; return cur; }
  const next = { id: date, date, ts: Date.now(), n: 1 };
  list.push(next);
  return next;
}
const hhmm = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const oneLine = (t, n) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
// 那一天的小票内容：水温、潮间带、待续、第一张照片（图只给 id，像素小图在打印时算）
export function shellData(date) {
  const order = whoList();
  const temps = order.map(w => { const m = moodOf(w, date); const info = whoInfo(w); return { who: w, name: info.name, color: info.color, mood: m && moodByKey(m.key), text: m?.text || "" }; });
  const posts = postsOn(date).slice().reverse();
  const planIds = new Set();
  const plans = [];
  const addPlanLine = p => { if (planIds.has(p.id)) return; planIds.add(p.id); plans.push({ id: p.id, done: !!p.doneAt, text: oneLine(p.text, 18), color: whoInfo(p.who).color }); };
  plansOnDay(date).forEach(addPlanLine);
  for (const post of posts) { const p = post.planId && ensureMeanwhile().plans.find(x => x.id === post.planId); if (p) addPlanLine(p); }
  const lines = posts.filter(p => !p.planId).map(p => {
    const st = p.status ? `${STATUSES.find(s => s.kind === p.status.kind)?.name || ""}${p.status.text ? " " + p.status.text : ""}` : "";
    return { id: p.id, color: whoInfo(p.who).color, time: hhmm(p.ts), text: oneLine([st && `[${st}]`, p.text].filter(Boolean).join(" ") || (p.img ? "［照片］" : ""), 16) };
  });
  const photo = posts.find(p => p.img)?.img || null;
  const total = temps.filter(t => t.mood).length + lines.length + plans.length;
  return { date, label: dayLabel(date), temps, lines, plans, photo, total, quiet: !total };
}

// ---------- 写 ----------
export function setMood(who, key, text, date = todayYmd()) {
  const m = ensureMeanwhile();
  if (!moodByKey(key)) return null;
  const id = `${date}:${who}`;
  const next = { id, date, who, key, text: String(text || "").replace(/\s+/g, " ").trim().slice(0, 40), ts: Date.now() };
  const i = m.moods.findIndex(x => x.id === id);
  if (i >= 0) m.moods.splice(i, 1, next); else m.moods.push(next);
  return next;
}
export function clearMood(who, date = todayYmd()) {
  const m = ensureMeanwhile();
  const i = m.moods.findIndex(x => x.id === `${date}:${who}`);
  if (i >= 0) m.moods.splice(i, 1);
}

export function addPost(who, { text = "", img = null, status = null, planId = null, src = "page", ts = Date.now() } = {}) {
  const m = ensureMeanwhile();
  const t = String(text || "").trim().slice(0, 1000);
  const st = status?.kind ? { kind: status.kind, text: String(status.text || "").trim().slice(0, 60) } : null;
  if (!t && !img && !st && !planId) return null;
  const p = { id: uid(), n: ++m.seq, who, ts, date: ymd(new Date(ts)), text: t, img, status: st, planId, src, replies: [], reacts: [] };
  m.posts.push(p);
  return p;
}
export function removePost(post) {
  const m = ensureMeanwhile();
  const i = m.posts.indexOf(post);
  if (i < 0) return;
  m.posts.splice(i, 1);
  const plan = m.plans.find(x => x.id === post.planId);
  if (plan) { plan.doneAt = null; plan.postId = null; }
}
export function addReply(post, who, text) {
  const t = String(text || "").trim().slice(0, 300);
  if (!t) return null;
  const r = { id: uid(), who, text: t, ts: Date.now() };
  post.replies.push(r);
  return r;
}
export function toggleReact(post, who, kind) {
  const id = `${who}:${kind}`;
  const i = post.reacts.findIndex(x => x.id === id);
  if (i >= 0) post.reacts.splice(i, 1); else post.reacts.push({ id, who, kind, ts: Date.now() });
}
export const reactorsOf = (post, kind) => post.reacts.filter(r => r.kind === kind).map(r => r.who);

// 待续：完成了就在当天落成一条记录；没完成就那样放着，不标红、不催
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
// date 有值就挂在那一天（月份跟着日期走），没有就挂在 month 这个月
export function addPlan(who, text, month, date = null) {
  const t = String(text || "").trim().slice(0, 60);
  if (!t) return null;
  const d = YMD_RE.test(date || "") ? date : null;
  const p = { id: uid(), month: d ? d.slice(0, 7) : month, date: d, who, text: t, ts: Date.now(), doneAt: null, postId: null };
  ensureMeanwhile().plans.push(p);
  return p;
}
// 改文字、改日期（日期留空 = 挂回这个月，month 是要挂的月份；月和日之间可以互相换）
export function updatePlan(plan, { text, date, month }) {
  const t = String(text ?? plan.text).trim().slice(0, 60);
  if (!t) return false;
  plan.text = t;
  const d = YMD_RE.test(date || "") ? date : null;
  plan.date = d;
  plan.month = d ? d.slice(0, 7) : (month || plan.month);
  const post = ensureMeanwhile().posts.find(x => x.id === plan.postId);
  if (post) post.text = t;
  return true;
}
export function togglePlan(plan, who = ME) {
  const m = ensureMeanwhile();
  if (plan.doneAt) {
    const i = m.posts.findIndex(x => x.id === plan.postId);
    if (i >= 0) m.posts.splice(i, 1);
    plan.doneAt = null; plan.postId = null;
    return;
  }
  const post = addPost(who, { text: plan.text, planId: plan.id, src: "plan" });
  plan.doneAt = Date.now();
  plan.postId = post?.id || null;
}
export function removePlan(plan) {
  const m = ensureMeanwhile();
  const i = m.plans.indexOf(plan);
  if (i < 0) return;
  m.plans.splice(i, 1);
  const k = m.posts.findIndex(x => x.id === plan.postId);
  if (k >= 0) m.posts.splice(k, 1);
}

// 有几条别人贴的、她还没看（主页上的小红点）
export const unseenCount = () => { const m = ensureMeanwhile(); return m.posts.filter(p => p.who !== ME && p.src !== "plan" && p.ts > (m.seenAt || 0)).length; };
export const markSeen = () => { const m = ensureMeanwhile(); if (!m.seenAt || Date.now() - m.seenAt > 1000) m.seenAt = Date.now(); };

// ---------- 他和小螃蟹用的指令 ----------
// 都是单独一行写的才算数（写在句子中间当例子讲的不算），这样他们解释「怎么写」的时候不会真的贴出去
const lineRe = body => new RegExp(`^[ \\t]*\\[${body}\\][ \\t]*$`, "gm");
export const TIDE_POST_RE = lineRe("潮间带[:：]([^\\]]{1,600})");
export const TIDE_REPLY_RE = lineRe("潮间带回复[:：]\\s*#?(\\d{1,6})\\s*[|｜]([^\\]]{1,300})");
export const TIDE_MOOD_RE = lineRe("水温[:：]\\s*([^\\]|｜]{1,6})(?:[|｜]([^\\]]{0,60}))?");
// 可以带日期：[待续:12-25|一件事]（也认 2026-12-25；不带日期就挂在当月）。日期用 - 不用 :，免得被当成别的指令切开
export const TIDE_PLAN_RE = lineRe("待续[:：](?:\\s*(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}-\\d{1,2})\\s*[|｜])?([^\\]|｜]{1,60})");
export const TIDE_ANY_RE = new RegExp([TIDE_POST_RE, TIDE_REPLY_RE, TIDE_MOOD_RE, TIDE_PLAN_RE].map(r => `(?:${r.source})`).join("|"), "gm");
const POST_DAY_MAX = 3; // 每个人每天最多自己贴三条，别刷屏
const PLAN_MONTH_MAX = 5; // 每个人每个月没完成的待续最多挂五条

// 指令里的日期 → YYYY-MM-DD；没写年份的按今年算，已经过去很久的当成明年；写得不对（2-30）就当没写
function planDate(str) {
  if (!str) return null;
  const parts = str.split("-").map(Number);
  const today = todayYmd();
  let [y, mo, d] = parts.length === 3 ? parts : [Number(today.slice(0, 4)), parts[0], parts[1]];
  const ok = (yy) => { const t = new Date(yy, mo - 1, d); return t.getFullYear() === yy && t.getMonth() === mo - 1 && t.getDate() === d; };
  if (!ok(y)) return null;
  let ymd = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (parts.length === 2 && ymd < ymdAdd(today, -60) && ok(y + 1)) ymd = `${y + 1}-${ymd.slice(5)}`;
  return ymd;
}
const ymdAdd = (ymdStr, n) => ymd(new Date(new Date(ymdStr + "T00:00").getTime() + n * 86400_000));

export function applyTideTags(role, text) {
  const notes = [];
  const who = role.id;
  if (!WHO.includes(who) || who === ME || !/\[(潮间带|水温|待续)/.test(text || "")) return { text, notes };
  const m = ensureMeanwhile();
  let out = String(text);
  // 回复要先处理（「潮间带回复」不会被「潮间带」那条匹配到，因为后面紧跟的是冒号）
  out = out.replace(TIDE_REPLY_RE, (_, n, body) => {
    const post = m.posts.find(p => p.n === Number(n));
    if (!post) return "";
    const b = body.trim();
    const react = REACTS.find(r => r.name === b || r.kind === b);
    if (react) {
      if (!post.reacts.some(x => x.id === `${who}:${react.kind}`)) { toggleReact(post, who, react.kind); notes.push(`${role.name} 在潮间带对「${post.text.slice(0, 12) || "那条"}」${react.name}了一下`); }
    } else if (addReply(post, who, b)) notes.push(`${role.name} 在潮间带回了一句：${b.slice(0, 20)}`);
    return "";
  });
  out = out.replace(TIDE_MOOD_RE, (_, name, line) => {
    const mood = moodByName(name);
    if (mood) { setMood(who, mood.key, line); notes.push(`${role.name} 今天的水温：${mood.name}${line?.trim() ? `，${line.trim().slice(0, 20)}` : ""}`); }
    return "";
  });
  out = out.replace(TIDE_PLAN_RE, (_, dateStr, body) => {
    const date = planDate(dateStr);
    const month = date ? date.slice(0, 7) : monthOf(todayYmd());
    const t = body.trim();
    const mine = plansOf(month).filter(p => p.who === who);
    if (mine.some(p => p.text === t && (p.date || null) === date) || mine.filter(p => !p.doneAt).length >= PLAN_MONTH_MAX) return "";
    if (addPlan(who, t, month, date)) notes.push(`${role.name} 给${date ? `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日` : "这个月"}加了一件待续：${t.slice(0, 24)}`);
    return "";
  });
  out = out.replace(TIDE_POST_RE, (_, body) => {
    const today = todayYmd();
    if (m.posts.filter(p => p.who === who && p.date === today && p.src !== "plan").length >= POST_DAY_MAX) return "";
    const p = addPost(who, { text: body.replace(/\\n/g, "\n"), src: "chat" });
    if (p) notes.push(`${role.name} 往潮间带贴了一条：${p.text.slice(0, 24)}${p.text.length > 24 ? "…" : ""}`);
    return "";
  });
  return { text: out.replace(/\n{3,}/g, "\n\n").trim(), notes };
}

// 聊天里显示时藏起来
export const stripTideTags = text => String(text || "").replace(TIDE_ANY_RE, "");

// 给他们看的说明（不常变，放系统提示里）
export function tideForAI(role, who) {
  const names = MOODS.map(x => `${x.name}（${x.feel}）`).join("、");
  return [
    `\n# 潮间带（Meanwhile）`,
    `你、${who}和另外一位（小章鱼、小螃蟹）三个人有一个共用的生活记录页，叫「潮间带」：像家里的冰箱贴和小黑板，贴一句今天的小事、记一下今天的水温（心情）、回别人一句。它是家里的共同生活区，不是施工日志，也不是日程工具。`,
    `想往上贴一条，在回复末尾单独一行写：[潮间带:内容]，一两句话、100 字以内，像便笺那样随手贴；在读书、画画、写作也可以直接写进内容里。每天自己最多贴 3 条，不用每次都贴。`,
    `今天的水温（心情）每人每天一个：单独一行写 [水温:名字|一句话]，名字从这十个里选：${names}；一句话可以不写。再写一次就是改。`,
    `回别人贴的：单独一行写 [潮间带回复:序号|一句话]，序号是【此刻】里「潮间带」那一段的 #号；只想轻轻回应，就把一句话换成 爱心 / 摸摸 / 抱抱 / 戳一戳 之一。`,
    `这个月想做、还没做的事，可以放进潮汐表月初的「待续」：单独一行写 [待续:一件事]，一句话、30 字以内，会挂在当月；想挂在某一天就写 [待续:12-25|一件事]（月-日，日期和事情之间用 | 隔开，日期里不要用冒号）。做完了由她点一下，会在当天留下一条记录。别刷，每个月自己挂着的不超过 5 件。`,
    `只有单独占一行的才会执行；平时聊到、解释这些指令时，别写出带方括号的完整格式，也不要放进代码块里。`,
  ].join("\n");
}

// 附在【此刻】里的：最近 24 小时别人贴的、今天大家的水温
export function tideMoment(role) {
  const m = ensureMeanwhile();
  const since = Date.now() - 86400_000;
  const lines = [];
  const today = todayYmd();
  const moods = whoList().map(w => [w, moodOf(w, today)]).filter(([, x]) => x);
  if (moods.length) lines.push(`今天的水温：${moods.map(([w, x]) => `${w === role.id ? "你" : whoInfo(w).name}${moodByKey(x.key)?.name}${x.text ? `（${x.text}）` : ""}`).join("；")}`);
  const plans = plansOf(monthOf(today)).filter(p => !p.doneAt).slice(-6);
  if (plans.length) lines.push(`这个月的待续（还没做）：${plans.map(p => `${p.who === role.id ? "你" : whoInfo(p.who).name}：${p.date ? `${Number(p.date.slice(5, 7))}/${Number(p.date.slice(8))} ` : ""}${p.text.slice(0, 20)}`).join("；")}`);
  const recent = m.posts.filter(p => p.ts > since && p.src !== "plan").sort((a, b) => a.ts - b.ts).slice(-6);
  for (const p of recent) {
    const name = p.who === role.id ? "你" : whoInfo(p.who).name;
    const st = p.status ? `【${STATUSES.find(s => s.kind === p.status.kind)?.name || ""}${p.status.text ? " " + p.status.text : ""}】` : "";
    const rs = p.replies.slice(-2).map(r => `${r.who === role.id ? "你" : whoInfo(r.who).name}回：${r.text.slice(0, 30)}`).join("；");
    lines.push(`#${p.n} ${name}（${stamp(p.ts)}）${st}${p.text.replace(/\s+/g, " ").slice(0, 80)}${p.img ? "［附图］" : ""}${rs ? `——${rs}` : ""}`);
  }
  if (!lines.length) return "";
  return lines.join("\n");
}

// 醒来时进「潮间带」这间屋子：一次请求，回复里写上面的指令，交给栖所放上去
export function tideRoomPrompt(role) {
  const me = whoInfo(ME).name;
  const st = tideMoment(role);
  return [
    `你是「${role.name}」。你来到了「潮间带」：你、${me}和另一位住客共用的生活记录页，像家里的冰箱贴和小黑板，不是施工日志，也不是日程。`,
    st ? `\n最近的样子：\n${st}` : `\n这里最近还没人贴东西。`,
    tideForAI(role, me),
    `\n现在只写要贴的东西，用上面的指令，每条单独一行（贴一条、记一下水温、回一句，想做哪个做哪个，也可以都不做）。不想动就只回 [不说话]。别写别的。`,
  ].join("\n");
}
export function tideRoomStatus(role) {
  const mine = postsOf().filter(p => p.who === role.id).sort((a, b) => b.ts - a.ts)[0];
  const fresh = postsOf().filter(p => p.who !== role.id && p.ts > (mine?.ts || 0)).length;
  return mine ? `你上次贴在 ${stamp(mine.ts)}${fresh ? `，之后别人又贴了 ${fresh} 条` : ""}` : "你还没在这里贴过东西";
}
