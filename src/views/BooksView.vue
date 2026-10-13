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
import BookCover from "../components/books/BookCover.vue";
import BookInfo from "../components/books/BookInfo.vue";

const router = useRouter();
const role = computed(() => roleById(MAIN));
const books = computed(() => [...(store.books || [])].sort((a, b) => (b.readAt || b.addedAt) - (a.readAt || a.addedAt)));
const TABS = { books: "书", notes: "笔记", stats: "统计" };
const tab = ref("books");
const busy = ref(false);
const info = ref(null);

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
// 每个月一张日历，读得越久颜色越深（最近 6 个月，新的在上面）
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const months = computed(() => {
  const log = store.readingLog || {};
  const now = new Date(), today = ymd(now);
  const out = [];
  for (let k = 0; k < 6; k++) {
    const first = new Date(now.getFullYear(), now.getMonth() - k, 1);
    const n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // 周一在最前
    let sum = 0;
    const cells = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= n; d++) {
      const key = ymd(new Date(first.getFullYear(), first.getMonth(), d));
      const s = log[key] || 0;
      sum += s;
      // 0：没读；1～4：读了不到 10 分钟、半小时、一小时、更久
      const lv = !s ? 0 : s < 600 ? 1 : s < 1800 ? 2 : s < 3600 ? 3 : 4;
      cells.push({ d, key, s, lv, today: key === today, future: key > today });
    }
    out.push({ label: `${first.getFullYear()} 年 ${first.getMonth() + 1} 月`, cells, sum, days: cells.filter(c => c?.s).length });
  }
  return out;
});
const tapDay = c => c && !c.future && toast(`${c.key.slice(5).replace("-", " 月 ")} 日：${c.s ? fmtDur(c.s) : "没读"}`, 1800);
const finished = computed(() => books.value.filter(b => b.mine).length);
</script>

<template>
  <div class="room">
    <header class="head">
      <button class="icon-btn" aria-label="返回" @click="goBack(router, '/')"><Icon name="back" /></button>
      <div class="acts">
        <button class="icon-btn" :disabled="busy" aria-label="放一本书" @click="add"><Icon name="plus" /></button>
      </div>
    </header>

    <!-- 标题：大大的「共读」，右边一行竖着的小字；下面是一道细线和这间屋子的一句话 -->
    <div class="title">
      <h1>共读</h1>
      <span class="side">margins<br />we share</span>
    </div>
    <p class="lead"><i />同一本书，两个人的页边 · 和{{ role?.name || "他" }}</p>

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
      <div class="months"><div v-for="m in months" :key="m.label" class="month">
        <div class="mh"><b>{{ m.label }}</b><span>{{ m.days ? `读了 ${m.days} 天 · ${fmtDur(m.sum)}` : "这个月还没读" }}</span></div>
        <div class="wk"><span v-for="w in ['一', '二', '三', '四', '五', '六', '日']" :key="w">{{ w }}</span></div>
        <div class="cal">
          <i v-for="(c, i) in m.cells" :key="i" :class="c ? ['lv' + c.lv, { today: c.today, future: c.future }] : 'blank'" @click="tapDay(c)">{{ c ? c.d : "" }}</i>
        </div>
      </div></div>
      <div class="legend"><span>少</span><i class="lv0" /><i class="lv1" /><i class="lv2" /><i class="lv3" /><i class="lv4" /><span>多</span></div>
      <div class="totals small">
        <div><b>{{ books.length }}</b><span>本书</span></div>
        <div><b>{{ finished }}</b><span>读完了</span></div>
        <div><b>{{ (store.bookNotes || []).length }}</b><span>张便利贴</span></div>
      </div>
      <p class="hint">每本书的进度（你和{{ role?.name || "他" }}各读到哪）、读了多久，长按封面就能看到。</p>
    </template>

    <BookInfo :book="info" @close="info = null" @read="b => { info = null; router.push(`/read/${b.id}`); }" />

  </div>
</template>

<style scoped>
.room { min-height: 100%; padding: calc(var(--safe-top) + 12px) 22px calc(var(--safe-bottom) + 40px); max-width: 760px; margin: 0 auto; }
.head { display: flex; justify-content: space-between; align-items: center; }
.acts { display: flex; gap: 8px; }
.title { display: flex; align-items: flex-end; gap: 14px; margin: 22px 0 0; }
.title h1 { margin: 0; font-size: clamp(3rem, 16vw, 4.2rem); font-weight: 200; letter-spacing: .18em; line-height: 1; color: var(--text); }
.side { font-size: .7rem; letter-spacing: .22em; text-transform: uppercase; color: var(--text-3); line-height: 1.6; padding-bottom: 6px; }
.lead { display: flex; align-items: center; gap: 10px; margin: 14px 0 24px; color: var(--text-2); font-size: .85rem; letter-spacing: .04em; }
.lead i { width: 28px; height: 1px; background: var(--text-3); flex: none; }
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
.month { background: var(--card); border-radius: 18px; padding: 14px 14px 12px; margin: 12px 0; box-shadow: var(--shadow-soft); }
@media (min-width: 640px) { .months { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; } }
.mh { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
.mh b { font-weight: 600; font-size: .92rem; }
.mh span { font-size: .72rem; color: var(--text-3); }
.wk, .cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.wk span { text-align: center; font-size: .62rem; color: var(--text-3); }
.cal i { height: 30px; border-radius: 6px; display: grid; place-items: center; font-style: normal; font-size: .62rem; color: var(--text-3); cursor: pointer; }
.cal i.blank { visibility: hidden; }
.cal i.future { opacity: .35; }
.cal i.today { box-shadow: inset 0 0 0 1.5px var(--ink); }
.lv0 { background: var(--bg-deep); }
.lv1 { background: #f3e2bf; color: #8a6a3a !important; }
.lv2 { background: #e8c67f; color: #6e4f20 !important; }
.lv3 { background: #d5a148; color: #fff !important; }
.lv4 { background: #b07a28; color: #fff !important; }
.legend { display: flex; align-items: center; justify-content: flex-end; gap: 4px; font-size: .66rem; color: var(--text-3); margin: 0 4px 12px; }
.legend i { width: 12px; height: 12px; border-radius: 3px; }
.chart { display: flex; align-items: flex-end; gap: 4px; height: 130px; margin: 16px 0; padding: 14px 12px 8px; background: var(--card); border-radius: 18px; box-shadow: var(--shadow-soft); }
.bar { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; }
.bar i { width: 100%; max-width: 14px; background: var(--ink); opacity: .75; border-radius: 4px; }
.bar span { font-size: .6rem; color: var(--text-3); }
</style>
