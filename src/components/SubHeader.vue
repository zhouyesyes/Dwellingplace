<script setup>
import { useRouter } from "vue-router";
import Icon from "./Icon.vue";
import { goBack } from "../lib/nav.js";
defineProps({ title: String });
const router = useRouter();
const back = () => goBack(router, "/settings");
</script>

<template>
  <header class="sub-header">
    <button class="icon-btn" @click="back"><Icon name="back" /></button>
    <h1>{{ title }}</h1>
    <div class="right"><slot /></div>
  </header>
</template>

<style scoped>
.sub-header { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
h1 { flex: 1; margin: 0; font-size: 18px; font-weight: 600; }
.right { display: flex; gap: 8px; }
</style>
