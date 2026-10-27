<script setup>
// 目录的「编辑」：改名（只改名字）、长按多选 → 移除 / 合并、从某一段切开、换一种规则重新分章、已移除的章节可以恢复。
// 移除要确认两次（写清是哪几章、几章；上面有笔记的再提醒一句）。改完通知读书页重新排版
import { ref, computed } from "vue";
import { notesOf } from "../../lib/books.js";
import { store } from "../../store/index.js";
import { renameChapter, removeChapters, restoreChapter, mergeChapters, splitChapter, resplitChapters, resplitPreview } from "../../lib/chapters.js";
import { SPLIT_RULES } from "../../lib/chapterSplit.js";
import { toast } from "../../lib/toast.js";
import Icon from "../Icon.vue";

const props = defineProps({ book: Object, body: Object, current: Number });
const emit = defineEmits(["changed", "done"]);

const busy = ref(false);
const picked = ref(new Set()); // 多选着的章
const picking = computed(() => picked.value.size > 0);
const renaming = ref(-1);
const draft = ref("");
const panel = ref(null); // { kind: "remove" | "merge" | "split" | "resplit", ... }
const open = ref(-1); // 点开了哪一章的操作条（改名 / 和下一章合并 / 从某一行拆开）

const noteCount = i => notesOf(props.book.id, i).length;
const sorted = computed(() => [...picked.value].sort((a, b) => a - b));
const contiguous = computed(() => sorted.value.length >= 2 && sorted.value.every((x, k) => !k || x === sorted.value[k - 1] + 1));

async function run(fn, done) {
  if (busy.value) return;
  busy.value = true;
  try {
    await fn();
    picked.value = new Set();
    panel.value = null;
    renaming.value = -1;
    open.value = -1;
    emit("changed");
    if (done) toast(done);
  } catch (e) {
    toast(e.message || "没改成", 3500);
  } finally {
    busy.value = false;
  }
}

// 长按一章：开始多选；多选时点一下加 / 减
let pressT = 0, pressed = false;
function down(i) { pressed = false; clearTimeout(pressT); pressT = setTimeout(() => { pressed = true; toggle(i); navigator.vibrate?.(10); }, 450); }
const up = () => clearTimeout(pressT);
function tap(i) {
  if (pressed) return (pressed = false);
  if (picking.value) toggle(i);
}
function toggle(i) {
  const s = new Set(picked.value);
  s.has(i) ? s.delete(i) : s.add(i);
  picked.value = s;
}

function startRename(i) { renaming.value = i; draft.value = props.book.chapters[i].title; }
const saveRename = () => run(() => renameChapter(props.book.id, renaming.value, draft.value), "改好了");

// 移除：先列出来确认
function askRemove() {
  const list = sorted.value.map(i => ({ i, title: props.book.chapters[i].title, notes: noteCount(i) }));
  panel.value = { kind: "remove", list, notes: list.reduce((a, x) => a + x.notes, 0) };
}
const doRemove = () => run(() => removeChapters(props.book.id, panel.value.list.map(x => x.i)), "移到「已移除章节」了，可以恢复");
// 合并：先列出来确认，说清楚哪些东西会跟着走
const trail = () => {
  const b = store.books.find(x => x.id === props.book.id) || {};
  return { pos: !!b.pos, his: !!(b.hisPos || b.alongTo), pin: b.herNext != null };
};
function askMerge(list = sorted.value) {
  if (list.length < 2) return;
  const items = list.map(i => ({ i, title: props.book.chapters[i].title, n: props.book.chapters[i].n, notes: noteCount(i) }));
  panel.value = { kind: "merge", list: items, notes: items.reduce((a, x) => a + x.notes, 0), ...trail() };
}
const doMerge = () => run(() => mergeChapters(props.book.id, panel.value.list.map(x => x.i)), "合并好了，笔记和进度都跟着原来的句子");
function askMergeNext(i) { askMerge([i, i + 1]); }
const restore = r => run(() => restoreChapter(props.book.id, r.id), `「${r.title}」放回去了`);

// 切开：选从哪一段开始是新的一章
function askSplit(i = sorted.value[0]) {
  panel.value = { kind: "split", i, at: -1, title: "", sure: false };
}
// 切开前数一数：从这一段往后有几条笔记会跟着去新的一章
const movedNotes = computed(() => panel.value?.kind === "split" && panel.value.at > 0 ? notesOf(props.book.id, panel.value.i).filter(n => n.p >= panel.value.at).length : 0);
const splitParas = computed(() => panel.value?.kind === "split" ? props.body.chapters[panel.value.i]?.paras || [] : []);
function pickSplit(p) { panel.value.at = p; panel.value.title = splitParas.value[p].slice(0, 30); }
const doSplit = () => run(() => splitChapter(props.book.id, panel.value.i, panel.value.at, panel.value.title), "切成两章了");

// 换规则重新分：先看分成什么样
const rule = ref("auto");
const prefix = ref("");
const resplitList = computed(() => panel.value?.kind === "resplit" ? resplitPreview(props.body, rule.value) : []);
const doResplit = () => run(() => resplitChapters(props.book.id, rule.value), `重新分好了，${resplitList.value.length} 章`);
</script>

<template>
  <div class="ce">
    <!-- 移除确认 -->
    <section v-if="panel?.kind === 'remove'" class="panel">
      <h4>移除这 {{ panel.list.length }} 章？</h4>
      <ul class="names"><li v-for="x in panel.list" :key="x.i">{{ x.title }}<small v-if="x.notes"> · {{ x.notes }} 条笔记</small></li></ul>
      <p v-if="panel.notes" class="warn">这几章上有 {{ panel.notes }} 条划线和便利贴，移除后先收着，恢复这一章时会一起回来。</p>
      <p class="tip">移除的章节放在下面「已移除章节」里，随时可以恢复。</p>
      <div class="row"><button class="btn soft" :disabled="busy" @click="panel = null">再想想</button><button class="btn danger" :disabled="busy" @click="doRemove">确定移除</button></div>
    </section>

    <!-- 合并确认 -->
    <section v-else-if="panel?.kind === 'merge'" class="panel">
      <h4>把这 {{ panel.list.length }} 章并成一章？</h4>
      <ul class="names"><li v-for="x in panel.list" :key="x.i">{{ x.title }}<small> · {{ x.n }} 段<template v-if="x.notes"> · {{ x.notes }} 条笔记</template></small></li></ul>
      <p class="tip">并成「{{ panel.list[0].title }}」，后面几章的名字不留（想找回可以再把它们切开）。</p>
      <p class="tip">划线、便利贴（你的、chatgpt 的、CC 的）、书签、阅读进度<template v-if="panel.pin">、「下次从这章读」</template>都会跟着原来的那一句走，不会丢也不会错位。</p>
      <div class="row"><button class="btn soft" :disabled="busy" @click="panel = null">再想想</button><button class="btn" :disabled="busy" @click="doMerge">确定合并</button></div>
    </section>

    <!-- 切开 -->
    <section v-else-if="panel?.kind === 'split'" class="panel">
      <h4>「{{ book.chapters[panel.i].title }}」从哪一段开始切成新的一章？</h4>
      <div class="paras">
        <button v-for="(t, p) in splitParas" :key="p" :class="{ on: panel.at === p }" :disabled="p === 0" @click="pickSplit(p)"><small>{{ p + 1 }}</small>{{ t.slice(0, 60) }}</button>
      </div>
      <label v-if="panel.at > 0" class="name">新一章的名字<input v-model="panel.title" class="input" maxlength="60" /></label>
      <template v-if="panel.sure">
        <p class="tip">会在第 {{ panel.at + 1 }} 段「{{ splitParas[panel.at].slice(0, 20) }}…」前面切开，从它起往后是新的一章「{{ panel.title }}」。{{ movedNotes ? `这几段上的 ${movedNotes} 条笔记会跟着去新的一章，` : "" }}划线、便利贴、书签、阅读进度都留在原来那一句上。</p>
        <div class="row"><button class="btn soft" :disabled="busy" @click="panel.sure = false">再选选</button><button class="btn" :disabled="busy" @click="doSplit">确定切开</button></div>
      </template>
      <div v-else class="row"><button class="btn soft" :disabled="busy" @click="panel = null">取消</button><button class="btn" :disabled="busy || panel.at <= 0" @click="panel.sure = true">从这一段切开</button></div>
    </section>

    <!-- 换规则重新分 -->
    <section v-else-if="panel?.kind === 'resplit'" class="panel">
      <h4>换一种规则重新分章</h4>
      <div class="rules"><button v-for="(l, k) in SPLIT_RULES" :key="k" :class="{ on: rule === k }" @click="rule = k">{{ l }}</button></div>
      <form class="rules" @submit.prevent="prefix.trim() && (rule = 'custom:' + prefix.trim())"><input v-model="prefix" class="input" maxlength="12" placeholder="自己写章节开头，比如 ☆、" aria-label="章节开头" /><button type="submit" :class="{ on: rule.startsWith('custom:') }">按这个分</button></form>
      <small class="tip">会分成 {{ resplitList.length }} 章。笔记和读到哪会跟着挪；改了名字的章节，名字会按新认出来的标题来。</small>
      <ol class="preview"><li v-for="(c, k) in resplitList.slice(0, 80)" :key="k"><span>{{ c.title }}</span><small>{{ c.n }} 段</small></li><li v-if="resplitList.length > 80" class="more">……还有 {{ resplitList.length - 80 }} 章</li></ol>
      <div class="row"><button class="btn soft" :disabled="busy" @click="panel = null">取消</button><button class="btn" :disabled="busy || !resplitList.length" @click="doResplit">按这个重新分</button></div>
    </section>

    <template v-else>
      <div class="top">
        <small>{{ picking ? `选了 ${picked.size} 章` : "点 ⋯ 合并或拆开，点笔改名，长按多选" }}</small>
        <button class="link" :disabled="busy" @click="panel = { kind: 'resplit' }">换规则重新分章</button>
      </div>
      <div class="list">
        <template v-for="(c, i) in book.chapters" :key="c.id || i">
        <div class="item" :class="{ on: picked.has(i), cur: i === current }"
          @pointerdown="down(i)" @pointerup="up" @pointerleave="up" @pointercancel="up" @contextmenu.prevent @click="tap(i)">
          <template v-if="renaming === i">
            <input v-model="draft" class="input" maxlength="60" aria-label="章节名" @click.stop @pointerdown.stop @keydown.enter="saveRename" />
            <button class="mini" :disabled="busy" @click.stop="saveRename">好</button>
            <button class="mini soft" @click.stop="renaming = -1">取消</button>
          </template>
          <template v-else>
            <i v-if="picking" class="check">{{ picked.has(i) ? "✓" : "" }}</i>
            <span class="t">{{ c.title }}</span>
            <small>{{ c.n }} 段{{ noteCount(i) ? ` · ${noteCount(i)} 条笔记` : "" }}</small>
            <button v-if="!picking" class="pen" aria-label="改名" @click.stop="startRename(i)" @pointerdown.stop><Icon name="edit" :size="15" /></button>
            <button v-if="!picking" class="pen" :aria-label="open === i ? '收起' : '合并或拆开'" @click.stop="open = open === i ? -1 : i" @pointerdown.stop>{{ open === i ? "▴" : "⋯" }}</button>
          </template>
        </div>
        <div v-if="open === i && !picking && renaming !== i" class="acts">
          <button :disabled="busy || i >= book.chapters.length - 1" @click="askMergeNext(i)">和下一章合并</button>
          <button :disabled="busy || c.n < 2" @click="askSplit(i)">从某一行拆开</button>
        </div>
        </template>
      </div>
      <div v-if="picking" class="bar">
        <button :disabled="busy" @click="picked = new Set()">取消</button>
        <button :disabled="busy || picked.size !== 1 || book.chapters[sorted[0]].n < 2" @click="askSplit">切开</button>
        <button :disabled="busy || !contiguous" @click="askMerge()">合并</button>
        <button class="danger" :disabled="busy || picked.size >= book.chapters.length" @click="askRemove">移除</button>
      </div>
      <section v-if="body.removed?.length" class="removed">
        <h4>已移除章节</h4>
        <div v-for="r in body.removed" :key="r.id" class="ritem">
          <span>{{ r.title }}<small> · {{ r.paras.length }} 段</small></span>
          <button class="mini soft" :disabled="busy" @click="restore(r)">恢复</button>
        </div>
      </section>
      <button class="btn soft done" @click="emit('done')">编辑好了</button>
    </template>
  </div>
</template>

<style scoped>
.ce { display: flex; flex-direction: column; gap: 10px; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.top small { color: var(--text-3); font-size: .74rem; }
.link { border: 0; background: none; color: var(--accent); font-size: .8rem; padding: 4px 0; flex: none; }
.list { display: flex; flex-direction: column; max-height: 48vh; overflow-y: auto; }
.item { display: flex; align-items: center; gap: 8px; padding: 10px 6px; border-bottom: 1px solid var(--line); font-size: .9rem; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; cursor: pointer; }
.item.on { background: color-mix(in srgb, var(--accent) 12%, transparent); border-radius: 8px; }
.item.cur .t { font-weight: 600; }
.item .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item small { flex: none; color: var(--text-3); font-size: .7rem; }
.item .input { flex: 1; min-width: 0; padding: 6px 10px; font-size: 16px; }
.check { flex: none; width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid var(--text-3); display: grid; place-items: center; font-style: normal; font-size: .72rem; color: var(--on-ink); }
.item.on .check { background: var(--ink); border-color: var(--ink); }
.pen { flex: none; border: 0; background: none; color: var(--text-3); padding: 4px; display: grid; place-items: center; }
.acts { display: flex; gap: 8px; padding: 8px 6px; border-bottom: 1px solid var(--line); background: var(--bg); }
.acts button { flex: 1; border: 1px solid var(--line); border-radius: 999px; padding: 7px 0; font-size: .8rem; background: var(--card); color: var(--text); }
.acts button:disabled { opacity: .4; }
.mini { flex: none; border: 0; border-radius: 999px; padding: 5px 12px; font-size: .78rem; background: var(--ink); color: var(--on-ink); }
.mini.soft { background: var(--bg); color: var(--text-2); border: 1px solid var(--line); }
.bar { display: flex; gap: 8px; }
.bar button { flex: 1; border: 1px solid var(--line); border-radius: 999px; padding: 9px 0; font-size: .82rem; background: var(--card); color: var(--text); }
.bar button:disabled { opacity: .4; }
.bar .danger, .btn.danger { color: var(--danger); }
.removed h4, .panel h4 { margin: 6px 0 4px; font-size: .88rem; }
.ritem { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 4px; border-bottom: 1px solid var(--line); font-size: .85rem; color: var(--text-2); }
.ritem small { color: var(--text-3); }
.done { align-self: flex-end; }
.panel { display: flex; flex-direction: column; gap: 8px; }
.names { margin: 0; padding-left: 1.2em; font-size: .86rem; line-height: 1.8; max-height: 30vh; overflow-y: auto; }
.names small { color: var(--text-3); }
.warn { margin: 0; font-size: .82rem; color: var(--danger); line-height: 1.6; }
.tip { margin: 0; font-size: .76rem; color: var(--text-3); line-height: 1.6; }
.row { display: flex; gap: 8px; justify-content: flex-end; }
.paras { display: flex; flex-direction: column; max-height: 40vh; overflow-y: auto; border: 1px solid var(--line); border-radius: 10px; }
.paras button { display: flex; gap: 8px; text-align: left; border: 0; border-bottom: 1px solid var(--line); background: none; padding: 8px 10px; font-size: .82rem; line-height: 1.5; color: var(--text); }
.paras button small { flex: none; width: 2.2em; color: var(--text-3); }
.paras button.on { background: color-mix(in srgb, var(--accent) 16%, transparent); }
.paras button:disabled { opacity: .45; }
.name { display: flex; flex-direction: column; gap: 4px; font-size: .78rem; color: var(--text-2); }
.name .input { font-size: 16px; }
.rules { display: flex; flex-wrap: wrap; gap: 6px; }
.rules button { border: 1px solid var(--line); background: var(--bg); color: var(--text-2); border-radius: 999px; padding: 5px 11px; font-size: .78rem; }
.rules button.on { background: var(--ink); color: var(--on-ink); border-color: var(--ink); }
.preview { list-style: none; margin: 0; padding: 4px 12px; max-height: 34vh; overflow-y: auto; background: var(--bg); border-radius: 10px; }
.preview li { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--line); font-size: .84rem; }
.preview li span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview li small { flex: none; color: var(--text-3); font-size: .7rem; }
.preview li.more { color: var(--text-3); justify-content: center; }
</style>
