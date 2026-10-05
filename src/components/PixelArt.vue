<script setup>
// 把一张像素图（二维颜色数组）画出来
import { computed } from "vue";
import { toRects } from "../lib/pixel.js";

const props = defineProps({ grid: { type: Array, required: true }, size: { type: [Number, String], default: 28 } });
const rects = computed(() => toRects(props.grid));
const w = computed(() => props.grid[0]?.length || 1);
const h = computed(() => props.grid.length || 1);
</script>

<template>
  <svg :viewBox="`0 0 ${w} ${h}`" :width="size" :height="(Number(size) * h) / w" shape-rendering="crispEdges" class="pixel" aria-hidden="true">
    <rect v-for="(r, i) in rects" :key="i" :x="r.x" :y="r.y" :width="r.w" height="1" :fill="r.c" />
  </svg>
</template>

<style scoped>
.pixel { display: block; image-rendering: pixelated; }
</style>
