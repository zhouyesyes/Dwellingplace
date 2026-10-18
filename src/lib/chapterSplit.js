// TXT 分章：一行行看，哪些是章节标题。
//   第一章 / 第1章 / 第十二回 / Chapter 3：一看就是标题
//   序章、楔子、尾声、番外、后记……：短短一行、没有逗号句号，也算
//   纯数字（1 2 3）、中文数字（一 二 三）、字母加数字（if1 if2）：要接得上号（上一个是 2，这个才认 3），
//     而且离上一个标题要隔开一段正文——正文里单独一个「3」、列表里的「1. 2. 3.」不会被当成一章
// 规则可以换（导入前预览、目录里「换一种规则重新分」都用这里）：
//   auto 都认 · numbered 只认「第X章」· digits 纯数字 · cn 中文数字 · prefix 字母加数字 · none 不分章，每 60 段一节
// 不管哪种规则，序章、番外这些都认（none 除外）。返回的每一章记着标题是第几行、正文是哪几行，挪笔记用
export const SPLIT_RULES = { auto: "自动", numbered: "第X章", digits: "纯数字", cn: "中文数字", prefix: "字母+数字", none: "不分章" };

const CN = "零〇一二两三四五六七八九十百千万";
const NUMBERED = new RegExp(`^(第[${CN}0-9０-９]+[章回节卷集部篇幕话])([\\s:：·、.．\\-—_]*.{0,30})$|^(chapter|CHAPTER|Chapter)\\s*\\d+.{0,40}$`);
const SPECIAL = /^(序章|序言|序|楔子|引子|前言|尾声|终章|后记|番外|附录|完结感言|作者的话)([\s:：·、.．\-—_]*[\d一二三四五六七八九十]{0,4}[\s:：·、.．\-—_]*.{0,24})$/;
const DIGITS = /^([0-9０-９]{1,4})(?:[\s.．、:：\-—_]+(.{0,30}))?$/;
const CNNUM = new RegExp(`^([${CN}]{1,6})(?:[\\s.．、:：\\-—_]+(.{0,30}))?$`);
const PREFIX = /^([A-Za-z]{1,10})\s*[-_.．]?\s*([0-9]{1,4})(?:[\s:：·\-—_]+(.{0,30}))?$/;
const SENTENCE = /[，,。；;！!？?]/; // 标题中间一般不带这些（末尾带个句号也不行，免得把对话当标题）

const half = s => s.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
function cnValue(s) {
  const d = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0, cur = 0;
  for (const ch of s) {
    if (ch in d) cur = d[ch];
    else if (ch === "十") { total += (cur || 1) * 10; cur = 0; }
    else if (ch === "百") { total += (cur || 1) * 100; cur = 0; }
    else if (ch === "千") { total += (cur || 1) * 1000; cur = 0; }
    else return NaN;
  }
  return total + cur;
}

// 一行可能是哪种标题：{ kind, series, value }
function candidate(line) {
  if (line.length > 40) return null;
  if (NUMBERED.test(line) && !SENTENCE.test(line.slice(0, -1))) return { kind: "numbered" };
  if (line.length <= 30 && SPECIAL.test(line) && !SENTENCE.test(line)) return { kind: "special" };
  if (SENTENCE.test(line)) return null;
  let m = line.match(DIGITS);
  if (m) return { kind: "digits", series: "#", value: Number(half(m[1])) };
  m = line.match(CNNUM);
  if (m && !Number.isNaN(cnValue(m[1]))) return { kind: "cn", series: "#cn", value: cnValue(m[1]) };
  m = line.match(PREFIX);
  if (m) return { kind: "prefix", series: m[1].toLowerCase(), value: Number(m[2]) };
  return null;
}

const GAP = 80; // 接号的标题之间至少隔这么多字正文
// 认出哪些行是标题：返回 Set（行号）
export function headingLines(lines, rule = "auto") {
  const heads = new Set();
  if (rule === "none") return heads;
  const want = k => k === "special" || rule === "auto" || rule === k;
  const last = {}; // 每个系列：上一个认下的号、它之后攒了多少字
  const picked = {}; // 每个系列认下的行（攒够两个才算数）
  let numbered = 0;
  for (let i = 0; i < lines.length; i++) {
    const c = candidate(lines[i]);
    for (const s of Object.values(last)) s.chars += lines[i].length;
    if (!c || !want(c.kind)) continue;
    if (c.kind === "numbered" || c.kind === "special") { heads.add(i); if (c.kind === "numbered") numbered++; continue; }
    const s = last[c.series];
    const fresh = !s && c.value <= 1;
    const next = s && c.value === s.value + 1 && s.chars - lines[i].length >= GAP;
    if (!fresh && !next) continue;
    last[c.series] = { value: c.value, chars: 0 };
    (picked[c.series] ??= []).push(i);
  }
  // 一个系列只认到一个（单独一个「1」）不算；书里已经有很多「第X章」时，数字系列要更多才算
  for (const list of Object.values(picked)) if (list.length >= (numbered >= 3 ? 3 : 2)) for (const i of list) heads.add(i);
  return heads;
}

// 分章：[{ title, head（标题行号，没有就是 -1）, lines（正文行号）}]
export function splitLines(lines, rule = "auto", fallbackTitle = "开头") {
  const heads = headingLines(lines, rule);
  let chapters = [];
  let cur = { title: fallbackTitle, head: -1, lines: [] };
  for (let i = 0; i < lines.length; i++) {
    if (heads.has(i)) {
      if (cur.lines.length || chapters.length || cur.head >= 0) chapters.push(cur);
      cur = { title: lines[i], head: i, lines: [] };
    } else cur.lines.push(i);
  }
  chapters.push(cur);
  // 「第一卷」后面紧跟「第一章」：卷名并进下一章的标题，不单独占一章
  for (let k = chapters.length - 2; k >= 0; k--) {
    if (!chapters[k].lines.length && chapters[k].head >= 0) {
      chapters[k + 1].title = `${chapters[k].title} · ${chapters[k + 1].title}`.slice(0, 60);
      chapters[k + 1].heads = [chapters[k].head, ...(chapters[k].heads || []), ...(chapters[k + 1].heads || [chapters[k + 1].head])];
      chapters.splice(k, 1);
    }
  }
  // 第一章前面只有书名、作者这一两行：不算一章
  if (chapters.length > 1 && chapters[0].head < 0 && chapters[0].lines.reduce((a, i) => a + lines[i].length, 0) < 60) chapters.shift();
  // 一章都没认出来、又很长：每 60 段切一节
  if (chapters.length === 1 && chapters[0].lines.length > 120) {
    const all = chapters[0].lines;
    chapters = [];
    for (let i = 0; i < all.length; i += 60) chapters.push({ title: `第 ${chapters.length + 1} 节`, head: -1, lines: all.slice(i, i + 60) });
  }
  return chapters;
}
