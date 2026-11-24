<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { roomOf } from "../lib/rooms.js";
import Icon from "./Icon.vue";
const props = defineProps({ role: Object, rooms: Array, run: Object });
const router = useRouter();
const list = computed(() => (props.rooms || []).map(roomOf).filter(Boolean));
</script>
<template>
  <button v-for="r in list" :key="r.key" class="rcard" @click="router.push(`/garden/${role.id}/${r.key}`)">
    <span class="ico"><Icon name="file" :size="22" /></span>
    <span class="txt"><b>{{ r.label }} · 旧对话</b><small>已停用，记录保留</small></span>
    <span class="go">查看<Icon name="right" :size="14" /></span>
  </button>
</template>

<style scoped>
.rcard { display: flex; align-items: center; gap: 12px; width: min(100%, 300px); margin-top: 6px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 18px; background: var(--card); color: var(--text); text-align: left; box-shadow: var(--shadow-soft); }
.ico { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--blue); color: var(--ink); flex: none; }
.txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.txt b { font-size: .95rem; font-weight: 600; }
.txt small { font-size: .72rem; color: var(--text-3); margin-top: 1px; }
.txt small.live::after { content: ""; display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%; background: var(--text-3); animation: rcardPulse 1.2s ease-in-out infinite; }
.txt small.bad { color: var(--danger); }
@keyframes rcardPulse { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
.go { display: flex; align-items: center; gap: 2px; font-size: .78rem; color: var(--text-2); flex: none; }
</style>
