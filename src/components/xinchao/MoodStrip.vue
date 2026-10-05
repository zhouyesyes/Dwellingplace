<script setup>
// 心情天气：最近 24 小时，底色是每个小时的心情（暖=开心，冷=低落），上面的小脸是有起因的情绪
import { ref, computed } from "vue";
import { faceGrid, EMOTION_LEGEND } from "../../lib/pixel.js";
import { moodColor } from "../../lib/xinchao.js";
import PixelArt from "../PixelArt.vue";

const props = defineProps({ journal: { type: Array, default: () => [] }, marks: { type: Array, default: () => [] } });
const now = Date.now(), span = 24 * 3600_000;
const samples = computed(() => props.journal
  .map(s => ({ t: Date.parse(s.at), v: Number(s.valence), label: s.label }))
  .filter(s => Number.isFinite(s.t))
  .sort((a, b) => a.t - b.t));

// 24 格，每格一小时：用这个小时里（或之前最近的）记录的心情上色
const blocks = computed(() => Array.from({ length: 24 }, (_, i) => {
  const end = now - span + (i + 1) * 3600_000;
  const before = samples.value.filter(s => s.t <= end);
  const s = before[before.length - 1];
  return s ? moodColor(s.v) : "#eeebef";
}));

// 小脸：按时间排开，挤在一起的往上叠
const faces = computed(() => {
  const placed = [];
  return props.marks
    .map(m => ({ ...m, t: Date.parse(m.at) }))
    .filter(m => Number.isFinite(m.t) && m.t >= now - span)
    .sort((a, b) => a.t - b.t)
    .map(m => {
      const x = ((m.t - (now - span)) / span) * 100;
      const row = placed.filter(p => Math.abs(p - x) < 9).length;
      placed.push(x);
      return { ...m, x: Math.min(95, Math.max(5, x)), row, grid: faceGrid(m.word) };
    });
});
const picked = ref(null);
const timeOf = t => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };

// 这一天走过的心情：去掉连续重复，最多 6 个
const path = computed(() => {
  const out = [];
  for (const s of samples.value.filter(s => s.t >= now - span)) if (s.label && out[out.length - 1] !== s.label) out.push(s.label);
  return out.slice(-6);
});
const legendOpen = ref(false);
const legend = EMOTION_LEGEND.map(([w, d]) => ({ w, d, grid: faceGrid(w) }));
</script>

<template>
  <div class="strip">
    <div class="sky" :style="{ paddingTop: 30 + Math.min(2, Math.max(0, ...faces.map(f => f.row))) * 26 + 'px' }">
      <button v-for="(f, i) in faces" :key="i" class="face" :style="{ left: f.x + '%', bottom: 18 + f.row * 26 + 'px' }" @click="picked = f">
        <PixelArt :grid="f.grid" :size="26" />
      </button>
      <div class="band"><i v-for="(c, i) in blocks" :key="i" :style="{ background: c }"></i></div>
    </div>
    <div class="axis"><span>24 小时前</span><span>12 小时前</span><span>现在</span></div>
    <p v-if="picked" class="picked">{{ timeOf(picked.t) }} · <b>{{ picked.word }}</b><template v-if="picked.why">：{{ picked.why }}</template></p>
    <p v-else-if="!faces.length" class="hint">这一天还没有冒出有起因的情绪。</p>
    <p v-if="path.length > 1" class="path">这一天走过 {{ path.join(" → ") }}</p>
    <button class="legend-btn" @click="legendOpen = !legendOpen">{{ legendOpen ? "收起图例" : "小脸都是什么" }}</button>
    <div v-if="legendOpen" class="legend">
      <div v-for="l in legend" :key="l.w" class="lg">
        <PixelArt :grid="l.grid" :size="26" />
        <span><b>{{ l.w }}</b><small>{{ l.d }}</small></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.strip { padding-top: 4px; }
.sky { position: relative; }
.face { position: absolute; transform: translateX(-50%); border: 0; background: none; padding: 0; }
.face:active { transform: translateX(-50%) scale(.9); }
.band { display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); height: 18px; border-radius: 4px; overflow: hidden; }
.band i { display: block; }
.axis { display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--text-3); margin-top: 4px; }
.picked, .path, .hint { font-size: 0.82rem; color: var(--text-2); margin: 8px 2px 0; line-height: 1.6; }
.hint { color: var(--text-3); }
.legend-btn { display: block; margin: 8px auto 0; border: 0; background: none; color: var(--text-3); font-size: 0.8rem; }
.legend { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; margin-top: 10px; }
.lg { display: flex; align-items: center; gap: 8px; min-width: 0; }
.lg span { display: flex; flex-direction: column; min-width: 0; }
.lg b { font-size: 0.85rem; }
.lg small { font-size: 0.72rem; color: var(--text-3); }
</style>
