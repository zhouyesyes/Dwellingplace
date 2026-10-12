<script setup>
// 像素书桌（还在做，没装上）：整屏的像素画，按高度铺满，左右可以划一点。墙上书架的书 = 你在写的书。
// 现在只能从 #/write/desk 打开看看；做好了再换成共写的入口
// 白天 / 夜里跟着时间走，点窗户可以换；左上返回，书架上的书点进去
import { ref, computed, onMounted, nextTick } from "vue";
import { useRouter } from "vue-router";
import { projects, newProject, freshNotes } from "../lib/writing.js";
import { isNight, WALL } from "../lib/deskScene.js";
import { goBack } from "../lib/nav.js";
import Icon from "../components/Icon.vue";
import DeskScene from "../components/write/DeskScene.vue";

const router = useRouter();
const night = ref(isNight());
const books = computed(() => projects());
const fresh = computed(() => freshNotes().length);
// 墙上的便利贴：他贴的、你还没看过的（最新的在前）
const wallNotes = computed(() => [...freshNotes()].sort((a, b) => b.ts - a.ts));
const openNote = id => { const n = freshNotes().find(x => x.id === id); if (n) router.push({ path: `/write/${n.projectId}`, query: { card: n.cardId } }); };
const pan = ref(null);
onMounted(async () => {
  await nextTick();
  const el = pan.value;
  if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2; // 从中间开始
});
function add() {
  const t = prompt("新书的名字");
  if (!t?.trim()) return;
  const p = newProject(t);
  router.push(`/write/${p.id}`);
}
const open = id => router.push(`/write/${id}`);
const latest = () => { const p = [...books.value].sort((a, b) => b.updatedAt - a.updatedAt)[0]; p ? open(p.id) : add(); };
</script>

<template>
  <div class="write" :class="{ night }" :style="{ background: night ? WALL.night : WALL.day }">
    <div ref="pan" class="pan">
      <DeskScene :night="night" :books="books" :notes="wallNotes" @open="open" @add="add" @toggle="night = !night" @paper="latest" @note="openNote" />
    </div>
    <header class="over">
      <button class="icon-btn" aria-label="返回" @click="goBack(router, '/')"><Icon name="back" /></button>
      <div class="label"><b>共写</b><span>{{ books.length ? (fresh ? `${fresh} 张新便利贴` : `${books.length} 本在写`) : "点书架上的空位，放第一本书" }}</span></div>
    </header>
  </div>
</template>

<style scoped>
.write { position: fixed; inset: 0; background: #ece7df; }
.write.night { background: #2d313c; }
.pan { position: absolute; inset: 0; overflow-x: auto; overflow-y: hidden; display: flex; justify-content: safe center; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.pan::-webkit-scrollbar { display: none; }
.pan > :deep(.desk-art) { flex: none; height: 100%; }
.over { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 12px; padding: calc(var(--safe-top) + 12px) 16px 0; pointer-events: none; }
.over > * { pointer-events: auto; }
.night .icon-btn { background: rgba(60, 65, 80, .85); color: #e4e4ea; }
.label { display: flex; flex-direction: column; padding: 6px 14px; border-radius: 16px; background: rgba(255, 255, 255, .7); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.night .label { background: rgba(40, 44, 56, .7); color: #e4e4ea; }
.label b { font-weight: 600; font-size: .95rem; letter-spacing: .2em; }
.label span { font-size: .7rem; opacity: .7; }
</style>
