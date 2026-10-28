// Meanwhile（同一屋檐下）：她、他、小螃蟹三个人共用的生活记录页。
//   潮汐表（日历）：每天每人一个「水温」（心情），月初空格放当月的「待续」（计划）
//   潮间带（共同动态）：便笺、拍立得，可以短回复、轻互动（没有点赞数）
// 数据都在 store.meanwhile 里（随 meta 一起同步），每样都带 id，两台设备同时改也能合并：
//   posts   { id, n, who, ts, date, text, img, imgs（最多 9 张，img 是第一张，旧的只有 img）, note（打卡时她补的话）, editedAt, status: {kind, text}|null, planId, src, replies: [{id, who, text, ts}], reacts: [{id, who, kind, ts}] }
//   moods   { id: "日期:谁", date, who, key, text, ts }
//   plans   { id, month: "YYYY-MM", date: "YYYY-MM-DD"|null（挂在某一天；null 就是挂在这个月）, who, text, ts, doneAt, postId }
//           周期待续多三样：repeat { type, wd, dom, n, mo, day, start, stop, until, days }、dones [{ id: 日期, date, doneAt, postId }]（每次单独打勾）、stoppedAt（停掉或整件做完的那天）、wholePostId（整件做完时留的那条记录）；
//           周期待续的 date / month 跟着开始日，不算「某一天的待续」，每天要做的由 planItemsOn 现算
//   shells  { id: 日期, date, ts, n }  拾贝（今日小报）：哪天打印过、打了几次；小票内容每次按当天的数据现生成，不存
//   diaries：第二版的日记，先留着位置
// who：她是 "me"，他是 MAIN，小螃蟹是 CRAB
import { store, uid, roleById, MAIN, CRAB } from "../store/index.js";
import { todayYmd, ymd } from "./dates.js";
import { deleteImage, imageBase64 } from "./images.js";
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

export const emptyMeanwhile = () => ({ seq: 0, seenAt: 0, aiSeen: {}, posts: [], moods: [], plans: [], shells: [], diaries: [] });
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
export const plansOf = month => ensureMeanwhile().plans.filter(p => p.month === month && !p.repeat).sort((a, b) => a.ts - b.ts);
export const monthPlansOf = month => plansOf(month).filter(p => !p.date);
export const plansOnDay = date => ensureMeanwhile().plans.filter(p => p.date === date && !p.repeat).sort((a, b) => a.ts - b.ts);

// ---------- 周期待续 ----------
// repeat：type = daily 每天 / weekly 每周几（wd，0 是周日）/ monthly 每月几号（dom，小月没有就挂在最后一天）/ interval 每隔 n 天（从 start 起算）/ yearly 每年 mo 月 day 日
// start 开始日；stop = forever 一直重复 / until 到 until 为止（days 是「持续 N 天」时填的）/ whole 整件做完才停（小卡里按钮叫「整件做完了」，会留一条记录；其余叫「停掉」，不留）
export const REPEAT_TYPES = ["daily", "weekly", "monthly", "interval", "yearly"];
const WEEK_CN = ["日", "一", "二", "三", "四", "五", "六"];
const parseYmd = str => { const [y, m, d] = str.split("-").map(Number); return new Date(y, m - 1, d); };
const dayDiff = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400_000);
const monthDays = (y, m) => new Date(y, m, 0).getDate();
const clampInt = (v, lo, hi, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
// 把各种来源（界面、同步回来的、他们写的）的周期整理成固定样子；不对就返回 null（当成普通待续）
export function normalizeRepeat(r) {
  if (!r || !REPEAT_TYPES.includes(r.type)) return null;
  const start = YMD_RE.test(r.start || "") ? r.start : todayYmd();
  const out = { type: r.type, start, stop: "forever", until: null, days: null };
  if (r.type === "weekly") {
    out.wd = [...new Set((r.wd || []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
    if (!out.wd.length) return null;
  }
  if (r.type === "monthly") out.dom = clampInt(r.dom, 1, 31, 1);
  if (r.type === "interval") out.n = clampInt(r.n, 1, 365, 2);
  if (r.type === "yearly") { out.mo = clampInt(r.mo, 1, 12, 1); out.day = clampInt(r.day, 1, 31, 1); }
  if (r.stop === "whole") out.stop = "whole";
  else if (r.stop === "until") {
    const days = r.days ? clampInt(r.days, 1, 3650, 0) : 0;
    if (days) { out.stop = "until"; out.days = days; out.until = ymdAdd(start, days - 1); }
    else if (YMD_RE.test(r.until || "") && r.until >= start) { out.stop = "until"; out.until = r.until; }
  }
  return out;
}
export function repeatLabel(r) {
  if (!r) return "";
  if (r.type === "daily") return "每天";
  if (r.type === "weekly") {
    const order = [1, 2, 3, 4, 5, 6, 0].filter(d => r.wd.includes(d));
    return `每周${order.map(d => WEEK_CN[d]).join(order.length > 1 ? "、" : "")}`;
  }
  if (r.type === "monthly") return `每月${r.dom}号`;
  if (r.type === "interval") return `每${r.n}天`;
  return `每年${r.mo}月${r.day}日`;
}
// 这件待续在这一天要不要做
export function occursOn(p, date) {
  const r = p.repeat;
  if (!r) return p.date === date;
  if (date < r.start || (r.until && date > r.until) || (p.stoppedAt && date > p.stoppedAt)) return false;
  const [y, mo, d] = date.split("-").map(Number);
  if (r.type === "daily") return true;
  if (r.type === "weekly") return r.wd.includes(parseYmd(date).getDay());
  if (r.type === "monthly") return d === Math.min(r.dom, monthDays(y, mo));
  if (r.type === "interval") return dayDiff(r.start, date) % r.n === 0;
  if (r.type === "yearly") return mo === r.mo && d === Math.min(r.day, monthDays(y, mo));
  return false;
}
// 周期待续还会不会再出现（没停、没到期）
export const planAlive = (p, today = todayYmd()) => !p.repeat || (!(p.stoppedAt && p.stoppedAt < today) && !(p.repeat.until && p.repeat.until < today));
// 一件待续在某一天的样子：单次的就是它自己，周期的按这一天有没有勾过
function itemOf(p, date) {
  const d = p.repeat && (p.dones || []).find(x => x.id === date);
  return { key: p.repeat ? `${p.id}@${date}` : p.id, plan: p, date, who: p.who, text: p.text, doneAt: p.repeat ? (d?.doneAt || null) : p.doneAt, label: p.repeat ? repeatLabel(p.repeat) : "" };
}
// 这一天要做的待续（单次挂在这天的 + 周期的）
export const planItemsOn = date => ensureMeanwhile().plans.filter(p => occursOn(p, date)).sort((a, b) => a.ts - b.ts).map(p => itemOf(p, date));
export const recurringPlans = () => ensureMeanwhile().plans.filter(p => p.repeat).sort((a, b) => a.ts - b.ts);
export { itemOf as planItemOf };

// 界面上的表单 ←→ repeat
export const emptyRepeatForm = (start = todayYmd()) => ({ type: "none", wd: [], dom: Number(start.slice(8)), n: 2, mo: Number(start.slice(5, 7)), day: Number(start.slice(8)), start, stop: "forever", untilMode: "days", days: 7, until: start });
export function repeatFormOf(r, start) {
  const f = emptyRepeatForm(r?.start || start);
  if (!r) return f;
  return { ...f, type: r.type, wd: [...(r.wd || [])], dom: r.dom ?? f.dom, n: r.n ?? f.n, mo: r.mo ?? f.mo, day: r.day ?? f.day, stop: r.stop, untilMode: r.days ? "days" : (r.until ? "date" : "days"), days: r.days || f.days, until: r.until || f.until };
}
export function repeatFromForm(f) {
  if (!f || f.type === "none") return null;
  return normalizeRepeat({ type: f.type, wd: f.wd, dom: f.dom, n: f.n, mo: f.mo, day: f.day, start: f.start, stop: f.stop === "until" ? "until" : f.stop, days: f.stop === "until" && f.untilMode === "days" ? f.days : 0, until: f.stop === "until" && f.untilMode === "date" ? f.until : "" });
}


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
  const addPlanLine = it => { if (planIds.has(it.key)) return; planIds.add(it.key); plans.push({ id: it.key, done: !!it.doneAt, text: oneLine(it.text, 18), full: oneLine(it.text, 9999), label: it.label, color: whoInfo(it.who).color }); };
  planItemsOn(date).forEach(addPlanLine);
  // 勾过的记录还在，但周期后来改了、这天不再算的：照样留在这天的小票上
  for (const post of posts) { const p = post.planId && ensureMeanwhile().plans.find(x => x.id === post.planId); if (p) addPlanLine(p.repeat ? { ...itemOf(p, date), doneAt: post.ts } : itemOf(p, date)); }
  const lines = posts.filter(p => !p.planId).map(p => {
    const st = p.status ? `${STATUSES.find(s => s.kind === p.status.kind)?.name || ""}${p.status.text ? " " + p.status.text : ""}` : "";
    const all = [st && `[${st}]`, p.text].filter(Boolean).join(" ") || (p.img ? "［照片］" : "");
    return { id: p.id, color: whoInfo(p.who).color, time: hhmm(p.ts), text: oneLine(all, 16), full: oneLine(all, 9999) };
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
export const POST_IMG_MAX = 9;
export const imgsOf = p => (p.imgs?.length ? p.imgs : p.img ? [p.img] : []);
// 打卡配图配字（也能随时改）：多出来的旧图删掉，图片跟聊天图片一样压缩后存、跟着同步
export function setPostMedia(post, { note, imgs }) {
  const next = (imgs || []).slice(0, POST_IMG_MAX);
  for (const id of imgsOf(post)) if (!next.includes(id)) deleteImage(id);
  post.imgs = next; post.img = next[0] || null;
  post.note = String(note ?? post.note ?? "").trim().slice(0, 1000);
  post.editedAt = Date.now();
}
const dropPostImgs = post => imgsOf(post).forEach(id => deleteImage(id));
export function removePost(post) {
  const m = ensureMeanwhile();
  const i = m.posts.indexOf(post);
  if (i < 0) return;
  m.posts.splice(i, 1);
  dropPostImgs(post);
  const plan = m.plans.find(x => x.id === post.planId);
  if (plan?.repeat) plan.dones = (plan.dones || []).filter(x => x.postId !== post.id); // 周期的只收回那一天的勾
  else if (plan) { plan.doneAt = null; plan.postId = null; }
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
// date 有值就挂在那一天（月份跟着日期走），没有就挂在 month 这个月；repeat 有值就是周期待续（开始日取 repeat.start）
export function addPlan(who, text, month, date = null, repeat = null) {
  const t = String(text || "").trim().slice(0, 60);
  if (!t) return null;
  const rep = repeat ? normalizeRepeat(repeat) : null;
  const d = rep ? rep.start : (YMD_RE.test(date || "") ? date : null);
  const p = { id: uid(), month: d ? d.slice(0, 7) : month, date: d, who, text: t, ts: Date.now(), doneAt: null, postId: null };
  if (rep) { p.repeat = rep; p.dones = []; p.stoppedAt = null; }
  ensureMeanwhile().plans.push(p);
  return p;
}
// 改文字、改日期（日期留空 = 挂回这个月，month 是要挂的月份；月和日之间可以互相换）
// 周期待续：repeat 是新的周期，整串一起改，已经勾过的那几天不动；单次的待续给了 repeat 就变成周期的（已经勾过的那次留在它那天）
export function updatePlan(plan, { text, date, month, repeat }) {
  const t = String(text ?? plan.text).trim().slice(0, 60);
  if (!t) return false;
  const m = ensureMeanwhile();
  if (plan.repeat || repeat) {
    const rep = normalizeRepeat(repeat || plan.repeat);
    if (!rep) return false;
    if (!plan.repeat) {
      const post = m.posts.find(x => x.id === plan.postId);
      plan.dones = post ? [{ id: post.date, date: post.date, doneAt: plan.doneAt || post.ts, postId: post.id }] : [];
      plan.doneAt = null; plan.postId = null; plan.stoppedAt = null;
    }
    plan.text = t; plan.repeat = rep; plan.date = rep.start; plan.month = rep.start.slice(0, 7);
    return true;
  }
  plan.text = t;
  const d = YMD_RE.test(date || "") ? date : null;
  plan.date = d;
  plan.month = d ? d.slice(0, 7) : (month || plan.month);
  const post = m.posts.find(x => x.id === plan.postId);
  if (post) post.text = t;
  return true;
}
// 那一天的几点几分（周期待续勾的不是今天，记录也要落在那一天）
const tsOnDay = date => { if (date === todayYmd()) return Date.now(); const n = new Date(), d = parseYmd(date); d.setHours(n.getHours(), n.getMinutes(), n.getSeconds()); return d.getTime(); };
// date 只给周期待续用：每一次单独打勾，只算那一天；返回新留下的那条记录（取消勾返回 null），外面用它弹「配图配字」的小框
export function togglePlan(plan, who = ME, date = todayYmd()) {
  const m = ensureMeanwhile();
  if (plan.repeat) {
    plan.dones ??= [];
    const cur = plan.dones.find(x => x.id === date);
    if (cur) {
      const i = m.posts.findIndex(x => x.id === cur.postId);
      if (i >= 0) { dropPostImgs(m.posts[i]); m.posts.splice(i, 1); }
      plan.dones = plan.dones.filter(x => x !== cur);
      return null;
    }
    const post = addPost(who, { text: plan.text, planId: plan.id, src: "plan", ts: tsOnDay(date) });
    plan.dones.push({ id: date, date, doneAt: Date.now(), postId: post?.id || null });
    return post;
  }
  if (plan.doneAt) {
    const i = m.posts.findIndex(x => x.id === plan.postId);
    if (i >= 0) { dropPostImgs(m.posts[i]); m.posts.splice(i, 1); }
    plan.doneAt = null; plan.postId = null;
    return null;
  }
  const post = addPost(who, { text: plan.text, planId: plan.id, src: "plan" });
  plan.doneAt = Date.now();
  plan.postId = post?.id || null;
  return post;
}
// 停掉（一直重复的）：从明天起不再出现，勾过的记录留着，潮间带里不留新的记录
export function stopPlan(plan) { plan.stoppedAt = todayYmd(); }
// 整件做完了（做完才停的）：同样从明天起不再出现，另外在潮间带当天留一条「整件完成了」（记录挂在 plan.wholePostId 上，删这件待续时一起拿掉）
export function finishWholePlan(plan, who = ME) {
  plan.stoppedAt = todayYmd();
  if (plan.wholePostId && ensureMeanwhile().posts.some(x => x.id === plan.wholePostId)) return null;
  const post = addPost(who, { text: plan.text, planId: plan.id, src: "plan" });
  if (post) { post.whole = true; plan.wholePostId = post.id; }
  return post;
}
export function removePlan(plan) {
  const m = ensureMeanwhile();
  const i = m.plans.indexOf(plan);
  if (i < 0) return;
  m.plans.splice(i, 1);
  const ids = new Set([plan.postId, plan.wholePostId, ...(plan.dones || []).map(x => x.postId)].filter(Boolean));
  for (let k = m.posts.length - 1; k >= 0; k--) if (ids.has(m.posts[k].id)) { dropPostImgs(m.posts[k]); m.posts.splice(k, 1); }
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
// 也可以写周期：[待续:每周三|一件事]、[待续:每天|一件事|持续14天]（前面那段是日期或周期，认不出来就当没写；最后一段是持续几天，可以没有）
export const TIDE_PLAN_RE = lineRe("待续[:：](?:\\s*([^\\]|｜]{1,24}?)\\s*[|｜])?([^\\]|｜]{1,60})(?:[|｜]\\s*([^\\]|｜]{1,12}))?");
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
// 他们写的周期：每天 / 每周三 / 每周一三五 / 每月15号 / 每3天（也认每隔3天）/ 每年12-25（也认12月25日）；加 days（持续几天）或 untilStr（到某天）；认不出来返回 null
const CN_WEEK = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
function parseRepeat(spec, tail) {
  const t = String(spec || "").replace(/\s+/g, "");
  const start = todayYmd();
  let r = null, m;
  if (/^每天$|^天天$|^每日$/.test(t)) r = { type: "daily" };
  else if ((m = t.match(/^每(?:个)?(?:周|星期)([一二三四五六日天、,，和]{1,13})$/))) r = { type: "weekly", wd: [...m[1]].filter(c => c in CN_WEEK).map(c => CN_WEEK[c]) };
  else if ((m = t.match(/^每月(\d{1,2})[号日]?$/))) r = { type: "monthly", dom: Number(m[1]) };
  else if ((m = t.match(/^每(?:隔)?(\d{1,3})天$/))) r = { type: "interval", n: Number(m[1]) };
  else if ((m = t.match(/^每年(\d{1,2})[-月](\d{1,2})[号日]?$/))) r = { type: "yearly", mo: Number(m[1]), day: Number(m[2]) };
  if (!r) return null;
  const days = String(tail || "").match(/持续(\d{1,4})天/);
  return normalizeRepeat({ ...r, start, stop: days ? "until" : "forever", days: days ? Number(days[1]) : 0 });
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
  out = out.replace(TIDE_PLAN_RE, (_, dateStr, body, tail) => {
    const repeat = parseRepeat(dateStr, tail); // 周期写错了就当普通待续，原始标记不露出来
    const date = repeat ? null : planDate(dateStr);
    const month = date ? date.slice(0, 7) : monthOf(todayYmd());
    const t = body.trim();
    const mine = plansOf(month).filter(p => p.who === who);
    const series = recurringPlans().filter(p => p.who === who && planAlive(p)); // 一串周期待续算一件
    if (repeat) {
      if (series.some(p => p.text === t && p.repeat.type === repeat.type) || mine.filter(p => !p.doneAt).length + series.length >= PLAN_MONTH_MAX) return "";
      if (addPlan(who, t, month, null, repeat)) notes.push(`${role.name} 加了一件周期待续（${repeatLabel(repeat)}）：${t.slice(0, 24)}`);
      return "";
    }
    if (mine.some(p => p.text === t && (p.date || null) === date) || mine.filter(p => !p.doneAt).length + series.length >= PLAN_MONTH_MAX) return "";
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
    `回别人贴的：单独一行写 [潮间带回复:序号|一句话]，序号是【此刻】里「潮间带」那一段的 #号；只想轻轻回应，就把一句话换成 爱心 / 摸摸 / 抱抱 / 戳一戳 之一。回复会挂在那条帖子底下成一串，别人回了你的帖子或点了反应，下次会在「别人对你帖子的回应」里列给你（标【新】的是还没看过的），想接着回就用这个写法；别人的帖子和底下的回复串你也看得到，想回哪条都行，不用每条都回。`,
    `这个月想做、还没做的事，可以放进潮汐表月初的「待续」：单独一行写 [待续:一件事]，一句话、30 字以内，会挂在当月；想挂在某一天就写 [待续:12-25|一件事]（月-日，日期和事情之间用 | 隔开，日期里不要用冒号）。要反复做的写周期：[待续:每天|一件事]、[待续:每周三|一件事]、[待续:每月15号|一件事]、[待续:每3天|一件事]、[待续:每年12-25|一件事]，末尾可以加 |持续14天。做完了由她点一下，会在当天留下一条记录（她有时会给这条记录补几句话、几张图，会跟着序号出现在【此刻】里，想回就用上面的 [潮间带回复:序号|一句话]）。别刷，每个月自己挂着的不超过 5 件（一串周期待续算一件）。`,
    `只有单独占一行的才会执行；平时聊到、解释这些指令时，别写出带方括号的完整格式，也不要放进代码块里。`,
  ].join("\n");
}

const plans2 = today => planItemsOn(today).filter(it => it.label && !it.doneAt).slice(0, 6).map(it => `${whoInfo(it.who).name}：${it.text.slice(0, 20)}（${it.label}）`);
// 别人对 role 自己帖子的回复和反应：{ post, items: [{ ts, who, text|react, fresh }] }，只看最近 7 天里的帖子，fresh = 这个 AI 还没看过
// 已读记在 m.aiSeen[role.id]（一个时间点），两个 AI 各记各的；她没叫醒 AI，只是下次带上
const RESP_DAYS = 7;
function responsesTo(role) {
  const m = ensureMeanwhile();
  const seen = m.aiSeen[role.id] || 0;
  const since = Date.now() - RESP_DAYS * 86400_000;
  const out = [];
  for (const p of m.posts) {
    if (p.who !== role.id || p.ts < since) continue;
    const items = [
      ...p.replies.filter(r => r.who !== role.id).map(r => ({ ts: r.ts, who: r.who, text: r.text })),
      ...p.reacts.filter(r => r.who !== role.id).map(r => ({ ts: r.ts, who: r.who, react: REACTS.find(x => x.kind === r.kind)?.name || r.kind })),
    ].sort((a, b) => a.ts - b.ts).map(i => ({ ...i, fresh: i.ts > seen }));
    if (items.some(i => i.fresh)) out.push({ post: p, items });
  }
  return out.sort((a, b) => a.post.n - b.post.n).slice(-4);
}
// 带过一次就算看过（预览不算）：只收「这次带出去的」那一刻之前的
const markTideRead = role => { ensureMeanwhile().aiSeen[role.id] = Date.now(); };

// 附在【此刻】里的：别人对你帖子的新回应、最近三个人贴的帖子和底下的回复串、今天大家的水温
// opt.peek 只看看不算「看过」；opt.tideMark 即使 peek 也算（小房间那种真的发出去的）
export function tideMoment(role, opt = {}) {
  const m = ensureMeanwhile();
  const since = Date.now() - 2 * 86400_000;
  const nameOf = w => (w === role.id ? "你" : whoInfo(w).name);
  const lines = [];
  const today = todayYmd();
  const moods = whoList().map(w => [w, moodOf(w, today)]).filter(([, x]) => x);
  if (moods.length) lines.push(`今天的水温：${moods.map(([w, x]) => `${nameOf(w)}${moodByKey(x.key)?.name}${x.text ? `（${x.text}）` : ""}`).join("；")}`);
  const plans = plansOf(monthOf(today)).filter(p => !p.doneAt).slice(-6);
  if (plans.length) lines.push(`这个月的待续（还没做）：${plans.map(p => `${nameOf(p.who)}：${p.date ? `${Number(p.date.slice(5, 7))}/${Number(p.date.slice(8))} ` : ""}${p.text.slice(0, 20)}`).join("；")}`);
  const today2 = plans2(today);
  if (today2.length) lines.push(`今天要做的周期待续：${today2.join("；")}`);
  const resp = responsesTo(role);
  if (resp.length) {
    lines.push(`别人对你帖子的回应（标「新」的是你还没看过的；想接着回就用 [潮间带回复:序号|一句话]）：`);
    for (const { post, items } of resp) {
      lines.push(`- 你的 #${post.n}「${post.text.replace(/\s+/g, " ").slice(0, 24)}」：${items.slice(-5).map(i => `${i.fresh ? "【新】" : ""}${nameOf(i.who)}（${stamp(i.ts)}）${i.react ? `点了${i.react}` : `回：${i.text.slice(0, 60)}`}`).join("；")}`);
    }
  }
  // 最近有动静的帖子（贴出来、补图字、有人回或点了反应），带上底下最后几条回复和反应
  const active = p => Math.max(p.ts, p.editedAt || 0, ...p.replies.map(r => r.ts), ...p.reacts.map(r => r.ts));
  const recent = m.posts.filter(p => active(p) > since && (p.src !== "plan" || p.note || imgsOf(p).length || p.replies.length || p.reacts.length)).sort((a, b) => active(a) - active(b)).slice(-6);
  for (const p of recent) {
    const n = imgsOf(p).length;
    const st = p.status ? `【${STATUSES.find(s => s.kind === p.status.kind)?.name || ""}${p.status.text ? " " + p.status.text : ""}】` : "";
    const seen = m.aiSeen[role.id] || 0;
    const rs = p.replies.slice(-3).map(r => `${r.ts > seen && r.who !== role.id ? "【新】" : ""}${nameOf(r.who)}（${stamp(r.ts)}）回：${r.text.slice(0, 40)}`).join("；");
    const rc = REACTS.map(x => [x.name, p.reacts.filter(r => r.kind === x.kind).map(r => nameOf(r.who))]).filter(([, w]) => w.length).map(([name, w]) => `${w.join("、")}点了${name}`).join("，");
    lines.push(`#${p.n} ${nameOf(p.who)}（${stamp(p.ts)}）${st}${p.planId ? `${p.whole ? "整件做完了" : "待续打卡"}：` : ""}${p.text.replace(/\s+/g, " ").slice(0, 80)}${p.note ? `——${p.note.replace(/\s+/g, " ").slice(0, 200)}` : ""}${n ? `［附 ${n} 张图］` : ""}${rs ? `——${rs}` : ""}${rc ? `（${rc}）` : ""}`);
  }
  if (!lines.length) return "";
  if (resp.length && (!opt.peek || opt.tideMark)) markTideRead(role);
  return lines.join("\n");
}

// 主聊天里：最近 3 小时别人贴（或补）的图，最多 4 张，跟在【此刻】后面给他看（醒来的房间只能带文字）
export async function tideImageParts(role) {
  const since = Date.now() - 3 * 3600_000;
  const posts = ensureMeanwhile().posts.filter(p => p.who !== role.id && Math.max(p.ts, p.editedAt || 0) > since && imgsOf(p).length).sort((a, b) => b.ts - a.ts);
  const parts = [];
  let left = 4;
  for (const p of posts) {
    if (left <= 0) break;
    const ids = imgsOf(p).slice(0, left);
    const got = [];
    for (const id of ids) { try { const { data, mime } = await imageBase64(id); got.push({ type: "image", data, mime }); } catch { /* 图还没同步过来就先不带 */ } }
    if (!got.length) continue;
    parts.push({ type: "text", text: `（潮间带 #${p.n} 附的图：）` }, ...got);
    left -= got.length;
  }
  return parts;
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
