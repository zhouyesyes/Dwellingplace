<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import TabBar from "./components/TabBar.vue";
import { toastText } from "./lib/toast.js";

const route = useRoute();
const tab = computed(() => route.meta.tab);
</script>

<template>
  <RouterView />
  <TabBar v-if="tab" :active="tab" />
  <Transition name="fade"><div v-if="toastText" class="toast">{{ toastText }}</div></Transition>
</template>
