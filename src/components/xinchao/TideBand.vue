<script setup>
// 潮汐带：最近 24 小时的情绪起伏（越高越愉悦），浮标是有起因的情绪
import { computed } from "vue";
import { moodColor } from "../../lib/xinchao.js";

const props = defineProps({ journal: { type: Array, default: () => [] }, marks: { type: Array, default: () => [] } });
const W = 320, H = 90, now = Date.now(), span = 24 * 3600_000;
const xOf = t => Math.max(0, Math.min(W, ((t - (now - span)) / span) * W));
const yOf = v => H - 12 - Math.max(0, Math.min(1, Number(v) || 0)) * (H - 30);

const pts = computed(() => {
  const list = props.journal
    .map(s => ({ t: Date.parse(s.at), v: s.valence, label: s.label }))
    .filter(s => Number.isFinite(s.t) && s.t >= now - span)
    .sort((a, b) => a.t - b.t);
  if (!list.length) return [];
  // 补上两端，让浪从头连到尾
  return [{ t: now - span, v: list[0].v }, ...list, { t: now, v: list[list.length - 1].v }];
});
const path = computed(() => {
  const p = pts.value.map(s => [xOf(s.t), yOf(s.v)]);
  if (!p.length) return "";
  let d = `M 0 ${H} L ${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i < p.length; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i];
    const mx = (x0 + x1) / 2;
    d += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
  }
  return d + ` L ${W} ${H} Z`;
});
const avg = computed(() => (pts.value.length ? pts.value.reduce((a, s) => a + (Number(s.v) || 0), 0) / pts.value.length : 0.5));
const buoys = computed(() => props.marks.map(m => {
  const t = Date.parse(m.at);
  const near = pts.value.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best), pts.value[0] || { v: 0.5 });
  return { ...m, x: xOf(t), y: yOf(near?.v ?? 0.5) - 10 };
}));
</script>

<template>
  <div class="tide">
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="band">
      <defs>
        <linearGradient id="tideFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" :stop-color="moodColor(avg)" stop-opacity=".75" />
          <stop offset="1" :stop-color="moodColor(avg)" stop-opacity=".15" />
        </linearGradient>
      </defs>
      <path v-if="path" :d="path" fill="url(#tideFill)" />
      <line v-else x1="0" :y1="H - 30" :x2="W" :y2="H - 30" stroke="#e5e0e6" stroke-dasharray="4 4" />
    </svg>
    <span v-for="(b, i) in buoys" :key="i" class="buoy" :style="{ left: (b.x / W) * 100 + '%', top: (b.y / H) * 100 + '%' }" :title="b.why">{{ b.word }}</span>
    <div class="axis"><span>24 小时前</span><span>12 小时前</span><span>现在</span></div>
  </div>
</template>

<style scoped>
.tide { position: relative; padding-top: 14px; }
.band { width: 100%; height: 96px; display: block; border-radius: 14px; background: #faf8fa; }
.buoy { position: absolute; transform: translate(-50%, -100%); font-size: 0.68rem; background: #fff; border-radius: 999px; padding: 1px 7px; box-shadow: 0 2px 6px rgba(0, 0, 0, .06); color: #8a6a7c; white-space: nowrap; }
.axis { display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--text-3); margin-top: 4px; }
</style>
