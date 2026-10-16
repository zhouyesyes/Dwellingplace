<script setup>
import { computed, ref, watch } from 'vue';
import { safeBookImage } from '../../lib/epubImages.js';
const props = defineProps({ source: String });
const emit = defineEmits(['settled']);
const failed = ref(false);
const src = computed(() => safeBookImage(props.source));
watch(src, () => { failed.value = false; });
</script>

<template>
  <figure class="book-image">
    <img v-if="src && !failed" :src="src" alt="书中插图" @load="emit('settled')" @error="failed = true; emit('settled')" />
    <span v-else class="image-missing" role="img" aria-label="图片暂不可用">图片暂不可用</span>
  </figure>
</template>

<style scoped>
.book-image { margin: .7em 0; width: 100%; break-inside: avoid; text-align: center; text-indent: 0; }
.book-image img { display: block; width: auto; height: auto; max-width: 100%; max-height: var(--image-height, 65vh); object-fit: contain; margin: 0 auto; }
.image-missing { display: block; padding: 20px 8px; font-size: 12px; color: var(--rink, var(--text-2)); opacity: .65; }
</style>
