<script setup>
// 记录：日历（从主页搬过来的）+ 日记本
import { ref, computed } from "vue";
import { store, authorInfo } from "../store/index.js";
import { diaryList } from "../lib/diary.js";
import CalendarWidget from "../components/widgets/CalendarWidget.vue";
import DiaryBook from "../components/record/DiaryBook.vue";

const pages = computed(diaryList);
const recent = computed(() => pages.value.map((e, i) => ({ e, i })).slice(-4).reverse());
const book = ref(false);
const start = ref(-1);
function open(i = -1) { start.value = i; book.value = true; }
const who = e => e.from === "me" ? authorInfo("me").name : (store.roles[0]?.name || "他");
const md = d => `${Number(d.slice(5, 7))}.${Number(d.slice(8))}`;
const TITLE = `${import.meta.env.BASE_URL}stickers/octopus/title.png`; // 不能写成 /stickers/…：栖所挂在带口令的路径下
</script>

<template>
  <div class="page record">
    <h1 class="studio">Record</h1>

    <section class="card cal"><CalendarWidget /></section>

    <button class="cover" @click="open()">
      <img :src="TITLE" alt="" />
      <div class="cover-text">
        <b>日记本</b>
        <span>{{ pages.length ? `一起写了 ${pages.length} 页` : "翻开第一页" }}</span>
      </div>
    </button>

    <div v-if="recent.length" class="recent">
      <button v-for="{ e, i } in recent" :key="e.id" class="entry" @click="open(i)">
        <span class="d">{{ md(e.date) }}</span>
        <span class="t">{{ e.title || e.text }}</span>
        <span class="w">{{ who(e) }}</span>
      </button>
    </div>

    <DiaryBook :open="book" :start="start" @close="book = false" />
  </div>
</template>

<style scoped>
.studio { text-align: center; font-size: 1.75rem; font-weight: 600; margin: 10px 0 16px; letter-spacing: .3px; }
.card { border-radius: 24px; background: var(--card); box-shadow: var(--shadow); }
.cal { margin-bottom: 16px; }

/* 日记本封面：浅蓝的布面，贴着小章鱼的标题 */
.cover {
  width: 100%; border: 0; display: flex; align-items: center; gap: 14px; text-align: left;
  padding: 16px 18px 16px 26px; border-radius: 10px 24px 24px 10px;
  background: color-mix(in srgb, #dce7f7 var(--pastel), var(--card));
  box-shadow: inset 8px 0 0 color-mix(in srgb, #b9cdeb var(--pastel), var(--card-2)), var(--shadow);
  color: var(--text);
}
.cover img { width: 46%; max-width: 220px; flex: none; }
.cover-text { display: flex; flex-direction: column; gap: 4px; }
.cover-text b { font-size: 1.13rem; font-weight: 600; }
.cover-text span { font-size: .8rem; color: var(--text-2); }

.recent { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.entry { border: 0; display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-radius: 14px; background: var(--card); box-shadow: 0 0 0 1px var(--line); color: var(--text); text-align: left; }
.entry .d { color: var(--accent); font-weight: 700; font-size: .87rem; flex: none; min-width: 34px; }
.entry .t { flex: 1; min-width: 0; font-size: .93rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entry .w { font-size: .75rem; color: var(--text-3); flex: none; }
</style>
