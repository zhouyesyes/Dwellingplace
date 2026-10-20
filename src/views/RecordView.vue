<script setup>
// 记录：Meanwhile（浪花标题、潮汐表、今天的水温、潮间带）+ 日记本。
// 以前这里的白日历换成了潮汐表：点日期看那天，那天的日记、他记住的事在日期下面接着列
import { ref, computed } from "vue";
import { store, authorInfo } from "../store/index.js";
import { diaryList, SHOW_DIARY } from "../lib/diary.js";
import MeanwhilePanel from "../components/meanwhile/MeanwhilePanel.vue";
import { useDayMemories } from "../lib/dayMemories.js";
import DiaryBook from "../components/record/DiaryBook.vue";

const pages = computed(diaryList);
const recent = computed(() => pages.value.map((e, i) => ({ e, i })).slice(-4).reverse());
const book = ref(false);
const start = ref(-1);
function open(i = -1) { start.value = i; book.value = true; }
const who = e => e.from === "me" ? authorInfo("me").name : (store.roles[0]?.name || "他");
const md = d => `${Number(d.slice(5, 7))}.${Number(d.slice(8))}`;
const { memsOn, openMem } = useDayMemories();
const dayDiaries = date => !SHOW_DIARY ? [] : pages.value.map((e, i) => ({ e, i })).filter(x => x.e.date === date);
</script>

<template>
  <div class="record">
    <MeanwhilePanel>
      <template #after-temp="{ date }">
        <!-- 点了某一天：那天的日记、他记住的事 -->
        <section v-if="date && (dayDiaries(date).length || memsOn(date).length)" class="day-extra">
          <button v-for="{ e, i } in dayDiaries(date)" :key="e.id" class="entry" @click="open(i)">
            <span class="d">日记</span>
            <span class="t">{{ e.title || e.text }}</span>
            <span class="w">{{ who(e) }}</span>
          </button>
          <button v-for="s in memsOn(date)" :key="s.role.id + s.id" class="entry" @click="openMem(s)">
            <span class="d" :style="{ color: s.role.color }">✦</span>
            <span class="t">{{ s.title }}</span>
            <span class="w">{{ s.role.name }}</span>
          </button>
        </section>
      </template>

      <!-- 日记本放在最下面，潮间带之后 -->
      <template #end>
        <section v-if="SHOW_DIARY" class="diary">
          <button class="cover" @click="open()">
            <b>日记本</b>
            <span>{{ pages.length ? `一起写了 ${pages.length} 页` : "翻开第一页" }}</span>
          </button>

          <div v-if="recent.length" class="recent">
            <button v-for="{ e, i } in recent" :key="e.id" class="entry" @click="open(i)">
              <span class="d">{{ md(e.date) }}</span>
              <span class="t">{{ e.title || e.text }}</span>
              <span class="w">{{ who(e) }}</span>
            </button>
          </div>
        </section>
      </template>
    </MeanwhilePanel>

    <DiaryBook v-if="SHOW_DIARY" :open="book" :start="start" @close="book = false" />
  </div>
</template>

<style scoped>
.record { font-family: "Poppins", var(--font); }
.diary, .day-extra { margin: 26px 16px 0; }
.day-extra { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; }

/* 日记本封面：浅蓝的布面，贴着小章鱼的标题 */
.cover {
  width: 100%; border: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left;
  padding: 16px 18px 16px 26px; border-radius: 10px 24px 24px 10px;
  background: color-mix(in srgb, #dce7f7 var(--pastel), var(--card));
  box-shadow: inset 8px 0 0 color-mix(in srgb, #b9cdeb var(--pastel), var(--card-2)), var(--shadow);
  color: var(--text);
}
.cover b { font-size: 1.13rem; font-weight: 600; }
.cover span { font-size: .8rem; color: var(--text-2); }

.recent { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.entry { border: 0; display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-radius: 14px; background: var(--card); box-shadow: 0 0 0 1px var(--line); color: var(--text); text-align: left; }
.entry .d { color: var(--accent); font-weight: 700; font-size: .87rem; flex: none; min-width: 34px; }
.entry .t { flex: 1; min-width: 0; font-size: .93rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entry .w { font-size: .75rem; color: var(--text-3); flex: none; }
</style>
