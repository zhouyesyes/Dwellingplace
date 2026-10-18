<script setup>
// 日记本：一页一篇，左右滑或点两边翻页；她可以写一页，哪页都能删
import { ref, computed, watch } from "vue";
import { store, authorInfo } from "../../store/index.js";
import { diaryList, addDiary, removeDiary } from "../../lib/diary.js";
import { todayYmd } from "../../lib/dates.js";
import Sheet from "../Sheet.vue";
import Icon from "../Icon.vue";

const props = defineProps({ open: Boolean, start: { type: Number, default: -1 } });
const emit = defineEmits(["close"]);

const pages = computed(diaryList);
const i = ref(0);
const dir = ref(1); // 翻页方向：1 往后，-1 往前
watch(() => props.open, o => { if (o) i.value = props.start >= 0 ? props.start : Math.max(0, pages.value.length - 1); });
const cur = computed(() => pages.value[i.value]);

function go(n) {
  const j = i.value + n;
  if (j < 0 || j >= pages.value.length) return;
  dir.value = n;
  i.value = j;
}

// 手指左右滑翻页；点左右两边也翻
let sx = 0, sy = 0;
const down = e => { sx = e.clientX; sy = e.clientY; };
function up(e) {
  const dx = e.clientX - sx, dy = e.clientY - sy;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) return go(dx < 0 ? 1 : -1);
  if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
    const w = window.innerWidth;
    if (e.clientX < w * .22) go(-1);
    else if (e.clientX > w * .78) go(1);
  }
}

const WEEK = "日一二三四五六";
const dayOf = d => { const t = new Date(d + "T00:00"); return `${t.getMonth() + 1} 月 ${t.getDate()} 日 · 星期${WEEK[t.getDay()]}`; };
const who = e => e.from === "me" ? authorInfo("me") : (store.roles[0] || { name: "他", color: "var(--accent)" });

// ---------- 她写一页 ----------
const draft = ref(null);
const write = () => (draft.value = { date: todayYmd(), title: "", text: "" });
function save() {
  if (!draft.value.text.trim()) return;
  addDiary({ ...draft.value, from: "me" });
  draft.value = null;
  dir.value = 1;
  i.value = pages.value.findIndex(e => e === store.diary[store.diary.length - 1]);
}
function del() {
  if (!cur.value || !confirm("撕掉这一页？")) return;
  removeDiary(cur.value);
  i.value = Math.min(i.value, Math.max(0, pages.value.length - 1));
}
const TITLE = `${import.meta.env.BASE_URL}stickers/octopus/title.png`; // 不能写成 /stickers/…：栖所挂在带口令的路径下
</script>

<template>
  <Teleport to="body">
    <Transition name="book">
      <div v-if="open" class="diary">
        <header class="bar">
          <button class="ib" aria-label="合上" @click="emit('close')"><Icon name="close" :size="20" /></button>
          <span class="count">{{ pages.length ? `${i + 1} / ${pages.length}` : "还没有一页" }}</span>
          <button v-if="cur" class="ib" aria-label="撕掉这页" @click="del"><Icon name="trash" :size="19" /></button>
          <button class="ib" aria-label="写一页" @click="write"><Icon name="edit" :size="19" /></button>
        </header>

        <div class="desk" @pointerdown="down" @pointerup="up">
          <Transition :name="dir > 0 ? 'next' : 'prev'" mode="out-in">
            <article v-if="cur" :key="cur.id" class="paper">
              <div class="date">{{ dayOf(cur.date) }}</div>
              <h2 v-if="cur.title" class="title">{{ cur.title }}</h2>
              <div class="body">{{ cur.text }}</div>
              <div class="sign" :style="{ '--c': who(cur).color }">— {{ who(cur).name }}</div>
            </article>
            <article v-else key="empty" class="paper empty">
              <img :src="TITLE" alt="" class="cover-img" />
              <p>日记本还是空的。<br />他想写的时候会写一页，你也可以先写。</p>
              <button class="btn" @click="write">写第一页</button>
            </article>
          </Transition>
        </div>

        <div v-if="pages.length > 1" class="dots">
          <button class="turn" :disabled="i === 0" aria-label="上一页" @click="go(-1)"><Icon name="back" :size="18" /></button>
          <span>左右滑动翻页</span>
          <button class="turn" :disabled="i === pages.length - 1" aria-label="下一页" @click="go(1)"><Icon name="right" :size="18" /></button>
        </div>
      </div>
    </Transition>

    <Sheet :open="!!draft" title="写一页" @close="draft = null">
      <template v-if="draft">
        <label class="field"><span>日期</span><input v-model="draft.date" class="input" type="date" /></label>
        <label class="field"><span>标题（可以不写）</span><input v-model="draft.title" class="input" maxlength="60" placeholder="今天" /></label>
        <label class="field"><span>内容</span><textarea v-model="draft.text" class="input" rows="8" placeholder="今天想记下来的事……" /></label>
        <button class="btn wide" :disabled="!draft.text.trim()" @click="save">放进日记本</button>
      </template>
    </Sheet>
  </Teleport>
</template>

<style scoped>
.diary {
  --paper: color-mix(in srgb, #fffdf7 var(--pastel), var(--card));
  --rule: color-mix(in srgb, #dfe7f3 var(--pastel), var(--line));
  position: fixed; inset: 0; z-index: 45; /* 盖住底栏，写一页的弹窗（50）在它上面 */
  background: color-mix(in srgb, #e9eef6 var(--pastel), var(--bg));
  display: flex; flex-direction: column;
  padding: calc(var(--safe-top) + 6px) 0 calc(var(--safe-bottom) + 10px);
}
.bar { display: flex; align-items: center; gap: 4px; padding: 0 10px; height: 46px; }
.count { flex: 1; text-align: center; font-size: .87rem; color: var(--text-2); padding-left: 40px; }
.ib { border: 0; background: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: var(--text-2); }
.ib:active { background: var(--card); }

.desk { flex: 1; min-height: 0; padding: 8px 18px; display: flex; perspective: 1400px; touch-action: pan-y; }
.paper {
  flex: 1; max-width: 560px; margin: 0 auto; min-height: 0; overflow-y: auto;
  background: var(--paper);
  /* 横线：像笔记本的纸 */
  background-image: repeating-linear-gradient(to bottom, transparent 0 31px, var(--rule) 31px 32px);
  background-position: 0 14px;
  border-radius: 6px 18px 18px 6px;
  box-shadow: inset 10px 0 12px -10px rgba(0, 0, 0, .14), var(--shadow);
  padding: 22px 22px 28px 30px;
  line-height: 32px;
  transform-origin: left center;
}
.date { font-size: .8rem; color: var(--text-3); letter-spacing: .5px; }
.title { margin: 0; font-size: 1.2rem; font-weight: 600; color: var(--text); line-height: 32px; }
.body { white-space: pre-wrap; word-break: break-word; color: var(--text); font-size: 1rem; }
.sign { text-align: right; margin-top: 10px; color: var(--c); font-size: .93rem; }
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 14px; color: var(--text-2); line-height: 1.7; background-image: none; }
.cover-img { width: min(240px, 70%); }

.dots { display: flex; align-items: center; justify-content: center; gap: 16px; padding-top: 10px; font-size: .75rem; color: var(--text-3); }
.turn { border: 0; background: var(--card); width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: var(--text-2); box-shadow: var(--shadow-soft); }
.turn:disabled { opacity: .35; }
.wide { width: 100%; margin-top: 8px; }

/* 翻页：往后翻像掀过去一页，往前翻倒回来 */
.next-enter-active, .next-leave-active, .prev-enter-active, .prev-leave-active { transition: transform .26s ease, opacity .26s ease; }
.next-leave-to { transform: rotateY(-28deg) translateX(-30px); opacity: 0; }
.next-enter-from { transform: translateX(26px); opacity: 0; }
.prev-leave-to { transform: translateX(26px); opacity: 0; }
.prev-enter-from { transform: rotateY(-28deg) translateX(-30px); opacity: 0; }
.book-enter-active, .book-leave-active { transition: opacity .2s, transform .2s; }
.book-enter-from, .book-leave-to { opacity: 0; transform: scale(.97); }
</style>
