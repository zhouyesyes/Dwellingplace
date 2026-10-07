<script setup>
// 用量：上一次回复都花在哪（设定和记忆、工具目录、聊天记录）、累计用了多少、命中缓存多少、用工具来回多花了多少
// 单聊和群聊共用；群聊还按人分开算
import { computed } from "vue";
import { roleById, fmtTokens } from "../store/index.js";
import Sheet from "./Sheet.vue";

const props = defineProps({
  open: Boolean,
  title: { type: String, default: "这个对话的用量" },
  all: { type: Array, default: () => [] }, // 这个对话里所有消息（包括重新生成的版本：都花了 tokens）
  path: { type: Array, default: () => [] }, // 现在看到的这一条线
  limit: { type: Number, default: 200000 },
  shownCount: { type: Number, default: 0 },
  perMember: Boolean,
});
const emit = defineEmits(["close"]);

const last = computed(() => [...props.path].reverse().find(m => m.from === "ai" && !m.error && (m.ctx || m.usage?.input)));
const ctx = computed(() => (last.value ? last.value.ctx0 || last.value.ctx || last.value.usage.input : 0));
const pct = computed(() => Math.min(100, Math.round((ctx.value / props.limit) * 100)));
const level = computed(() => (pct.value >= 85 ? "high" : pct.value >= 60 ? "mid" : ""));
const lastName = computed(() => roleById(last.value?.speaker)?.name || "TA");

// 上一次回复：系统提示里的设定 / 记忆 / 日历、工具目录，剩下的是聊天记录和【此刻】
const parts = computed(() => {
  const m = last.value;
  if (!m?.est) return null;
  const tools = m.est.tools || 0;
  const sys = Math.max(0, (m.est.system || 0) - tools);
  const total = ctx.value;
  // 估出来的数和服务商算的不一样：按比例对到实际的数上
  const est = sys + tools;
  const k = est > total ? total / est : 1;
  const rows = [
    { label: "设定、记忆、日历等", n: Math.round(sys * k) },
    { label: "工具目录", n: Math.round(tools * k) },
  ];
  rows.push({ label: `聊天记录和【此刻】`, n: Math.max(0, total - rows[0].n - rows[1].n) });
  return rows.map(r => ({ ...r, pct: total ? Math.round((r.n / total) * 100) : 0 }));
});
const lastExtra = computed(() => {
  const m = last.value;
  return m?.ctx0 ? Math.max(0, (m.usage?.input || 0) - m.ctx0) : 0;
});

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
const members = computed(() => {
  if (!props.perMember) return [];
  const ids = [...new Set(props.all.filter(m => m.from === "ai" && m.speaker).map(m => m.speaker))];
  return ids.map(id => ({ id, name: roleById(id)?.name || "（已删除）", ...sum(props.all.filter(m => m.speaker === id)) }));
});
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);
</script>

<template>
  <Sheet :open="open" :title="title" @close="emit('close')">
    <p v-if="!totals.replies" class="tip">还没有回复，聊几句再来看。</p>
    <template v-else>
      <div v-if="last" class="ctx-big">
        <div class="ctx-num">{{ fmtTokens(ctx) }}<small> / {{ fmtTokens(limit) }} tokens</small></div>
        <i class="bar big" :class="level"><b :style="{ width: pct + '%' }" /></i>
        <p>上一次{{ perMember ? ` ${lastName} ` : "" }}回复时一共看了这么多内容<template v-if="shownCount">（最近 {{ shownCount }} 条消息，加上设定、记忆和日历）</template>。</p>
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

      <template v-if="members.length">
        <div class="section">每个人</div>
        <div class="list-card flat">
          <div v-for="r in members" :key="r.id" class="list-row col">
            <b>{{ r.name }} · {{ r.replies }} 次回复</b>
            <span class="sub">输入 {{ fmtTokens(r.input) }}<template v-if="r.cached">（缓存 {{ fmtTokens(r.cached) }}）</template> · 输出 {{ fmtTokens(r.output) }}<template v-if="r.extra"> · 工具来回 {{ fmtTokens(r.extra) }}</template></span>
          </div>
        </div>
      </template>

      <p class="tip">
        命中缓存的部分服务商一般只收一到两折的钱；「工具来回」是用一次工具就要把内容再看一遍。「都花在哪」是按字数估的，看比例就好。
        <slot />
      </p>
    </template>
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
</style>
