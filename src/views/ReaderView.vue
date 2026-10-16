<script setup>
// 读书：一章一章读。点一下 → 选中那一句（长按可以自己拖着选），下面出来一张小卡片：复制、划线、写想法、问问他。
// 书页上只留划线（你的暖黄、他的淡蓝，写了想法的线尾有个小数字），点划线才看批注，段落不会被挤开。
// 右下角「一起读」→ 从你现在这一页往后读十页（你还没读到的，他先读），他挑几句划线、写批注；读到哪就在哪做个淡淡的记号。
// 给他看的只有这一句 / 这几页，而且是单独问的一次，不进聊天记录。读到哪记在书上（他在聊天里也知道你读到哪了）
// 右上角 Aa：背景、字号、字体（可以导入自己的字体文件）、翻页还是上下滚；读的时候计时（每天读了多久）
// 翻页：一屏一页（左右划，或者点屏幕左右两边）
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, MAIN, roleById } from "../store/index.js";
import { bookById, loadBook, notesOf, addNote, removeNote, savePos, tickReading, addFont, useFont, removeFont } from "../lib/books.js";
import { askHim, readAlong, alongSlice, placeAlong } from "../lib/reading.js";
import { describeError } from "../lib/chat.js";
import { pickFile } from "../lib/images.js";
import BookImage from "../components/books/BookImage.vue";
import BookInfo from "../components/books/BookInfo.vue";
import { toast } from "../lib/toast.js";
import { goBack } from "../lib/nav.js";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";
import { isDark } from "../lib/theme.js";
import PetDock from "../components/pet/PetDock.vue";
import { petOn, petOnce, petActive } from "../lib/pet.js";

const route = useRoute();
const router = useRouter();
const b = computed(() => bookById(route.params.id));
const role = computed(() => roleById(MAIN));
const content = ref(null);
const ch = ref(0);
const scroller = ref(null);
const paras = computed(() => content.value?.chapters[ch.value]?.paras || []);
const media = computed(() => content.value?.chapters[ch.value]?.media || []);
const imagesAt = p => media.value.filter(m => m.p === p);
const chapterTitle = computed(() => b.value?.chapters[ch.value]?.title || "");

// ---------- 翻页 ----------
const paged = computed(() => (store.readerPrefs.mode || "page") === "page");
const pageW = ref(0); // 一页多宽（就是书页的宽度：一栏字 + 两边留白）
const padX = ref(48); // 左右留白加起来：也是两栏字之间的空，这样「一栏 + 空」正好一页宽
const pageNo = ref(0);
const pageCount = ref(1);
let ro = null;
function measure() {
  const el = scroller.value;
  if (!el) return;
  el.style.setProperty("--image-height", Math.max(80, el.clientHeight - parseFloat(getComputedStyle(el).paddingTop) - parseFloat(getComputedStyle(el).paddingBottom) - 40) + "px");
  pageW.value = el.clientWidth;
  const cs = getComputedStyle(el);
  padX.value = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  pageCount.value = paged.value ? Math.max(1, Math.round(el.scrollWidth / el.clientWidth)) : 1;
  pageNo.value = paged.value ? Math.round(el.scrollLeft / el.clientWidth) : 0;
}
function toPage(n, smooth = true) {
  const el = scroller.value;
  if (!el) return;
  measure();
  n = Math.max(0, Math.min(n, pageCount.value - 1));
  el.scrollTo({ left: n * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
  pageNo.value = n;
}
// 往后 / 往前翻一页；翻过这一章的头尾就去上一章 / 下一章
function flip(d) {
  measure();
  const n = pageNo.value + d;
  if (n < 0) { if (ch.value > 0) goChapter(ch.value - 1, true); return; }
  if (n >= pageCount.value) { if (ch.value < b.value.chapters.length - 1) goChapter(ch.value + 1); return; }
  toPage(n);
}
// 左右划翻页；点屏幕左右两边也翻（中间点一段还是贴便利贴、问问他）
let down0 = null, swiped = false;
function onDown(e) { down0 = { x: e.clientX, y: e.clientY }; swiped = false; }
function onUp(e) {
  if (!paged.value || !down0) return;
  const dx = e.clientX - down0.x, dy = e.clientY - down0.y;
  down0 = null;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) { swiped = true; flip(dx < 0 ? 1 : -1); }
}
function onTapCapture(e) {
  if (!paged.value) return;
  if (swiped) { swiped = false; e.stopPropagation(); e.preventDefault(); return; }
  if (sel.value != null || e.target.closest("button, .mk") || !getSelection()?.isCollapsed) return; // 点在划线上：看批注，不翻页
  const w = innerWidth;
  if (e.clientX < w * 0.18) { e.stopPropagation(); flip(-1); }
  else if (e.clientX > w * 0.82) { e.stopPropagation(); flip(1); }
}

// 现在屏幕上看得到哪几段（翻页、滚动都按看得见的算）
// back：再往前多算几屏（一起读时连前两页一起）
function visibleParas(back = 0) {
  const el = scroller.value;
  if (!el) return [];
  const box = el.getBoundingClientRect();
  const left = box.left - (paged.value ? back * el.clientWidth : 0), top = box.top - (paged.value ? 0 : back * el.clientHeight);
  const out = [];
  for (const x of el.querySelectorAll("[data-p]")) {
    if ([...x.getClientRects()].some(r => r.right > left + 20 && r.left < box.right - 20 && r.bottom > top + 30 && r.top < box.bottom - 40)) out.push(Number(x.dataset.p));
  }
  return out;
}

onMounted(async () => {
  if (!b.value) return router.replace("/books");
  content.value = await loadBook(b.value.id);
  ch.value = Math.min(b.value.pos?.ch || 0, content.value.chapters.length - 1);
  await nextTick();
  ro = new ResizeObserver(() => { const p = b.value?.pos?.p || 0; measure(); jumpTo(p); });
  ro.observe(scroller.value);
  await settleImages();
  jumpTo(b.value.pos?.p || 0);
  markSeen();
});
onBeforeUnmount(() => ro?.disconnect());

async function settleImages() {
  measure();
  await Promise.all([...scroller.value.querySelectorAll(".book-image img")].map(img => img.decode().catch(() => {})));
  await nextTick();
  measure();
}
function jumpTo(p) {
  const el = scroller.value;
  if (!el) return;
  const x = el.querySelector(`[data-p="${p}"]`);
  if (paged.value) {
    measure();
    if (!x) return toPage(0, false);
    const r = x.getClientRects()[0], box = el.getBoundingClientRect();
    toPage(Math.floor((r.left - box.left + el.scrollLeft + 2) / el.clientWidth), false);
  } else if (x) el.scrollTop = x.offsetTop - 70;
  else el.scrollTop = 0;
}
async function goChapter(i, toEnd = false) {
  if (!content.value || i < 0 || i >= content.value.chapters.length) return;
  ch.value = i;
  sel.value = null;
  tocOpen.value = false;
  savePos(b.value, i, 0);
  await nextTick();
  await settleImages();
  if (toEnd && paged.value) { measure(); toPage(pageCount.value - 1, false); }
  else { scroller.value.scrollLeft = 0; jumpTo(0); }
  measure();
  markSeen();
}
// 读到哪：屏幕上第一段（停下来半秒再记）
let posTimer = 0;
function onScroll() {
  clearTimeout(posTimer);
  posTimer = setTimeout(() => {
    if (!scroller.value || !b.value) return;
    measure();
    const seen = visibleParas();
    savePos(b.value, ch.value, seen.length ? Math.min(...seen) : 0);
  }, 500);
}
onBeforeUnmount(() => clearTimeout(posTimer));

// 他贴的便利贴：翻到这一章就算你看过了
function markSeen() {
  setTimeout(() => { for (const n of notesOf(b.value?.id, ch.value)) if (n.from === "ai") n.seen = true; }, 1200);
}

// ---------- 划线和批注 ----------
// 一条划线在这段里是哪几个字
function rangeOf(n, para) {
  if (n.start != null && n.end != null && n.end <= para.length) return [n.start, n.end];
  const q = (n.quote || "").replace(/…$/, "").trim();
  const i = q ? para.indexOf(q.slice(0, 40)) : -1;
  return i >= 0 ? [i, Math.min(para.length, i + q.length)] : [0, para.length];
}
const marksByP = computed(() => {
  const m = {};
  for (const n of b.value ? notesOf(b.value.id, ch.value) : []) {
    const para = paras.value[n.p];
    if (para == null) continue;
    const [s0, e0] = rangeOf(n, para);
    (m[n.p] ??= []).push({ n, s: s0, e: e0 });
  }
  return m;
});
// 一段拆成几截：哪截有你的线、他的线、正选着；写了想法的线，在线尾标个数
function segsOf(i) {
  const t = paras.value[i] || "";
  const ms = marksByP.value[i] || [];
  const temp = sel.value && !sel.value.native && sel.value.p === i ? [{ s: sel.value.start, e: sel.value.end, temp: true }] : [];
  const all = [...ms, ...temp];
  if (!all.length) return [{ text: t, a: 0 }];
  const xs = [...new Set([0, t.length, ...all.flatMap(m => [m.s, m.e])])].filter(x => x >= 0 && x <= t.length).sort((x, y) => x - y);
  const out = [];
  for (let k = 0; k < xs.length - 1; k++) {
    const a = xs[k], z = xs[k + 1];
    if (a === z) continue;
    const cover = all.filter(m => m.s <= a && m.e >= z);
    const ends = ms.filter(m => m.e === z && m.n.text).length;
    out.push({ text: t.slice(a, z), a, me: cover.some(m => m.n?.from === "me"), his: cover.some(m => m.n?.from === "ai"), temp: cover.some(m => m.temp), n: ends });
  }
  return out;
}
// 段落里第几个字（按看得见的文字数，线尾的小数字不算）
function offsetIn(pEl, node, off) {
  const rg = document.createRange();
  rg.selectNodeContents(pEl);
  rg.setEnd(node, off);
  return rg.toString().length;
}
// 点到的那个字所在的一句：前后找句号、问号、叹号……
function sentenceAt(t, i) {
  const END = /[。！？!?；;…\n]/;
  let a = i, z = i;
  while (a > 0 && !END.test(t[a - 1])) a--;
  while (z < t.length && !END.test(t[z])) z++;
  while (z < t.length && /[。！？!?；;…”」』）)\s]/.test(t[z])) z++;
  while (a < z && /\s/.test(t[a])) a++;
  return [a, Math.max(z, a + 1)];
}

const sel = ref(null); // 选着的：{ p, start, end, native }（native：自己长按拖出来的）
const selQuote = computed(() => (sel.value ? (paras.value[sel.value.p] || "").slice(sel.value.start, sel.value.end) : ""));
const clearSel = () => { sel.value = null; try { getSelection()?.removeAllRanges(); } catch { /* 没事 */ } };
const marksSheet = ref(null); // 点了划线：{ p, list: [{ n, s, e }] }

// 点一下：点在划线上 → 看批注；点在字上 → 选中那一句；再点同一句 → 取消
function tapPara(i, e) {
  const gs = getSelection();
  if (gs && !gs.isCollapsed) return;
  const pEl = e.currentTarget;
  let pos = null;
  if (document.caretRangeFromPoint) { const c = document.caretRangeFromPoint(e.clientX, e.clientY); if (c && pEl.contains(c.startContainer)) pos = offsetIn(pEl, c.startContainer, c.startOffset); }
  else if (document.caretPositionFromPoint) { const c = document.caretPositionFromPoint(e.clientX, e.clientY); if (c && pEl.contains(c.offsetNode)) pos = offsetIn(pEl, c.offsetNode, c.offset); }
  if (pos == null) return;
  if (e.target.closest(".mk:not(.temp)")) {
    const list = (marksByP.value[i] || []).filter(m => m.s <= pos && m.e >= pos);
    if (list.length) { clearSel(); marksSheet.value = { p: i, list }; for (const m of list) m.n.seen = true; return; }
  }
  const [a, z] = sentenceAt(paras.value[i], Math.min(pos, paras.value[i].length - 1));
  if (sel.value && sel.value.p === i && sel.value.start === a && sel.value.end === z) return clearSel();
  sel.value = { p: i, start: a, end: z };
}
// 自己长按拖出来的一段：记下是哪几个字（不重画这一段，不然手机上的选区会没）
let selT = 0;
function onSelChange() {
  clearTimeout(selT);
  selT = setTimeout(() => {
    const gs = getSelection();
    if (!gs || gs.isCollapsed || !gs.rangeCount) return;
    const rg = gs.getRangeAt(0);
    const node = rg.startContainer.nodeType === 1 ? rg.startContainer : rg.startContainer.parentElement;
    const pEl = node?.closest?.("[data-p]");
    if (!pEl || !scroller.value?.contains(pEl)) return;
    const i = Number(pEl.dataset.p);
    const start = offsetIn(pEl, rg.startContainer, rg.startOffset);
    const end = pEl.contains(rg.endContainer) ? offsetIn(pEl, rg.endContainer, rg.endOffset) : paras.value[i].length;
    if (end - start >= 1) sel.value = { p: i, start, end, native: true };
  }, 250);
}
onMounted(() => document.addEventListener("selectionchange", onSelChange));
onBeforeUnmount(() => { document.removeEventListener("selectionchange", onSelChange); clearTimeout(selT); });

async function copySel() {
  try { await navigator.clipboard.writeText(selQuote.value); toast("已复制"); } catch { toast("复制失败，浏览器不允许"); }
  clearSel();
}
const here = () => ({ ch: ch.value, p: sel.value.p, start: sel.value.start, end: sel.value.end, quote: selQuote.value });
function lineSel() {
  addNote(b.value, { ...here(), text: "", from: "me" });
  clearSel();
}
const sheet = ref(null); // { mode: "note" | "ask", text, at }
function openSheet(mode, at = here()) { sheet.value = { mode, text: "", at }; }
function saveNote() {
  const s = sheet.value;
  if (!s.text.trim()) return toast("还没写呢");
  addNote(b.value, { ...s.at, text: s.text, from: "me" });
  sheet.value = null;
  clearSel();
}
// 从批注里接着写 / 问他：还是这几个字
const fromMarks = (mode) => { const m = marksSheet.value.list[0]; marksSheet.value = null; openSheet(mode, { ch: ch.value, p: m.n.p, start: m.s, end: m.e, quote: (paras.value[m.n.p] || "").slice(m.s, m.e) }); };
function dropMark(n) {
  if (n.text && !confirm(`删掉这条批注？\n\n${n.text.slice(0, 60)}`)) return;
  removeNote(n);
  if (marksSheet.value) { marksSheet.value.list = marksSheet.value.list.filter(m => m.n !== n); if (!marksSheet.value.list.length) marksSheet.value = null; }
}

// 问问他：给他看划的这一句（和它所在的段落、前后各一段），他回一条批注，划在同一句上
const asking = ref(false);
async function ask() {
  const s = sheet.value, r = role.value;
  if (!r) return;
  sheet.value = null;
  clearSel();
  const at = s.at;
  if (s.text.trim()) addNote(b.value, { ...at, text: s.text, from: "me" }).seen = true;
  else Object.assign(addNote(b.value, { ...at, text: "", from: "me" }), { seen: true, ask: true }); // 没写话也留一道线：问过他这里
  asking.value = true;
  try {
    const { text, notes } = await askHim(r, b.value, { ch: ch.value, p: at.p, paras: paras.value, chapterTitle: chapterTitle.value, question: s.text.trim(), quote: at.quote });
    addNote(b.value, { ...at, text, from: "ai" }).seen = true;
    toast(notes[0] || `${r.name} 在那句旁边写了一句`, 2500);
  } catch (e) {
    toast(`没问到：${describeError(e)}`, 4000);
  } finally {
    asking.value = false;
  }
}

const along = ref(false);
const petErr = ref(false); // 桌宠：没读成时着急几秒
const posBefore = (x, y) => x.ch < y.ch || (x.ch === y.ch && x.p < y.p);
// 一起读：从你现在这一页开始，往后读十页（你还没读到的，他先读），一路划线写批注；读到哪，就在哪轻轻做个记号
const PAGES = 10;
async function readThisPage() {
  const r = role.value, el = scroller.value;
  if (!r || !el || along.value) return;
  const seen = visibleParas();
  if (!seen.length) return toast("这一页没有字");
  const from = { ch: ch.value, p: Math.min(...seen) };
  // 一页大概多少字：就按这一页算；往后数够十页
  const perPage = Math.max(300, seen.reduce((a, i) => a + (paras.value[i]?.length || 0), 0));
  const book = content.value;
  let to = { ...from }, n = 0;
  for (let c = from.ch; c < book.chapters.length && n < perPage * PAGES; c++) {
    const ps = book.chapters[c].paras || [];
    for (let p = c === from.ch ? from.p : 0; p < ps.length && n < perPage * PAGES; p++) { n += ps[p].length; to = { ch: c, p }; }
  }
  const maxChars = Infinity;
  along.value = true;
  store.settings.readTip = true;
  try {
    const res = await readAlong(r, b.value, { from, to, maxChars });
    b.value.alongTo = res.upTo;
    await placeAlong(b.value, res.notes, -1);
    for (const n of store.bookNotes.slice(-res.notes.length)) n.seen = n.ch !== ch.value;
    const endTitle = content.value.chapters[res.upTo.ch]?.title || `第 ${res.upTo.ch + 1} 章`;
    toast(res.memNotes[0] || `${r.name} 往后读了十来页，划了 ${res.notes.length} 处，读到「${endTitle}」那里做了个记号`, 3200);
    petOnce("success");
  } catch (e) {
    toast(`没读成：${describeError(e)}`, 4000);
    petErr.value = true;
    setTimeout(() => (petErr.value = false), 5000);
  } finally {
    along.value = false;
  }
}

// ---------- 读了多久：页面开着、最近两分钟里动过，每 15 秒记一笔 ----------
let lastAct = Date.now();
const act = () => (lastAct = Date.now());
const timer = setInterval(() => {
  if (b.value && document.visibilityState === "visible" && Date.now() - lastAct < 120_000) tickReading(b.value, 15);
}, 15_000);
onBeforeUnmount(() => clearInterval(timer));

// ---------- 背景、字号、字体 ----------
const BGS = { white: ["#ffffff", "#2e2e34"], paper: ["#faf6ef", "#3b3128"], mist: ["#eef1f4", "#2f3640"], green: ["#e9efe6", "#2f3a2c"], night: ["#1c1d22", "#c9c6bf"] };
// 深色模式：每种纸换成对应的暗色（纸还是纸的感觉，只是暗下来），夜间那种照旧
const BGS_DARK = { white: ["#1f2229", "#d4d6dc"], paper: ["#25211c", "#d8cebf"], mist: ["#1d2229", "#cdd5de"], green: ["#1e241d", "#ccd5c6"], night: ["#1c1d22", "#c9c6bf"] };
const dark = ref(isDark());
const themeObs = new MutationObserver(() => (dark.value = isDark()));
themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
onBeforeUnmount(() => themeObs.disconnect());
const prefs = computed(() => store.readerPrefs);
const fontFamily = ref("");
watch(() => prefs.value.font, async id => { try { fontFamily.value = await useFont(id); } catch { fontFamily.value = ""; } }, { immediate: true });
const pageStyle = computed(() => {
  const [bg, ink] = (dark.value ? BGS_DARK : BGS)[prefs.value.bg] || (dark.value ? BGS_DARK : BGS).paper;
  return { "--rbg": bg, "--rink": ink, "--rsize": `${prefs.value.size || 18}px`, ...(fontFamily.value ? { "--rfont": `"${fontFamily.value}"` } : {}) };
});
// 换了字号、字体、翻页方式：排版变了，回到刚才读的那一段
watch(() => [store.readerPrefs.size, store.readerPrefs.font, store.readerPrefs.mode, fontFamily.value], async () => {
  const p = b.value?.pos?.p || 0;
  await nextTick();
  setTimeout(() => { measure(); jumpTo(p); }, 60);
});

const prefsOpen = ref(false);
async function importFont() {
  const [f] = await pickFile(".ttf,.otf,.woff,.woff2,font/*");
  if (!f) return;
  try {
    const id = await addFont(f);
    store.readerPrefs.font = id;
    toast("字体放进来了");
  } catch (e) {
    toast(`这个字体用不了：${e.message}`, 4000);
  }
}
const dropFont = f => { if (confirm(`删掉字体「${f.name}」？`)) removeFont(f); };
const infoOpen = ref(false);
const atEnd = computed(() => b.value && ch.value === b.value.chapters.length - 1);

const tocOpen = ref(false);
const who = n => (n.from === "me" ? "我" : role.value?.name || "他");
const when = ts => new Date(ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
</script>

<template>
  <div v-if="b" class="reader" :class="prefs.bg" :style="pageStyle" @pointerdown="act" @keydown="act">
    <header class="bar">
      <button class="icon-btn" aria-label="返回" @click="goBack(router, '/books')"><Icon name="back" /></button>
      <div class="t">
        <b>{{ b.title }}</b>
        <span>{{ chapterTitle }}</span>
      </div>
      <button class="icon-btn" aria-label="讨论室" @click="router.push(`/books/talk/${b.id}`)"><Icon name="chat" /></button>
      <button class="icon-btn aa" aria-label="阅读设置" @click="prefsOpen = true">Aa</button>
      <button class="icon-btn" aria-label="目录" @click="tocOpen = true"><Icon name="threads" /></button>
    </header>

    <main ref="scroller" class="page" :class="{ paged }" :style="paged && pageW ? { '--colw': pageW - padX + 'px', '--colgap': padX + 'px' } : null"
      @scroll.passive="onScroll(); act()" @pointerdown="onDown" @pointerup="onUp" @click.capture="onTapCapture">
      <h2 class="ch-title">{{ chapterTitle }}</h2>
      <template v-for="(t, i) in paras" :key="ch + ':' + i">
        <BookImage v-for="(m, j) in imagesAt(i)" :key="'image:' + j" :source="content.resources?.[m.resource]" @settled="measure" />
        <p :data-p="i" :class="{ 'his-end': b.alongTo && b.alongTo.ch === ch && b.alongTo.p === i }" :data-his="role?.name || '他'" @click="tapPara(i, $event)"><template v-for="(g, k) in segsOf(i)" :key="k"><span v-if="g.me || g.his || g.temp" class="mk" :class="{ me: g.me, his: g.his, temp: g.temp }" :data-n="g.n || null">{{ g.text }}</span><template v-else>{{ g.text }}</template></template></p>
      </template>
      <BookImage v-for="(m, j) in imagesAt(paras.length)" :key="'tail:' + j" :source="content.resources?.[m.resource]" @settled="measure" />
      <nav class="ch-nav">
        <button class="btn soft" :disabled="ch === 0" @click="goChapter(ch - 1)">‹ 上一章</button>
        <span>{{ ch + 1 }} / {{ b.chapters.length }}</span>
        <button v-if="!atEnd" class="btn" @click="goChapter(ch + 1)">下一章 ›</button>
        <button v-else class="btn" @click="infoOpen = true">{{ b.mine ? "看读后感" : "读完了，打个分" }}</button>
      </nav>
    </main>

    <span v-if="paged && pageCount > 1" class="pgno">{{ pageNo + 1 }} / {{ pageCount }}</span>

    <!-- 第一次来：告诉她怎么和他一起读 -->
    <div v-if="!store.settings.readTip && sel == null" class="tip" @click="store.settings.readTip = true">
      点一下选中一句（长按可以自己拖着选）：划线、写想法，或者问问{{ role?.name || "他" }}。点划线看批注。<br />{{ paged ? "左右划、或者点屏幕两边翻页。" : "" }}右下角「一起读」：{{ role?.name || "他" }}从这一页往后先读十页，一路划线、写批注，你接着往后读就会看到；他读到的地方有个淡淡的记号。<b>知道了</b>
    </div>
    <!-- 桌宠：站在「一起读」上面；平时在读书，他在想的时候托着脑袋 -->
    <div v-if="sel == null && petOn()" class="pet-read" @pointerdown="petActive()"><PetDock :work="petErr ? 'error' : asking ? 'think' : null" base="read" :roam="false" /></div>
    <button v-if="sel == null" class="along" :class="{ busy: along || asking }" :disabled="along || asking" @click="readThisPage">
      <Icon name="chat" :size="17" />{{ along ? `${role?.name || "他"}在读…` : asking ? `${role?.name || "他"}在想…` : "一起读" }}
    </button>

    <!-- 选中一句：下面一张小卡片 -->
    <Transition name="pop">
      <div v-if="sel != null" class="selcard" @pointerdown.stop @click.stop>
        <p class="q">{{ selQuote }}</p>
        <div class="acts">
          <button @click="copySel"><Icon name="copy" :size="19" />复制</button>
          <button @click="lineSel"><span class="ul">A</span>划线</button>
          <button @click="openSheet('note')"><Icon name="edit" :size="19" />写想法</button>
          <button @click="openSheet('ask')"><Icon name="chat" :size="19" />问问{{ role?.name || "他" }}</button>
          <button class="x" aria-label="取消" @click="clearSel"><Icon name="close" :size="17" /></button>
        </div>
      </div>
    </Transition>

    <Sheet :open="!!sheet" :title="sheet?.mode === 'ask' ? `问问${role?.name || '他'}` : '写想法'" @close="sheet = null">
      <div v-if="sheet" class="compose">
        <blockquote>{{ sheet.at.quote.slice(0, 160) }}{{ sheet.at.quote.length > 160 ? "…" : "" }}</blockquote>
        <textarea v-model="sheet.text" class="input" rows="4" :placeholder="sheet.mode === 'ask' ? '想问他什么（可以不写，他会自己说说读到这里的想法）' : '在这句旁边写点什么'" />
        <button class="btn" @click="sheet.mode === 'ask' ? ask() : saveNote()">{{ sheet.mode === "ask" ? "给他看" : "写上" }}</button>
      </div>
    </Sheet>

    <!-- 点了划线：这句上的批注 -->
    <Sheet :open="!!marksSheet" title="划线" @close="marksSheet = null">
      <div v-if="marksSheet" class="compose">
        <blockquote>{{ (paras[marksSheet.p] || "").slice(marksSheet.list[0].s, marksSheet.list[0].e).slice(0, 200) }}</blockquote>
        <div class="mlist">
          <div v-for="m in marksSheet.list" :key="m.n.id" class="mnote" :class="m.n.from === 'me' ? 'mine' : 'his'">
            <p v-if="m.n.text">{{ m.n.text }}</p>
            <p v-else class="only">{{ m.n.ask ? `问了问${role?.name || "他"}` : "只划了线" }}</p>
            <div class="mf"><small>— {{ who(m.n) }} · {{ when(m.n.ts) }}</small><button @click="dropMark(m.n)">删掉</button></div>
          </div>
        </div>
        <div class="row2">
          <button class="btn soft" @click="fromMarks('note')">写想法</button>
          <button class="btn" @click="fromMarks('ask')">问问{{ role?.name || "他" }}</button>
        </div>
      </div>
    </Sheet>

    <Sheet :open="prefsOpen" title="阅读设置" @close="prefsOpen = false">
      <div class="prefs">
        <div class="pr-row"><span>背景</span>
          <div class="bgs"><button v-for="(c, k) in BGS" :key="k" :class="{ on: prefs.bg === k }" :style="{ background: c[0], color: c[1] }" :aria-label="k" @click="store.readerPrefs.bg = k">文</button></div>
        </div>
        <div class="pr-row"><span>翻页</span>
          <div class="fonts"><button :class="{ on: paged }" @click="store.readerPrefs.mode = 'page'">一屏一页</button><button :class="{ on: !paged }" @click="store.readerPrefs.mode = 'scroll'">上下滚动</button></div>
        </div>
        <div class="pr-row col"><span>原文攒到多少字，整理一次前情</span>
          <div class="fonts"><button v-for="n in [30000, 60000, 100000]" :key="n" :class="{ on: (store.settings.readSumChars || 60000) === n }" @click="store.settings.readSumChars = n">{{ n / 10000 }} 万字</button></div>
          <small>上次整理之后读过的原文，{{ role?.name || "他" }}每次都看得见；攒到这么多字，等这一章读完就整理一次（一直没读完一章，多 1 万字直接整理）。整理模型只整理新读的那段，客观地写梗概。</small>
        </div>
        <div class="pr-row col"><span>每读多少字，{{ role?.name || "他" }}写一句中途印象</span>
          <div class="fonts"><button v-for="n in [10000, 20000, 30000]" :key="n" :class="{ on: (store.settings.readImprChars || 20000) === n }" @click="store.settings.readImprChars = n">{{ n / 10000 }} 万字</button></div>
          <small>用{{ role?.name || "他" }}自己的模型，100 字以内，每一版都留着，平时只带最新的。</small>
        </div>
        <div class="pr-row"><span>字号</span>
          <input v-model.number="store.readerPrefs.size" type="range" min="14" max="26" step="1" /><b>{{ prefs.size }}</b>
        </div>
        <div class="pr-row col"><span>字体</span>
          <div class="fonts">
            <button :class="{ on: !prefs.font }" @click="store.readerPrefs.font = ''">默认</button>
            <button v-for="f in store.readerFonts" :key="f.id" :class="{ on: prefs.font === f.id }" @click="store.readerPrefs.font = f.id" @contextmenu.prevent="dropFont(f)">{{ f.name }}</button>
            <button class="imp" @click="importFont">＋ 导入字体</button>
          </div>
          <small>支持 ttf / otf / woff。长按一个导入的字体可以删掉。</small>
        </div>
      </div>
    </Sheet>

    <BookInfo :book="infoOpen ? b : null" @close="infoOpen = false" @read="infoOpen = false" />

    <Sheet :open="tocOpen" title="目录" @close="tocOpen = false">
      <div class="toc">
        <button class="book-card" @click="tocOpen = false; infoOpen = true">这本书：进度、评分、读后感 ›</button>
        <button v-for="(c, i) in b.chapters" :key="i" :class="{ on: i === ch }" @click="goChapter(i)">
          <span>{{ c.title }}</span><small v-if="notesOf(b.id, i).length">{{ notesOf(b.id, i).length }} 张便利贴</small>
        </button>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.reader { position: fixed; inset: 0; display: flex; flex-direction: column; background: var(--rbg); color: var(--rink); }
.bar { display: flex; align-items: center; gap: 10px; padding: calc(var(--safe-top) + 10px) 14px 10px; background: color-mix(in srgb, var(--rbg) 92%, transparent); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); z-index: 2; }
/* 书名靠左，章节名跟在后面、小一点 */
.bar .t { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; padding-left: 2px; }
.bar .t b { flex: none; max-width: 62%; font-weight: 600; font-size: 1.05rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar .t span { min-width: 0; font-size: .74rem; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.page { flex: 1; overflow-y: auto; padding: 18px 24px calc(var(--safe-bottom) + 130px); max-width: 720px; width: 100%; margin: 0 auto; -webkit-overflow-scrolling: touch; }
/* 一屏一页：字排成一栏一栏往右排，一栏正好一屏宽，翻页就是往右挪一屏 */
.page.paged { min-height: 0; max-width: none; overflow: hidden; column-width: var(--colw, 300px); column-gap: var(--colgap, 48px); column-fill: auto; padding-bottom: calc(var(--safe-bottom) + 84px); touch-action: pan-y pinch-zoom; }
@media (min-width: 768px) { .page.paged { padding-left: max(24px, calc((100% - 720px) / 2)); padding-right: max(24px, calc((100% - 720px) / 2)); } }
.page.paged .ch-nav { break-inside: avoid; position: relative; }
/* Safari 的多栏滚动末尾可能不计右 padding，末页会少滚一段留白。
   用章末导航的定位溢出显式补足右留白，不参与排版，也不增加新的一栏。 */
.page.paged .ch-nav::after { content: ""; position: absolute; top: 0; left: 100%; width: calc(var(--colgap, 48px) / 2); height: 1px; pointer-events: none; }
.pgno { position: fixed; left: 22px; bottom: calc(var(--safe-bottom) + 34px); z-index: 2; font-size: .72rem; color: var(--text-3); letter-spacing: .05em; }
.ch-title { font-weight: 600; font-size: calc(var(--rsize) * 1.2); text-align: center; margin: 10px 0 26px; color: var(--rink); font-family: var(--rfont, inherit); }
.page > p { margin: 0 0 .9em; text-indent: 2em; font-size: var(--rsize); line-height: 1.95; color: var(--rink); font-weight: 300; font-family: var(--rfont, inherit); border-radius: 6px; transition: background .2s; cursor: pointer; }
/* 划线：你的暖黄、他的淡蓝；两个人都划了就叠在一起。写了想法的线尾，有个小小的数字 */
.mk { border-radius: 2px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.mk.me { text-decoration: underline 2px rgba(214, 160, 60, .75); text-underline-offset: 5px; }
.mk.his { text-decoration: underline 2px dotted rgba(92, 142, 205, .85); text-underline-offset: 5px; }
.mk.me.his { text-decoration: underline 2px rgba(150, 140, 190, .85); }
.mk.temp { background: rgba(217, 164, 65, .22); }
.mk[data-n]::after { content: attr(data-n); display: inline; margin-left: 2px; padding: 0 4px; line-height: 1; border-radius: 7px; font-size: 9px; text-align: center; text-indent: 0; vertical-align: super; background: rgba(214, 160, 60, .85); color: #fff; font-weight: 600; font-family: var(--font); }
.mk.his[data-n]::after { background: rgba(92, 142, 205, .9); }
.pet-read { position: fixed; right: 18px; bottom: calc(var(--safe-bottom) + 22px + 42px); width: 180px; height: 0; z-index: 3; pointer-events: none; }
/* 他一起读读到的地方：段落末尾一个淡淡的小记号 */
.his-end::after { content: " · " attr(data-his) "读到这里"; font-size: .62em; letter-spacing: .05em; color: rgba(92, 142, 205, .75); white-space: nowrap; }
.along { position: fixed; right: 18px; bottom: calc(var(--safe-bottom) + 22px); z-index: 3; display: flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; padding: 11px 16px; background: var(--ink); color: var(--on-ink); font-weight: 600; font-size: .85rem; box-shadow: 0 10px 26px rgba(30, 30, 40, .22); }
.along.busy { animation: breathe 1.6s ease-in-out infinite; }
@keyframes breathe { 50% { opacity: .55; } }
.tip { position: fixed; left: 18px; right: 18px; bottom: calc(var(--safe-bottom) + 80px); z-index: 3; max-width: 520px; margin: 0 auto; padding: 12px 14px; border-radius: 16px; background: rgba(var(--glass-rgb), .96); color: var(--text); font-size: .82rem; line-height: 1.7; box-shadow: 0 10px 30px rgba(30, 30, 40, .16); }
.tip b { display: block; text-align: right; margin-top: 4px; color: #b5852e; font-weight: 600; }
.ch-nav { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 30px 0 10px; font-size: .8rem; color: var(--text-2); }
.selcard { position: fixed; left: 12px; right: 12px; bottom: calc(var(--safe-bottom) + 14px); z-index: 4; max-width: 560px; margin: 0 auto; padding: 14px 14px 8px; border-radius: 22px; background: rgba(var(--glass-rgb), .97); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); box-shadow: 0 12px 36px rgba(30, 30, 40, .2); color: var(--text); }
.selcard .q { margin: 0 4px 10px; font-size: .86rem; line-height: 1.6; color: #6a5e52; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.selcard .q::before { content: "“"; font-size: 1.4rem; line-height: 0; vertical-align: -.3em; margin-right: 2px; color: #c7b49a; }
.selcard .acts { display: flex; border-top: 1px solid rgba(60, 45, 30, .08); padding-top: 6px; }
.selcard .acts button { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; border: 0; background: none; padding: 6px 2px; font-size: .72rem; color: var(--text-2); }
.selcard .acts .x { flex: none; width: 40px; color: #9a8f84; justify-content: center; }
.selcard .ul { font-size: 1.05rem; line-height: 19px; text-decoration: underline 2px rgba(214, 160, 60, .9); text-underline-offset: 3px; font-weight: 600; }
.mlist { display: flex; flex-direction: column; gap: 10px; }
.mnote { padding: 12px 14px 8px; border-radius: 14px; }
.mnote.mine { background: color-mix(in srgb, #fff4c9 var(--pastel), var(--card)); }
.mnote.his { background: color-mix(in srgb, #e3eefb var(--pastel), var(--card)); }
.mnote p { margin: 0; font-size: .92rem; line-height: 1.7; white-space: pre-wrap; color: var(--text); }
.mnote p.only { color: rgba(60, 45, 30, .5); font-size: .82rem; }
.mf { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.mf small { flex: 1; font-size: .7rem; color: rgba(60, 45, 30, .5); }
.mf button { border: 0; background: rgba(var(--glass-rgb), .7); border-radius: 999px; padding: 3px 10px; font-size: .72rem; color: #8a5a50; }
.row2 { display: flex; gap: 8px; margin-top: 4px; }
.row2 .btn { flex: 1; }
.pop-enter-active, .pop-leave-active { transition: opacity .2s, transform .2s; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translateY(12px); }
.compose { display: flex; flex-direction: column; gap: 10px; }
.compose blockquote { margin: 0; padding: 8px 12px; border-left: 3px solid #d9a441; background: color-mix(in srgb, #faf6ef var(--pastel), var(--card)); color: var(--text-2); font-size: .85rem; line-height: 1.7; border-radius: 4px; }
.compose .btn { align-self: flex-end; }
.toc { display: flex; flex-direction: column; max-height: 60vh; overflow-y: auto; }
.toc button { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; border: 0; background: none; text-align: left; padding: 11px 6px; border-bottom: 1px solid var(--line); font-size: .9rem; }
.toc button.on { font-weight: 600; color: #b5852e; }
.toc small { color: #d9a441; font-size: .7rem; flex: none; }
.bar .t span { color: color-mix(in srgb, var(--rink) 55%, transparent); }
.night .icon-btn { background: #2a2b31; color: #ddd; }
.night .ch-nav { color: #888; }
.night .selcard { background: rgba(44, 45, 52, .97); color: #ddd8d0; }
.night .selcard .q, .night .selcard .acts button { color: #cfc8bf; }
.aa { font-weight: 600; font-size: .95rem; }
.prefs { display: flex; flex-direction: column; gap: 16px; }
.pr-row { display: flex; align-items: center; gap: 12px; }
.pr-row.col { flex-direction: column; align-items: stretch; gap: 8px; }
.pr-row.col > span { width: auto; }
.pr-row > span { font-size: .85rem; color: var(--text-2); width: 3em; flex: none; }
.pr-row input[type=range] { flex: 1; accent-color: var(--ink); }
.bgs { display: flex; gap: 10px; }
.bgs button { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--line); font-size: .85rem; }
.bgs button.on { box-shadow: 0 0 0 2px var(--ink); }
.fonts { display: flex; flex-wrap: wrap; gap: 8px; }
.fonts button { border: 1px solid var(--line); background: var(--card); padding: 6px 12px; border-radius: 999px; font-size: .82rem; }
.fonts button.on { background: var(--ink); color: var(--on-ink); border-color: var(--ink); }
.fonts .imp { border-style: dashed; color: var(--text-2); }
.pr-row small { color: var(--text-3); font-size: .72rem; }
.toc .book-card { color: var(--text-2); font-size: .82rem; }
</style>
