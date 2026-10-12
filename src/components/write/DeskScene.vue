<script setup>
// 像素书桌（共写）：整张画按高度铺满，宽出来的部分可以左右划一点。
// 墙上书架的书可以点（打开那本书），旁边空位放新书；点窗户换白天 / 夜里
import { computed } from "vue";
import { W, H, scene } from "../../lib/deskScene.js";

const props = defineProps({ night: Boolean, books: Array, fresh: Number, interactive: { type: Boolean, default: true } });
const emit = defineEmits(["open", "add", "toggle", "paper"]);
const s = computed(() => scene({ night: props.night, books: props.books || [], fresh: props.fresh || 0 }));
// 一格占画面的百分之几（放可点的按钮用）
const pos = b => ({ left: `${(b.x / W) * 100}%`, top: `${(b.y / H) * 100}%`, width: `${(b.w / W) * 100}%`, height: `${(b.h / H) * 100}%` });
</script>

<template>
  <div class="desk" :class="{ night }">
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" class="art" aria-hidden="true">
      <defs>
        <radialGradient id="lampGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#ffd99a" stop-opacity=".34" />
          <stop offset=".55" stop-color="#ffcf88" stop-opacity=".1" />
          <stop offset="1" stop-color="#ffcf88" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect v-for="(r, i) in s.rects" :key="i" :x="r.x" :y="r.y" :width="r.w" :height="r.h" :fill="r.c" />
      <ellipse v-if="night" :cx="s.lamp.x" :cy="s.lamp.y + 18" rx="44" ry="34" fill="url(#lampGlow)" class="glow" />
    </svg>
    <template v-if="interactive">
      <button class="hit win" :style="pos(s.window)" aria-label="换白天或夜里" @click="emit('toggle')" />
      <button v-for="b in s.slots" :key="b.id" class="hit book" :style="pos(b)" :aria-label="books.find(x => x.id === b.id)?.title" @click="emit('open', b.id)" />
      <button v-if="(books || []).length < 8" class="hit add" :style="pos(s.add)" aria-label="放一本新书" @click="emit('add')"><span>＋</span></button>
      <button class="hit paper" :style="pos(s.paper)" aria-label="稿纸" @click="emit('paper')" />
    </template>
  </div>
</template>

<style scoped>
.desk { position: relative; height: 100%; aspect-ratio: 120 / 200; image-rendering: pixelated; }
.art { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.glow { animation: breathe 6s ease-in-out infinite; }
@keyframes breathe { 50% { opacity: .82; } }
.hit { position: absolute; border: 0; padding: 0; background: transparent; cursor: pointer; }
.hit.book:active { background: rgba(255, 255, 255, .25); }
.hit.add { display: grid; place-items: center; border: 1px dashed rgba(120, 110, 100, .45); border-radius: 1px; }
.night .hit.add { border-color: rgba(200, 200, 220, .3); }
.hit.add span { font-size: 10px; color: rgba(120, 110, 100, .6); line-height: 1; }
.night .hit.add span { color: rgba(200, 200, 220, .45); }
@media (prefers-reduced-motion: reduce) { .glow { animation: none; } }
</style>
