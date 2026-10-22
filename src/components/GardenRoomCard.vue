<script setup>
// 主聊天里的房间卡片：他说「我们去逛逛」，消息底下出一张，同时他已经在那间房里开工了（见 lib/rooms.js 的 [房间:逛]、gardenTalk.js 的 runRoomFromChat）
// 卡片只是看进度的窗口：底下一行小字跟着变，点一下进到那间房看做到哪了
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { roomOf, roomConnected } from "../lib/rooms.js";
import { wakeName } from "../lib/wake.js";
import { roomRunning, RUN_STALE } from "../lib/gardenTalk.js";
import Icon from "./Icon.vue";

const props = defineProps({ rooms: Array, role: Object, run: Object });
const router = useRouter();
const icon = { stroll: "globe", play: "smile", nostos: "box" };
const list = computed(() => (props.rooms || []).map(roomOf).filter(Boolean));
const now = ref(Date.now());
let tick = null;
onMounted(() => { tick = setInterval(() => { now.value = Date.now(); }, 20_000); });
onBeforeUnmount(() => clearInterval(tick));
// 底下那行小字：正在逛… / 逛完了 / 出错了；旧卡片（没有进度）还是显示房间的介绍
const doing = { stroll: ["正在逛…", "逛完了"], play: ["正在玩…", "玩完了"], nostos: ["正在玩雾潮群岛…", "玩完了"] };
const status = r => {
  const x = props.run;
  if (!x || x.key !== r.key) return roomConnected(props.role, r.key) ? r.sub : "这间房还没接上工具";
  if (x.state === "notools") return "这间房还没接上工具";
  if (x.state === "error") return "出错了";
  if (x.state === "done") return doing[r.key][1];
  if (!roomRunning(props.role, r.key) && now.value - x.at > RUN_STALE) return "中断了，点进去看看";
  return doing[r.key][0];
};
const live = r => props.run?.key === r.key && props.run.state === "running" && (roomRunning(props.role, r.key) || now.value - props.run.at <= RUN_STALE);
</script>

<template>
  <button v-for="r in list" :key="r.key" class="rcard" @click="router.push(`/garden/${role.id}/${r.key}`)">
    <span class="ico"><Icon :name="icon[r.key]" :size="22" /></span>
    <span class="txt"><b>{{ wakeName(role) }} 的「{{ r.label }}」</b><small :class="{ live: live(r), bad: run?.key === r.key && run.state === 'error' }">{{ status(r) }}</small></span>
    <span class="go">{{ run?.key === r.key ? "看看" : "进去" }}<Icon name="right" :size="14" /></span>
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
