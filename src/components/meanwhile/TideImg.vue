<script setup>
// 动态里的一张图（点开由外面的看图器放大）
import { useImage } from "../../lib/images.js";
const props = defineProps({ id: String });
const url = useImage(() => props.id);
</script>

<template>
  <img v-if="url" class="tide-img" :src="url" alt="" draggable="false" />
  <span v-else class="tide-img ph" />
</template>

<style scoped>
.tide-img { display: block; width: 100%; height: auto; max-height: 420px; object-fit: cover; border-radius: 2px; box-shadow: 0 0 0 1px rgba(0, 0, 0, .06); }
.ph { height: 140px; background: var(--bg-deep); }
</style>
