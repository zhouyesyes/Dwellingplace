// 聊天、共写讨论每次带多少原文：按 token 算（粗估），不按条数——一条「嗯」和一条长信不一样长
//   聊天：摘要后面的原文最多 historyTokens（默认 5 万），到八成就整理，留最近一半
//   共写讨论：writeTokens（默认 3 万），一样到八成整理
//   共读、共写里带的主聊天：最近 sceneChatTokens（默认 6 千）
// 摘要每整理、改动、退回一次，旧的那份都留一个版本（最多 30 个），整理坏了可以退回去
import { store } from "../store/index.js";

// 粗估 token 数：中日韩文字大约一个字一个，其他大约 3.5 个字符一个（只用来看比例，不是计费数）
export function estTokens(text) {
  const t = String(text || "");
  const cjk = (t.match(/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/g) || []).length;
  return Math.round(cjk + (t.length - cjk) / 3.5);
}
export const msgTokens = m => estTokens(m?.text) + ((m?.attachments || m?.atts)?.length || 0) * 200 + 4;
export const sumTokens = list => list.reduce((a, m) => a + msgTokens(m), 0);

export const AUTO = 0.8; // 到上限的八成就整理
export const chatTokens = () => Math.max(2000, Number(store.settings.historyTokens) || 50000);
export const writeTokens = () => Math.max(2000, Number(store.settings.writeTokens) || 30000);
export const sceneChatTokens = () => Math.max(500, Number(store.settings.sceneChatTokens) || 6000);

// 从后往前数，凑够 budget 的那段从第几条开始（最后一条再长也带上）
export function tailFrom(list, budget) {
  let n = 0, i = list.length;
  while (i > 0) {
    const t = msgTokens(list[i - 1]);
    if (i < list.length && n + t > budget) break;
    n += t;
    i--;
  }
  return i;
}
export const tail = (list, budget) => list.slice(tailFrom(list, budget));
// 整理时留着不动的条数：最近一半上限那么多
export const keepCount = (list, budget) => list.length - tailFrom(list, budget / 2);

export function fmtTok(n) {
  n = Math.round(n || 0);
  if (n >= 10000) return `${+(n / 10000).toFixed(1)} 万`;
  if (n >= 1000) return `${+(n / 1000).toFixed(1)} 千`;
  return String(n);
}

// ---------- 摘要的版本 ----------
// owner[key] 是现在那份（thread.summary、p.talkSum），旧的存在 owner[key + "Vers"]，新的在后面
const VER_MAX = 30;
export function snapshotSum(owner, key) {
  const s = owner?.[key];
  if (!s?.text) return;
  const vers = (owner[key + "Vers"] ??= []);
  const last = vers[vers.length - 1];
  if (last && last.text === s.text && last.upTo === s.upTo) return;
  vers.push({ ...JSON.parse(JSON.stringify(s)), savedAt: Date.now() });
  if (vers.length > VER_MAX) vers.splice(0, vers.length - VER_MAX);
}
export function restoreSum(owner, key, v) {
  snapshotSum(owner, key);
  const { savedAt, ...rest } = v;
  owner[key] = { ...rest, restoredFrom: rest.at || savedAt, restoredAt: Date.now() };
}
