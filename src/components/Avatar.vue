<script setup>
import { computed } from "vue";
import { useImage } from "../lib/images.js";

const props = defineProps({
  img: String,
  name: String,
  color: { type: String, default: "#f5a3b5" },
  size: { type: Number, default: 40 },
});
const url = useImage(() => props.img);
const initial = computed(() => (props.name || "?").trim().slice(0, 1));
</script>

<template>
  <span class="avatar" :style="{ width: size + 'px', height: size + 'px', '--c': color, fontSize: size * 0.42 + 'px' }">
    <img v-if="url" :src="url" alt="" />
    <span v-else>{{ initial }}</span>
  </span>
</template>

<style scoped>
.avatar {
  flex: none;
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  overflow: hidden;
  background: color-mix(in srgb, var(--c) 45%, #ffffff);
  color: color-mix(in srgb, var(--c) 55%, #2e2e34);
  font-weight: 600;
  box-shadow: 0 0 0 2px #ffffff, 0 2px 8px rgba(40, 40, 60, .12);
}
img { width: 100%; height: 100%; object-fit: cover; }
</style>
