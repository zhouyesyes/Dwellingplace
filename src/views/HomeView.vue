<script setup>
// 首页和聊天左抽屉共用 HomeShell；这里保留原来的同步与下拉刷新。
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { syncState, startSync, resumeSync } from "../lib/sync.js";
import { useHomePullRefresh } from "../lib/homePullRefresh.js";
import HomeShell from "../components/HomeShell.vue";


// ---------- 下拉刷新、回到前台自动同步（和以前一样） ----------
const refreshing = ref(false);
const home = ref(null);
const feedback = ref("");
let feedbackTimer, disposed = false;
const busy = computed(() => refreshing.value || syncState.busy);
const { distance, armed } = useHomePullRefresh(home, busy, refreshHome);
const pullLabel = computed(() => distance.value ? (armed.value ? "松开刷新" : "下拉刷新") : refreshing.value ? "正在刷新…" : feedback.value);
async function refreshHome() {
  if (busy.value) return;
  clearTimeout(feedbackTimer);
  refreshing.value = true;
  let failed = false;
  try {
    await startSync();
    if (syncState.error) throw new Error(syncState.error);
    feedback.value = syncState.deferred || syncState.pending ? "仍有内容待同步" : !syncState.on ? "尚未连接同步" : "已是最新";
  } catch {
    failed = true;
    feedback.value = "刷新失败，请重试";
  } finally {
    refreshing.value = false;
    if (!disposed) feedbackTimer = setTimeout(() => { feedback.value = ""; }, failed ? 3500 : 1800);
  }
}
let foregroundAt = 0;
function foreground() {
  if (document.visibilityState !== "visible" || Date.now() - foregroundAt < 1000) return;
  foregroundAt = Date.now();
  resumeSync();
}
onMounted(() => {
  foreground();
  document.addEventListener("visibilitychange", foreground);
  window.addEventListener("pageshow", foreground);
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(feedbackTimer);
  document.removeEventListener("visibilitychange", foreground);
  window.removeEventListener("pageshow", foreground);
});

</script>
<template><div ref="home" class="home"><div class="pull" :class="{ on: pullLabel }" role="status" aria-live="polite">{{ pullLabel }}</div><HomeShell /></div></template>
<style scoped>
.home { min-height: 100dvh; background: var(--bg); }
.pull { position: fixed; top: calc(var(--safe-top) + 10px); left: 50%; transform: translateX(-50%); z-index: 5; padding: 6px 14px; border-radius: 99px; background: var(--card); color: var(--text-2); opacity: 0; pointer-events: none; }
.pull.on { opacity: 1; }
</style>
