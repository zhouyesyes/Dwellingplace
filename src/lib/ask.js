// 提问选项卡：AI 真需要她拍板时，在回复里带一张卡，显示在那条消息底下（像官方 Claude Code 的提问）。
//   写法（单独一行，一次最多一张）：[提问:问题|单选|选项=说明|选项=说明;;问题|多选|选项=说明|选项=说明|选项=说明]
//   题之间用 ;;，一题里用 | 隔开：问题、单选或多选、然后 2～4 个选项；选项是「短名字=一行小字说明」
//   最多 4 道题；每题最后的「其他…」是界面自己加的，不用写
//   解析出来存在消息上 msg.ask = { qs: [{ q, multi, opts: [{ n, d }] }], done?: { picks, others, text } }，原始标记从文字里去掉
//   她答完点「好了」，作为一条她发的消息发出（一题一行「问题：选的」，多选用顿号），msg.ask.done 记下选了什么，卡片变淡、不能再点
export const ASK_RE = /\[提问[:：]([^\]\n]{1,1500})\]/g;
export const ASK_MAX_Q = 4;

export function parseAsk(inner) {
  const qs = [];
  for (const seg of String(inner).split(/[;；]{2}/)) {
    const [q, kind, ...rest] = seg.split(/[|｜]/).map(s => s.trim());
    if (!q || !/^(单选|多选)$/.test(kind || "")) return null;
    const opts = rest.filter(Boolean).map(o => { const i = o.search(/[=＝]/); return i < 0 ? { n: o, d: "" } : { n: o.slice(0, i).trim(), d: o.slice(i + 1).trim() }; }).filter(o => o.n);
    if (opts.length < 2 || opts.length > 4) return null;
    qs.push({ q, multi: kind === "多选", opts });
  }
  return qs.length && qs.length <= ASK_MAX_Q ? { qs } : null;
}

// 回复里的提问标记：去掉；能解析、而且是聊天里的回复（不是醒来），就挂到消息上。解析不了的悄悄丢掉，不露原始标记
export function applyAskTags(msg) {
  let found = null;
  msg.text = String(msg.text || "").replace(ASK_RE, (_, inner) => { found ??= parseAsk(inner); return ""; }).replace(/\n{3,}/g, "\n\n").trim();
  if (found && msg.id && !msg.wakeId) msg.ask = found;
}

// 作为一条消息发出去的字：一题一行
export function askAnswerText(ask, picks, others) {
  return ask.qs.map((q, i) => {
    const chosen = [...(picks[i] || []).sort((a, b) => a - b).map(k => q.opts[k].n), ...(others[i]?.trim() ? [others[i].trim()] : [])];
    return `${q.q}：${chosen.join("、")}`;
  }).join("\n");
}

export const askForAI = who => [
  `\n# 提问选项卡`,
  `遇到真的需要${who}拍板的事（几条路里选哪条、要不要这样改），可以在回复里带一张选项卡，会显示在那条消息底下。闲聊、随口问的、自己能定的小事不要出卡；一次回复最多一张；写信和醒来时不要出。`,
  `写法（单独一行）：[提问:问题|单选|选项=一行说明|选项=一行说明;;问题|多选|选项=一行说明|选项=一行说明|选项=一行说明]`,
  `一张卡可以有 1～4 道题，题之间用 ;;；每题写：问题、单选或多选（你来定，几个答案能同时成立就多选）、2～4 个选项，选项是「短名字=一行说明」。不用写「其他」，卡片会自带。名字和说明里别用 | ; = 和方括号。`,
  `出卡时正文里先用一两句说清为什么问。${who}选完会作为一条消息发回来，一题一行，如「贝壳：先拿掉留位置」，多选用顿号连着。`,
  `平时聊到、解释这个功能时，别写出带方括号的完整格式（说「提问卡」就好）。`,
].join("\n");
