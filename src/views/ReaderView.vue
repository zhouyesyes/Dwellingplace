<script setup>
// 读书：一章一章读。点一下 → 选中那一句（长按可以自己拖着选），下面出来一张小卡片：复制、划线、写想法、问问他。
// 写了话的划线，句子照常连着读，只在那句下面划线；便利贴贴在这一段的末尾（你的黄、他的蓝）。
// 一段里有几句都贴了：线尾标个小角标 1 2 3，便利贴上也标同一个数。同一句贴了三张以上就叠起来，点开再看。
// 一屏一页时，便利贴和它那几句总在同一页（放不下，就从那句开始连着便利贴一起挪到下一页）。只划了线的，点划线看。
// 右下角「一起读」旁边一张小蓝便利贴：他贴的、你还没看到的，点开是列表，长按一条「跳转 / 忽略」。
// 右下角「一起读」→ 他按自己的进度读：先看目录，挑从哪读、读多少（1000～8000 token），一路划线、写批注；读到哪就在哪做个淡淡的记号。
// 他读到的地方不在你这一页：书页边上有他的小头像（他慢在左、快在右），点一下确认就跳过去
// 给他看的只有这一句 / 这几页，而且是单独问的一次，不进聊天记录。读到哪记在书上（他在聊天里也知道你读到哪了）
// 右上角 Aa：背景、字号、字体（可以导入自己的字体文件）、翻页还是上下滚；读的时候计时（每天读了多久）
// 翻页：一屏一页（左右划，或者点屏幕左右两边）
import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, MAIN, roleById } from "../store/index.js";
import { bookById, loadBook, notesOf, addNote, removeNote, savePos, tickReading, addFont, useFont, removeFont } from "../lib/books.js";
import { captureReadingPage } from "../lib/readingImages.js";
import { safeBookImage } from "../lib/epubImages.js";
import { askHim, readAlong, alongSlice, placeAlong, readOnHisOwn, hisAt } from "../lib/reading.js";
import { describeError } from "../lib/chat.js";
import { pickFile } from "../lib/images.js";
import BookImage from "../components/books/BookImage.vue";
import BookInfo from "../components/books/BookInfo.vue";
import ChapterEditor from "../components/books/ChapterEditor.vue";
import { editParagraph, mergeWithNext, restoreParagraph, restoreGroup } from "../lib/chapters.js";
import { toast } from "../lib/toast.js";
import { goBack } from "../lib/nav.js";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";
import { isDark } from "../lib/theme.js";
import PetDock from "../components/pet/PetDock.vue";
import Avatar from "../components/Avatar.vue";
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
  el.style.setProperty("--colh", el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) + "px");
  pageCount.value = paged.value ? Math.max(1, pageOf(el.querySelector(".ch-nav")?.getBoundingClientRect().left) + 1) : 1;
  pageNo.value = paged.value ? Math.round(el.scrollLeft / el.clientWidth) : 0;
}
// 屏幕上横坐标 x 在这一章的第几页
function pageOf(x) {
  const el = scroller.value;
  if (!el || x == null) return 0;
  return Math.floor((x - el.getBoundingClientRect().left + el.scrollLeft + 2) / el.clientWidth);
}
function toPage(n, smooth = true) {
  const el = scroller.value;
  if (!el) return;
  measure();
  n = Math.max(0, Math.min(n, pageCount.value - 1));
  flipUntil = Date.now() + (smooth ? 800 : 80);
  el.scrollTo({ left: n * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
  pageNo.value = n;
}
// 浏览器自己挪了书页（点图片时对焦、拖选文字时跟着滚）：停在半页上、或者挪进章末垫的那栏，就挪回整页
let flipUntil = 0;
function guardScroll() {
  const el = scroller.value;
  if (!paged.value || !el || Date.now() < flipUntil) return;
  const w = el.clientWidth, at = el.scrollLeft / w;
  const n = Math.abs(at - Math.round(at)) * w > 1 ? pageNo.value : Math.min(Math.round(at), pageCount.value - 1);
  if (Math.abs(el.scrollLeft - n * w) > 1) el.scrollLeft = n * w;
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
  if (sel.value != null || e.target.closest("button, .mk, .notes") || !getSelection()?.isCollapsed) return; // 点在划线、便利贴上：看批注，不翻页
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
  ro = new ResizeObserver(() => relayout());
  ro.observe(scroller.value);
  await settleImages();
  await fixStickies();
  jumpTo(b.value.pos?.p || 0);
  pagePs.value = visibleParas();
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
  keeps.clear();
  savePos(b.value, i, 0);
  await nextTick();
  await settleImages();
  await fixStickies();
  if (toEnd && paged.value) { measure(); toPage(pageCount.value - 1, false); }
  else { scroller.value.scrollLeft = 0; jumpTo(0); }
  measure();
  pagePs.value = visibleParas();
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
    pagePs.value = seen;
    savePos(b.value, ch.value, seen.length ? Math.min(...seen) : 0);
    markSeen();
  }, 500);
}
onBeforeUnmount(() => clearTimeout(posTimer));

// 他贴的便利贴：在屏幕上停了一秒多，才算你看到了（叠起来没展开的，只算最上面那张）
let seenTimer = 0;
function markSeen() {
  clearTimeout(seenTimer);
  seenTimer = setTimeout(() => {
    const el = scroller.value;
    if (!el) return;
    const box = el.getBoundingClientRect();
    for (const x of el.querySelectorAll(".note.his[data-id]")) {
      if (![...x.getClientRects()].some(r => r.right > box.left + 10 && r.left < box.right - 10 && r.bottom > box.top + 10 && r.top < box.bottom - 10)) continue;
      const n = store.bookNotes.find(n => n.id === x.dataset.id);
      if (n) n.seen = true;
    }
  }, 1200);
}
onBeforeUnmount(() => clearTimeout(seenTimer));

// ---------- 便利贴 ----------
// 一段里写了话的划线：重叠的并成一组；一段里有好几组时，按先后编号（线尾和便利贴上的小角标）
const groupsByP = computed(() => {
  const out = {};
  for (const [p, ms] of Object.entries(marksByP.value)) {
    const gs = [];
    for (const m of ms.filter(m => m.n.text).sort((x, y) => x.s - y.s)) {
      const g = gs.at(-1);
      if (g && m.s < g.e) { g.e = Math.max(g.e, m.e); g.list.push(m); }
      else gs.push({ s: m.s, e: m.e, list: [m] });
    }
    gs.forEach((g, k) => { g.key = `${ch.value}:${p}:${g.s}`; g.num = gs.length > 1 ? k + 1 : 0; g.list.sort((x, y) => x.n.ts - y.n.ts); });
    if (gs.length) out[p] = gs;
  }
  return out;
});
// 便利贴和那几句不在同一页的段落：记着从第几个字（那句开头）起另起一行，连着便利贴挪到下一页 { "章:段": 字 }
const keeps = reactive(new Map());
// 同一句三张以上叠起来；点开的记在这里
const opened = reactive(new Set());
// 一段拆成几截：[{ a, z, gs（这一截后面贴的便利贴，按组）, keep, last }]。平时就一截，便利贴跟在段尾
function piecesOf(i) {
  const t = paras.value[i] || "";
  const gs = groupsByP.value[i] || [];
  const cut = keeps.get(`${ch.value}:${i}`);
  const out = cut > 0 && cut < t.length ? [{ a: 0, z: cut }, { a: cut, z: t.length, keep: true }] : [{ a: 0, z: t.length }];
  Object.assign(out.at(-1), { last: true, gs: gs.length ? gs : null });
  return out;
}
// 一屏一页：便利贴和它那句话不在同一页（那句在页尾，便利贴被挤到下一页），就把那句和便利贴绑在一起
async function fixStickies() {
  const el = scroller.value;
  if (!paged.value || !el) return;
  for (let round = 0; round < 5; round++) {
    measure();
    let more = false;
    for (const nb of el.querySelectorAll(".notes[data-g]")) {
      const key = nb.dataset.g, p = Number(key.split(":")[1]);
      if (keeps.has(key)) continue;
      const rs = [...nb.getClientRects()];
      if (!rs.length) continue;
      const pg = pageOf(rs[0].left);
      const split = rs.some(r => pageOf(r.left) !== pg || pageOf(r.right - 4) !== pg);
      // 哪一组的那句不在便利贴这一页：从那句开头起挪（便利贴自己跨页了，就从最后一组挪）
      const gs = groupsByP.value[p] || [];
      const off = gs.find(g => { const at = el.querySelector(`[data-at="${CSS.escape(g.key)}"]`)?.getClientRects()[0]; return at && pageOf(at.left) !== pg; });
      const from = off || (split ? gs.at(-1) : null);
      if (from) { keeps.set(key, from.s); more = true; }
    }
    if (!more) return;
    await nextTick();
  }
}
// 排版变了（屏幕尺寸、字号、字体、展开叠着的便利贴）：重新排，回到刚才读的那一段
let relaying = false, again = false;
async function relayout() {
  if (relaying) return (again = true); // 正在排：排完再来一遍
  relaying = true;
  try {
    do {
      again = false;
      const p = b.value?.pos?.p || 0;
      keeps.clear();
      await nextTick();
      measure();
      await fixStickies();
      jumpTo(p);
    } while (again);
  } finally {
    relaying = false;
  }
}
function toggleStack(g) {
  if (opened.has(g.key)) opened.delete(g.key); else opened.add(g.key);
  nextTick(async () => { await fixStickies(); markSeen(); });
}
// 便利贴上回的是哪张：「回 他：……」
const replyOf = n => n.replyTo && store.bookNotes.find(x => x.id === n.replyTo);
// 点便利贴：打开这一组（看全文、删掉、回应他）
function openGroup(i, g) {
  clearSel();
  marksSheet.value = { p: i, s: g.s, e: g.e, list: g.list };
  for (const m of g.list) m.n.seen = true;
}
// 书里有了新便利贴、删了一张：重新看看哪组要挪页
watch(() => notesOf(b.value?.id, ch.value).filter(n => n.text).length, () => nextTick(fixStickies));

// ---------- 划线和批注 ----------
// 一条划线在这段里是哪几个字
function rangeOf(n, para) {
  if (n.start >= 0 && n.end > n.start && n.end <= para.length) return [n.start, n.end];
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
// 一段（的 [a0, z0) 这一截）拆成几小截：哪截有你的线、他的线、正选着；贴了便利贴的那句，开头那截记下是哪一组
function segsOf(i, a0 = 0, z0 = (paras.value[i] || "").length) {
  const t = paras.value[i] || "";
  const ms = marksByP.value[i] || [];
  const temp = sel.value && !sel.value.native && sel.value.p === i ? [{ s: sel.value.start, e: sel.value.end, temp: true }] : [];
  const all = [...ms, ...temp];
  if (!all.length) return [{ text: t.slice(a0, z0), a: a0 }];
  const starts = Object.fromEntries((groupsByP.value[i] || []).map(g => [g.s, g.key]));
  const ends = Object.fromEntries((groupsByP.value[i] || []).filter(g => g.num).map(g => [g.e, g.num]));
  const xs = [...new Set([a0, z0, ...all.flatMap(m => [m.s, m.e])])].filter(x => x >= a0 && x <= z0).sort((x, y) => x - y);
  const out = [];
  for (let k = 0; k < xs.length - 1; k++) {
    const a = xs[k], z = xs[k + 1];
    if (a === z) continue;
    const cover = all.filter(m => m.s <= a && m.e >= z);
    out.push({ text: t.slice(a, z), a, me: cover.some(m => m.n?.from === "me"), his: cover.some(m => m.n?.from === "ai"), temp: cover.some(m => m.temp), at: starts[a], n: ends[z] });
  }
  return out;
}
// 段落里第几个字（按看得见的文字数）；一段拆成几截时，data-a 是这一截从第几个字开始
function offsetIn(pEl, node, off) {
  const rg = document.createRange();
  rg.selectNodeContents(pEl);
  rg.setEnd(node, off);
  return Number(pEl.dataset.a || 0) + rg.toString().length;
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
const sheet = ref(null); // { mode: "note" | "ask" | "reply", text, at, to }（to：回应他的哪张便利贴）
function openSheet(mode, at = here(), to = null) { sheet.value = { mode, text: "", at, to }; }
function saveNote() {
  const s = sheet.value;
  if (!s.text.trim()) return toast("还没写呢");
  addNote(b.value, { ...s.at, text: s.text, from: "me" });
  sheet.value = null;
  clearSel();
}
// 从批注里接着写 / 问他：还是这几个字
const fromMarks = (mode) => { const m = marksSheet.value.list[0]; marksSheet.value = null; openSheet(mode, { ch: ch.value, p: m.n.p, start: m.s, end: m.e, quote: (paras.value[m.n.p] || "").slice(m.s, m.e) }); };
// 回应他的一张便利贴：贴在同一句上
const replyTo = (m) => { marksSheet.value = null; openSheet("reply", { ch: ch.value, p: m.n.p, start: m.s, end: m.e, quote: (paras.value[m.n.p] || "").slice(m.s, m.e) }, m.n); };
// 只贴上（他下次读到这里会看到）；或者贴上，再让他回一句
async function saveReply(askBack) {
  const s = sheet.value;
  if (!s.text.trim()) return toast("还没写呢");
  const mine = addNote(b.value, { ...s.at, text: s.text, from: "me", replyTo: s.to.id });
  sheet.value = null;
  if (!askBack || !role.value) return;
  asking.value = true;
  try {
    const { text, notes } = await askHim(role.value, b.value, { ch: s.at.ch, p: s.at.p, paras: paras.value, chapterTitle: chapterTitle.value, question: s.text.trim(), quote: s.at.quote, thread: s.to.text });
    mine.seen = true;
    addNote(b.value, { ...s.at, text, from: "ai", replyTo: mine.id }).seen = true;
    toast(notes[0] || `${role.value.name} 回了你一张便利贴`, 2500);
  } catch (e) {
    toast(`没问到：${describeError(e)}`, 4000);
  } finally {
    asking.value = false;
  }
}
function dropMark(n) {
  if (n.text && !confirm(`删掉这条批注？\n\n${n.text.slice(0, 60)}`)) return;
  removeNote(n);
  if (marksSheet.value) { marksSheet.value.list = marksSheet.value.list.filter(m => m.n !== n); if (!marksSheet.value.list.length) marksSheet.value = null; }
}

// 问问他：给他看划的这一句（和它所在的段落、前后各一段），他回一条批注，划在同一句上
const imageReply = ref("");
const asking = ref(false);
async function ask() {
  const s = sheet.value, r = role.value;
  if (!r) return;
  sheet.value = null;
  clearSel();
  const at = s.at;
  const imageOnly = !paras.value[at.p]?.trim();
  if (!imageOnly) {
    if (s.text.trim()) addNote(b.value, { ...at, text: s.text, from: "me" }).seen = true;
    else Object.assign(addNote(b.value, { ...at, text: "", from: "me" }), { seen: true, ask: true }); // 没写话也留一道线：问过他这里
  }
  asking.value = true;
  try {
    const { text, notes } = await askHim(r, b.value, { ch: ch.value, p: at.p, paras: paras.value, chapterTitle: chapterTitle.value, question: s.text.trim(), quote: at.quote, page: captureReadingPage(scroller.value, content.value, ch.value) });
    if (imageOnly) imageReply.value = text;
    else addNote(b.value, { ...at, text, from: "ai" }).seen = true;
    toast(notes[0] || (imageOnly ? `${r.name} 回复了这一页` : `${r.name} 在那句旁边写了一句`), 2500);
  } catch (e) {
    toast(`没问到：${describeError(e)}`, 4000);
  } finally {
    asking.value = false;
  }
}

const along = ref(false);
const petErr = ref(false); // 桌宠：没读成时着急几秒
const posBefore = (x, y) => x.ch < y.ch || (x.ch === y.ch && x.p < y.p);
// 一起读：按他自己的进度读——他先看目录，挑从哪开始（接着读、跳到某一章、看结尾）、读多少（1000～8000 token），再读那一段，一路划线写批注。
// 停在一页纯插图上点：就是请他看这一页的图（单独问一次）
async function readThisPage() {
  const r = role.value, el = scroller.value;
  if (!r || !el || along.value) return;
  along.value = true;
  store.settings.readTip = true;
  try {
    const page = captureReadingPage(el, content.value, ch.value);
    if (!visibleParas().length && page.images.length) {
      const res = await readAlong(r, b.value, { from: { ch: ch.value, p: Math.max(0, Math.min(page.images[0].p, paras.value.length - 1)) }, to: { ch: ch.value, p: 0 }, maxChars: Infinity, page });
      if (res.imageOnly) { imageReply.value = res.text; petOnce("success"); return; }
    }
    const res = await readOnHisOwn(r, b.value);
    await placeAlong(b.value, res.notes, -1);
    const title = i => content.value.chapters[i]?.title || `第 ${i + 1} 章`;
    const where = res.choice.how === "end" ? "直接去读了结尾" : res.choice.how === "chapter" ? `跳到「${title(res.from.ch)}」读了` : "接着往下读了";
    toast(res.memNotes[0] || `${r.name}${where}约 ${res.choice.tokens} token，划了 ${res.notes.length} 处，读到「${title(res.upTo.ch)}」`, 3600);
    petOnce("success");
  } catch (e) {
    toast(`没读成：${describeError(e)}`, 4000);
    petErr.value = true;
    setTimeout(() => (petErr.value = false), 5000);
  } finally {
    along.value = false;
  }
}

// ---------- 他读到哪：你书页边上他的小头像 ----------
// 他读到的地方不在这一页：他比你慢，小头像在左边；比你快，在右边。点一下确认，再跳过去
const pagePs = ref([]); // 这一页看得到哪几段
const hisPt = computed(() => (b.value ? hisAt(b.value) : null));
const hisSide = computed(() => {
  const h = hisPt.value, v = pagePs.value;
  if (!h || !v.length || !content.value) return null;
  if (h.ch === ch.value && v.includes(h.p)) return null;
  return posBefore(h, { ch: ch.value, p: Math.min(...v) }) ? "left" : "right";
});
async function jumpHis() {
  const h = hisPt.value;
  if (!h || !confirm(`跳到${role.value?.name || "他"}读到的地方？\n「${content.value.chapters[h.ch]?.title || ""}」`)) return;
  if (h.ch !== ch.value) await goChapter(h.ch);
  jumpTo(h.p);
  await nextTick();
  measure();
  savePos(b.value, ch.value, h.p);
  pagePs.value = visibleParas();
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
  await nextTick();
  setTimeout(relayout, 60);
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

// ---------- 小蓝便利贴：他贴的、你还没看到的 ----------
const unread = computed(() => (b.value ? notesOf(b.value.id) : []).filter(n => n.from === "ai" && n.text && !n.seen && n.ch >= 0)
  .sort((x, y) => x.ch - y.ch || x.p - y.p || (x.start || 0) - (y.start || 0)));
const hisAny = computed(() => (b.value ? notesOf(b.value.id) : []).some(n => n.from === "ai" && n.text));
const trackOpen = ref(false);
const trackAct = ref(null); // 长按了哪一条：出来「跳转 / 忽略」
const trackOpenOne = ref(null); // 点了哪一条：展开全文
let pressT = 0, pressed = false;
function pressStart(n) { pressed = false; clearTimeout(pressT); pressT = setTimeout(() => { pressed = true; trackAct.value = n; navigator.vibrate?.(10); }, 450); }
const pressEnd = () => clearTimeout(pressT);
function tapTrack(n) { if (pressed) return (pressed = false); trackOpenOne.value = trackOpenOne.value === n.id ? null : n.id; }
const chTitle = i => b.value?.chapters[i]?.title || `第 ${i + 1} 章`;
function ignore(n) { n.seen = true; trackAct.value = null; }
// 跳过去：翻到那张便利贴所在的那一页，闪一下
async function jumpNote(n) {
  trackAct.value = null;
  trackOpen.value = false;
  if (n.ch !== ch.value) await goChapter(n.ch);
  const g = (groupsByP.value[n.p] || []).find(g => g.list.some(m => m.n === n));
  if (g && g.list.length >= 3 && !opened.has(g.key)) { opened.add(g.key); await nextTick(); await fixStickies(); }
  await nextTick();
  const x = scroller.value?.querySelector(`.note[data-id="${n.id}"]`);
  if (!x) return toast("这张便利贴找不到原来的位置了");
  if (paged.value) { measure(); toPage(pageOf(x.getClientRects()[0].left)); }
  else scroller.value.scrollTop = Math.max(0, x.offsetTop - scroller.value.clientHeight / 3);
  x.classList.remove("flash");
  void x.offsetWidth;
  x.classList.add("flash");
  markSeen();
}
onBeforeUnmount(() => clearTimeout(pressT));

// 点书里的图：全屏看（长图上下滑着看，两指可以放大）
const viewing = ref(null); // { src, long }
function viewImage(m) {
  const src = safeBookImage(content.value.resources?.[m.resource]);
  if (src) viewing.value = { src, long: false };
}
const onViewLoad = e => { if (viewing.value) viewing.value.long = e.target.naturalHeight > e.target.naturalWidth * 2.2; };

// ---------- 改正文：选中一句 →「改正文」，改这一整段（改字、标点；中间换行就拆成两段）；原文留着，能恢复 ----------
const editing = ref(null); // { p, text, orig（能恢复成的原文）}
function openEdit() {
  const p = sel.value.p;
  const g = restoreGroup(content.value.chapters[ch.value], p);
  editing.value = { p, text: paras.value[p], orig: g ? g.news.join("\n") : "" };
  clearSel();
}
async function runEdit(fn, done) {
  const e = editing.value;
  if (!e || e.busy) return;
  e.busy = true;
  try {
    await fn(e);
    editing.value = null;
    await chaptersChanged();
    toast(done);
  } catch (err) {
    toast(err.message || "没改成", 3500);
    if (editing.value) editing.value.busy = false;
  }
}
const saveEdit = () => runEdit(e => (e.text.trim() === paras.value[e.p] ? Promise.resolve() : editParagraph(b.value.id, ch.value, e.p, e.text)), "改好了");
const mergeEdit = () => runEdit(e => mergeWithNext(b.value.id, ch.value, e.p), "和下一段并在一起了");
const restoreEdit = () => runEdit(e => restoreParagraph(b.value.id, ch.value, e.p), "恢复成原文了");

const tocOpen = ref(false);
const tocEdit = ref(false);
// 目录里改了章节（改名、移除、合并、切开、重新分）：正文换成新的，回到刚才读的地方（位置已经跟着挪过了）
async function chaptersChanged() {
  content.value = await loadBook(b.value.id);
  ch.value = Math.min(b.value.pos?.ch || 0, content.value.chapters.length - 1);
  sel.value = null;
  await nextTick();
  await settleImages();
  await relayout();
  markSeen();
}
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
      @scroll.passive="guardScroll(); onScroll(); act()" @pointerdown="onDown" @pointerup="onUp" @click.capture="onTapCapture">
      <h2 class="ch-title">{{ chapterTitle }}</h2>
      <template v-for="(t, i) in paras" :key="ch + ':' + i">
        <BookImage v-for="(m, j) in imagesAt(i)" :key="'image:' + j" :data-media="media.indexOf(m)" :source="content.resources?.[m.resource]" @settled="measure" @click="viewImage(m)" />
        <div v-for="pc in piecesOf(i)" :key="pc.a" class="pc" :class="{ keep: pc.keep }">
          <p class="para" :class="{ cont: pc.a > 0, cut: !pc.last, 'his-end': pc.last && b.alongTo && b.alongTo.ch === ch && b.alongTo.p === i }" :data-p="i" :data-a="pc.a || null" :data-his="role?.name || '他'" @click="tapPara(i, $event)"><template v-for="(g, k) in segsOf(i, pc.a, pc.z)" :key="k"><span v-if="g.me || g.his || g.temp" class="mk" :class="{ me: g.me, his: g.his, temp: g.temp }" :data-at="g.at || null" :data-n="g.n || null">{{ g.text }}</span><template v-else>{{ g.text }}</template></template></p>
          <div v-if="pc.gs" class="notes" :data-g="`${ch}:${i}`">
            <template v-for="g in pc.gs" :key="g.key">
              <div v-if="g.list.length >= 3 && !opened.has(g.key)" class="note stacked" :class="g.list.at(-1).n.from === 'me' ? 'mine' : 'his'" :data-id="g.list.at(-1).n.id" @click="toggleStack(g)">
                <i class="tape" /><b v-if="g.num" class="num">{{ g.num }}</b><p>{{ g.list.at(-1).n.text }}</p>
                <span class="more">这句上一共 {{ g.list.length }} 张 · 点开</span>
              </div>
              <template v-else>
                <div v-for="m in g.list" :key="m.n.id" class="note" :class="m.n.from === 'me' ? 'mine' : 'his'" :data-id="m.n.id" @click="openGroup(i, g)">
                  <i class="tape" /><b v-if="g.num" class="num">{{ g.num }}</b>
                  <small v-if="replyOf(m.n)" class="re">回{{ replyOf(m.n).from === "me" ? "我" : role?.name || "他" }}：{{ replyOf(m.n).text.slice(0, 18) }}{{ replyOf(m.n).text.length > 18 ? "…" : "" }}</small>
                  <p>{{ m.n.text }}</p>
                  <span>— {{ who(m.n) }} · {{ when(m.n.ts) }}</span>
                </div>
                <button v-if="g.list.length >= 3" class="fold" @click="toggleStack(g)">叠起来</button>
              </template>
            </template>
          </div>
        </div>
      </template>
      <BookImage v-for="(m, j) in imagesAt(paras.length)" :key="'tail:' + j" :data-media="media.indexOf(m)" :source="content.resources?.[m.resource]" @settled="measure" @click="!paras.length ? openSheet('ask', { ch, p: 0, quote: '' }) : viewImage(m)" :role="!paras.length ? 'button' : null" :tabindex="!paras.length ? 0 : null" :aria-label="!paras.length ? '问问他：当前图片页' : null" @mousedown="!paras.length && $event.preventDefault()" @keydown.enter="!paras.length && openSheet('ask', { ch, p: 0, quote: '' })" />
      <nav class="ch-nav">
        <button class="btn soft" :disabled="ch === 0" @click="goChapter(ch - 1)">‹ 上一章</button>
        <span>{{ ch + 1 }} / {{ b.chapters.length }}</span>
        <button v-if="!atEnd" class="btn" @click="goChapter(ch + 1)">下一章 ›</button>
        <button v-else class="btn" @click="infoOpen = true">{{ b.mine ? "看读后感" : "读完了，打个分" }}</button>
      </nav>
      <!-- 一屏一页：章末后面多垫一栏空白，最后一页才能完整翻过去（有的浏览器算不上右边的留白，末页会偏右） -->
      <div v-if="paged" class="tail" aria-hidden="true" />
    </main>

    <button v-if="hisSide && sel == null" class="his-arrow" :class="hisSide" :aria-label="`跳到${role?.name || '他'}读到的地方`" @click="jumpHis">
      <span class="ar">{{ hisSide === "left" ? "‹" : "›" }}</span><Avatar :img="role?.avatar" :name="role?.name || '他'" :color="role?.color" :size="26" />
    </button>
    <span v-if="paged && pageCount > 1" class="pgno">{{ pageNo + 1 }} / {{ pageCount }}</span>

    <!-- 第一次来：告诉她怎么和他一起读 -->
    <div v-if="!store.settings.readTip && sel == null" class="tip" @click="store.settings.readTip = true">
      点一下选中一句（长按可以自己拖着选）：划线、写想法，或者问问{{ role?.name || "他" }}。点划线看批注。<br />{{ paged ? "左右划、或者点屏幕两边翻页。" : "" }}右下角「一起读」：{{ role?.name || "他" }}按自己的进度读一段（他自己挑读哪、读多少），一路划线、写批注；他读到的地方有个淡淡的记号，不在这一页时书页边上有他的小头像，点一下能跳过去。<b>知道了</b>
    </div>
    <!-- 桌宠：站在「一起读」上面；平时在读书，他在想的时候托着脑袋 -->
    <div v-if="sel == null && petOn()" class="pet-read" @pointerdown="petActive()"><PetDock :work="petErr ? 'error' : asking ? 'think' : null" base="read" :roam="false" /></div>
    <div v-if="sel == null" class="dockr">
      <button v-if="hisAny" class="track" :class="{ none: !unread.length }" :aria-label="`${role?.name || '他'}的便利贴，${unread.length} 张没看`" @click="trackOpen = true">
        <i class="tape" /><b v-if="unread.length">{{ unread.length > 99 ? "99+" : unread.length }}</b>
      </button>
      <button class="along" :class="{ busy: along || asking }" :disabled="along || asking" @click="readThisPage">
        <Icon name="chat" :size="17" />{{ along ? `${role?.name || "他"}在读…` : asking ? `${role?.name || "他"}在想…` : "一起读" }}
      </button>
    </div>

    <!-- 选中一句：下面一张小卡片 -->
    <Transition name="pop">
      <div v-if="sel != null" class="selcard" @pointerdown.stop @click.stop>
        <p class="q">{{ selQuote }}</p>
        <div class="acts">
          <button @click="copySel"><Icon name="copy" :size="19" />复制</button>
          <button @click="lineSel"><span class="ul">A</span>划线</button>
          <button @click="openSheet('note')"><Icon name="edit" :size="19" />写想法</button>
          <button @click="openSheet('ask')"><Icon name="chat" :size="19" />问问{{ role?.name || "他" }}</button>
          <button @click="openEdit"><Icon name="file" :size="19" />改正文</button>
          <button class="x" aria-label="取消" @click="clearSel"><Icon name="close" :size="17" /></button>
        </div>
      </div>
    </Transition>

    <Sheet :open="!!sheet" :title="sheet?.mode === 'ask' ? `问问${role?.name || '他'}` : '写想法'" @close="sheet = null">
      <div v-if="sheet" class="compose">
        <blockquote>{{ sheet.at.quote.slice(0, 160) }}{{ sheet.at.quote.length > 160 ? "…" : "" }}</blockquote>
        <div v-if="sheet.to" class="mnote his"><p>{{ sheet.to.text }}</p></div>
        <textarea v-model="sheet.text" class="input" rows="4" :placeholder="sheet.mode === 'ask' ? '想问他什么（可以不写，他会自己说说读到这里的想法）' : sheet.mode === 'reply' ? `回${role?.name || '他'}一句` : '在这句旁边写点什么'" />
        <div v-if="sheet.mode === 'reply'" class="row2">
          <button class="btn soft" @click="saveReply(false)">贴上</button>
          <button class="btn" :disabled="asking" @click="saveReply(true)">贴上，让{{ role?.name || "他" }}回</button>
        </div>
        <button v-else class="btn" @click="sheet.mode === 'ask' ? ask() : saveNote()">{{ sheet.mode === "ask" ? "给他看" : "写上" }}</button>
      </div>
    </Sheet>

    <Sheet :open="!!editing" title="改正文" @close="editing = null">
      <div v-if="editing" class="compose">
        <textarea v-model="editing.text" class="input edit-text" rows="8" aria-label="这一段的正文" />
        <small class="edit-tip">改错字、标点都行；想拆成两段，就在中间换一行。原文一直留着，随时能恢复。</small>
        <details v-if="editing.orig" class="edit-orig"><summary>原文</summary><p>{{ editing.orig }}</p></details>
        <div class="row2">
          <button v-if="editing.orig" class="btn soft" :disabled="editing.busy" @click="restoreEdit">恢复原文</button>
          <button v-if="editing.p < paras.length - 1" class="btn soft" :disabled="editing.busy" @click="mergeEdit">和下一段合并</button>
          <button class="btn" :disabled="editing.busy || !editing.text.trim()" @click="saveEdit">保存</button>
        </div>
      </div>
    </Sheet>

    <Sheet :open="!!imageReply" title="这一页的共读" @close="imageReply = ''">
      <div class="compose"><p>{{ imageReply }}</p></div>
    </Sheet>

    <!-- 点了划线：这句上的批注 -->
    <Sheet :open="!!marksSheet" :title="marksSheet?.s != null ? '便利贴' : '划线'" @close="marksSheet = null">
      <div v-if="marksSheet" class="compose">
        <blockquote>{{ (paras[marksSheet.p] || "").slice(marksSheet.s ?? marksSheet.list[0].s, marksSheet.e ?? marksSheet.list[0].e).slice(0, 200) }}</blockquote>
        <div class="mlist">
          <div v-for="m in marksSheet.list" :key="m.n.id" class="mnote" :class="m.n.from === 'me' ? 'mine' : 'his'">
            <small v-if="replyOf(m.n)" class="re">回{{ replyOf(m.n).from === "me" ? "我" : role?.name || "他" }}：{{ replyOf(m.n).text.slice(0, 40) }}{{ replyOf(m.n).text.length > 40 ? "…" : "" }}</small>
            <p v-if="m.n.text">{{ m.n.text }}</p>
            <p v-else class="only">{{ m.n.ask ? `问了问${role?.name || "他"}` : "只划了线" }}</p>
            <div class="mf"><small>— {{ who(m.n) }} · {{ when(m.n.ts) }}</small><button v-if="m.n.from === 'ai' && m.n.text" class="re-btn" @click="replyTo(m)">回应</button><button @click="dropMark(m.n)">删掉</button></div>
          </div>
        </div>
        <div class="row2">
          <button class="btn soft" @click="fromMarks('note')">写想法</button>
          <button class="btn" @click="fromMarks('ask')">问问{{ role?.name || "他" }}</button>
        </div>
      </div>
    </Sheet>

    <Sheet :open="trackOpen" :title="`${role?.name || '他'}的便利贴`" @close="trackOpen = false; trackAct = null">
      <div class="track-list">
        <p v-if="!unread.length" class="track-empty">{{ role?.name || "他" }}贴的都看过了</p>
        <p v-else class="track-tip">还没看到的 {{ unread.length }} 张 · 长按一条：跳转 / 忽略</p>
        <div v-for="n in unread" :key="n.id" class="titem" :class="{ held: trackAct === n }"
          @pointerdown="pressStart(n)" @pointerup="pressEnd" @pointerleave="pressEnd" @pointercancel="pressEnd" @contextmenu.prevent @click="tapTrack(n)">
          <small>{{ chTitle(n.ch) }}{{ n.quote ? ` ·「${n.quote.slice(0, 16)}${n.quote.length > 16 ? "…" : ""}」` : "" }}</small>
          <p :class="{ full: trackOpenOne === n.id }">{{ n.text }}</p>
          <div v-if="trackAct === n" class="tacts" @click.stop @pointerdown.stop>
            <button @click="jumpNote(n)">跳转</button>
            <button @click="ignore(n)">忽略</button>
          </div>
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

    <div v-if="viewing" class="imgview" :class="{ long: viewing.long }" role="dialog" aria-label="看图" @click="viewing = null">
      <img :src="viewing.src" alt="书中插图" @load="onViewLoad" @click.stop />
      <button class="icon-btn x" aria-label="关闭" @click.stop="viewing = null"><Icon name="close" /></button>
    </div>

    <Sheet :open="tocOpen" :title="tocEdit ? '编辑目录' : '目录'" @close="tocOpen = false; tocEdit = false">
      <ChapterEditor v-if="tocEdit" :book="b" :body="content" :current="ch" @changed="chaptersChanged" @done="tocEdit = false" />
      <div v-else class="toc">
        <div class="toc-top">
          <button class="book-card" @click="tocOpen = false; infoOpen = true">这本书：进度、评分、读后感 ›</button>
          <button class="toc-edit" @click="tocEdit = true">编辑</button>
        </div>
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
/* 章末后面垫一整栏空白：Safari 的多栏滚动末尾不计右留白，最后一页会少滚一段、字偏右。
   多垫一栏，最后一页总能滚到整页的位置；页数按章末那一行算，这一栏翻不到 */
.page.paged .tail { break-before: column; height: var(--colh, 100%); }
.pgno { position: fixed; left: 22px; bottom: calc(var(--safe-bottom) + 34px); z-index: 2; font-size: .72rem; color: var(--text-3); letter-spacing: .05em; }
.ch-title { font-weight: 600; font-size: calc(var(--rsize) * 1.2); text-align: center; margin: 10px 0 26px; color: var(--rink); font-family: var(--rfont, inherit); }
.page .para { margin: 0 0 .9em; text-indent: 2em; font-size: var(--rsize); line-height: 1.95; color: var(--rink); font-weight: 300; font-family: var(--rfont, inherit); border-radius: 6px; transition: background .2s; cursor: pointer; }
/* 划线：你的暖黄、他的淡蓝；两个人都划了就叠在一起。写了想法的线尾，有个小小的数字 */
.mk { border-radius: 2px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.mk.me { text-decoration: underline 2px rgba(214, 160, 60, .75); text-underline-offset: 5px; }
.mk.his { text-decoration: underline 2px dotted rgba(92, 142, 205, .85); text-underline-offset: 5px; }
.mk.me.his { text-decoration: underline 2px rgba(150, 140, 190, .85); }
.mk.temp { background: rgba(217, 164, 65, .22); }
/* 一段拆成几截：平时就像一段（截和截之间不留空、不缩进）；要和便利贴绑在一起的那句，整块不跨页 */
.pc { display: contents; }
.pc.keep { display: block; break-inside: avoid; -webkit-column-break-inside: avoid; }
.page .para.cont { text-indent: 0; }
.page .para.cut { margin-bottom: 0; }
/* 便利贴：贴在那句后面，你的黄、他的蓝（靠右），歪一点点，顶上一截胶带 */
.notes { display: flex; flex-direction: column; gap: 12px; margin: 4px 0 18px; break-inside: avoid; -webkit-column-break-inside: avoid; }
.note { position: relative; width: fit-content; max-width: 86%; padding: 14px 14px 9px; border-radius: 2px; box-shadow: 0 6px 14px rgba(60, 45, 30, .14); cursor: pointer; transform: rotate(-1.2deg); font-family: var(--font); text-indent: 0; }
.note:nth-child(even) { transform: rotate(1deg); }
.note.mine { background: #fff1a8; }
.note.his { background: #dcebfc; align-self: flex-end; }
.note p { margin: 0; font-size: .9rem; line-height: 1.7; white-space: pre-wrap; color: #3b3128; display: -webkit-box; -webkit-line-clamp: 7; -webkit-box-orient: vertical; overflow: hidden; }
.note span { display: block; margin-top: 6px; font-size: .68rem; color: rgba(60, 45, 30, .5); text-align: right; }
.note .re { display: block; margin-bottom: 4px; font-size: .68rem; color: rgba(60, 45, 30, .55); }
.tape { position: absolute; top: -8px; left: 50%; width: 46px; height: 16px; transform: translateX(-50%) rotate(-3deg); background: rgba(255, 255, 255, .55); box-shadow: 0 1px 2px rgba(0, 0, 0, .06); }
/* 叠起来的：最上面一张，后面露出两张的边 */
.note.stacked { box-shadow: 0 6px 14px rgba(60, 45, 30, .14), 5px 5px 0 -1px #f3e6a0, 10px 10px 0 -2px #e9ddb0; }
.note.stacked.his { box-shadow: 0 6px 14px rgba(60, 45, 30, .14), -5px 5px 0 -1px #cddff4, -10px 10px 0 -2px #c3d3e6; }
.note.stacked p { -webkit-line-clamp: 3; }
/* 一段里好几句都贴了：线尾一个小角标，便利贴左上角同一个数 */
.mk[data-n]::after { content: attr(data-n); display: inline-block; margin-left: 2px; min-width: 1.1em; padding: 0 3px; line-height: 1.25; border-radius: 7px; font-size: 10px; text-align: center; text-indent: 0; vertical-align: super; background: rgba(214, 160, 60, .85); color: #fff; font-weight: 600; font-family: var(--font); text-decoration: none; }
.mk.his[data-n]::after { background: rgba(92, 142, 205, .9); }
.note .num { position: absolute; top: 6px; left: 8px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; font-size: 10px; line-height: 16px; text-align: center; color: #fff; background: rgba(214, 160, 60, .9); font-family: var(--font); }
.note.his .num { background: rgba(92, 142, 205, .95); }
.note:has(.num) p, .note:has(.num) .re { padding-left: 14px; }
.note .more { color: #9a7b3f; }
.note.his .more { color: #4d79ad; }
.fold { align-self: center; border: 0; background: none; font-size: .72rem; color: var(--text-3); padding: 2px 10px; }
.note.flash { animation: flash 1.4s ease-out; }
@keyframes flash { 0%, 40% { box-shadow: 0 0 0 4px rgba(92, 142, 205, .55), 0 6px 14px rgba(60, 45, 30, .14); } }
/* 深色：纸暗下来一点，字还看得清 */
:root[data-theme="dark"] .note, .night .note { filter: brightness(.78) saturate(.85); }
.pet-read { position: fixed; right: 18px; bottom: calc(var(--safe-bottom) + 22px + 42px); width: 180px; height: 0; z-index: 3; pointer-events: none; }
/* 他一起读读到的地方：段落末尾一个淡淡的小记号 */
.his-end::after { content: " · " attr(data-his) "读到这里"; font-size: .62em; letter-spacing: .05em; color: rgba(92, 142, 205, .75); white-space: nowrap; }
.his-arrow { position: fixed; top: 50%; z-index: 3; display: flex; align-items: center; gap: 1px; border: 0; padding: 4px 5px; background: color-mix(in srgb, var(--rbg) 70%, transparent); border-radius: 999px; box-shadow: 0 4px 12px rgba(30, 40, 60, .14); opacity: .85; }
.his-arrow.left { left: 2px; }
.his-arrow.right { right: 2px; flex-direction: row-reverse; }
.his-arrow .ar { font-size: 1.1rem; line-height: 1; color: rgba(92, 142, 205, .95); padding: 0 2px; }
.dockr { position: fixed; right: 18px; bottom: calc(var(--safe-bottom) + 22px); z-index: 3; display: flex; align-items: center; gap: 12px; }
/* 「一起读」旁边的小蓝便利贴：数字是他贴的、你还没看到的 */
.track { position: relative; width: 38px; height: 38px; border: 0; border-radius: 2px; padding: 0; background: #dcebfc; color: #2f5d93; transform: rotate(4deg); box-shadow: 0 6px 14px rgba(30, 40, 60, .18); display: grid; place-items: center; }
.track .tape { width: 24px; height: 10px; top: -5px; }
.track b { font-size: .8rem; font-weight: 700; font-family: var(--font); }
.track.none { opacity: .75; }
:root[data-theme="dark"] .track { filter: brightness(.82); }
.along { display: flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; padding: 11px 16px; background: var(--ink); color: var(--on-ink); font-weight: 600; font-size: .85rem; box-shadow: 0 10px 26px rgba(30, 30, 40, .22); }
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
.mf .re-btn { color: #4d79ad; }
.mnote .re { display: block; margin-bottom: 4px; font-size: .72rem; color: var(--text-3); }
.track-list { display: flex; flex-direction: column; gap: 10px; max-height: 62vh; overflow-y: auto; padding: 4px 2px 6px; }
.track-tip, .track-empty { margin: 0 4px 2px; font-size: .76rem; color: var(--text-3); }
.track-empty { text-align: center; padding: 24px 0; }
.titem { padding: 10px 14px; border-radius: 4px; background: color-mix(in srgb, #e3eefb var(--pastel), var(--card)); -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; cursor: pointer; transition: transform .15s; }
.titem.held { transform: scale(.98); }
.titem small { display: block; font-size: .7rem; color: var(--text-3); margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.titem p { margin: 0; font-size: .88rem; line-height: 1.65; color: var(--text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
.titem p.full { display: block; }
.tacts { display: flex; gap: 8px; margin-top: 8px; }
.tacts button { flex: 1; border: 0; border-radius: 999px; padding: 7px 0; font-size: .8rem; background: var(--card); color: var(--text); box-shadow: var(--shadow-soft); }
.tacts button:first-child { background: var(--ink); color: var(--on-ink); }
.row2 { display: flex; gap: 8px; margin-top: 4px; }
.row2 .btn { flex: 1; }
.edit-text { font-size: 16px; line-height: 1.8; background: var(--card); max-height: 46vh; }
.edit-tip { color: var(--text-3); font-size: .74rem; line-height: 1.6; }
.edit-orig summary { font-size: .8rem; color: var(--text-2); cursor: pointer; }
.edit-orig p { margin: 6px 0 0; font-size: .84rem; line-height: 1.7; color: var(--text-2); white-space: pre-wrap; }
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
.toc .book-card { color: var(--text-2); font-size: .82rem; flex: 1; }
.imgview { position: fixed; inset: 0; z-index: 60; background: rgba(0, 0, 0, .92); display: flex; align-items: center; justify-content: center; overflow: auto; touch-action: pan-x pan-y pinch-zoom; padding: calc(var(--safe-top) + 56px) 0 calc(var(--safe-bottom) + 20px); }
.imgview img { max-width: 100%; max-height: 100%; object-fit: contain; }
.imgview.long { align-items: flex-start; }
.imgview.long img { width: 100%; max-height: none; }
.imgview .x { position: fixed; top: calc(var(--safe-top) + 10px); right: 14px; }
.toc-top { display: flex; align-items: center; border-bottom: 1px solid var(--line); }
.toc-top .book-card { border-bottom: 0; }
.toc .toc-edit { flex: none; border: 0; border-radius: 999px; padding: 5px 14px; background: var(--bg); color: var(--text); font-size: .8rem; border-bottom: 0; }
</style>
