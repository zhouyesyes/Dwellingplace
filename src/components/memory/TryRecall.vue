<script setup>
// 试试翻记忆：和他用 [翻记忆:关键词|范围|时间] 时一模一样，看看他会翻到什么
import { ref } from "vue";
import { searchAll, hitLine } from "../../lib/recall.js";
import { KINDS } from "../../lib/rank.js";
import { meName } from "../../lib/chat.js";
import Sheet from "../Sheet.vue";

const props = defineProps({ open: Boolean, role: Object });
defineEmits(["close"]);
const q = ref("");
const kind = ref("");
const when = ref("");
const res = ref(null);
const busy = ref(false);
const WHENS = ["", "今天", "最近一周", "这个月", "上个月"];
async function go() {
  if (!q.value.trim() && !kind.value && !when.value.trim()) return;
  busy.value = true;
  const t0 = performance.now();
  try {
    const raw = [q.value.trim(), kind.value, when.value.trim()].join("|").replace(/\|+$/, "");
    const me = meName(props.role);
    const r = await searchAll(props.role, raw, me);
    res.value = { raw, ms: Math.round(performance.now() - t0), pool: r.pool, lines: r.hits.map(d => ({ kind: KINDS[d.kind], text: hitLine(d, r.q, me, props.role).replace(/^· /, "") })) };
  } finally { busy.value = false; }
}
</script>

<template>
  <Sheet :open="open" title="试试翻记忆" @close="$emit('close')">
    <div class="tr">
      <input v-model="q" class="input" placeholder="关键词（说法不用一字不差）" @keydown.enter="go" />
      <div class="chips">
        <button :class="{ on: !kind }" @click="kind = ''">全部</button>
        <button v-for="(v, k) in KINDS" :key="k" :class="{ on: kind === v }" @click="kind = v">{{ v }}</button>
      </div>
      <div class="chips">
        <button v-for="w in WHENS" :key="w" :class="{ on: when === w }" @click="when = w">{{ w || "不限时间" }}</button>
        <input v-model="when" class="input when" placeholder="或写：2026-10、10月3日" />
      </div>
      <button class="btn" :disabled="busy" @click="go">{{ busy ? "在翻……" : "翻一翻" }}</button>
      <template v-if="res">
        <p class="meta">他写的是 [翻记忆:{{ res.raw }}] · 在 {{ res.pool }} 条里找 · 用了 {{ res.ms }} 毫秒 · 找到 {{ res.lines.length }} 条（排在前面的更相关）</p>
        <article v-for="(x, i) in res.lines" :key="i" class="hit"><small>{{ i + 1 }} · {{ x.kind }}</small><p>{{ x.text }}</p></article>
        <p v-if="!res.lines.length" class="meta">没找到。换个说法、放宽范围试试。</p>
      </template>
      <p class="note">两路一起找：所有关键词都原样出现的（精确），和拆成小块后最像的（BM25，说法不一样也能找到）；再按两边各排第几合起来（RRF），常驻、重要、最近一个月的稍微靠前，已过时的靠后。范围和时间是先划好去哪找。</p>
    </div>
  </Sheet>
</template>

<style scoped>
.tr { display: flex; flex-direction: column; gap: 10px; max-height: 76vh; overflow-y: auto; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.chips button { border: 0; background: var(--bg); padding: 5px 11px; border-radius: 999px; font-size: .78rem; color: var(--text-2); }
.chips button.on { background: var(--ink); color: #fff; font-weight: 600; }
.when { flex: 1; min-width: 140px; padding: 6px 10px; font-size: .8rem; }
.meta { font-size: .74rem; color: var(--text-3); margin: 4px 2px 0; line-height: 1.6; }
.hit { background: var(--card); border-radius: 14px; padding: 9px 12px; box-shadow: var(--shadow-soft); }
.hit small { font-size: .68rem; color: var(--text-3); }
.hit p { margin: 2px 0 0; font-size: .82rem; line-height: 1.65; color: var(--text-2); white-space: pre-wrap; }
.note { font-size: .7rem; color: var(--text-3); line-height: 1.6; margin: 6px 2px 0; }
</style>
