<script setup>
// 心潮的花：每股驱力一片花瓣，越强越长；花蕊外圈是安全感、里圈是自信，颜色是心境
import { computed } from "vue";
import { driveColor, moodColor } from "../../lib/xinchao.js";

const props = defineProps({ drives: { type: Array, default: () => [] }, stamen: { type: Object, default: null }, word: String });
const emit = defineEmits(["pick"]);

const C = 150; // 中心
const petals = computed(() => {
  const n = props.drives.length || 1;
  return props.drives.map((d, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    // 再弱也留一小片；名字跟在花瓣尖外面
    const len = 52 + Math.max(0, Math.min(1, d.value)) * 70;
    const w = Math.min(30, (Math.PI * 2 * 46) / n / 1.25);
    const deg = (a * 180) / Math.PI + 90;
    const lr = len + 26;
    const lx = C + Math.cos(a) * lr, ly = C + Math.sin(a) * lr;
    return { ...d, len, w, deg, lx, ly, color: driveColor(d.key) };
  });
});
const ring = (r, v) => {
  const c = 2 * Math.PI * r;
  return { r, dash: `${Math.max(0, Math.min(1, v || 0)) * c} ${c}` };
};
const outer = computed(() => ring(30, props.stamen?.security));
const inner = computed(() => ring(22, props.stamen?.confidence));
const core = computed(() => (props.stamen?.mood == null ? "#efe9ee" : moodColor((Number(props.stamen.mood) + 1) / 2)));
</script>

<template>
  <svg viewBox="-28 -6 356 312" class="flower">
    <g v-for="p in petals" :key="p.key" class="petal" @click="emit('pick', p)">
      <path :d="`M ${C} ${C} C ${C - p.w} ${C - p.len * 0.45}, ${C - p.w * 0.8} ${C - p.len}, ${C} ${C - p.len - 8} C ${C + p.w * 0.8} ${C - p.len}, ${C + p.w} ${C - p.len * 0.45}, ${C} ${C} Z`"
        :fill="p.color" fill-opacity=".82" :transform="`rotate(${p.deg} ${C} ${C})`" />
      <text :x="p.lx" :y="p.ly" text-anchor="middle" dominant-baseline="middle" class="lab">{{ p.short || p.label }}</text>
    </g>
    <circle :cx="C" :cy="C" r="38" fill="#fff" />
    <circle :cx="C" :cy="C" :r="outer.r" fill="none" stroke="#efe6ea" stroke-width="5" />
    <circle :cx="C" :cy="C" :r="outer.r" fill="none" stroke="#e6b8c8" stroke-width="5" stroke-linecap="round" :stroke-dasharray="outer.dash" :transform="`rotate(-90 ${C} ${C})`" />
    <circle :cx="C" :cy="C" :r="inner.r" fill="none" stroke="#e9eef6" stroke-width="4" />
    <circle :cx="C" :cy="C" :r="inner.r" fill="none" stroke="#b9c9e6" stroke-width="4" stroke-linecap="round" :stroke-dasharray="inner.dash" :transform="`rotate(-90 ${C} ${C})`" />
    <circle :cx="C" :cy="C" r="16" :fill="core" />
    <text :x="C" :y="C + 1" text-anchor="middle" dominant-baseline="middle" class="word">{{ word }}</text>
  </svg>
</template>

<style scoped>
.flower { width: 100%; max-width: 340px; display: block; margin: 0 auto; overflow: visible; }
.petal { cursor: pointer; }
.petal path { transition: opacity .15s; }
.petal:active path { opacity: .6; }
.lab { font-size: 11px; fill: var(--text-2); }
.word { font-size: 10px; fill: #4a4550; font-weight: 600; }
</style>
