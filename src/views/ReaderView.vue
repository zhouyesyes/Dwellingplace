<script setup>
// 读书：一章一章读。点一段 → 贴便利贴，或者问问他（他读了这一段，回一张便利贴）。
// 读到哪记在书上（他在聊天里也知道你读到哪了）；便利贴贴在那一段下面：你的黄色，他的蓝色
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { MAIN, roleById } from "../store/index.js";
import { bookById, loadBook, notesOf, addNote, removeNote, savePos } from "../lib/books.js";
import { oneShot, meName, describeError } from "../lib/chat.js";
import { toast } from "../lib/toast.js";
import { goBack } from "../lib/nav.js";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";

const route = useRoute();
const router = useRouter();
const b = computed(() => bookById(route.params.id));
const role = computed(() => roleById(MAIN));
const content = ref(null);
const ch = ref(0);
const scroller = ref(null);
const paras = computed(() => content.value?.chapters[ch.value]?.paras || []);
const chapterTitle = computed(() => b.value?.chapters[ch.value]?.title || "");
const notesByP = computed(() => {
  const m = {};
  for (const n of b.value ? notesOf(b.value.id, ch.value) : []) (m[n.p] ??= []).push(n);
  return m;
});

onMounted(async () => {
  if (!b.value) return router.replace("/books");
  content.value = await loadBook(b.value.id);
  ch.value = Math.min(b.value.pos?.ch || 0, content.value.chapters.length - 1);
  await nextTick();
  jumpTo(b.value.pos?.p || 0);
  markSeen();
});

function jumpTo(p) {
  const el = scroller.value?.querySelector(`[data-p="${p}"]`);
  if (el) scroller.value.scrollTop = el.offsetTop - 70;
  else if (scroller.value) scroller.value.scrollTop = 0;
}
async function goChapter(i) {
  if (!content.value || i < 0 || i >= content.value.chapters.length) return;
  ch.value = i;
  sel.value = null;
  tocOpen.value = false;
  savePos(b.value, i, 0);
  await nextTick();
  jumpTo(0);
  markSeen();
}

// 读到哪：最上面那一段（停下来半秒再记）
let posTimer = 0;
function onScroll() {
  clearTimeout(posTimer);
  posTimer = setTimeout(() => {
    const el = scroller.value;
    if (!el || !b.value) return;
    const top = el.scrollTop + 80;
    let p = 0;
    for (const x of el.querySelectorAll("[data-p]")) { if (x.offsetTop <= top) p = Number(x.dataset.p); else break; }
    savePos(b.value, ch.value, p);
  }, 500);
}
onBeforeUnmount(() => clearTimeout(posTimer));

// 他贴的便利贴：翻到这一章就算你看过了
function markSeen() {
  setTimeout(() => { for (const n of notesOf(b.value?.id, ch.value)) if (n.from === "ai") n.seen = true; }, 1200);
}

// ---------- 点一段 ----------
const sel = ref(null);
const pick = p => (sel.value = sel.value === p ? null : p);
const sheet = ref(null); // { mode: "note" | "ask", text }
function openSheet(mode) { sheet.value = { mode, text: "" }; }
function saveNote() {
  const s = sheet.value;
  if (!s.text.trim()) return toast("便利贴还是空的");
  addNote(b.value, { ch: ch.value, p: sel.value, quote: paras.value[sel.value], text: s.text, from: "me" });
  sheet.value = null;
  sel.value = null;
}

// 问问他：把这一段（和前后各一段）给他看，他回一张便利贴
const asking = ref(null); // 正在等他回的那一段
async function ask() {
  const s = sheet.value, p = sel.value, r = role.value;
  if (!r) return;
  sheet.value = null;
  sel.value = null;
  const me = meName(r);
  if (s.text.trim()) addNote(b.value, { ch: ch.value, p, quote: paras.value[p], text: s.text, from: "me" }).seen = true;
  asking.value = p;
  try {
    const around = [paras.value[p - 1], paras.value[p + 1]].filter(Boolean).map(x => x.slice(0, 300));
    const prompt = [
      r.style?.trim() ? `（这是你写给自己的：${r.style.trim()}）\n` : "",
      `你和${me}在一起读《${b.value.title}》${b.value.author ? `（${b.value.author}）` : ""}，现在读到「${chapterTitle.value}」。`,
      `${me}指着这一段给你看：\n「${paras.value[p]}」`,
      around.length ? `（前后文：${around.join(" …… ")}）` : "",
      s.text.trim() ? `${me}在旁边写：${s.text.trim()}` : `${me}想听听你读到这里在想什么。`,
      `写一张便利贴贴在这段旁边：用你自己的口吻，像在书页边上随手写给${me}的，几句话就好（不超过 120 字）。只写便利贴上的字。`,
    ].filter(Boolean).join("\n");
    const text = await oneShot(r, prompt);
    if (!text) throw new Error("他没有写什么");
    addNote(b.value, { ch: ch.value, p, quote: paras.value[p], text, from: "ai" }).seen = true;
  } catch (e) {
    toast(`没问到：${describeError(e)}`, 4000);
  } finally {
    asking.value = null;
  }
}

function tapNote(n) {
  if (confirm(`撕掉这张便利贴？\n\n${n.text.slice(0, 60)}`)) removeNote(n);
}
const tocOpen = ref(false);
const who = n => (n.from === "me" ? "我" : role.value?.name || "他");
const when = ts => new Date(ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
</script>

<template>
  <div v-if="b" class="reader">
    <header class="bar">
      <button class="icon-btn" aria-label="返回" @click="goBack(router, '/books')"><Icon name="back" /></button>
      <div class="t">
        <b>{{ b.title }}</b>
        <span>{{ chapterTitle }}</span>
      </div>
      <button class="icon-btn" aria-label="目录" @click="tocOpen = true"><Icon name="threads" /></button>
    </header>

    <main ref="scroller" class="page" @scroll.passive="onScroll">
      <h2 class="ch-title">{{ chapterTitle }}</h2>
      <template v-for="(t, i) in paras" :key="ch + ':' + i">
        <p :data-p="i" :class="{ sel: sel === i, marked: notesByP[i] }" @click="pick(i)">{{ t }}</p>
        <div v-if="notesByP[i] || asking === i" class="notes">
          <div v-for="n in notesByP[i]" :key="n.id" class="note" :class="n.from === 'me' ? 'mine' : 'his'" @click="tapNote(n)">
            <i class="tape" />
            <p>{{ n.text }}</p>
            <span>— {{ who(n) }} · {{ when(n.ts) }}</span>
          </div>
          <div v-if="asking === i" class="note his waiting"><i class="tape" /><p>他在读这一段……</p></div>
        </div>
      </template>
      <nav class="ch-nav">
        <button class="btn soft" :disabled="ch === 0" @click="goChapter(ch - 1)">‹ 上一章</button>
        <span>{{ ch + 1 }} / {{ b.chapters.length }}</span>
        <button class="btn" :disabled="ch >= b.chapters.length - 1" @click="goChapter(ch + 1)">下一章 ›</button>
      </nav>
    </main>

    <Transition name="pop">
      <div v-if="sel != null" class="actions">
        <button @click="openSheet('note')"><Icon name="edit" :size="18" />贴便利贴</button>
        <button @click="openSheet('ask')"><Icon name="chat" :size="18" />问问他</button>
        <button class="x" aria-label="取消" @click="sel = null"><Icon name="close" :size="16" /></button>
      </div>
    </Transition>

    <Sheet :open="!!sheet" :title="sheet?.mode === 'ask' ? '问问他' : '贴一张便利贴'" @close="sheet = null">
      <div v-if="sheet" class="compose">
        <blockquote>{{ paras[sel]?.slice(0, 120) }}{{ paras[sel]?.length > 120 ? "…" : "" }}</blockquote>
        <textarea v-model="sheet.text" class="input" rows="4" :placeholder="sheet.mode === 'ask' ? '想问他什么（可以不写，他会自己说说读到这里的想法）' : '想在这里写点什么'" />
        <button class="btn" @click="sheet.mode === 'ask' ? ask() : saveNote()">{{ sheet.mode === "ask" ? "给他看" : "贴上" }}</button>
      </div>
    </Sheet>

    <Sheet :open="tocOpen" title="目录" @close="tocOpen = false">
      <div class="toc">
        <button v-for="(c, i) in b.chapters" :key="i" :class="{ on: i === ch }" @click="goChapter(i)">
          <span>{{ c.title }}</span><small v-if="notesOf(b.id, i).length">{{ notesOf(b.id, i).length }} 张便利贴</small>
        </button>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.reader { position: fixed; inset: 0; display: flex; flex-direction: column; background: #faf6ef; }
.bar { display: flex; align-items: center; gap: 10px; padding: calc(var(--safe-top) + 10px) 14px 10px; background: rgba(250, 246, 239, .92); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); z-index: 2; }
.bar .t { flex: 1; min-width: 0; text-align: center; display: flex; flex-direction: column; }
.bar .t b { font-weight: 600; font-size: .95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar .t span { font-size: .72rem; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.page { flex: 1; overflow-y: auto; padding: 18px 24px calc(var(--safe-bottom) + 90px); max-width: 720px; width: 100%; margin: 0 auto; -webkit-overflow-scrolling: touch; }
.ch-title { font-weight: 600; font-size: 1.25rem; text-align: center; margin: 10px 0 26px; color: #3b3128; }
.page > p { margin: 0 0 .9em; text-indent: 2em; font-size: 1.08rem; line-height: 1.95; color: #3b3128; font-weight: 300; border-radius: 6px; transition: background .2s; cursor: pointer; }
.page > p.marked { text-decoration: underline wavy rgba(217, 164, 65, .45); text-underline-offset: 6px; }
.page > p.sel { background: rgba(217, 164, 65, .16); }
.notes { display: flex; flex-wrap: wrap; gap: 10px; margin: -2px 0 18px; }
.note { position: relative; max-width: 86%; padding: 14px 14px 10px; border-radius: 2px; box-shadow: 0 6px 14px rgba(60, 45, 30, .14); cursor: pointer; transform: rotate(-1.2deg); }
.note:nth-child(even) { transform: rotate(1deg); }
.note.mine { background: #fff1a8; }
.note.his { background: #dcebfc; margin-left: auto; }
.note p { margin: 0; font-size: .92rem; line-height: 1.7; white-space: pre-wrap; color: #3b3128; }
.note span { display: block; margin-top: 6px; font-size: .68rem; color: rgba(60, 45, 30, .5); text-align: right; }
.tape { position: absolute; top: -8px; left: 50%; width: 46px; height: 16px; transform: translateX(-50%) rotate(-3deg); background: rgba(255, 255, 255, .55); box-shadow: 0 1px 2px rgba(0, 0, 0, .06); }
.waiting p { color: var(--text-2); animation: breathe 1.6s ease-in-out infinite; }
@keyframes breathe { 50% { opacity: .45; } }
.ch-nav { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 30px 0 10px; font-size: .8rem; color: var(--text-2); }
.actions { position: fixed; left: 50%; bottom: calc(var(--safe-bottom) + 22px); transform: translateX(-50%); display: flex; gap: 6px; padding: 6px; border-radius: 999px; background: var(--ink); box-shadow: 0 10px 30px rgba(30, 30, 40, .25); z-index: 3; }
.actions button { display: flex; align-items: center; gap: 6px; border: 0; background: none; color: #fff; padding: 9px 14px; border-radius: 999px; font-weight: 600; font-size: .88rem; }
.actions .x { padding: 9px 10px; opacity: .7; }
.pop-enter-active, .pop-leave-active { transition: opacity .2s, transform .2s; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translate(-50%, 10px); }
.compose { display: flex; flex-direction: column; gap: 10px; }
.compose blockquote { margin: 0; padding: 8px 12px; border-left: 3px solid #d9a441; background: #faf6ef; color: var(--text-2); font-size: .85rem; line-height: 1.7; border-radius: 4px; }
.compose .btn { align-self: flex-end; }
.toc { display: flex; flex-direction: column; max-height: 60vh; overflow-y: auto; }
.toc button { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; border: 0; background: none; text-align: left; padding: 11px 6px; border-bottom: 1px solid var(--line); font-size: .9rem; }
.toc button.on { font-weight: 600; color: #b5852e; }
.toc small { color: #d9a441; font-size: .7rem; flex: none; }
</style>
