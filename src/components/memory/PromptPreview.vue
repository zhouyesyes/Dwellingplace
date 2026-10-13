<script setup>
// 「看看发给他的」：把某个地方会发给他的东西一段一段摆出来（标题、多少字），方便查错
import { computed } from "vue";
import Sheet from "../Sheet.vue";

const props = defineProps({ open: Boolean, title: String, parts: Array });
defineEmits(["close"]);
const total = computed(() => (props.parts || []).reduce((a, p) => a + (p.text || "").length, 0));
// 粗略估一下 tokens：中文差不多一字一个多一点，英文四个字母一个
const tok = n => (n < 1000 ? `${n} 字` : `${(n / 1000).toFixed(1)} 千字`);
</script>

<template>
  <Sheet :open="open" :title="title" @close="$emit('close')">
    <p class="sum">一共约 {{ tok(total) }}，按发给他的先后排。</p>
    <details v-for="(p, i) in parts || []" :key="i" class="part" :open="i === 0 && (parts || []).length < 3">
      <summary><b>{{ i + 1 }}. {{ p.label }}</b><span>{{ tok((p.text || "").length) }}</span></summary>
      <pre>{{ p.text }}</pre>
    </details>
  </Sheet>
</template>

<style scoped>
.sum { margin: 0 0 10px; font-size: .78rem; color: var(--text-3); }
.part { background: var(--bg); border-radius: 14px; margin-bottom: 8px; overflow: hidden; }
.part summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 14px; cursor: pointer; list-style: none; font-size: .88rem; }
.part summary::-webkit-details-marker { display: none; }
.part summary span { font-size: .72rem; color: var(--text-3); flex: none; }
.part[open] summary { border-bottom: 1px solid var(--line); }
pre { margin: 0; padding: 10px 14px 14px; white-space: pre-wrap; word-break: break-word; font-family: var(--font); font-size: .8rem; line-height: 1.7; color: var(--text-2); max-height: 50vh; overflow-y: auto; }
</style>
