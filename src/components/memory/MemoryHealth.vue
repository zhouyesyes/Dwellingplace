<script setup>
// 记忆体检：卡片、摘要、快到整理的房间、每次带多少、最近想起和翻过什么
import { ref, watch } from "vue";
import { healthOf, STALE_DAYS } from "../../lib/health.js";
import { meName } from "../../lib/chat.js";
import { fmtTok } from "../../lib/budget.js";
import Sheet from "../Sheet.vue";

const props = defineProps({ open: Boolean, role: Object });
const emit = defineEmits(["close", "view"]);
const h = ref(null);
const busy = ref(false);
watch(() => props.open, async v => {
  if (!v || !props.role) return;
  busy.value = true;
  try { h.value = await healthOf(props.role, meName(props.role)); } finally { busy.value = false; }
}, { immediate: true });
const when = ts => (ts ? new Date(ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "还没有");
const days = ts => (ts ? `${Math.floor((Date.now() - ts) / 86400_000)} 天前` : "从来没有");
const amount = r => (r.unit === "token" ? `${fmtTok(r.now)} / ${fmtTok(r.limit)} token` : `${r.now >= 10000 ? +(r.now / 10000).toFixed(1) + " 万" : r.now} / ${r.limit / 10000} 万字`);
</script>

<template>
  <Sheet :open="open" title="记忆体检" @close="emit('close')">
    <div class="hc">
      <p v-if="busy && !h" class="dim">在检查……</p>
      <template v-if="h">
        <section v-if="h.tips.length" class="tips">
          <p v-for="(t, i) in h.tips" :key="i">· {{ t }}</p>
        </section>
        <p v-else class="ok">一切都好，没有要特别留意的。</p>

        <h4>记忆卡片</h4>
        <div class="grid">
          <div><b>{{ h.count.all }}</b><span>一共</span></div>
          <div><b>{{ h.count.pinned }}<small>/20</small></b><span>常驻</span></div>
          <div><b>{{ h.count.normal }}</b><span>普通</span></div>
          <div><b>{{ h.count.archived }}</b><span>归档</span></div>
          <div :class="{ warn: h.count.pending }"><b>{{ h.count.pending }}</b><span>待确认</span></div>
          <div><b>{{ h.count.obsolete }}</b><span>已过时</span></div>
          <div><b>{{ h.count.trash }}</b><span>回收站</span></div>
          <div><b>{{ h.count.derived }}</b><span>读书笔记等</span></div>
        </div>

        <template v-if="h.pairs.length">
          <h4>可能是同一件事<small>说法很像的两张，看看要不要合并，或者把旧的标已过时</small></h4>
          <article v-for="(x, i) in h.pairs" :key="i" class="pair">
            <button @click="emit('view', x.a)"><b>{{ x.a.title }}</b><span>{{ x.a.content }}</span></button>
            <button @click="emit('view', x.b)"><b>{{ x.b.title }}</b><span>{{ x.b.content }}</span></button>
          </article>
        </template>

        <h4>各个房间<small>摘要什么时候整理的、压了几次；离下一次整理还差多少</small></h4>
        <article v-for="(r, i) in h.rooms" :key="i" class="room">
          <div class="rt"><span class="k">{{ r.kind }}</span><b>{{ r.name }}</b></div>
          <p class="dim">{{ r.segs ? `前情 ${r.times} 段` : r.sum ? `摘要整理过 ${r.times} 次` : "还没整理过" }}{{ r.at ? ` · 上一次 ${when(r.at)}` : "" }}{{ r.impr != null ? ` · 中途印象 ${r.impr} 版` : "" }}</p>
          <div class="bar" :class="{ hi: r.pct >= 90 }"><i :style="{ width: r.pct + '%' }" /></div>
          <p class="dim">{{ amount(r) }}（{{ r.pct }}%，满了就整理）</p>
        </article>
        <p v-if="!h.rooms.length" class="dim">还没有聊过、读过、写过。</p>

        <h4>每次聊天大概带多少<small>按字数估的，看比例就好</small></h4>
        <div v-for="x in h.tokens" :key="x.label" class="tk">
          <span>{{ x.label }}</span><div class="bar"><i :style="{ width: x.pct + '%' }" /></div><em>{{ fmtTok(x.n) }}</em>
        </div>
        <p class="dim">一共约 {{ fmtTok(h.total) }} token（还没算工具目录和你这次说的话）。</p>

        <h4>最近自动想起的<small>按你说的话想起的普通卡片</small></h4>
        <article v-for="(x, i) in h.recalls" :key="i" class="log">
          <p class="dim">{{ when(x.ts) }} · 因为你说「{{ x.q }}」</p>
          <p><button v-for="m in x.cards" :key="m.id" class="chip" @click="emit('view', m)">{{ m.title }}</button></p>
        </article>
        <p v-if="!h.recalls.length" class="dim">还没有自动想起过。</p>

        <h4>他最近翻的记忆</h4>
        <article v-for="(x, i) in h.searches" :key="i" class="log">
          <p class="dim">{{ when(x.ts) }} · 翻「{{ x.q }}」· 找到 {{ x.count }} 条</p>
          <p v-if="x.cards.length"><button v-for="m in x.cards" :key="m.id" class="chip" @click="emit('view', m)">{{ m.title }}</button></p>
        </article>
        <p v-if="!h.searches.length" class="dim">还没翻过。</p>

        <template v-if="h.stale.length">
          <h4>很久没用上的卡片<small>{{ STALE_DAYS }} 天以上没被想起、也没被翻到</small></h4>
          <button v-for="m in h.stale.slice(0, 15)" :key="m.id" class="stale" @click="emit('view', m)"><b>{{ m.title }}</b><span>{{ m.usedAt ? `上次用上：${days(m.usedAt)}` : `写下以后还没用上（${days(m.createdAt || m.ts)}写的）` }}</span></button>
          <p v-if="h.stale.length > 15" class="dim">还有 {{ h.stale.length - 15 }} 张。</p>
        </template>
      </template>
    </div>
  </Sheet>
</template>

<style scoped>
.hc { display: flex; flex-direction: column; gap: 8px; max-height: 78vh; overflow-y: auto; padding-bottom: 10px; }
h4 { margin: 12px 0 2px; font-size: .9rem; }
h4 small { margin-left: 8px; font-size: .7rem; font-weight: 400; color: var(--text-3); }
.dim { margin: 0; font-size: .74rem; color: var(--text-3); line-height: 1.6; }
.ok { margin: 0; font-size: .85rem; color: #4f8a5b; background: color-mix(in srgb, #eaf5ec var(--pastel), var(--card)); border-radius: 14px; padding: 10px 14px; }
.tips { background: color-mix(in srgb, #fdf3e4 var(--pastel), var(--card)); border-radius: 14px; padding: 10px 14px; }
.tips p { margin: 2px 0; font-size: .82rem; line-height: 1.6; color: #8a5a1c; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.grid div { background: var(--card); border-radius: 14px; padding: 8px 4px; text-align: center; box-shadow: var(--shadow-soft); display: flex; flex-direction: column; }
.grid b { font-size: 1.1rem; }
.grid b small { font-size: .7rem; color: var(--text-3); font-weight: 400; }
.grid span { font-size: .68rem; color: var(--text-3); }
.grid .warn b { color: #c9304c; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.pair button, .stale { border: 0; text-align: left; background: var(--card); border-radius: 12px; padding: 8px 10px; box-shadow: var(--shadow-soft); display: flex; flex-direction: column; gap: 2px; font-size: .78rem; color: var(--text-2); }
.pair b, .stale b { font-size: .82rem; color: var(--text); }
.pair span { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.stale span { font-size: .7rem; color: var(--text-3); }
.room { background: var(--card); border-radius: 14px; padding: 9px 12px; box-shadow: var(--shadow-soft); display: flex; flex-direction: column; gap: 4px; }
.rt { display: flex; align-items: center; gap: 8px; font-size: .86rem; }
.k { font-size: .66rem; color: var(--text-2); background: var(--bg); padding: 2px 8px; border-radius: 999px; }
.bar { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; flex: 1; }
.bar i { display: block; height: 100%; background: #9cc5a1; border-radius: 3px; }
.bar.hi i { background: #e7a35a; }
.tk { display: grid; grid-template-columns: 9.5em 1fr 4em; gap: 8px; align-items: center; font-size: .76rem; color: var(--text-2); }
.tk em { font-style: normal; text-align: right; color: var(--text-3); }
.log { background: var(--card); border-radius: 12px; padding: 7px 10px; box-shadow: var(--shadow-soft); }
.log p { margin: 0; }
.chip { border: 0; background: var(--bg); border-radius: 999px; padding: 3px 9px; margin: 4px 4px 0 0; font-size: .74rem; color: var(--text-2); }
</style>
