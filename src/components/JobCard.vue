<script setup>
// 派活的进度卡片：小章鱼把活派给云端的 Codex 以后，聊天里这张卡片显示排队 / 开工 / 做完 / 没做成，和小螃蟹的网址卡片放在同一个位置
import { computed, onMounted } from "vue";
import { jobState, refreshJob } from "../lib/codexJobs.js";

const props = defineProps({ id: String });
const j = computed(() => jobState[props.id]);
onMounted(() => refreshJob(props.id));

const STATE = {
  queued: ["排队中", "wait"], running: ["开工了", "run"], done: ["做完了，报告在下面", "ok"],
  failed: ["没做成，原因在下面", "bad"], blocked: ["先没动手，原因在下面", "bad"],
};
const label = computed(() => {
  const s = j.value?.status;
  if (!s) return ["正在问进度…", "wait"];
  if (s === "queued" && j.value.position > 0) return [`排队中（前面还有 ${j.value.position} 件）`, "wait"];
  return STATE[s] || [s, "wait"];
});
const step = computed(() => (j.value?.progress || []).at(-1) || "");
</script>

<template>
  <div class="jc" :class="label[1]">
    <div class="top">
      <span class="dot" />
      <b>云端 Codex · {{ label[0] }}</b>
    </div>
    <p v-if="step && (j?.status === 'running' || j?.status === 'queued')" class="step">{{ step }}</p>
  </div>
</template>

<style scoped>
.jc { width: min(300px, 100%); box-sizing: border-box; padding: 12px 16px; border-radius: 18px; background: var(--card); color: var(--text); box-shadow: 0 2px 10px rgba(40, 40, 60, .07); text-align: left; margin-top: 8px; }
.top { display: flex; align-items: center; gap: 8px; font-size: .85rem; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: var(--text-3, #999); }
.wait .dot { background: var(--yellow); box-shadow: 0 0 0 1px var(--line); }
.run .dot { background: var(--accent); animation: pulse 1.4s ease-in-out infinite; }
.ok .dot { background: #58c08d; }
.bad .dot { background: var(--danger); }
.step { margin: 6px 0 0 17px; font-size: .74rem; line-height: 1.5; color: var(--text-2); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
@keyframes pulse { 50% { opacity: .3; } }
</style>
