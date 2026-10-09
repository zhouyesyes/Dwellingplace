<script setup>
// 用量和余额：每个 API 在这台手机上每天用了多少次、多少 tokens；DeepSeek、OpenRouter 还能直接查账户余额和花费
import { ref, computed, onMounted } from "vue";
import { store, fmtTokens } from "../store/index.js";
import SubHeader from "../components/SubHeader.vue";

// OpenRouter 的查询地址跟着接口地址走（自己服务器转发的也行）
const orBase = a => (/\/openrouter(\/|$)/i.test(a.baseUrl || "") && !/openrouter\.ai/i.test(a.baseUrl || "") ? String(a.baseUrl).replace(/\/+$/, "").replace(/\/v1$/, "") + "/v1" : "https://openrouter.ai/api/v1");
const kindOf = a => (/deepseek\.com/i.test(a.baseUrl || "") ? "deepseek" : /openrouter\.ai|\/openrouter(\/|$)/i.test(a.baseUrl || "") ? "openrouter" : "");
const account = ref({}); // apiId -> { loading, error, lines: [] }

async function getJSON(url, key) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (r.status === 401 || r.status === 403) throw new Error("Key 不对或者没有权限查余额");
  if (!r.ok) throw new Error(`返回 ${r.status}`);
  return r.json();
}
const usd = n => `$${(Number(n) || 0).toFixed((Number(n) || 0) < 1 ? 4 : 2)}`;
async function check(a) {
  const k = kindOf(a);
  if (!k || !a.key) return;
  account.value[a.id] = { loading: true };
  try {
    let lines = [];
    if (k === "deepseek") {
      const r = await getJSON("https://api.deepseek.com/user/balance", a.key);
      lines = (r.balance_infos || []).map(b => `余额 ${b.currency === "CNY" ? "¥" : b.currency + " "}${b.total_balance}（充值 ${b.topped_up_balance}，赠送 ${b.granted_balance}）`);
      if (!r.is_available) lines.push("余额不够了，调用会失败");
    } else {
      const [c, kinfo] = await Promise.all([getJSON(`${orBase(a)}/credits`, a.key).catch(() => null), getJSON(`${orBase(a)}/key`, a.key)]);
      const d = kinfo.data || {};
      if (c?.data) lines.push(`账户余额 ${usd(c.data.total_credits - c.data.total_usage)}（一共充了 ${usd(c.data.total_credits)}）`);
      if (d.usage_daily != null) lines.push(`今天花了 ${usd(d.usage_daily)} · 这周 ${usd(d.usage_weekly)} · 这个月 ${usd(d.usage_monthly)}`);
      lines.push(`这个 Key 一共花了 ${usd(d.usage)}${d.limit != null ? `，上限 ${usd(d.limit)}（还剩 ${usd(d.limit_remaining)}）` : ""}`);
    }
    account.value[a.id] = { lines };
  } catch (e) {
    account.value[a.id] = { error: /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? "连不上（可能要开梯子）" : e.message };
  }
}
const refresh = () => store.apis.forEach(check);
onMounted(refresh);

// 这台手机上记下来的：最近 14 天，每天每个 API 的次数和 tokens（点开看每个模型）
const days = computed(() => Object.keys(store.usage || {}).sort().reverse().slice(0, 14));
const open = ref({});
const rowsOf = a => days.value.map(d => ({ d, u: store.usage[d]?.[a.id] })).filter(r => r.u);
const sum = a => rowsOf(a).reduce((s, { u }) => ({ calls: s.calls + u.calls, input: s.input + u.input, output: s.output + u.output }), { calls: 0, input: 0, output: 0 });
const short = d => d.slice(5).replace("-", "/");
</script>

<template>
  <div class="page">
    <SubHeader title="用量和余额">
      <button class="btn soft small" @click="refresh">刷新</button>
    </SubHeader>

    <template v-for="a in store.apis" :key="a.id">
      <div class="section-label">{{ a.name || "未命名" }} · {{ a.model || "未选模型" }}</div>
      <div class="card body">
        <template v-if="kindOf(a)">
          <p class="acc-title">{{ kindOf(a) === "deepseek" ? "DeepSeek 账户" : "OpenRouter 账户" }}</p>
          <p v-if="account[a.id]?.loading" class="muted">正在查…</p>
          <p v-else-if="account[a.id]?.error" class="bad">查不到：{{ account[a.id].error }}</p>
          <p v-for="l in account[a.id]?.lines || []" :key="l" class="acc">{{ l }}</p>
          <p v-if="kindOf(a) === 'deepseek'" class="muted small">DeepSeek 只能查余额，每天花了多少钱要去它的控制台看；下面是在这台手机上记的次数和 tokens。</p>
        </template>
        <p v-else class="muted small">这个服务商查不了余额，下面是在这台手机上记的次数和 tokens。</p>

        <div class="total">最近 14 天：{{ sum(a).calls }} 次 · 输入 {{ fmtTokens(sum(a).input) }} · 输出 {{ fmtTokens(sum(a).output) }}</div>
        <div v-for="r in rowsOf(a)" :key="r.d" class="day" @click="open[a.id + r.d] = !open[a.id + r.d]">
          <div class="day-row">
            <b>{{ short(r.d) }}</b>
            <span>{{ r.u.calls }} 次</span>
            <span>输入 {{ fmtTokens(r.u.input) }}</span>
            <span>输出 {{ fmtTokens(r.u.output) }}</span>
            <i>{{ r.u.models ? (open[a.id + r.d] ? "▴" : "▾") : "" }}</i>
          </div>
          <div v-if="open[a.id + r.d] && r.u.models" class="models">
            <div v-for="(m, name) in r.u.models" :key="name" class="m-row"><span class="m-name">{{ name }}</span><span>{{ m.calls }} 次 · {{ fmtTokens(m.input) }} / {{ fmtTokens(m.output) }}</span></div>
          </div>
        </div>
        <p v-if="!rowsOf(a).length" class="muted small">最近 14 天在这台手机上还没用过。</p>
      </div>
    </template>
    <p v-if="!store.apis.length" class="muted center">还没有添加 API。</p>
    <p class="note">次数和 tokens 是栖所在这台手机上记的（聊天、群聊都算）；唤醒是中转去调用的，记在「唤醒」页每次醒来的那一条里。余额和花费是服务商那边的数字。</p>
  </div>
</template>

<style scoped>
.body { padding: 14px 16px; }
.acc-title { margin: 0 0 4px; font-weight: 600; font-size: 0.9rem; }
.acc { margin: 2px 0; font-size: 0.88rem; line-height: 1.6; }
.muted { color: var(--text-3); font-size: 0.85rem; margin: 4px 0; line-height: 1.6; }
.small { font-size: 0.78rem; }
.bad { color: var(--danger); font-size: 0.85rem; margin: 4px 0; }
.total { margin: 12px 0 6px; font-size: 0.85rem; font-weight: 600; }
.day { border-top: 1px solid var(--line); padding: 7px 2px; cursor: pointer; }
.day-row { display: flex; gap: 10px; align-items: center; font-size: 0.85rem; font-variant-numeric: tabular-nums; }
.day-row b { width: 46px; }
.day-row span { flex: 1; color: var(--text-2); }
.day-row i { font-style: normal; color: var(--text-3); width: 12px; }
.models { margin: 6px 0 2px 46px; display: flex; flex-direction: column; gap: 3px; }
.m-row { display: flex; justify-content: space-between; gap: 8px; font-size: 0.78rem; color: var(--text-3); }
.m-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.note { font-size: 0.8rem; color: var(--text-3); line-height: 1.7; margin: 12px 8px 0; }
.center { text-align: center; }
</style>
