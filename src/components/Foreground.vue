<script setup>
// 四个主页面（底栏那四个）上一层统一的前景：现在是小小的白花瓣慢慢飘下来。
// kind 以后可以按天气换（下雨、下雪……），在这里加一种就行；设置 → 外观里可以关掉
import { computed } from "vue";
import { store } from "../store/index.js";

const PETALS = Object.values(import.meta.glob("../assets/petals/*.png", { eager: true, import: "default" }));
const kind = computed(() => store.settings.foreground ?? "petals");

// 随机但每次打开都一样：位置、大小、快慢、晃的幅度
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const items = Array.from({ length: 14 }, (_, i) => ({
  src: PETALS[i % PETALS.length],
  left: rnd() * 100, // vw
  size: 9 + rnd() * 9, // 小小的：9～18px
  dur: 16 + rnd() * 14, // 落一次多少秒
  delay: -rnd() * 30, // 一打开就已经在半空里
  sway: 18 + rnd() * 34, // 左右飘多远
  spin: (rnd() < .5 ? -1 : 1) * (160 + rnd() * 260),
  op: .55 + rnd() * .35,
}));
</script>

<template>
  <div v-if="kind === 'petals' && PETALS.length" class="fg" aria-hidden="true">
    <span v-for="(p, i) in items" :key="i" class="drop"
      :style="{ left: p.left + 'vw', '--dur': p.dur + 's', '--delay': p.delay + 's', '--sway': p.sway + 'px', '--spin': p.spin + 'deg', opacity: p.op }">
      <img :src="p.src" alt="" :style="{ width: p.size + 'px' }" />
    </span>
  </div>
</template>

<style scoped>
.fg { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 30; }
.drop { position: absolute; top: -30px; animation: fall var(--dur) linear var(--delay) infinite; }
.drop img { display: block; height: auto; animation: sway calc(var(--dur) / 3) ease-in-out var(--delay) infinite alternate; filter: drop-shadow(0 1px 1.5px rgba(80, 70, 60, .18)); }
@keyframes fall { to { transform: translateY(calc(100lvh + 60px)); } }
@keyframes sway { from { transform: translateX(calc(var(--sway) * -1)) rotate(0deg); } to { transform: translateX(var(--sway)) rotate(var(--spin)); } }
:root[data-theme="dark"] .drop img { filter: brightness(.85) drop-shadow(0 1px 1.5px rgba(0, 0, 0, .3)); }
@media (prefers-reduced-motion: reduce) { .fg { display: none; } }
</style>
