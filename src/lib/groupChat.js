// 群聊：小续、小章鱼（chatgpt）、小螃蟹（CC）三个人的第三个主聊天。
// 对话是 store.threads 里一个固定 id（GROUP_TID）的 thread（group: true），一条回复就是一次普通的 generate，只是多带一个 speaker（这条由谁说）。
// 这里管三件事：
//   1. 一轮怎么轮流（runGroupRound）：谁先、后说的看得到前面刚说的、两个 AI 之间最多再接一两句就停（硬上限）
//   2. 群里的话怎么并进两个人各自主聊天的时间轴（withGroupLines / groupRowsFor）：不复制消息，每次要用的时候按时间排进去，标「群聊」
//   3. 停下（stopGroup）
import { reactive } from "vue";
import { store, roleById, loadMessages, MAIN, CRAB, GROUP_TID } from "../store/index.js";
import { generate, generating, pathOf, splitBubbles, visibleText, findCmd, meName } from "./chat.js";
import { ROOT } from "./tree.js";

// 进群时带多少句：最近这么多句原样带，更早的整理进群摘要
export const GROUP_TAIL = 24;
// 小续说一句，最多回这么多条：两个人各一条，加上最多再接两句。这是硬上限，到了就停，等小续说话
export const GROUP_MAX = 4;
// 一条回复最后单独一行写 [接话]：想听对方再接一句
export const GROUP_MORE_RE = /\[接话\]/;

export const groupThread = () => store.threads.find(t => t.id === GROUP_TID);

// threadId -> { stop }：正在轮着说话
export const groupRuns = reactive({});

export async function stopGroup(thread) {
  const run = groupRuns[thread.id];
  if (!run) return;
  run.stop = true;
  generating[thread.id]?.abort();
  while (groupRuns[thread.id]) await new Promise(r => setTimeout(r, 50));
}

// 她这句话里点名了谁：谁的名字先出现，谁先说（名字、常见叫法都认；cc 要单独成词，免得认进别的单词）
const NICKS = { [MAIN]: ["章鱼", "chatgpt", "gpt"], [CRAB]: ["螃蟹", "claude"] };
function mentionedFirst(text, members) {
  const t = String(text || "").toLowerCase();
  let best = null;
  for (const r of members) {
    const keys = [r.name, ...(NICKS[r.id] || [])].filter(Boolean).map(k => k.toLowerCase());
    const hits = keys.map(k => t.indexOf(k));
    if (r.id === CRAB) hits.push(t.search(/(^|[^a-z])cc(?![a-z])/) >= 0 ? t.search(/(^|[^a-z])cc(?![a-z])/) : -1);
    const at = Math.min(...hits.filter(i => i >= 0), Infinity);
    if (at < Infinity && (!best || at < best.at)) best = { r, at };
  }
  return best?.r || null;
}

// 开一整轮：她说了一句（parentId 是接在哪条后面，不传就是最后一条），两个人轮流回
export async function runGroupRound(thread, parentId) {
  if (groupRuns[thread.id] || generating[thread.id]) return null;
  const run = groupRuns[thread.id] = { stop: false };
  try {
    const all = await loadMessages(thread.id);
    let history = pathOf(thread, all);
    if (parentId !== undefined) {
      const i = history.findIndex(m => m.id === parentId);
      history = i >= 0 ? history.slice(0, i + 1) : parentId === ROOT ? [] : history;
    }
    const members = [MAIN, CRAB].map(roleById).filter(Boolean);
    if (!members.length) return null;
    // 谁先：她点名了就点名的先；没点名就轮着来，每轮换一个
    const trigger = [...history].reverse().find(m => m.from === "user" && !m.poke);
    const first = mentionedFirst(trigger?.text, members) || members.find(r => r.id === store.group.nextFirst) || members[0];
    const order = [first, ...members.filter(r => r !== first)];
    store.group.nextFirst = (order[1] || first).id;

    let from = history.length ? history[history.length - 1].id : ROOT;
    let last = null; // 上一条有话的回复
    let extra = 0;
    for (let n = 0; n < GROUP_MAX; n++) {
      let speaker;
      if (n < order.length) speaker = order[n];
      else {
        // 两个人都说过了：只有上一位写了 [接话]，才让另一位再接一句；硬上限 GROUP_MAX
        if (!last || !findCmd(last.text, GROUP_MORE_RE)) break;
        speaker = members.find(r => r.id !== last.who);
        if (!speaker) break;
        extra++;
      }
      const msg = await generate(thread, from, { speaker });
      if (run.stop || !msg || msg.error) break;
      if (!msg.text) { if (n >= order.length) break; continue; } // 这位没话要说（[不说话]），下一位接着
      from = msg.id;
      last = msg;
    }
    return last;
  } finally {
    delete groupRuns[thread.id];
  }
}

// ---------- 群里的话 → 两个人各自主聊天的时间轴 ----------
// 群里说过的话（ts 在 (from, to] 里的）：[{ ts, who, name, text }]。最近的最多 40 句
export async function groupRowsFor(role, from, to) {
  const gt = groupThread();
  if (!gt) return [];
  const list = pathOf(gt, await loadMessages(gt.id)).filter(m => m.from !== "event" && !m.pending && !m.error && m.ts > from && m.ts <= to);
  const me = meName(role);
  return list.map(m => ({
    ts: m.ts,
    who: m.from === "user" ? "user" : m.who,
    name: m.from === "user" ? me : roleById(m.who)?.name || "?",
    text: (m.from === "user" ? m.text || (m.attachments?.length ? "[图片/文件]" : "") : splitBubbles(visibleText(m.text)).join(" ")).slice(0, 300),
  })).filter(r => r.text).slice(-40);
}

// 主聊天要给 AI 看的聊天记录：把群里的话按时间排进去，连着的几句并成一条（不是在这条私聊里说的，开头写明）。
// 只给小章鱼和小螃蟹；从上一段摘要管到的地方往后，到这段记录最后一条为止
export async function withGroupLines(role, thread, history) {
  if (!history.length || (role.id !== MAIN && role.id !== CRAB)) return history;
  const to = history[history.length - 1].ts;
  const from = thread.summary?.lastSpan?.[1] || history[0].ts - 12 * 3600_000;
  const rows = await groupRowsFor(role, from, to);
  if (!rows.length) return history;
  const items = [...history.map(m => ({ ts: m.ts, m })), ...rows.map(r => ({ ts: r.ts, row: r }))]
    .map((x, i) => [x, i]).sort((a, b) => a[0].ts - b[0].ts || a[1] - b[1]).map(x => x[0]);
  const out = [];
  for (let i = 0; i < items.length; ) {
    if (items[i].m) { out.push(items[i].m); i++; continue; }
    let j = i;
    while (j < items.length && items[j].row) j++;
    const run = items.slice(i, j).map(x => x.row);
    out.push({
      id: `grp:${run[0].ts}`, from: "user", groupLines: true, ts: run[run.length - 1].ts,
      text: `（群聊「${store.group.name}」里说的话，是在群里说的，不是在这条私聊里说的：\n${run.map(r => `${r.who === role.id ? "你" : r.name}：${r.text}`).join("\n")}\n）`,
    });
    i = j;
  }
  return out;
}
