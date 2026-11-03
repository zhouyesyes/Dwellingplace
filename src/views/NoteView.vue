<script setup>
// 一篇笔记：纯文字，自动保存。看的时候 [[双链]] 和 #标签 可以点；点正文别处进入编辑。
// 底下：他们挂的小纸条（她点好才改）、这篇链到哪些、谁链到了这里
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";
import FolderPicker from "../components/bench/FolderPicker.vue";
import { store } from "../store/index.js";
import { toast } from "../lib/toast.js";
import { vAutoGrow } from "../lib/autogrow.js";
import { goBack, useSwipeBack } from "../lib/nav.js";
import {
  bench, loadBench, editNote, flushNote, newNote, renameNote, moveNote, deleteNote, linksIn, tagsIn, findNote,
  backlinks, tipsOf, applyTip, rejectTip, tipKindLabel, pathOf,
} from "../lib/notes.js";

const route = useRoute(), router = useRouter();
const id = computed(() => route.params.id);
const note = computed(() => bench.notes[id.value]);
const editing = ref(false);
const body = ref(null), titleEl = ref(null);
const titleText = ref("");

onMounted(async () => {
  await loadBench();
  if (route.query.fresh) { editing.value = true; await nextTick(); titleEl.value?.focus(); titleEl.value?.select(); }
});
watch(note, n => { if (n && document.activeElement !== titleEl.value) titleText.value = n.title; }, { immediate: true });
// 这篇被别的设备删了：回到列表
watch(() => [bench.ready, note.value], () => { if (bench.ready && !note.value) router.replace("/bench"); });
// 换了一篇（点链接跳过去）：回到阅读状态
watch(id, () => { editing.value = false; });

const back = () => { flushNote(id.value); goBack(router, note.value?.folder ? `/bench?f=${note.value.folder}` : "/bench"); };
useSwipeBack(back);
onBeforeUnmount(() => flushNote(id.value));

// ---------- 正文 ----------
const text = computed({
  get: () => note.value?.body ?? "",
  set: v => note.value && editNote(note.value, { body: v }),
});
// 阅读状态下把正文切成「文字 / 链接 / 标签」几段
const LINK = /\[\[([^\[\]\n]+?)\]\]/g;
const TAG = /(^|[\s,，。.;；:：!！?？()（）「」\[\]])#([\p{L}\p{N}_\-/]+)/gu;
const tokens = computed(() => {
  const s = text.value, marks = [];
  for (const m of s.matchAll(LINK)) { const [name, ...alias] = m[1].split("|"); marks.push({ i: m.index, end: m.index + m[0].length, t: "link", name: name.trim(), v: (alias.join("|") || name).trim() }); }
  for (const m of s.matchAll(TAG)) { if (/^\d+$/.test(m[2])) continue; const i = m.index + m[1].length; if (!marks.some(k => i >= k.i && i < k.end)) marks.push({ i, end: i + 1 + m[2].length, t: "tag", name: m[2], v: "#" + m[2] }); }
  marks.sort((a, b) => a.i - b.i);
  const out = []; let at = 0;
  for (const k of marks) { if (k.i > at) out.push({ t: "text", v: s.slice(at, k.i) }); out.push({ ...k, ok: k.t === "link" ? !!findNote(k.name) : true }); at = k.end; }
  if (at < s.length) out.push({ t: "text", v: s.slice(at) });
  return out;
});
async function startEdit(e) {
  if (e?.target?.closest?.("[data-tok]")) return;
  const sel = String(getSelection?.() || "");
  if (sel) return; // 正在选字：别打断
  editing.value = true;
  await nextTick();
  body.value?.focus();
}
// 点 [[链接]]：有这篇就跳过去，没有就当场新建一篇（放在当前这篇同一个文件夹）再跳
async function openLink(name) {
  let n = findNote(name);
  if (!n) { n = await newNote({ title: name, folder: note.value?.folder }); toast(`新建了「${n.title}」`); }
  await flushNote(id.value);
  router.push(`/bench/n/${n.id}`);
}
const openTag = t => { flushNote(id.value); router.push({ path: "/bench", query: { tag: t } }); };

// ---------- 标题（改名时别的笔记里的链接一起改）----------
async function saveTitle() {
  const n = note.value;
  if (!n) return;
  const t = titleText.value.trim();
  if (!t || t === n.title) { titleText.value = n.title; return; }
  const got = await renameNote(n.id, t);
  titleText.value = got || n.title;
}

// ---------- 小纸条 ----------
const tips = computed(() => (note.value ? tipsOf(note.value.id) : []));
const aiName = idv => store.roles.find(r => r.id === idv)?.name || "他";
async function yes(t) { const r = await applyTip(t.id); toast(r.msg); }
const tipLine = t => t.kind === "link" ? `链到 [[${t.to}]]` : t.kind === "move" ? `挪进「${t.folder}」` : t.kind === "edit" ? "改这一段" : "";

// ---------- 链接和标签 ----------
const outs = computed(() => linksIn(text.value).map(name => ({ name, ok: !!findNote(name) })));
const backs = computed(() => (note.value ? backlinks(note.value) : []));
const tags = computed(() => tagsIn(text.value));
const crumb = computed(() => { const p = pathOf(note.value?.folder); return p.length ? p.join(" / ") : "最外层"; });

// ---------- ⋯ ----------
const menu = ref(false), picking = ref(false);
async function pick(f) { picking.value = false; await moveNote(id.value, f); }
async function remove() {
  menu.value = false;
  if (!confirm(`删掉「${note.value.title}」？删了就找不回来了。`)) return;
  const folder = note.value.folder;
  await deleteNote(id.value);
  router.replace(folder ? `/bench?f=${folder}` : "/bench");
}
</script>

<template>
  <div v-if="note" class="page note">
    <header class="top">
      <button class="icon-btn" aria-label="返回" @click="back"><Icon name="back" /></button>
      <span class="crumb">{{ crumb }}</span>
      <button class="icon-btn" :aria-label="editing ? '完成' : '编辑'" @click="editing ? (editing = false, flushNote(id)) : startEdit()"><Icon :name="editing ? 'check' : 'edit'" /></button>
      <button class="icon-btn" aria-label="更多" @click="menu = true"><Icon name="more" /></button>
    </header>

    <input ref="titleEl" v-model="titleText" class="title" placeholder="标题" enterkeyhint="done" @blur="saveTitle" @keydown.enter.prevent="$event.target.blur()" />

    <textarea v-if="editing" ref="body" v-model="text" v-auto-grow class="body" placeholder="写点什么…　用 [[名字]] 链到另一篇，用 #词 打标签" @blur="flushNote(id)" />
    <div v-else class="body read" @click="startEdit">
      <template v-for="(k, i) in tokens" :key="i">
        <span v-if="k.t === 'text'">{{ k.v }}</span>
        <a v-else-if="k.t === 'link'" data-tok class="lk" :class="{ miss: !k.ok }" @click.stop="openLink(k.name)">{{ k.v }}</a>
        <a v-else data-tok class="tg" @click.stop="openTag(k.name)">{{ k.v }}</a>
      </template>
      <span v-if="!text" class="ph">点一下开始写…</span>
    </div>

    <!-- 他们的建议：她点好才生效 -->
    <section v-if="tips.length" class="tips">
      <div v-for="t in tips" :key="t.id" class="tip">
        <p class="who"><Icon name="bulb" :size="16" />{{ aiName(t.by) }} 的小纸条 · {{ tipKindLabel(t.kind) }}</p>
        <p class="why">{{ t.why }}</p>
        <p v-if="tipLine(t)" class="do">{{ tipLine(t) }}</p>
        <div v-if="t.kind === 'edit'" class="diff"><del>{{ t.find }}</del><ins>{{ t.replace }}</ins></div>
        <div class="btns">
          <button class="btn small" @click="yes(t)">{{ t.kind === 'note' ? "知道了" : "好" }}</button>
          <button v-if="t.kind !== 'note'" class="btn soft small" @click="rejectTip(t.id)">不要</button>
        </div>
      </div>
    </section>

    <section v-if="tags.length" class="blk">
      <h3>标签</h3>
      <div class="chips"><button v-for="t in tags" :key="t" class="chip" @click="openTag(t)">#{{ t }}</button></div>
    </section>
    <section v-if="outs.length" class="blk">
      <h3>链到</h3>
      <div class="chips"><button v-for="o in outs" :key="o.name" class="chip" :class="{ miss: !o.ok }" @click="openLink(o.name)">{{ o.name }}<i v-if="!o.ok">新建</i></button></div>
    </section>
    <section class="blk">
      <h3>谁链到了这里</h3>
      <div v-if="backs.length" class="chips"><button v-for="b in backs" :key="b.id" class="chip" @click="router.push(`/bench/n/${b.id}`)">{{ b.title }}</button></div>
      <p v-else class="none">还没有笔记提到这一篇</p>
    </section>

    <Sheet :open="menu && !picking" :title="note.title" @close="menu = false">
      <div class="acts">
        <button class="act" @click="picking = true"><Icon name="folder" :size="20" />挪动</button>
        <button class="act danger" @click="remove"><Icon name="trash" :size="20" />删除</button>
      </div>
    </Sheet>
    <FolderPicker :open="picking" :current="note.folder" @close="picking = false; menu = false" @pick="f => { pick(f); menu = false; }" />
  </div>
</template>

<style scoped>
.top { display: flex; align-items: center; gap: 10px; padding-top: calc(var(--safe-top) + 18px); margin-bottom: 10px; }
.crumb { flex: 1; min-width: 0; color: var(--text-3); font-size: .8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.title { width: 100%; border: 0; background: none; outline: none; font-size: 1.5rem; font-weight: 600; padding: 8px 2px; color: var(--text); }
.body { width: 100%; box-sizing: border-box; border: 0; background: none; outline: none; resize: none; padding: 6px 2px 14px; min-height: 22vh; line-height: 1.75; font-size: 1.02rem; color: var(--text); white-space: pre-wrap; word-break: break-word; }
.read { cursor: text; }
.ph { color: var(--text-3); }
.lk { color: var(--accent); border-bottom: 1px solid color-mix(in srgb, var(--accent) 45%, transparent); cursor: pointer; }
.lk.miss { color: var(--text-2); border-bottom-style: dashed; }
.tg { color: #c0728a; cursor: pointer; }
:root[data-theme="dark"] .tg { color: #e59ab3; }
.blk { margin-top: 18px; }
.blk h3 { margin: 0 4px 8px; font-size: .82rem; font-weight: 500; color: var(--text-2); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); background: var(--card); border-radius: 999px; padding: 6px 14px; color: var(--text); font-size: .9rem; }
.chip.miss { border-style: dashed; color: var(--text-2); }
.chip i { font-style: normal; font-size: .72rem; color: var(--accent); }
.none { margin: 0 4px; color: var(--text-3); font-size: .88rem; }
.tips { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; }
.tip { background: var(--yellow); border-radius: var(--radius-sm); padding: 12px 14px; color: #5e5120; box-shadow: var(--shadow-soft); transform: rotate(-.4deg); }
:root[data-theme="dark"] .tip { background: #3a3522; color: #eadfae; }
.tip p { margin: 0; }
.tip .who { display: flex; align-items: center; gap: 6px; font-size: .78rem; opacity: .8; }
.tip .why { margin: 6px 0 4px; line-height: 1.6; }
.tip .do { font-weight: 600; font-size: .9rem; }
.diff { margin-top: 6px; font-size: .88rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.diff del { display: block; opacity: .65; }
.diff ins { display: block; text-decoration: none; font-weight: 600; }
.diff ins::before { content: "→ "; }
.btns { display: flex; gap: 8px; margin-top: 10px; }
.acts { display: flex; flex-direction: column; }
.act { display: flex; align-items: center; gap: 12px; border: 0; background: none; padding: 14px 8px; text-align: left; color: var(--text); font-size: 1rem; border-radius: 12px; }
.act.danger { color: var(--danger); }
.act:active { background: var(--bg); }
</style>
