<script setup>
// 主页的小书桌（共写）：像素书桌的一角（窗、书架、桌面），白天 / 夜里跟着时间；大尺寸时旁边写着在写什么
import { computed } from "vue";
import { useRouter } from "vue-router";
import { projects, freshNotes } from "../../lib/writing.js";
import { isNight, WALL } from "../../lib/deskScene.js";
import DeskScene from "../write/DeskScene.vue";

const props = defineProps({ size: String, editing: Boolean });
const router = useRouter();
const night = isNight();
const books = computed(() => projects());
const latest = computed(() => [...books.value].sort((a, b) => b.updatedAt - a.updatedAt)[0]);
const fresh = computed(() => freshNotes().length);
const go = () => { if (!props.editing) router.push("/write"); };
</script>

<template>
  <div class="dw" :class="[size, { night }]" :style="{ background: night ? WALL.night : WALL.day }" @click="go">
    <div class="pic"><div class="crop"><DeskScene :night="night" :books="books" :notes="freshNotes()" :interactive="false" /></div></div>
    <div v-if="size === 'large'" class="txt">
      <b>Desk</b>
      <span v-if="latest">在写《{{ latest.title }}》</span>
      <span v-else>放一本在写的书</span>
      <small v-if="fresh">{{ fresh }} 张新便利贴</small>
      <small v-else-if="books.length">{{ books.length }} 本在书架上</small>
    </div>
  </div>
</template>

<style scoped>
.dw { position: absolute; inset: 0; border-radius: inherit; display: flex; background: #ece7df; cursor: pointer; overflow: hidden; }
.dw.night { background: #2d313c; color: #e4e4ea; }
.pic { position: relative; height: 100%; aspect-ratio: 0.9; flex: none; overflow: hidden; }
.dw.small .pic { margin: 0 auto; }
/* 只露窗户到桌面那一段（第 16 到 222 格） */
.crop { position: absolute; left: 50%; top: calc(-16 / 206 * 100%); height: calc(300 / 206 * 100%); transform: translateX(-50%); }
.txt { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 4px; padding: 0 16px 0 6px; min-width: 0; }
.txt b { font-weight: 300; letter-spacing: .2em; font-size: 1.05rem; }
.txt span { font-size: .85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.txt small { font-size: .72rem; opacity: .6; }
</style>
