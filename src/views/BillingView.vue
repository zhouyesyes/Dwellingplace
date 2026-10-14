<script setup>
// 用量和余额：每个 API 在这台手机上每天用了多少次、多少 tokens；DeepSeek、OpenRouter 还能直接查账户余额和花费
import { ref, computed, onMounted } from "vue";
import { store, fmtTokens, today } from "../store/index.js";
import { isPlan } from "../lib/providers.js";
import { planPercents } from "../lib/quota.js";
import SubHeader from "../components/SubHeader.vue";

// ---------- ChatGPT 会员额度：放在最上面 ----------
const planApis = computed(() => store.apis.filter(a => a.type === "openai" && isPlan(a)));
const otherApis = computed(() => store.apis.filter(a => !planApis.value.includes(a)));
const showOthers = ref(!planApis.value.length);
const plan = ref({}); // apiId -> { loading, error, st }
const planBase = a => String(a.baseUrl).trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
async function checkPlan(a) {
  plan.value[a.id] = { loading: true };
  try {
    const r = await fetch(planBase(a) + "/status", { cache: "no-store" });
    const st = await r.json();
    if (!r.ok) throw new Error(st.error?.message || `返回 ${r.status}`);
    plan.value[a.id] = { st };
  } catch (e) {
    plan.value[a.id] = { error: /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? "连不上服务器" : e.message };
  }
}
// OpenAI 回复时带的额度：认得出百分比的画成进度条
const bars = limits => planPercents(limits).map(p => ({ label: p.label, left: Math.round(100 - p.used), reset: Number.isFinite(p.secs) && p.secs > 0 ? untilText(p.secs) : "" }));
const untilText = s => (s < 3600 ? `${Math.ceil(s / 60)} 分钟后恢复` : s < 86400 ? `${Math.round(s / 3600)} 小时后恢复` : `${Math.round(s / 86400)} 天后恢复`);
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "刚刚" : m < 60 ? `${m} 分钟前` : `${Math.round(m / 60)} 小时前`; };
const todayCalls = a => store.usage[today()]?.[a.id]?.calls || 0;


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
const refresh = () => { store.apis.forEach(check); planApis.value.forEach(checkPlan); };
onMounted(refresh);

// 这台手机上记下来的：最近 14 天，每天每个 API 的次数和 tokens（点开看每个模型）
const days = computed(() => Object.keys(store.usage || {}).sort().reverse().slice(0, 14));
const open = ref({});
const rowsOf = a => days.value.map(d => ({ d, u: store.usage[d]?.[a.id] })).filter(r => r.u);
const sum = a => rowsOf(a).reduce((s, { u }) => ({ calls: s.calls + u.calls, input: s.input + u.input, output: s.output + u.output }), { calls: 0, input: 0, output: 0 });
const short = d => d.slice(5).replace("-", "/");

// 最近每一轮回复：请求了几次、多少 tokens；会员额度的话，这一轮前后百分比变了多少
const turns = computed(() => (store.turnLog || []).slice(-20).reverse());
const apiName = id => store.apis.find(a => a.id === id)?.name || "已删掉的 API";
const hm = ts => new Date(ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const showTurns = ref(false);
</script>

<template>
  <div class="page">
    <SubHeader title="用量和余额">
      <button class="btn soft small" @click="refresh">刷新</button>
    </SubHeader>

    <div class="card body how">
      <b>额度到底怎么算</b>
      <template v-if="planApis.length">
        <p><i>ChatGPT 会员额度</i>不按次数、也不按条数。OpenAI 按这一轮让模型算了多少来扣：输入、输出（连同思考）的 tokens，模型越大、思考越多扣得越多，折成「5 小时」和「每周」两个百分比。具体怎么换算 OpenAI 没公开；下面「最近每一轮」里，栖所在每轮之后看一眼百分比，记下这一轮大概用掉了多少。</p>
      </template>
      <p v-if="otherApis.length"><i>用 Key 的 API</i>（DeepSeek、OpenRouter、Claude 等）按 tokens 收钱：输入多少、输出多少（思考也算输出），命中缓存的输入便宜很多。请求次数本身不收钱。</p>
      <p>两种都一样的一点：<b>每多请求一次，前面的设定、记忆、摘要和最近的聊天就要再发一遍输入</b>。用工具、翻记忆、搜索、续发，每一步都要多请求一次；按空行分气泡、[停顿] 都是同一次生成，不多花。</p>
    </div>

    <div v-if="turns.length" class="card body">
      <div class="turn-head" @click="showTurns = !showTurns"><b>最近每一轮</b><span class="muted small">{{ turns.length }} 轮 {{ showTurns ? "▴" : "▾" }}</span></div>
      <template v-if="showTurns">
        <div v-for="t in turns" :key="t.ts" class="turn">
          <div class="turn-row"><span>{{ hm(t.ts) }}</span><span class="grow">{{ t.wake ? `唤醒 · ${t.wake.reasons.join("；")}` : apiName(t.apiId) }}</span><b :class="{ many: t.rounds > 1 }">{{ t.wake?.direct ? "直接发，没请求" : `请求 ${t.rounds} 次` }}<template v-if="t.sends">（续发 {{ t.sends }}）</template></b></div>
          <div v-if="t.wake && !t.wake.direct" class="turn-sub">{{ t.wake.error ? `失败：${t.wake.error}` : t.wake.silent ? "醒了，没发消息" : "醒了，发了消息" }}<template v-if="t.wake.ctx"> · 带的上下文 {{ fmtTokens(t.wake.ctx) }}</template></div>
          <div v-if="!t.wake?.direct" class="turn-sub">输入 {{ fmtTokens(t.input) }}<template v-if="t.cached">（缓存 {{ fmtTokens(t.cached) }}）</template> · 输出 {{ fmtTokens(t.output) }}<template v-for="p in t.plan || []" :key="p.label"> · {{ p.label }} {{ p.d == null ? `用了 ${p.used}%` : `+${p.d}%` }}</template></div>
        </div>
      </template>
    </div>

    <div v-for="a in planApis" :key="a.id" class="card plan">
      <div class="plan-top">
        <b>ChatGPT 会员额度</b>
        <span class="muted small">{{ plan[a.id]?.st?.email || a.name }}</span>
      </div>
      <p v-if="plan[a.id]?.loading" class="muted">正在查…</p>
      <p v-else-if="plan[a.id]?.error" class="bad">查不到：{{ plan[a.id].error }}</p>
      <p v-else-if="plan[a.id]?.st && !plan[a.id].st.connected" class="bad">还没登录：去「设置 → API → {{ a.name }}」里用 ChatGPT 登录</p>
      <template v-else-if="plan[a.id]?.st">
        <div v-for="b in bars(plan[a.id].st.limits)" :key="b.label" class="bar-row">
          <div class="bar-label"><span>{{ b.label }}</span><span>还剩 {{ b.left }}%<template v-if="b.reset"> · {{ b.reset }}</template></span></div>
          <div class="bar"><i :style="{ width: b.left + '%' }" :class="{ low: b.left < 20 }" /></div>
        </div>
        <p v-if="!bars(plan[a.id].st.limits).length" class="muted small">OpenAI 不告诉栖所还剩多少，准确的数字在 ChatGPT 里看：</p>
        <p v-if="bars(plan[a.id].st.limits).length" class="muted small">（{{ ago(plan[a.id].st.limits.at) }}聊天时 OpenAI 带回来的）</p>
      </template>
      <div class="plan-foot">
        <span>今天在这台设备上聊了 {{ todayCalls(a) }} 次</span>
        <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener">ChatGPT 里看用量 ›</a>
      </div>
    </div>

    <button v-if="planApis.length && otherApis.length" class="others-btn" @click="showOthers = !showOthers">
      其他 API（{{ otherApis.length }}）<span>{{ showOthers ? "▴" : "▾" }}</span>
    </button>

    <template v-for="a in showOthers ? otherApis : []" :key="a.id">
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
    <p v-if="planApis.length" class="note">会员额度是 OpenAI 按自己的方式算的（和 ChatGPT 本身共用），栖所只能显示 OpenAI 告诉它的部分。</p>
    <p class="note">次数和 tokens 是栖所在这台手机上记的（聊天、群聊都算）；唤醒是中转去调用的，记在「唤醒」页每次醒来的那一条里。余额和花费是服务商那边的数字。</p>
  </div>
</template>

<style scoped>
.body { padding: 14px 16px; }
.plan { padding: 18px 18px 14px; }
.plan-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.plan-top b { font-size: 1.1rem; }
.bar-row { margin: 10px 0; }
.bar-label { display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 6px; }
.bar-label span:last-child { color: var(--text-2); font-variant-numeric: tabular-nums; }
.bar { height: 10px; border-radius: 999px; background: var(--bg-deep); overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width .3s; }
.bar i.low { background: var(--danger); }
.plan-foot { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 12px; font-size: 0.82rem; color: var(--text-2); }
.plan-foot a { color: var(--ink); white-space: nowrap; }
.others-btn { display: flex; justify-content: space-between; width: 100%; margin: 18px 0 0; border: 0; background: var(--card); border-radius: 16px; padding: 12px 16px; box-shadow: var(--shadow-soft); color: var(--text-2); font-size: 0.9rem; }
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
.how { margin-bottom: 14px; }
.how p { margin: 8px 0 0; font-size: 0.84rem; line-height: 1.7; color: var(--text-2); }
.how i { font-style: normal; font-weight: 600; color: var(--text); margin-right: 4px; }
.turn-head { display: flex; justify-content: space-between; align-items: baseline; cursor: pointer; }
.turn { border-top: 1px solid var(--line); padding: 7px 0; margin-top: 6px; }
.turn-row { display: flex; gap: 10px; font-size: 0.84rem; align-items: baseline; }
.turn-row .grow { flex: 1; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.turn-row b { font-weight: 500; font-size: 0.8rem; color: var(--text-2); }
.turn-row b.many { color: var(--accent); }
.turn-sub { font-size: 0.76rem; color: var(--text-3); margin-top: 2px; font-variant-numeric: tabular-nums; }
</style>
