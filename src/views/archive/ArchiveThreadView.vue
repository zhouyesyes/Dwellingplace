<script setup>
// 旧居里的一段聊天：只看
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, archivedRole, loadMessages } from "../../store/index.js";
import { pathOf, splitBubbles } from "../../lib/chat.js";
import { shortTime } from "../../lib/time.js";
import { inlineMd } from "../../lib/inlineMd.js";
import Avatar from "../../components/Avatar.vue";
import ImgThumb from "../../components/ImgThumb.vue";
import SubHeader from "../../components/SubHeader.vue";

const route = useRoute();
const router = useRouter();
const thread = computed(() => (store.archive?.threads || []).find(t => t.id === route.params.tid));
if (!thread.value) router.replace("/archive");
const group = computed(() => thread.value?.groupId && store.archive.groups.find(g => g.id === thread.value.groupId));
const title = computed(() => group.value?.name || `${archivedRole(thread.value?.roleId)?.name || ""} · ${thread.value?.title || "对话"}`);

const msgs = ref([]);
const shown = ref(80); // 先显示最近 80 条，往上翻再多显示
onMounted(async () => {
  if (!thread.value) return;
  msgs.value = pathOf(thread.value, await loadMessages(thread.value.id)).filter(m => m.from !== "event" && !m.pending);
});
const visible = computed(() => msgs.value.slice(-shown.value));
const who = m => (m.from === "user" ? null : archivedRole(m.speaker || thread.value?.roleId));
const bubbles = m => (m.from === "user" ? [m.text] : splitBubbles(m.text || "")).filter(b => b && b.trim());
const imgs = m => (m.attachments || []).filter(a => a.kind === "image");
</script>

<template>
  <div v-if="thread" class="page">
    <SubHeader :title="title" />
    <button v-if="msgs.length > shown" class="btn soft small more" @click="shown += 100">再往前看 {{ Math.min(100, msgs.length - shown) }} 条</button>
    <div class="msgs">
      <div v-for="m in visible" :key="m.id" class="row" :class="m.from === 'user' ? 'mine' : 'theirs'">
        <Avatar v-if="who(m)" :img="who(m).avatar" :name="who(m).name" :color="who(m).color" :size="32" class="ava" />
        <div class="col">
          <span v-if="group && who(m)" class="name">{{ who(m).name }}</span>
          <div v-for="a in imgs(m)" :key="a.img" class="img"><ImgThumb :id="a.img" /></div>
          <p v-for="(b, i) in bubbles(m)" :key="i" class="b" :style="m.from !== 'user' ? { background: who(m)?.bubbleColor } : {}" v-html="inlineMd(b)" />
          <span class="time">{{ shortTime(m.ts) }}</span>
        </div>
      </div>
    </div>
    <p v-if="!msgs.length" class="empty-hint">这段对话是空的</p>
  </div>
</template>

<style scoped>
.more { display: block; margin: 0 auto 12px; }
.msgs { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; gap: 8px; align-items: flex-start; }
.row.mine { justify-content: flex-end; }
.col { display: flex; flex-direction: column; gap: 4px; max-width: min(78%, 560px); }
.mine .col { align-items: flex-end; }
.name { font-size: 0.75rem; color: var(--text-2); margin-left: 4px; }
.b { margin: 0; padding: 9px 13px; border-radius: 16px; background: var(--card); line-height: 1.65; font-size: 0.93rem; white-space: pre-wrap; overflow-wrap: anywhere; box-shadow: 0 1px 2px rgba(40, 40, 60, .05); }
.mine .b { background: var(--ink); color: #fff; }
.time { font-size: 0.7rem; color: var(--text-3); margin: 0 4px; }
.ava { flex: none; }
</style>
