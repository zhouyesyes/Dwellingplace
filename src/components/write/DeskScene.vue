<script setup>
// 像素书桌（共写）：整张画按高度铺满，宽出来的部分可以左右划一点。
// 墙上书架的书可以点（打开那本书），旁边空位放新书；墙上的便利贴点了去那张卡片；点窗户换白天 / 夜里
import { computed } from "vue";
import { W, H, scene } from "../../lib/deskScene.js";

const props = defineProps({ night: Boolean, books: Array, notes: Array, interactive: { type: Boolean, default: true } });
const emit = defineEmits(["open", "add", "toggle", "paper", "note"]);
const s = computed(() => scene({ night: props.night, books: props.books || [], notes: props.notes || [] }));
// 一格占画面的百分之几（放可点的按钮用）
const pos = b => ({ left: `${(b.x / W) * 100}%`, top: `${(b.y / H) * 100}%`, width: `${(b.w / W) * 100}%`, height: `${(b.h / H) * 100}%` });
</script>

<template>
  <div class="desk-art" :class="{ night }">
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" class="art" aria-hidden="true">
      <defs>
        <linearGradient id="beam" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stop-color="#fff6d8" stop-opacity=".5" />
          <stop offset="1" stop-color="#fff6d8" stop-opacity="0" />
        </linearGradient>
      </defs>
      <rect v-for="(r, i) in s.rects" :key="i" :x="r.x" :y="r.y" :width="r.w" :height="r.h" :fill="r.c" />
      <polygon v-if="s.beam" :points="s.beam" fill="url(#beam)" class="beam" />
    </svg>
    <template v-if="interactive">
      <button class="hit win" :style="pos(s.window)" aria-label="换白天或夜里" @click="emit('toggle')" />
      <button v-for="b in s.slots" :key="b.id" class="hit book" :style="pos(b)" :aria-label="books.find(x => x.id === b.id)?.title" @click="emit('open', b.id)" />
      <button v-if="(books || []).length < 8" class="hit add" :style="pos(s.add)" aria-label="放一本新书"><span @click="emit('add')">＋</span></button>
      <button v-for="n in s.notes" :key="n.id" class="hit note" :style="pos(n)" aria-label="便利贴" @click="emit('note', n.id)" />
      <button class="hit paper" :style="pos(s.paper)" aria-label="稿纸" @click="emit('paper')" />
    </template>
  </div>
</template>

<style scoped>
.desk-art { position: relative; height: 100%; aspect-ratio: 96 / 160; image-rendering: pixelated; }
.art { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.beam { mix-blend-mode: screen; animation: sway 14s ease-in-out infinite; }
@keyframes sway { 50% { opacity: .72; } }
.hit { position: absolute; border: 0; padding: 0; background: transparent; cursor: pointer; }
.hit.book:active, .hit.note:active { background: rgba(var(--glass-rgb), .3); }
.hit.add { display: grid; place-items: center; border: 1px dashed rgba(120, 90, 60, .5); border-radius: 1px; }
.night .hit.add { border-color: rgba(200, 200, 220, .3); }
.hit.add span { width: 100%; height: 100%; display: grid; place-items: center; font-size: 10px; color: rgba(120, 90, 60, .7); line-height: 1; }
.night .hit.add span { color: rgba(200, 200, 220, .45); }
@media (prefers-reduced-motion: reduce) { .beam { animation: none; } }
</style>
