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
const initial = computed(() => Array.from(props.name?.trim() || "?")[0]);
</script>

<template>
  <span class="avatar" :style="{ width: size + 'px', height: size + 'px', '--c': color, fontSize: size * 0.42 + 'px' }">
    <img v-if="url" :src="url" alt="" />
    <span v-else class="initial" :class="{ tall: /^[A-Z0-9bdfhklt]$/.test(initial), short: /^[acemnorsuvwxz]$/.test(initial) }">{{ initial }}</span>
  </span>
</template>

<style scoped>
.avatar {
  flex: none;
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  overflow: hidden;
  background: color-mix(in srgb, var(--c) 45%, var(--avatar-mix));
  color: color-mix(in srgb, var(--c) 55%, var(--avatar-ink, #2e2e34));
  font-family: var(--display-font);
  font-weight: 600;
  box-shadow: 0 0 0 2px var(--card), 0 2px 8px rgba(40, 40, 60, .12);
}
/* 按字形的可见高度微调默认头像的字母。 */
.initial { line-height: 1; }
.initial.tall { transform: translateY(.055em); }
.initial.short { transform: translateY(-.035em); }
img { width: 100%; height: 100%; object-fit: cover; }
</style>
