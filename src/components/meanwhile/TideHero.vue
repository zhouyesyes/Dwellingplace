<script setup>
// 顶上的浪花和标题：浪花从上面垂下来，MEANWHILE 一个字母一个字母轻轻浮在水上晃（只用 transform，不费电）
import layout from "../../assets/meanwhile/title.json";
import waveDay from "../../assets/meanwhile/wave-day.webp";
import waveNight from "../../assets/meanwhile/wave-night.webp";
import subtitle from "../../assets/meanwhile/subtitle.png";

const files = import.meta.glob("../../assets/meanwhile/title-*.png", { eager: true, import: "default" });
const W = layout.w, H = layout.totalH;
const pct = (v, total) => `${(v / total) * 100}%`;
const letters = layout.letters.map(l => ({
  i: l.i,
  style: { left: pct(l.x, W), top: pct(l.y, H), width: pct(l.w, W), height: pct(l.h, H), "--m": `url(${files[`../../assets/meanwhile/title-${l.i}.png`]})`, "--d": `${l.i * 0.22}s` },
}));
const sub = { left: pct(layout.sub.x, W), top: pct(layout.sub.y, H), width: pct(layout.sub.w, W), height: pct(layout.sub.h, H), "--m": `url(${subtitle})` };
</script>

<template>
  <header class="hero">
    <img class="wave day" :src="waveDay" alt="" draggable="false" />
    <img class="wave night" :src="waveNight" alt="" draggable="false" />
    <h1 class="title" :style="{ aspectRatio: `${W} / ${H}` }" aria-label="Meanwhile">
      <span v-for="l in letters" :key="l.i" class="ch" :style="l.style" aria-hidden="true" />
      <span class="sub" :style="sub" aria-hidden="true" />
    </h1>
    <p class="zh">同一屋檐下</p>
  </header>
</template>

<style scoped>
.hero { position: relative; text-align: center; --ink-title: #4a6086; }
:root[data-theme="dark"] .hero { --ink-title: #a9c1e2; }
.wave { display: block; width: 100%; height: auto; aspect-ratio: 720 / 485; transform-origin: 50% 0; animation: sway 9s ease-in-out infinite alternate; }
.wave.night { display: none; }
:root[data-theme="dark"] .wave.day { display: none; }
:root[data-theme="dark"] .wave.night { display: block; }
.title { position: relative; width: 76%; margin: -30px auto 0; font-size: 0; }
.ch, .sub { position: absolute; background: var(--ink-title); -webkit-mask: var(--m) center / 100% 100% no-repeat; mask: var(--m) center / 100% 100% no-repeat; }
.ch { animation: bob 3.2s ease-in-out infinite; animation-delay: var(--d); will-change: transform; }
.zh { margin: 4px 0 0; font-size: .82rem; letter-spacing: .5em; text-indent: .5em; color: var(--text-2); }
@keyframes bob { 0%, 100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-4px) rotate(-.8deg); } }
@keyframes sway { from { transform: scaleY(1); } to { transform: scaleY(1.035); } }
@media (prefers-reduced-motion: reduce) { .ch, .wave { animation: none; } }
</style>
