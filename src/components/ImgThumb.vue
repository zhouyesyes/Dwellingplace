<script setup>
import { useImage } from "../lib/images.js";
const props = defineProps({ id: String });
const url = useImage(() => props.id);
</script>

<template>
  <a v-if="url" :href="url" target="_blank" class="thumb"><img :src="url" alt="" /></a>
  <span v-else class="thumb ph" />
</template>

<style scoped>
.thumb { display: block; width: 150px; max-width: 60vw; border-radius: 16px; overflow: hidden; box-shadow: var(--shadow-soft); }
.thumb img { display: block; width: 100%; height: auto; }
.ph { height: 110px; background: var(--bg-deep); }
</style>
