// 翻记忆用的排序：两路一起找，再合起来
//   精确：所有关键词都原样出现（几个词用空格隔开）——准，但换个说法就找不到
//   BM25：把字拆成两两相连的小块（中文）、单词（英文），算「这几个字在这条里出现得多不多、在别处稀不稀罕」——能找到说法不完全一样的
//   合并用 RRF（倒数排名融合）：不比两种分数谁大，只看同一条在两边各排第几，两边都靠前的排最前；再按常驻、重要、新近稍微加一点分
// 先按「范围」「时间」划好去哪找（过滤），再排。几千条聊天在手机上也就几十毫秒，不用另外建索引
// 以后要加向量搜索，就是在这里多一路排名，一起放进 RRF

// 拆词：英文/数字按单词，中文按两两相连的字（一个字的就单独算）
const cache = new WeakMap();
export function toks(text) {
  const t = String(text || "").toLowerCase();
  const out = [];
  for (const [w] of t.matchAll(/[a-z0-9]+|[\u3400-\u9fff\uf900-\ufaff]+/g)) {
    if (/^[a-z0-9]/.test(w)) { if (w.length > 1 || /\d/.test(w)) out.push(w); }
    else if (w.length === 1) out.push(w);
    else for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2));
  }
  return out;
}
const docToks = d => {
  const hit = cache.get(d);
  if (hit && hit.text === d.text) return hit.toks;
  const tk = toks(d.text);
  cache.set(d, { text: d.text, toks: tk });
  return tk;
};
export const terms = q => String(q || "").toLowerCase().split(/\s+/).filter(Boolean);

export function exactRank(docs, q) {
  const ts = terms(q);
  if (!ts.length) return [];
  return docs.filter(d => { const t = d.text.toLowerCase(); return ts.every(w => t.includes(w)); }).sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

export function bm25Rank(docs, q, { k1 = 1.2, b = 0.75 } = {}) {
  const qt = [...new Set(toks(q))];
  if (!qt.length || !docs.length) return [];
  const lens = docs.map(d => docToks(d).length);
  const avg = lens.reduce((a, n) => a + n, 0) / docs.length || 1;
  const df = Object.fromEntries(qt.map(w => [w, 0]));
  const tfs = docs.map(d => {
    const tf = {};
    for (const w of docToks(d)) if (w in df) tf[w] = (tf[w] || 0) + 1;
    for (const w in tf) df[w]++;
    return tf;
  });
  // 哪儿都没出现过的小块（比如「嘴巴溃疡」里的「巴溃」）不算数
  const present = qt.filter(w => df[w] > 0).length;
  if (!present) return [];
  const idf = Object.fromEntries(qt.map(w => [w, Math.log(1 + (docs.length - df[w] + 0.5) / (df[w] + 0.5))]));
  const scored = [];
  docs.forEach((d, i) => {
    const tf = tfs[i];
    let s = 0, matched = 0;
    for (const w of qt) {
      const f = tf[w];
      if (!f) continue;
      matched++;
      s += idf[w] * (f * (k1 + 1)) / (f + k1 * (1 - b + b * lens[i] / avg));
    }
    // 只沾上一两个字的不算：找得到的那些小块里，至少一半要对上
    if (s > 0 && matched >= Math.max(1, Math.ceil(present / 2))) scored.push({ d, s });
  });
  return scored.sort((a, b) => b.s - a.s).map(x => x.d);
}

// 合并：每一路里排第 r 名，得 1 / (60 + r)；再加一点点：常驻、重要、最近一个月，已过时的减一点
export function fuse(lists, { k = 60, now = Date.now() } = {}) {
  const score = new Map();
  for (const list of lists) list.forEach((d, r) => score.set(d, (score.get(d) || 0) + 1 / (k + r + 1)));
  for (const [d, s] of score) {
    let x = s;
    if (d.pinned) x += 0.004;
    if (d.importance >= 3) x += 0.003;
    if (d.ts && now - d.ts < 30 * 86400_000) x += 0.002;
    if (d.obsolete) x -= 0.003;
    score.set(d, x);
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
}

// ---------- 范围和时间 ----------
export const KINDS = { chat: "聊天", read: "共读批注", write: "共写讨论", letter: "信", card: "记忆卡片", sum: "摘要" };
const KIND_WORDS = [
  [/聊天|对话|说过/, ["chat"]], [/共读|读书|批注|划线|便利贴/, ["read"]], [/共写|写书|讨论/, ["write"]],
  [/信/, ["letter"]], [/邮箱|邮件/, ["chat"]], [/卡片|记忆卡/, ["card"]], [/摘要/, ["sum"]],
];
export function parseKinds(s) {
  const t = String(s || "").trim();
  if (!t || /全部|所有|都/.test(t)) return null;
  const out = new Set();
  for (const [re, ks] of KIND_WORDS) if (re.test(t)) ks.forEach(k => out.add(k));
  return out.size ? out : null;
}
const DAY = 86400_000;
const startOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const NUM = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5 };
const num = s => (/^\d+$/.test(s) ? Number(s) : NUM[s] ?? (s === "十一" ? 11 : s === "十二" ? 12 : 1));
// 时间：今天、昨天、前天、最近 N 天/周/个月、这周、上周、这个月、上个月、2026-10、2026-10-03、10月、10月3日、a~b
export function parseWhen(s, now = new Date()) {
  const t = String(s || "").replace(/\s+/g, "");
  if (!t) return null;
  const today = startOf(now);
  if (/今天/.test(t)) return [today, today + DAY];
  if (/昨天/.test(t)) return [today - DAY, today];
  if (/前天/.test(t)) return [today - 2 * DAY, today - DAY];
  let m = t.match(/最近([\d一两二三四五六七八九十半]+)?(天|日|周|星期|礼拜|个?月|年)/);
  if (m) {
    const n = m[1] ? num(m[1]) : 1;
    const span = /天|日/.test(m[2]) ? DAY : /周|星期|礼拜/.test(m[2]) ? 7 * DAY : /月/.test(m[2]) ? 30 * DAY : 365 * DAY;
    return [now.getTime() - n * span, now.getTime() + 1];
  }
  const dow = (now.getDay() + 6) % 7; // 周一是 0
  if (/这周|本周/.test(t)) return [today - dow * DAY, today + DAY];
  if (/上周/.test(t)) return [today - (dow + 7) * DAY, today - dow * DAY];
  if (/这个月|本月/.test(t)) return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), today + DAY];
  if (/上个月/.test(t)) return [new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(), new Date(now.getFullYear(), now.getMonth(), 1).getTime()];
  const range = t.split(/[~～至到]/);
  if (range.length === 2) {
    const a = parseWhen(range[0], now), b = parseWhen(range[1], now);
    if (a && b) return [a[0], b[1]];
  }
  m = t.match(/^(\d{4})[-./年](\d{1,2})(?:[-./月](\d{1,2})日?)?月?$/);
  if (m) {
    const y = +m[1], mo = +m[2] - 1;
    return m[3] ? [new Date(y, mo, +m[3]).getTime(), new Date(y, mo, +m[3] + 1).getTime()] : [new Date(y, mo, 1).getTime(), new Date(y, mo + 1, 1).getTime()];
  }
  m = t.match(/^([\d一二三四五六七八九十]+)月(?:([\d]+)[日号])?$/);
  if (m) {
    const mo = num(m[1]) - 1;
    const y = mo > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear(); // 说「11 月」而现在是 10 月：去年的
    return m[2] ? [new Date(y, mo, +m[2]).getTime(), new Date(y, mo, +m[2] + 1).getTime()] : [new Date(y, mo, 1).getTime(), new Date(y, mo + 1, 1).getTime()];
  }
  return null;
}
