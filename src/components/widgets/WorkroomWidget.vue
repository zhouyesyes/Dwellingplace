<script setup>
// 主页的工作间小组件：有没有任务在干活、有几处等你点、额度用了多少；点一下进工作间
import { computed, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { wr, refresh, limitsOf } from "../../lib/workroom.js";

const props = defineProps({ size: String, editing: Boolean });
const router = useRouter();
let timer = null;
onMounted(() => { refresh(); timer = setInterval(() => document.visibilityState === "visible" && refresh(), 60_000); });
onBeforeUnmount(() => clearInterval(timer));
const st = computed(() => wr.status);
const working = computed(() => (st.value?.threads || []).filter(t => t.turnId));
const waiting = computed(() => (st.value?.approvals || []).length);
const latest = computed(() => (st.value?.threads || []).filter(t => t.status !== "archived")[0]);
const lim = computed(() => limitsOf(st.value?.rateLimits)[0]);
const line = computed(() => {
  if (!st.value) return wr.error ? "还没接上服务器" : "在连…";
  if (!st.value.account) return "还没登录 Codex";
  if (waiting.value) return `${waiting.value} 处等你点`;
  if (working.value.length) return `「${working.value[0].title}」正在干活`;
  return latest.value ? `上次：${latest.value.title}` : "开一个项目试试";
});
const go = () => { if (!props.editing) router.push("/work"); };
</script>

<template>
  <div class="ww" :class="size" @click="go">
    <div class="term">
      <i class="d r" /><i class="d y" /><i class="d g" />
      <code><span class="pr">$</span> {{ working.length ? "working" : "ready" }}<b v-if="working.length" class="cur" /></code>
    </div>
    <div class="txt">
      <b>Workroom</b>
      <span :class="{ ask: waiting }">{{ line }}</span>
      <small v-if="lim">{{ lim.label }}额度用了 {{ lim.used }}%</small>
    </div>
  </div>
</template>

<style scoped>
.ww { position: absolute; inset: 0; border-radius: inherit; display: flex; gap: 14px; padding: 16px 18px; background: var(--card); cursor: pointer; }
.ww.small { flex-direction: column; gap: 8px; }
.term { width: 44%; min-width: 96px; border-radius: 10px; background: #23262d; padding: 8px 10px; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 4px; }
.ww.small .term { width: auto; flex: 1; }
.term .d { width: 7px; height: 7px; border-radius: 50%; }
.d.r { background: #ff6b6b; } .d.y { background: #ffd166; } .d.g { background: #6fbf73; }
.term code { flex-basis: 100%; margin-top: 6px; font: .74rem ui-monospace, Menlo, monospace; color: #cfd3dc; }
.pr { color: #6fbf73; }
.cur { display: inline-block; width: 6px; height: 11px; background: #cfd3dc; margin-left: 3px; vertical-align: -1px; animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.txt { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; gap: 3px; min-width: 0; }
.txt b { font-weight: 300; letter-spacing: .2em; font-size: 1.05rem; }
.txt span { font-size: .85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.txt span.ask { color: var(--danger); }
.txt small { font-size: .72rem; color: var(--text-3); }
</style>
