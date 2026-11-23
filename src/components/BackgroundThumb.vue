<script setup>
import { useImage } from "../lib/images.js";

const props = defineProps({ id: String });
const url = useImage(() => props.id);
</script>

<template>
  <img v-if="url" :src="url" alt="" />
</template>

<style scoped>
img { width: 22px; height: 22px; object-fit: cover; border-radius: 4px; }
</style>
