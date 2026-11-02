<script setup>
// 聊天记录卡片（聊天里、确认框里都用这张）：标题 + 前三句 + 「聊天记录」小字
import { computed } from "vue";
import { previewLines } from "../../lib/share.js";
import Icon from "../Icon.vue";
const props = defineProps({ share: Object, flat: Boolean });
const lines = computed(() => previewLines(props.share));
const more = computed(() => props.share.items.length - lines.value.length);
</script>

<template>
  <div class="share-card" :class="{ flat }">
    <div class="title">{{ share.title }}</div>
    <div class="lines">
      <p v-for="(l, i) in lines" :key="i"><b>{{ l.name }}：</b>{{ l.text }}</p>
      <p v-if="more > 0" class="more">…</p>
    </div>
    <div class="foot"><Icon name="chat" :size="13" />聊天记录 · {{ share.items.length }} 条</div>
  </div>
</template>

<style scoped>
.share-card {
  width: min(72vw, 270px); box-sizing: border-box; text-align: left; cursor: pointer;
  background: var(--card); color: var(--text); border-radius: 18px; border-bottom-right-radius: 4px;
  padding: 12px 14px 8px; box-shadow: var(--shadow-soft); border: 1px solid var(--line);
}
.share-card.flat { width: 100%; cursor: default; border-bottom-right-radius: 18px; }
.title { font-size: .95rem; font-weight: 700; line-height: 1.35; }
.lines { margin-top: 6px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.lines p { margin: 2px 0 0; font-size: .8rem; line-height: 1.5; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-all; }
.lines b { font-weight: 600; color: var(--text-2); }
.lines .more { line-height: 1; color: var(--text-3); }
.foot { display: flex; align-items: center; gap: 4px; margin-top: 6px; font-size: .7rem; color: var(--text-3); }
</style>
