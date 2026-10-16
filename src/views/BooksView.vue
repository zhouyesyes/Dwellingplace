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
import { decodeTxt, analyzeTxt, TXT_ENCODINGS, encodingLabel } from "../lib/txtEncoding.js";
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

const txt = ref(null);
const encoding = ref('utf-8');
const decoded = computed(() => txt.value ? decodeTxt(txt.value.bytes, encoding.value) : null);
async function confirmTxt() {
  if (!txt.value || !decoded.value.usable || busy.value) return;
  await place(txt.value.file, { encoding: encoding.value });
}
async function place(file, options) {
  busy.value = true;
  try {
    const id = await importBook(file, options);
    txt.value = null;
    toast("放上书架了");
    router.push(`/read/${id}`);
  } catch (e) {
    toast(`没放上去：${e.message}`, 4000);
  } finally {
    busy.value = false;
  }
}
async function add(forceEncoding = false) {
  const [file] = await pickFile(".txt,.epub,text/plain,application/epub+zip");
  if (!file) return;
  busy.value = true;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.epub$/i.test(file.name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      await place(file);
    } else {
      const analysis = analyzeTxt(bytes);
      encoding.value = analysis.encoding;
      if (forceEncoding || analysis.needsPreview) txt.value = { file, bytes, detected: encoding.value };
      else await place(file, { encoding: encoding.value });
    }
  } catch (e) {
    toast(`没放上去：${e.message}`, 4000);
  } finally { busy.value = false; }
}

// 长按封面：看这本书的卡片
let press = 0;
const down = b => { press = setTimeout(() => { press = 0; info.value = b; navigator.vibrate?.(10); }, 450); };
const up = b => { if (press) { clearTimeout(press); press = 0; router.push(`/read/${b.id}`); } };
const cancel = () => { clearTimeout(press); press = 0; };

const mems = computed(() => readingMemsOf());
const bookOf = id => store.books.find(b => b.id === id);
const totals = computed(() => readingTotals());
// 一整年的热力图：十二个小月份，读得越久颜色越深（粉 → 红）；左右箭头换年份
const year = ref(new Date().getFullYear());
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const months = computed(() => {
  const log = store.readingLog || {};
  const today = ymd(new Date());
  const out = [];
  for (let mo = 0; mo < 12; mo++) {
    const first = new Date(year.value, mo, 1);
    const n = new Date(year.value, mo + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // 周一在最前
    let sum = 0;
    const cells = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= n; d++) {
      const key = ymd(new Date(year.value, mo, d));
      const sec = log[key] || 0;
      sum += sec;
      // 0：没读；1～4：读了不到 10 分钟、半小时、一小时、更久
      const lv = !sec ? 0 : sec < 600 ? 1 : sec < 1800 ? 2 : sec < 3600 ? 3 : 4;
      cells.push({ d, key, s: sec, lv, today: key === today, future: key > today });
    }
    out.push({ label: `${mo + 1} 月`, cells, sum });
  }
  return out;
});
const yearSum = computed(() => months.value.reduce((a, m) => a + m.sum, 0));
const yearDays = computed(() => months.value.reduce((a, m) => a + m.cells.filter(c => c?.s).length, 0));
const tapDay = c => c && !c.future && toast(`${c.key.slice(5).replace("-", " 月 ")} 日：${c.s ? fmtDur(c.s) : "没读"}`, 1800);
const finished = computed(() => books.value.filter(b => b.mine).length);
</script>

<template>
  <div class="room">
    <header class="head">
      <button class="icon-btn" aria-label="返回" @click="goBack(router, '/')"><Icon name="back" /></button>
      <div class="acts">
        <button class="icon-btn" aria-label="讨论室" @click="router.push('/books/talk/hall')"><Icon name="chat" /></button>
        <button class="icon-btn" :disabled="busy" aria-label="放一本书" @click="add(false)"><Icon name="plus" /></button>
      </div>
    </header>

    <button class="txt-retry" :disabled="busy" @click="add(true)">重新选择编码导入</button>

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
        <button class="item add" :disabled="busy" @click="add(false)"><span class="cv ph"><Icon name="plus" :size="22" /></span><b>{{ busy ? "在放…" : "放一本书" }}</b><span>txt / epub</span></button>
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
      <div class="year">
        <div class="yh">
          <button aria-label="上一年" @click="year--">‹</button>
          <b>{{ year }}</b>
          <button aria-label="下一年" :disabled="year >= new Date().getFullYear()" @click="year++">›</button>
          <span>{{ yearDays ? `读了 ${yearDays} 天 · ${fmtDur(yearSum)}` : "这一年还没读" }}</span>
        </div>
        <div class="months">
          <div v-for="m in months" :key="m.label" class="month">
            <small>{{ m.label }}</small>
            <div class="cal"><i v-for="(c, i) in m.cells" :key="i" :class="c ? ['lv' + c.lv, { today: c.today, future: c.future }] : 'blank'" @click="tapDay(c)" /></div>
          </div>
        </div>
      </div>
      <div class="legend"><span>少</span><i class="lv0" /><i class="lv1" /><i class="lv2" /><i class="lv3" /><i class="lv4" /><span>多</span></div>
      <div class="totals small">
        <div><b>{{ books.length }}</b><span>本书</span></div>
        <div><b>{{ finished }}</b><span>读完了</span></div>
        <div><b>{{ (store.bookNotes || []).length }}</b><span>张便利贴</span></div>
      </div>
      <p class="hint">每本书的进度（你和{{ role?.name || "他" }}各读到哪）、读了多久，长按封面就能看到。</p>
    </template>

    <div v-if="txt" class="txt-shade" @click.self="!busy && (txt = null)">
      <section class="txt-dialog" role="dialog" aria-modal="true" aria-labelledby="txt-title">
        <h2 id="txt-title">确认 TXT 正文</h2>
        <p class="txt-name">{{ txt.file.name }}</p>
        <label class="txt-encoding">编码
          <select v-model="encoding" :disabled="busy" aria-label="TXT 编码">
            <option v-for="e in TXT_ENCODINGS" :key="e" :value="e">{{ encodingLabel(e) }}</option>
          </select>
        </label>
        <small>自动识别：{{ encodingLabel(txt.detected) }}</small>
        <pre class="txt-preview">{{ decoded.text.slice(0, 700).replace(/\u0000/g, '␀') || '（正文为空）' }}</pre>
        <p v-if="decoded.suspicious" class="txt-warning" role="alert">正文可能有乱码，请核对预览或切换编码。</p>
        <p v-if="!decoded.usable" class="txt-warning">正文为空或损坏字符过多，请选择其他编码。</p>
        <div class="txt-actions">
          <button :disabled="busy" @click="txt = null">取消</button>
          <button :disabled="busy || !decoded.usable" @click="confirmTxt">{{ busy ? '在放…' : '确认导入' }}</button>
        </div>
      </section>
    </div>
    <BookInfo :book="info" @close="info = null" @read="b => { info = null; router.push(`/read/${b.id}`); }" />

  </div>
</template>

<style scoped>
.txt-retry { display: block; margin: 8px 0 16px auto; border: 0; background: none; color: var(--text-2); font-size: 12px; text-decoration: underline; }
.txt-shade { position: fixed; inset: 0; z-index: 100; background: #0006; display: flex; align-items: center; justify-content: center; padding: max(16px, var(--safe-top)) 16px max(16px, var(--safe-bottom)); }
.txt-dialog { width: 100%; max-width: 440px; max-height: 100%; overflow-y: auto; padding: 20px; border-radius: 20px; background: var(--card); color: var(--text); box-sizing: border-box; }
.txt-dialog h2 { margin: 0 0 10px; font-size: 1.15rem; }
.txt-name { overflow-wrap: anywhere; color: var(--text-2); }
.txt-encoding { display: flex; align-items: center; gap: 12px; }
.txt-encoding select { flex: 1; min-width: 0; min-height: 44px; font-size: 16px; background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
.txt-dialog small { display: block; margin-top: 8px; color: var(--text-2); }
.txt-preview { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: .9rem; line-height: 1.8; background: var(--bg); border-radius: 10px; padding: 12px; max-height: 32dvh; overflow-y: auto; }
.txt-warning { color: var(--text); font-size: .85rem; }
.txt-actions { display: flex; gap: 12px; }
.txt-actions button { flex: 1; min-height: 44px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--text); }
.txt-actions button:last-child { background: var(--ink); color: var(--on-ink); }
.txt-actions button:disabled { opacity: .4; }

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
.tabs button.on { background: var(--ink); color: var(--on-ink); font-weight: 600; }
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
.year { background: var(--card); border-radius: 18px; padding: 12px 14px 14px; margin: 12px 0 8px; box-shadow: var(--shadow-soft); }
.yh { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.yh b { font-weight: 600; font-size: .95rem; }
.yh button { border: 0; background: none; font-size: 1.1rem; color: var(--text-2); width: 26px; height: 26px; padding: 0; }
.yh button:disabled { opacity: .25; }
.yh span { margin-left: auto; font-size: .7rem; color: var(--text-3); }
.months { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 14px; }
@media (min-width: 640px) { .months { grid-template-columns: repeat(4, 1fr); } }
.month small { display: block; font-size: .64rem; color: var(--text-3); margin-bottom: 4px; }
.cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.cal i { aspect-ratio: 1; border-radius: 2px; cursor: pointer; }
.cal i.blank { visibility: hidden; }
.cal i.future { opacity: .35; }
.cal i.today { box-shadow: 0 0 0 1.2px #e9657e; }
/* 粉 → 红 */
.lv0 { background: var(--bg-deep); }
.lv1 { background: color-mix(in srgb, #fbd3dc var(--pastel), var(--card)); }
.lv2 { background: #f5a3b4; }
.lv3 { background: #e9657e; }
.lv4 { background: #c9304c; }
.legend { display: flex; align-items: center; justify-content: flex-end; gap: 3px; font-size: .64rem; color: var(--text-3); margin: 0 4px 12px; }
.legend i { width: 10px; height: 10px; border-radius: 2px; }
.chart { display: flex; align-items: flex-end; gap: 4px; height: 130px; margin: 16px 0; padding: 14px 12px 8px; background: var(--card); border-radius: 18px; box-shadow: var(--shadow-soft); }
.bar { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; }
.bar i { width: 100%; max-width: 14px; background: var(--ink); opacity: .75; border-radius: 4px; }
.bar span { font-size: .6rem; color: var(--text-3); }
</style>
