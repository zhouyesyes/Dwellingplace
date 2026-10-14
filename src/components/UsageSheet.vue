<script setup>
// 用量：上一次回复都花在哪（设定和记忆、工具目录、聊天记录）、累计用了多少、命中缓存多少、用工具来回多花了多少
// 往左滑是第二页：他每次看得到多少条（随时能调）
import { computed, ref, watch } from "vue";
import { store, fmtTokens } from "../store/index.js";
import Sheet from "./Sheet.vue";
import { sumTokens, fmtTok } from "../lib/budget.js";

const props = defineProps({
  open: Boolean,
  title: { type: String, default: "这个对话的用量" },
  all: { type: Array, default: () => [] }, // 这个对话里所有消息（包括重新生成的版本：都花了 tokens）
  path: { type: Array, default: () => [] }, // 现在看到的这一条线
  limit: { type: Number, default: 200000 },
  shownCount: { type: Number, default: 0 },
  summary: { type: Object, default: null }, // 这个对话的摘要记忆（thread.summary）
});
const emit = defineEmits(["close"]);

const last = computed(() => [...props.path].reverse().find(m => m.from === "ai" && !m.error && (m.ctx || m.usage?.input)));
const ctx = computed(() => (last.value ? last.value.ctx0 || last.value.ctx || last.value.usage.input : 0));
const pct = computed(() => Math.min(100, Math.round((ctx.value / props.limit) * 100)));
const level = computed(() => (pct.value >= 85 ? "high" : pct.value >= 60 ? "mid" : ""));

// 一次回复：系统提示里的设定 / 记忆 / 日历、工具目录，剩下的是聊天记录和【此刻】
const ctxOf = m => m.ctx0 || m.ctx || m.usage?.input || 0;
function partsOf(m) {
  if (!m?.est) return null;
  const tools = m.est.tools || 0;
  const sys = Math.max(0, (m.est.system || 0) - tools);
  const total = ctxOf(m);
  const rows = [
    { label: "设定、日历等", n: sys },
    { label: "工具目录", n: tools },
  ];
  // 【此刻】：时间（和心境）；老消息没记，就和聊天记录算在一起
  const split = m.est.mind != null;
  if (split) rows.push({ label: "此刻的时间", n: m.est.mind || 0 });
  const est = rows.reduce((a, r) => a + r.n, 0);
  // 估出来的数和服务商算的不一样：按比例对到实际的数上
  const k = est > total ? total / est : 1;
  rows.forEach(r => (r.n = Math.round(r.n * k)));
  rows.push({ label: split ? "聊天记录" : "聊天记录和【此刻】", n: Math.max(0, total - rows.reduce((a, r) => a + r.n, 0)) });
  return rows.filter(r => r.n > 0 || r.label === "工具目录").map(r => ({ ...r, pct: total ? Math.round((r.n / total) * 100) : 0 }));
}
const extraOf = m => (m?.ctx0 ? Math.max(0, (m.usage?.input || 0) - m.ctx0) : 0);
const parts = computed(() => partsOf(last.value));
const lastExtra = computed(() => extraOf(last.value));

// ---------- 第二页：看得到多少条 ----------
const page = ref(0);
const pager = ref(null);
const onScroll = () => { const el = pager.value; if (el) page.value = Math.round(el.scrollLeft / el.clientWidth); };
const go = i => pager.value?.scrollTo({ left: i * pager.value.clientWidth, behavior: "smooth" });
watch(() => props.open, v => { if (v) { page.value = 0; requestAnimationFrame(() => pager.value && (pager.value.scrollLeft = 0)); } });
const limits = [
  { key: "historyTokens", label: "他每次带多少聊天原文（token）", sub: "摘要后面的聊天原样发给他，最多这么多；到八成就把前面的整理进摘要，最近一半留着。越多记得越细，也越费", min: 2000, max: 300000, step: 10000, def: 50000 },
  { key: "wakeHistoryTokens", label: "他醒来时带多少聊天（token）", sub: "醒来只带个小背包：最近这么多聊天、摘要、记忆和醒来的原因；要旧的事他会自己翻记忆。也不会超过上一项", min: 500, max: 50000, step: 1000, def: 4000 }
];
function setLimit(l, v) {
  const n = Math.round(Number(v));
  store.settings[l.key] = Number.isFinite(n) ? Math.max(l.min, Math.min(l.max || 1000, n)) : l.def;
}
const step = (l, d) => setLimit(l, (Number(store.settings[l.key] ?? l.def) || 0) + d * (l.step || 10));

function sum(list) {
  const t = { replies: 0, input: 0, cached: 0, output: 0, extra: 0 };
  for (const m of list) {
    if (m.from !== "ai" || !m.usage) continue;
    t.replies++;
    t.input += m.usage.input || 0;
    t.cached += m.usage.cached || 0;
    t.output += m.usage.output || 0;
    if (m.ctx0) t.extra += Math.max(0, (m.usage.input || 0) - m.ctx0);
  }
  return t;
}
const totals = computed(() => sum(props.all));
// 这个对话一共多少条（这一条线上的，不算小记）、整理进摘要多少条、摘要后面还剩多少条
const counts = computed(() => {
  const real = props.path.filter(m => m.from !== "event" && !m.pending);
  const i = props.summary?.upTo ? real.findIndex(m => m.id === props.summary.upTo) : -1;
  const done = i >= 0 ? i + 1 : 0;
  return { total: real.length, done, rest: real.length - done, restTok: sumTokens(real.slice(done)), carried: props.summary?.from ? (props.summary.count || 0) - done : 0 };
});
const pctOf = (a, b) => (!b || !a ? 0 : a / b < 0.01 ? "<1" : Math.round((a / b) * 100));
</script>

<template>
  <Sheet :open="open" :title="title" @close="emit('close')">
    <nav class="tabs">
      <button :class="{ on: page === 0 }" @click="go(0)">用量</button>
      <button :class="{ on: page === 1 }" @click="go(1)">看得到多少</button>
    </nav>
    <div ref="pager" class="pager" @scroll.passive="onScroll">
    <section class="pg">
    <p v-if="!totals.replies" class="tip">还没有回复，聊几句再来看。往左滑可以调他每次带多少聊天原文。</p>
    <template v-else>
      <div v-if="last" class="ctx-big">
        <div class="ctx-num">{{ fmtTokens(ctx) }}<small> / {{ fmtTokens(limit) }} tokens</small></div>
        <i class="bar big" :class="level"><b :style="{ width: pct + '%' }" /></i>
        <p>上一次回复时一共看了这么多内容<template v-if="shownCount">（最近 {{ shownCount }} 条消息，加上设定、记忆和日历）</template>。</p>
      </div>

      <template v-if="parts">
        <div class="section">上一次都花在哪（估算）</div>
        <div class="list-card flat">
          <div v-for="r in parts" :key="r.label" class="list-row">
            <span class="grow">{{ r.label }}</span>
            <i class="bar mini"><b :style="{ width: r.pct + '%' }" /></i>
            <span class="val">{{ fmtTokens(r.n) }}</span>
          </div>
          <div v-if="last.usage?.cached" class="list-row"><span class="grow">这次命中缓存</span><span class="val">{{ fmtTokens(last.usage.cached) }}（{{ pctOf(last.usage.cached, last.usage.input) }}%）</span></div>
          <div v-if="lastExtra" class="list-row"><span class="grow">用工具来回又看了</span><span class="val">{{ fmtTokens(lastExtra) }}</span></div>
        </div>
      </template>

      <div class="section">累计</div>
      <div class="list-card flat">
        <div class="list-row"><span class="grow">回复</span><span class="val">{{ totals.replies }} 次</span></div>
        <div class="list-row"><span class="grow">输入</span><span class="val">{{ fmtTokens(totals.input) }}</span></div>
        <div class="list-row"><span class="grow">其中命中缓存</span><span class="val">{{ fmtTokens(totals.cached) }}（{{ pctOf(totals.cached, totals.input) }}%）</span></div>
        <div class="list-row"><span class="grow">其中用工具来回</span><span class="val">{{ fmtTokens(totals.extra) }}（{{ pctOf(totals.extra, totals.input) }}%）</span></div>
        <div class="list-row"><span class="grow">输出</span><span class="val">{{ fmtTokens(totals.output) }}</span></div>
      </div>

      <p class="tip">
        命中缓存的部分服务商一般只收一到两折的钱（中转平台要看它自己怎么算）。「工具来回」：他每用一次工具，都要带着整段内容再问一次模型，多出来的这些输入就算在这里；没用工具就是 0。
        缓存和工具来回是这次更新以后才开始记的，以前的回复算不进去。「都花在哪」是按字数估的，看比例就好。
        <slot />
      </p>
    </template>
    </section>

    <section class="pg">
      <div class="counts">
        <div><b>{{ counts.total }}</b><span>这个对话一共</span></div>
        <div><b>{{ counts.done }}</b><span>已整理进摘要{{ counts.total ? `（${Math.round((counts.done / counts.total) * 100)}%）` : "" }}</span></div>
        <div><b>{{ counts.rest }}</b><span>摘要后面的（约 {{ fmtTok(counts.restTok) }} token）</span></div>
      </div>
      <p v-if="counts.carried > 0" class="tip">摘要里还有从「{{ summary.from }}」带过来的 {{ counts.carried }} 条。</p>
      <div class="list-card flat">
        <div v-for="l in limits" :key="l.key" class="list-row col limit">
          <b>{{ l.label }}</b>
          <span class="sub">{{ l.sub }}</span>
          <div class="stepper">
            <button aria-label="少一点" @click="step(l, -1)">−</button>
            <input :value="store.settings[l.key] ?? l.def" type="number" inputmode="numeric" :min="l.min" :max="l.max || 1000" :step="l.step || 10" @change="setLimit(l, $event.target.value)" />
            <button aria-label="多一点" @click="step(l, 1)">+</button>
          </div>
        </div>
      </div>
      <p class="tip">改了马上生效。聊得久了（摘要后面的原文到了上面那个数的八成，或者内容快到模型上限的七成），他会把前面的聊天整理成一段摘要接着用，聊天里会留一行小记，点开能看。记忆库里的事不受这个影响，他一直记得。</p>
    </section>
    </div>
  </Sheet>
</template>

<style scoped>
.ctx-big { text-align: center; padding: 4px 0 10px; }
.ctx-num { font-size: 1.6rem; font-weight: 700; }
.ctx-num small { font-size: 0.8rem; font-weight: 400; color: var(--text-3); }
.ctx-big p { margin: 6px 0 0; font-size: 0.83rem; color: var(--text-2); line-height: 1.7; }
.bar { display: inline-block; width: 44px; height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; }
.bar b { display: block; height: 100%; background: #9cc5a1; border-radius: 2px; }
.bar.mid b { background: #f0c36a; }
.bar.high b { background: var(--danger); }
.bar.big { width: 70%; height: 8px; border-radius: 4px; margin: 8px 0; }
.bar.mini { width: 56px; margin-right: 10px; flex: none; }
.bar.mini b { background: #a9c7ec; }
.section { font-size: 0.78rem; color: var(--text-3); margin: 14px 4px 6px; }
.val { color: var(--text-2); font-size: 0.88rem; white-space: nowrap; }
.list-row.col { flex-direction: column; align-items: flex-start; gap: 2px; }
.list-row.col b { font-size: 0.9rem; font-weight: 600; }
.sub { font-size: 0.78rem; color: var(--text-3); }
.tip { font-size: 0.78rem; color: var(--text-3); line-height: 1.7; margin: 12px 4px 0; }
.tabs { display: flex; gap: 6px; margin-bottom: 10px; }
.tabs button { flex: 1; border: 0; border-radius: 12px; padding: 7px; background: var(--bg); font-size: 0.85rem; color: var(--text-2); }
.tabs button.on { background: var(--ink); color: var(--on-ink); font-weight: 600; }
/* 两页左右滑 */
.pager { display: flex; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory; scrollbar-width: none; align-items: flex-start; overscroll-behavior-x: contain; }
.pager::-webkit-scrollbar { display: none; }
.pg { flex: 0 0 100%; min-width: 0; scroll-snap-align: start; scroll-snap-stop: always; }
.limit { gap: 4px; }
.list-row.col .sub { white-space: normal; line-height: 1.6; }
.pg .list-card { margin-left: 0; margin-right: 0; }
.stepper { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.stepper button { width: 34px; height: 34px; border-radius: 50%; border: 0; background: var(--bg); color: var(--ink); font-size: 1.1rem; display: grid; place-items: center; padding: 0; }
.stepper input { width: 80px; text-align: center; border: 1px solid var(--line); border-radius: 10px; padding: 6px; font-size: 1rem; background: var(--card); color: var(--text); }
.counts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
.counts div { background: var(--bg); border-radius: 14px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
.counts b { font-size: 1.2rem; font-weight: 600; }
.counts span { font-size: .7rem; color: var(--text-3); }
</style>
