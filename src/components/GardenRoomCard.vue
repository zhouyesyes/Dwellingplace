<script setup>
// 主聊天里的房间卡片：他说「我们去逛逛」，消息底下出一张，点一下进到他的那间房（见 lib/rooms.js 的 [房间:逛]）
import { computed } from "vue";
import { useRouter } from "vue-router";
import { roomOf, roomConnected } from "../lib/rooms.js";
import { wakeName } from "../lib/wake.js";
import Icon from "./Icon.vue";

const props = defineProps({ rooms: Array, role: Object });
const router = useRouter();
const icon = { stroll: "globe", play: "smile", nostos: "box" };
const list = computed(() => (props.rooms || []).map(roomOf).filter(Boolean));
</script>

<template>
  <button v-for="r in list" :key="r.key" class="rcard" @click="router.push(`/garden/${role.id}/${r.key}`)">
    <span class="ico"><Icon :name="icon[r.key]" :size="22" /></span>
    <span class="txt"><b>{{ wakeName(role) }} 的「{{ r.label }}」</b><small>{{ roomConnected(role, r.key) ? r.sub : "这间房还没接上工具" }}</small></span>
    <span class="go">进去<Icon name="right" :size="14" /></span>
  </button>
</template>

<style scoped>
.rcard { display: flex; align-items: center; gap: 12px; width: min(100%, 300px); margin-top: 6px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 18px; background: var(--card); color: var(--text); text-align: left; box-shadow: var(--shadow-soft); }
.ico { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--blue); color: var(--ink); flex: none; }
.txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.txt b { font-size: .95rem; font-weight: 600; }
.txt small { font-size: .72rem; color: var(--text-3); margin-top: 1px; }
.go { display: flex; align-items: center; gap: 2px; font-size: .78rem; color: var(--text-2); flex: none; }
</style>
