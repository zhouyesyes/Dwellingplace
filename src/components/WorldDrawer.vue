<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import HomeShell from "./HomeShell.vue";
import { homeDrawerOpen } from "../lib/homeShell.js";
const props = defineProps({ open: Boolean, role: Object, thread: Object });
const emit = defineEmits(["close", "threads", "search", "summary"]);
const panel = ref(null);
let previousFocus;
function close() { homeDrawerOpen.value = false; emit("close"); }
watch(() => props.open, async on => {
  homeDrawerOpen.value = on;
  if (on) { previousFocus = document.activeElement; await nextTick(); panel.value?.focus(); }
  else previousFocus?.focus?.();
});
watch(homeDrawerOpen, on => { if (!on && props.open) emit("close"); });
function keydown(event) {
  if (event.key === "Escape") close();
  if (event.key !== "Tab") return;
  const nodes = [...panel.value.querySelectorAll("button, input, select, summary")].filter(n => n.getClientRects().length);
  const first = nodes[0], last = nodes.at(-1);
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
onBeforeUnmount(() => { homeDrawerOpen.value = false; });
</script>
<template><Teleport to="body"><Transition name="home-drawer"><div v-if="open" class="home-drawer-mask" @click.self="close" @keydown="keydown"><aside ref="panel" class="home-drawer-panel" role="dialog" aria-modal="true" aria-label="缩窄首页" tabindex="-1"><HomeShell compact :role="role" @threads="emit('threads')" @summary="emit('summary')" /></aside></div></Transition></Teleport></template>
