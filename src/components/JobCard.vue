<script setup>
// 派活的进度卡片：小章鱼把活派给云端的 Codex、小螃蟹派去云端的 CC，聊天里都是这张卡片。
// Codex 有排队 / 开工 / 做完 / 没做成（id）；CC 官网云端没有中间进度，只有开工 / 做完两态（cloud={ url, done }，会话网址收在卡片里，点一下打开）
import { computed, onMounted } from "vue";
import { jobState, refreshJob } from "../lib/codexJobs.js";

const props = defineProps({ id: String, cloud: Object });
const j = computed(() => (props.id ? jobState[props.id] : null));
onMounted(() => props.id && refreshJob(props.id));
const who = computed(() => (props.cloud ? "云端 CC" : j.value?.kind === "tavern" ? "服务器上的 CC" : "云端 Codex"));
// 改的是哪个仓库（没写过的老活就是栖所）
const repo = computed(() => (props.id && !j.value ? "" : String((props.cloud ? props.cloud.repo : j.value?.repo) || "Dwellingplace").split("/").pop()));
function open() { if (props.cloud?.url) window.open(props.cloud.url, "_blank", "noopener"); }

const STATE = {
  queued: ["排队中", "wait"], running: ["开工了", "run"], done: ["做完了，报告在下面", "ok"],
  failed: ["没做成，原因在下面", "bad"], blocked: ["先没动手，原因在下面", "bad"],
};
const label = computed(() => {
  if (props.cloud) return props.cloud.done ? ["做完了，报告在下面", "ok"] : ["开工了", "run"];
  const s = j.value?.status;
  if (!s) return ["正在问进度…", "wait"];
  if (s === "queued" && j.value.position > 0) return [`排队中（前面还有 ${j.value.position} 件）`, "wait"];
  return STATE[s] || [s, "wait"];
});
const step = computed(() => (j.value?.progress || []).at(-1) || "");
</script>

<template>
  <div class="jc" :class="[label[1], { tap: cloud?.url }]" @click="open">
    <div class="top">
      <span class="dot" />
      <b>{{ who }} · {{ label[0] }}</b>
      <span v-if="cloud?.url" class="go">›</span>
    </div>
    <p v-if="repo" class="repo">仓库：{{ repo }}</p>
    <p v-if="step && (j?.status === 'running' || j?.status === 'queued')" class="step">{{ step }}</p>
  </div>
</template>

<style scoped>
.jc { width: min(300px, 100%); box-sizing: border-box; padding: 12px 16px; border-radius: 18px; background: var(--card); color: var(--text); box-shadow: 0 2px 10px rgba(40, 40, 60, .07); text-align: left; margin-top: 8px; }
.tap { cursor: pointer; }
.go { margin-left: auto; color: var(--text-3, #999); }
.top { display: flex; align-items: center; gap: 8px; font-size: .85rem; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: var(--text-3, #999); }
.wait .dot { background: var(--yellow); box-shadow: 0 0 0 1px var(--line); }
.run .dot { background: var(--accent); animation: pulse 1.4s ease-in-out infinite; }
.ok .dot { background: #58c08d; }
.bad .dot { background: var(--danger); }
.repo { margin: 6px 0 0 17px; font-size: .74rem; color: var(--text-2); overflow-wrap: anywhere; }
.step { margin: 6px 0 0 17px; font-size: .74rem; line-height: 1.5; color: var(--text-2); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
@keyframes pulse { 50% { opacity: .3; } }
</style>
