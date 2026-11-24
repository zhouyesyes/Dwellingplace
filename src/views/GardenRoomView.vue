<script setup>
// 小房间退出使用，旧链接仍可查看原来的对话和摘要。
import { ref, computed, watch, onMounted, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { roleById } from "../store/index.js";
import { roomOf } from "../lib/rooms.js";
import { loadGRoom, gSum } from "../lib/gardenTalk.js";
import { blockMd } from "../lib/inlineMd.js";
import { goBack } from "../lib/nav.js";
import Icon from "../components/Icon.vue";
const route = useRoute(), router = useRouter();
const role = computed(() => roleById(String(route.params.roleId)));
const key = computed(() => String(route.params.room));
const room = computed(() => roomOf(key.value));
const owner = computed(() => role.value ? gSum(role.value, key.value) : null);
const msgs = ref([]), scroller = ref(null);
const nt = n => typeof n === "string" ? n : n.text;
async function load() {
  if (!role.value || !room.value) return router.replace("/");
  msgs.value = await loadGRoom(role.value, key.value);
  await nextTick();
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
}
onMounted(load);
watch(() => [route.params.roleId, route.params.room], load);
</script>
<template>
  <div v-if="role && room" class="rt" style="--dock: 0px">
    <header class="bar">
      <button class="icon-btn" aria-label="返回" @click="goBack(router, `/chat/${role.id}`)"><Icon name="back" /></button>
      <div class="ttl"><b>{{ room.label }} · 旧对话</b><small>房间已停用，记录仍保留</small></div>
      <button class="btn small" @click="router.push(`/chat/${role.id}`)">去聊天</button>
    </header>
    <main ref="scroller" class="list">
      <p class="off">工具已统一到主聊天和唤醒中，这里只保留以前的记录。</p>
      <details v-if="owner?.talkSum?.text"><summary>对话摘要</summary><p class="sum">{{ owner.talkSum.text }}</p></details>
      <p v-if="!msgs.length" class="empty">还没有旧对话</p>
      <div v-for="m in msgs" :key="m.id" class="m" :class="m.from === 'me' ? 'me' : 'ai'">
        <p v-if="m.from === 'me'">{{ m.text }}</p>
        <template v-else>
          <div v-for="(para, i) in (m.text || '').split(/\n\s*\n/).filter(x => x.trim())" :key="i" class="mt" v-html="blockMd(para)" />
          <small v-for="(n, i) in m.notes || []" :key="i" class="note">{{ nt(n) }}</small>
        </template>
      </div>
    </main>
  </div>
</template>

<style scoped>
.rt { height: 100dvh; background: var(--bg); display: flex; flex-direction: column; }
.bar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 8px; padding: calc(var(--safe-top) + 10px) 12px 10px; background: rgba(var(--glass-rgb), .86); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); }
.ttl { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ttl b { font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ttl small { font-size: .72rem; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.list { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; max-width: 760px; width: 100%; margin: 0 auto; padding: 14px 16px calc(var(--dock) + var(--safe-bottom) + 24px); display: flex; flex-direction: column; gap: 14px; }
.off { margin: 0; text-align: center; font-size: .8rem; line-height: 1.7; color: var(--text-2); background: var(--card); border-radius: 14px; padding: 10px 14px; box-shadow: var(--shadow-soft); }
.empty { text-align: center; color: var(--text-3); font-size: .84rem; line-height: 1.8; margin: 30px 8px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.empty p { margin: 0 0 6px; }
.idea { border: 0; background: var(--card); color: var(--text-2); border-radius: 999px; padding: 7px 14px; font-size: .8rem; box-shadow: var(--shadow-soft); }
.sum-tip { align-self: center; margin: 0; font-size: .72rem; color: var(--text-3); background: var(--card); border-radius: 999px; padding: 4px 12px; cursor: pointer; }
.m.me { align-self: flex-end; max-width: 82%; }
.m.me p { margin: 0; background: var(--card); color: var(--text); padding: 10px 14px; border-radius: 18px 18px 4px 18px; box-shadow: var(--shadow-soft); white-space: pre-wrap; line-height: 1.65; font-size: .95rem; }
.m.ai { color: var(--text); line-height: 1.8; font-size: .97rem; }
.m.ai .note { display: block; font-size: .72rem; color: var(--text-3); margin-top: 4px; }
.m.ai .note.more { cursor: pointer; }
.detail { margin: 4px 0 0; padding: 8px 10px; border-radius: 10px; background: var(--card); color: var(--text-2); font: inherit; font-size: .72rem; line-height: 1.6; white-space: pre-wrap; word-break: break-all; max-height: 220px; overflow-y: auto; }
.mt { margin-bottom: .7em; }
.mt :deep(p) { margin: 0 0 .6em; }
.mt :deep(.md-h) { margin: .6em 0 .3em; font-weight: 700; }
.mt :deep(.md-list) { margin: .2em 0 .6em; padding-left: 1.3em; }
.mt :deep(.md-quote) { margin: .3em 0; padding-left: 10px; border-left: 3px solid var(--line); color: var(--text-2); }
.mt :deep(.md-tbl) { overflow-x: auto; margin: .4em 0; }
.mt :deep(table) { border-collapse: collapse; font-size: .88em; }
.mt :deep(td), .mt :deep(th) { border: 1px solid var(--line); padding: 4px 8px; }
.dots { display: inline-flex; gap: 5px; padding: 6px 2px; }
.dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); animation: hop 1.2s infinite; }
.dots i:nth-child(2) { animation-delay: .15s; }
.dots i:nth-child(3) { animation-delay: .3s; }
@keyframes hop { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }
.dock { position: fixed; left: 0; right: 0; bottom: 0; z-index: 6; display: flex; align-items: flex-end; gap: 8px; max-width: 760px; margin: 0 auto; padding: 10px 14px var(--dock-bottom); }
.dock .input { flex: 1; resize: none; min-height: 44px; height: 44px; max-height: 40vh; line-height: 1.5; border-radius: 22px; padding: 11px 16px; background: rgba(var(--glass-rgb), .92); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); box-shadow: var(--shadow-soft); }
.dock .input:disabled { opacity: .6; }
.send { width: 44px; height: 44px; border-radius: 50%; border: 0; display: grid; place-items: center; background: var(--card); color: var(--text-3); box-shadow: var(--shadow-soft); flex: none; }
.send.on { background: var(--ink); color: var(--on-ink); }
.acts { display: flex; flex-direction: column; gap: 4px; }
.acts button { display: flex; align-items: center; gap: 10px; border: 0; background: none; padding: 12px 6px; font-size: .95rem; color: var(--text); text-align: left; }
.acts .danger { color: var(--danger); }
.info { font-size: .8rem; color: var(--text-3); line-height: 1.7; margin: 0 4px 8px; }
.lim { margin: 0 4px 10px; display: flex; flex-direction: column; gap: 6px; }
.lim b { font-size: .88rem; font-weight: 500; }
.lim small { font-size: .72rem; color: var(--text-3); }
.seg { display: flex; gap: 6px; flex-wrap: wrap; }
.seg button { border: 0; background: var(--card); color: var(--text-2); border-radius: 999px; padding: 6px 13px; font-size: .8rem; box-shadow: var(--shadow-soft); }
.seg button.on { background: var(--ink); color: var(--on-ink); }
.sum { white-space: pre-wrap; font-family: inherit; font-size: .86rem; line-height: 1.75; color: var(--text-2); max-height: 60vh; overflow-y: auto; margin: 0; }
.ins { background: var(--card); border-radius: 14px; padding: 10px 12px; margin-bottom: 8px; box-shadow: var(--shadow-soft); }
.ins .meta { display: flex; justify-content: space-between; align-items: center; font-size: .72rem; color: var(--text-3); }
.ins .meta button { border: 0; background: none; color: var(--text-3); padding: 2px; }
.ins p { margin: 4px 0 0; font-size: .9rem; line-height: 1.7; }
.none { margin: 0 4px 8px; font-size: .78rem; color: var(--text-3); }
.sub { margin: 14px 4px 8px; font-size: .84rem; font-weight: 500; color: var(--text-2); }
.sub small { margin-left: 8px; font-weight: 400; color: var(--text-3); font-size: .72rem; }
</style>
