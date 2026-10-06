<script setup>
// 在小屋的大 SVG 里画一小块像素图（坐标是格子数）
import { computed } from "vue";
import { toRects } from "../../lib/pixel.js";

const props = defineProps({ grid: { type: Array, required: true }, x: { type: Number, default: 0 }, y: { type: Number, default: 0 }, flip: Boolean });
const rects = computed(() => toRects(props.grid));
const w = computed(() => props.grid[0]?.length || 0);
</script>

<template>
  <g :transform="flip ? `translate(${x + w} ${y}) scale(-1 1)` : `translate(${x} ${y})`">
    <rect v-for="(r, i) in rects" :key="i" :x="r.x" :y="r.y" :width="r.w" height="1" :fill="r.c" />
  </g>
</template>
