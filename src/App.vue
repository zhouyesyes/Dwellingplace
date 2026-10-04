<script setup>
import { computed, watchEffect } from "vue";
import { useRoute } from "vue-router";
import TabBar from "./components/TabBar.vue";
import Cropper from "./components/Cropper.vue";
import { store } from "./store/index.js";
import { toastText } from "./lib/toast.js";

const route = useRoute();
const tab = computed(() => route.meta.tab);

// 字号：小 / 标准 / 大
const FONT = { small: "13px", standard: "14px", large: "15.5px" };
watchEffect(() => {
  document.documentElement.style.fontSize = FONT[store.settings.fontSize] || FONT.standard;
});
</script>

<template>
  <RouterView />
  <TabBar v-if="tab" :active="tab" />
  <Cropper />
  <Transition name="fade"><div v-if="toastText" class="toast">{{ toastText }}</div></Transition>
</template>
