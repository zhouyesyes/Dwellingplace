// 额度和每轮花了多少：每一轮回复请求了几次、多少 tokens；会员额度的话，再看这一轮前后 OpenAI 报的百分比变了多少
import { store } from "../store/index.js";
import { isPlan } from "./providers.js";

const planBase = a => String(a.baseUrl).trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
export async function planStatus(a) {
  const r = await fetch(planBase(a) + "/status", { cache: "no-store" });
  const st = await r.json();
  if (!r.ok) throw new Error(st.error?.message || `返回 ${r.status}`);
  return st;
}

// OpenAI 回复时带的额度（流里的事件或响应头）：认得出百分比的列出来 [{ label, used, secs }]
export function planPercents(limits) {
  const h = limits?.headers || {};
  const out = [];
  // 流里的额度事件：找带 used_percent 的（primary 一般是 5 小时，secondary 是每周）
  for (const raw of Object.values(limits?.events || {})) {
    let ev; try { ev = JSON.parse(raw); } catch { continue; }
    const walk = (o, name) => {
      if (!o || typeof o !== "object") return;
      if (o.used_percent != null) {
        const mins = Number(o.window_minutes);
        const label = mins ? (mins <= 600 ? `${Math.round(mins / 60)} 小时` : mins >= 7 * 1440 - 60 ? "每周" : `${Math.round(mins / 1440)} 天`) : /primary/i.test(name) ? "5 小时" : /secondary/i.test(name) ? "每周" : name;
        const secs = Number(o.resets_in_seconds ?? o.reset_after_seconds ?? (o.resets_at ? o.resets_at - Date.now() / 1000 : NaN));
        out.push({ label, used: Math.max(0, Math.min(100, Number(o.used_percent))), secs });
        return;
      }
      for (const [k, v] of Object.entries(o)) walk(v, k);
    };
    walk(ev, "");
  }
  if (out.length) return out;
  for (const [k, v] of Object.entries(h)) {
    if (!/percent/i.test(k)) continue;
    const used = Math.max(0, Math.min(100, Number(v)));
    if (!Number.isFinite(used)) continue;
    const label = /primary|5h|hour/i.test(k) ? "5 小时" : /secondary|week/i.test(k) ? "每周" : k;
    const resetKey = Object.keys(h).find(x => /reset/i.test(x) && x.replace(/reset.*$/i, "") === k.replace(/used.*$|percent.*$/i, ""));
    const secs = resetKey ? Number(h[resetKey]) : NaN;
    out.push({ label, used, secs: secs < 30 * 86400 ? secs : NaN });
  }
  return out;
}

// 会员额度快用完了（上一次看到的任何一档到了 90%）：这时候不续发，一次回完
export const planLow = api => !!(api && isPlan(api) && store.planSnap?.[api.id]?.list?.some(p => p.used >= 90));

// 记一轮：请求了几次（用工具、翻记忆、续发都要再请求一次）、输入输出多少；最近 60 轮
export function logTurn(api, model, msg) {
  if (!api) return;
  const u = msg.usage || {};
  const e = { ts: Date.now(), apiId: api.id, model, rounds: msg.rounds || 1, sends: msg.sends || 0, input: u.input || 0, output: u.output || 0, cached: u.cached || 0 };
  const list = (store.turnLog ??= []);
  list.push(e);
  if (list.length > 60) list.splice(0, list.length - 60);
  if (isPlan(api)) notePlan(api, list[list.length - 1]);
}
// 会员额度：这一轮之后再看一眼百分比，和上一次比，就知道这一轮大概用掉了多少
async function notePlan(api, e) {
  try {
    const st = await planStatus(api);
    const now = planPercents(st.limits);
    if (!now.length) return;
    const prev = store.planSnap?.[api.id];
    e.plan = now.map(p => {
      const old = prev?.list?.find(x => x.label === p.label);
      const d = old ? +(p.used - old.used).toFixed(2) : null;
      return { label: p.label, used: p.used, d: d != null && d >= 0 ? d : null }; // 变小了是窗口重置了，不算
    });
    (store.planSnap ??= {})[api.id] = { at: Date.now(), list: now.map(({ label, used }) => ({ label, used })) };
  } catch { /* 查不到就算了 */ }
}
