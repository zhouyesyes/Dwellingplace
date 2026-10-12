<script setup>
// 共读室：三页——书（封面一格格排着，下面写读到百分之几）、他的读书笔记、读书统计。
// 点封面去读；长按（或「…」里的整理）看这本书的卡片：进度、评分、读后感、换封面
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { store, MAIN, roleById } from "../store/index.js";
import { importBook, progressOf, readingTotals, fmtDur } from "../lib/books.js";
import { readingMemsOf } from "../lib/reading.js";
import { pickFile } from "../lib/images.js";
import { toast } from "../lib/toast.js";
import { goBack } from "../lib/nav.js";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";
import BookCover from "../components/books/BookCover.vue";
import BookInfo from "../components/books/BookInfo.vue";

const router = useRouter();
const role = computed(() => roleById(MAIN));
const books = computed(() => [...(store.books || [])].sort((a, b) => (b.readAt || b.addedAt) - (a.readAt || a.addedAt)));
const TABS = { books: "书", notes: "笔记", stats: "统计" };
const tab = ref("books");
const busy = ref(false);
const info = ref(null);
const menuOpen = ref(false);

async function add() {
  const [file] = await pickFile(".txt,.epub,text/plain,application/epub+zip");
  if (!file) return;
  busy.value = true;
  try {
    const id = await importBook(file);
    toast("放上书架了");
    router.push(`/read/${id}`);
  } catch (e) {
    toast(`没放上去：${e.message}`, 4000);
  } finally {
    busy.value = false;
  }
}

// 长按封面：看这本书的卡片
let press = 0;
const down = b => { press = setTimeout(() => { press = 0; info.value = b; navigator.vibrate?.(10); }, 450); };
const up = b => { if (press) { clearTimeout(press); press = 0; router.push(`/read/${b.id}`); } };
const cancel = () => { clearTimeout(press); press = 0; };

const mems = computed(() => readingMemsOf());
const bookOf = id => store.books.find(b => b.id === id);
const totals = computed(() => readingTotals());
// 最近 14 天每天读了多久
const days = computed(() => {
  const out = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ k, s: store.readingLog?.[k] || 0, label: i === 0 ? "今" : String(d.getDate()) });
  }
  const max = Math.max(...out.map(x => x.s), 600);
  return out.map(x => ({ ...x, h: x.s / max }));
});
const finished = computed(() => books.value.filter(b => b.mine).length);
const TONES = { light: "白", grey: "灰", dark: "黑" };
</script>

<template>
  <div class="room">
    <header class="head">
      <button class="icon-btn" aria-label="返回" @click="goBack(router, '/')"><Icon name="back" /></button>
      <div class="acts">
        <button class="icon-btn" aria-label="更多" @click="menuOpen = true"><Icon name="more" /></button>
        <button class="icon-btn" :disabled="busy" aria-label="放一本书" @click="add"><Icon name="plus" /></button>
      </div>
    </header>

    <p class="eyebrow">COREAD · 共读室</p>
    <h1 class="big">Read,<br /><em>together.</em></h1>
    <p class="lead">一个人读书，也有{{ role?.name || "他" }}在页边陪你。</p>

    <nav class="tabs">
      <button v-for="(l, k) in TABS" :key="k" :class="{ on: tab === k }" @click="tab = k">{{ l }}</button>
    </nav>

    <!-- 书 -->
    <template v-if="tab === 'books'">
      <div class="grid">
        <div v-for="b in books" :key="b.id" class="item">
          <button class="cv" @pointerdown="down(b)" @pointerup="up(b)" @pointerleave="cancel" @pointercancel="cancel" @contextmenu.prevent>
            <BookCover :book="b" />
            <i v-if="(store.bookNotes || []).some(n => n.bookId === b.id && n.from === 'ai' && !n.seen)" class="new" />
          </button>
          <b>{{ b.title }}</b>
          <span>{{ b.mine ? "读完了 " + "★".repeat(b.mine.stars) : progressOf(b) > 0.01 ? `已读 ${Math.round(progressOf(b) * 100)}%` : "还没开始" }}</span>
        </div>
        <button class="item add" :disabled="busy" @click="add"><span class="cv ph"><Icon name="plus" :size="22" /></span><b>{{ busy ? "在放…" : "放一本书" }}</b><span>txt / epub</span></button>
      </div>
      <p class="hint">点封面去读，长按看这本书的进度、评分和读后感。</p>
    </template>

    <!-- 他的读书笔记 -->
    <template v-else-if="tab === 'notes'">
      <article v-for="m in mems" :key="m.id" class="mem">
        <small>{{ bookOf(m.bookId) ? `《${bookOf(m.bookId).title}》` : "" }} · {{ m.date }}</small>
        <b>{{ m.title.replace(/^《[^》]*》：?/, "") || "读书笔记" }}</b>
        <p>{{ m.content }}</p>
      </article>
      <p v-if="!mems.length" class="hint">{{ role?.name || "他" }}读书时觉得有收获的地方，会自己记在这里（也会进他的记忆库）。</p>
    </template>

    <!-- 统计 -->
    <template v-else>
      <div class="totals">
        <div><b>{{ fmtDur(totals.today) }}</b><span>今天</span></div>
        <div><b>{{ fmtDur(totals.month) }}</b><span>这个月</span></div>
        <div><b>{{ fmtDur(totals.year) }}</b><span>今年</span></div>
      </div>
      <div class="chart">
        <div v-for="d in days" :key="d.k" class="bar"><i :style="{ height: `${Math.max(d.h * 100, d.s ? 4 : 0)}%` }" /><span>{{ d.label }}</span></div>
      </div>
      <div class="totals small">
        <div><b>{{ books.length }}</b><span>本书</span></div>
        <div><b>{{ finished }}</b><span>读完了</span></div>
        <div><b>{{ (store.bookNotes || []).length }}</b><span>张便利贴</span></div>
      </div>
      <p class="hint">每本书的进度（你和{{ role?.name || "他" }}各读到哪）、读了多久，长按封面就能看到。</p>
    </template>

    <BookInfo :book="info" @close="info = null" @read="b => { info = null; router.push(`/read/${b.id}`); }" />

    <Sheet :open="menuOpen" title="共读室" @close="menuOpen = false">
      <div class="menu">
        <div class="list-row"><span class="grow">主页书架的颜色</span>
          <div class="seg"><button v-for="(l, k) in TONES" :key="k" :class="{ on: store.settings.shelfTone === k }" @click="store.settings.shelfTone = k">{{ l }}</button></div>
        </div>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.room { min-height: 100%; padding: calc(var(--safe-top) + 12px) 22px calc(var(--safe-bottom) + 40px); max-width: 760px; margin: 0 auto; }
.head { display: flex; justify-content: space-between; align-items: center; }
.acts { display: flex; gap: 8px; }
.eyebrow { margin: 18px 0 2px; font-size: .72rem; letter-spacing: .3em; color: var(--text-3); }
.big { margin: 0; font-size: clamp(2.6rem, 13vw, 3.6rem); font-weight: 300; line-height: 1.02; letter-spacing: -.01em; color: var(--text); }
.big em { font-style: italic; font-weight: 300; color: var(--text-2); }
.lead { margin: 12px 0 22px; color: var(--text-2); font-size: .92rem; }
.tabs { display: flex; gap: 6px; margin-bottom: 18px; }
.tabs button { border: 0; background: var(--card); padding: 7px 16px; border-radius: 999px; font-size: .85rem; color: var(--text-2); box-shadow: var(--shadow-soft); }
.tabs button.on { background: var(--ink); color: #fff; font-weight: 600; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px 16px; }
@media (min-width: 640px) { .grid { grid-template-columns: repeat(4, 1fr); } }
.item { display: flex; flex-direction: column; gap: 4px; min-width: 0; border: 0; background: none; padding: 0; text-align: left; }
.cv { border: 0; padding: 0; background: none; position: relative; -webkit-touch-callout: none; user-select: none; }
.cv :deep(.cover) { box-shadow: 0 8px 16px rgba(40, 40, 60, .12); }
.cv.ph { aspect-ratio: 2 / 3; border-radius: 4px; border: 1.5px dashed var(--line); display: grid; place-items: center; color: var(--text-3); background: var(--card-2); }
.item b { margin-top: 6px; font-size: .85rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item span { font-size: .72rem; color: var(--text-3); }
.new { position: absolute; top: -4px; right: -4px; width: 12px; height: 12px; border-radius: 50%; background: #9fbfe0; box-shadow: 0 0 0 2px var(--bg); }
.hint { text-align: center; color: var(--text-3); font-size: .78rem; line-height: 1.7; margin: 22px 10px; }
.mem { background: var(--card); border-radius: 18px; padding: 14px 16px; margin-bottom: 10px; box-shadow: var(--shadow-soft); display: flex; flex-direction: column; gap: 4px; }
.mem small { color: var(--text-3); font-size: .72rem; }
.mem b { font-weight: 600; font-size: .95rem; }
.mem p { margin: 0; color: var(--text-2); font-size: .88rem; line-height: 1.75; white-space: pre-wrap; }
.totals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.totals div { background: var(--card); border-radius: 18px; padding: 14px 12px; display: flex; flex-direction: column; gap: 2px; box-shadow: var(--shadow-soft); }
.totals b { font-size: 1.05rem; font-weight: 600; }
.totals span { font-size: .72rem; color: var(--text-3); }
.totals.small b { font-size: 1.3rem; font-weight: 300; }
.chart { display: flex; align-items: flex-end; gap: 4px; height: 130px; margin: 16px 0; padding: 14px 12px 8px; background: var(--card); border-radius: 18px; box-shadow: var(--shadow-soft); }
.bar { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; }
.bar i { width: 100%; max-width: 14px; background: var(--ink); opacity: .75; border-radius: 4px; }
.bar span { font-size: .6rem; color: var(--text-3); }
.menu .seg { display: flex; gap: 4px; }
.menu .seg button { border: 0; background: var(--bg); padding: 5px 12px; border-radius: 999px; font-size: .8rem; }
.menu .seg button.on { background: var(--ink); color: #fff; }
</style>
