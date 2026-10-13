<script setup>
// 场景记忆：只在共读、共写里才带给他的东西。每本书一张卡：他在那里能看见什么、各多少字，点开看原样发过去的
import { ref, reactive, computed, onMounted } from "vue";
import { store } from "../../store/index.js";
import { meName } from "../../lib/chat.js";
import { readingSceneParts, readingPreview, rawSince, sumEvery, SUM_FORCE } from "../../lib/reading.js";
import { writingSceneParts, writingPrompt, loadTalk, projects, SPINES } from "../../lib/writing.js";
import Sheet from "../Sheet.vue";
import BigTextarea from "../BigTextarea.vue";
import PromptPreview from "./PromptPreview.vue";

const props = defineProps({ role: Object });
const me = computed(() => (props.role ? meName(props.role) : "我"));
// 正在读的那本在最上面
const books = computed(() => [...(store.books || [])].sort((a, b) => (b.readAt || 0) - (a.readAt || 0)));
const pros = computed(() => [...projects()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
const talks = reactive({});
// 上次整理前情之后读过的原文（他每次都看得见）
const raws = reactive({});
onMounted(async () => {
  for (const p of projects()) talks[p.id] = await loadTalk(p.id);
  for (const b of store.books || []) raws[b.id] = await rawSince(b);
});
const num = n => (n < 1000 ? `${n} 字` : n < 10000 ? `${(n / 1000).toFixed(1)} 千字` : `${+(n / 10000).toFixed(1)} 万字`);
const len = s => num(s.length);
const posOf = (b, pos) => (pos ? `${b.chapters[pos.ch]?.title || `第 ${pos.ch + 1} 章`}` : "还没开始");

const preview = ref(null);
async function showBook(b) { preview.value = { title: `共读《${b.title}》发给他的`, parts: await readingPreview(props.role, b) }; }
async function showProject(p) { preview.value = { title: `共写《${p.title}》发给他的`, parts: [{ label: "讨论时给他看的全部（场景记忆在前，全局记忆在后）", text: await writingPrompt(props.role, p) }, { label: "然后", text: "你这次说的话（和图片、文件）。" }] }; }

// 改「读到这里的印象」
const gistEdit = ref(null);
function editGist(b) { gistEdit.value = { b, text: b.gist?.text || "" }; }
// 改过就合成一段（分段的记录不再对得上）
function saveGist() {
  const { b, text } = gistEdit.value;
  if (text.trim() === (b.gist?.text || "")) return (gistEdit.value = null);
  const upTo = b.gist?.upTo || b.pos || { ch: 0, p: 0 };
  if (text.trim()) b.gist = { segs: [{ text: text.trim(), from: { ch: 0, p: 0 }, upTo, at: Date.now(), edited: true }], text: text.trim(), upTo, at: Date.now() };
  else delete b.gist;
  gistEdit.value = null;
}
</script>

<template>
  <div class="scene">
    <p class="lead">进到共读、共写里，这些排在全局记忆前面；离开那里就不带。</p>

    <h3>共读</h3>
    <p v-if="!books.length" class="empty">书架上还没有书。</p>
    <article v-for="(b, i) in books" :key="b.id" class="sc">
      <div class="sh"><b>《{{ b.title }}》</b><span v-if="i === 0 && b.readAt" class="now">正在读</span></div>
      <p class="pos">你读到 {{ posOf(b, b.pos) }} · {{ role?.name }}读到 {{ posOf(b, b.hisPos) }}{{ b.alongTo ? ` · 上次一起读到 ${posOf(b, b.alongTo)}` : "" }}</p>
      <div v-if="b.gist?.text" class="gist" role="button" @click="editGist(b)"><small>前情梗概 · 点一下可以改</small><p>{{ b.gist.text }}</p></div>
      <ul class="parts">
        <li v-for="x in readingSceneParts(b, me)" :key="x.key"><span>{{ x.label }}</span><em>{{ len(x.text) }}</em></li>
        <li><span>上次整理之后读过的原文</span><em>{{ num(raws[b.id] || 0) }} / 攒到 {{ num(sumEvery()) }}、等一章读完整理（最多 {{ num(sumEvery() + SUM_FORCE) }}）</em></li>
      </ul>
      <button class="btn soft small" @click="showBook(b)">看看发给{{ role?.name || "他" }}的</button>
    </article>

    <h3>共写</h3>
    <p v-if="!pros.length" class="empty">书桌上还没有在写的书。</p>
    <article v-for="p in pros" :key="p.id" class="sc">
      <div class="sh"><i class="sp" :style="{ background: SPINES[(p.color || 0) % SPINES.length] }" /><b>《{{ p.title }}》</b></div>
      <ul class="parts">
        <li v-for="x in writingSceneParts(p, talks[p.id] || [], me)" :key="x.key"><span>{{ x.label }}</span><em>{{ len(x.text) }}</em></li>
      </ul>
      <button class="btn soft small" @click="showProject(p)">看看发给{{ role?.name || "他" }}的</button>
    </article>

    <PromptPreview :open="!!preview" :title="preview?.title" :parts="preview?.parts" @close="preview = null" />
    <Sheet :open="!!gistEdit" title="前情梗概" @close="gistEdit = null">
      <template v-if="gistEdit">
        <BigTextarea v-model="gistEdit.text" rows="8" title="前情梗概" />
        <p class="tip">这是{{ role?.name }}自己记的前情，读够字数会再整理一次（新的会接着这份写）。看到错的直接改。</p>
        <div class="row"><button class="btn" @click="saveGist">保存</button></div>
      </template>
    </Sheet>
  </div>
</template>

<style scoped>
.lead { margin: 0 4px 14px; font-size: .8rem; color: var(--text-3); line-height: 1.7; }
h3 { margin: 18px 4px 10px; font-size: .95rem; }
.empty { margin: 0 4px 10px; font-size: .82rem; color: var(--text-3); }
.sc { background: var(--card); border-radius: 18px; padding: 14px 16px 12px; margin-bottom: 12px; box-shadow: var(--shadow-soft); }
.sh { display: flex; align-items: center; gap: 8px; }
.sh b { font-size: 1rem; }
.now { font-size: .66rem; background: var(--ink); color: #fff; border-radius: 999px; padding: 1px 8px; }
.sp { width: 5px; height: 18px; border-radius: 1px; }
.pos { margin: 4px 0 8px; font-size: .74rem; color: var(--text-3); }
.gist { background: var(--bg); border-radius: 12px; padding: 8px 12px; margin-bottom: 8px; cursor: pointer; }
.gist small { font-size: .68rem; color: var(--text-3); }
.gist p { margin: 2px 0 0; font-size: .82rem; line-height: 1.7; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
.parts { list-style: none; margin: 0 0 10px; padding: 0; }
.parts li { display: flex; justify-content: space-between; font-size: .82rem; padding: 5px 2px; border-bottom: 1px dashed var(--line); }
.parts li em { font-style: normal; color: var(--text-3); font-size: .74rem; }
.parts li.none { color: var(--text-3); }
.tip { font-size: .74rem; color: var(--text-3); line-height: 1.7; margin: 8px 2px 0; }
.row { display: flex; justify-content: flex-end; margin-top: 10px; }
</style>
