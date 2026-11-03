<script setup>
// 工作台：她的笔记本。手机上一次看一列：最外层 → 点文件夹进去 → 返回 / 左边缘右划回来。
// 路由 /bench?f=<文件夹 id>（文件夹）；首页最上面可以放一张首图（只有首页有）；笔记本身在 /bench/n/:id
import { ref, computed, watch, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";
import FolderPicker from "../components/bench/FolderPicker.vue";
import { store } from "../store/index.js";
import { useImage } from "../lib/images.js";
import { goBack, useSwipeBack } from "../lib/nav.js";
import {
  bench, loadBench, childFolders, notesIn, newNote, newFolder, renameFolder, moveFolder, deleteFolder, folderStats,
  deleteNote, moveNote, renameNote, searchNotes, tipsOf, pathOf, tipCount, noteList, pickCover, clearCover, benchName, renameBench,
} from "../lib/notes.js";

const route = useRoute(), router = useRouter();
onMounted(loadBench);

const folderId = computed(() => route.query.f || null);
const folder = computed(() => (folderId.value ? bench.folders[folderId.value] : null));
const inSub = computed(() => !!folderId.value);
// 文件夹被别的设备删了：回到最外层
watch(() => [bench.ready, folder.value, folderId.value], () => { if (bench.ready && folderId.value && !folder.value) router.replace("/bench"); });

const q = ref("");
const hits = computed(() => searchNotes(q.value));
const folders = computed(() => (bench.ready ? childFolders(folderId.value) : []));
const notes = computed(() => (!bench.ready ? [] : notesIn(folderId.value)));
const withTips = computed(() => (bench.ready ? noteList().filter(n => tipsOf(n.id).length) : []));
const title = computed(() => folder.value?.name || benchName());
const crumb = computed(() => (folderId.value ? pathOf(folderId.value).slice(0, -1).join(" / ") : ""));

const up = () => goBack(router, folder.value ? (folder.value.parent ? `/bench?f=${folder.value.parent}` : "/bench") : "/bench");
useSwipeBack(() => { if (inSub.value) up(); });

const count = f => { const s = folderStats(f.id); return s.notes + s.folders ? `${notesIn(f.id).length} 篇${s.folders ? ` · ${s.folders} 个文件夹` : ""}` : "空的"; };
const snip = n => String(n.body || "").replace(/\s+/g, " ").trim().slice(0, 40) || "（还没写）";
const when = ts => { const d = new Date(ts), n = new Date(); return d.toDateString() === n.toDateString() ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : `${d.getMonth() + 1}.${d.getDate()}`; };

// ---------- 新建 ----------
const addOpen = ref(false);
async function addNote() {
  addOpen.value = false;
  const n = await newNote({ title: "没起名字", folder: folderId.value });
  router.push({ path: `/bench/n/${n.id}`, query: { fresh: 1 } });
}
async function addFolder() {
  addOpen.value = false;
  const name = prompt("文件夹叫什么？");
  if (name?.trim()) await newFolder(name, folderId.value);
}

// ---------- 每一行的「⋯」：改名、挪动、删除 ----------
const menu = ref(null); // { kind: "note" | "folder", item }
const picking = ref(false);
async function rename() {
  const m = menu.value; menu.value = null;
  const name = prompt(m.kind === "note" ? "笔记改成什么名字？" : "文件夹改成什么名字？", m.kind === "note" ? m.item.title : m.item.name);
  if (!name?.trim()) return;
  if (m.kind === "note") await renameNote(m.item.id, name); else await renameFolder(m.item.id, name);
}
async function pick(to) {
  const m = menu.value; picking.value = false; menu.value = null;
  if (m.kind === "note") await moveNote(m.item.id, to); else await moveFolder(m.item.id, to);
}
async function remove() {
  const m = menu.value; menu.value = null;
  if (m.kind === "note") {
    if (confirm(`删掉「${m.item.title}」？删了就找不回来了。`)) await deleteNote(m.item.id);
    return;
  }
  const s = folderStats(m.item.id);
  const more = s.notes || s.folders ? `里面的 ${s.notes} 篇笔记${s.folders ? `、${s.folders} 个文件夹` : ""}也会一起删掉，` : "";
  if (confirm(`删掉文件夹「${m.item.name}」？${more}删了就找不回来了。`)) await deleteFolder(m.item.id);
}
const go = n => router.push(`/bench/n/${n.id}`);
// ---------- 首页首图（只有首页有）----------
const coverUrl = useImage(() => bench.cover?.img);
const coverMenu = ref(false);
async function setCover() {
  coverMenu.value = false;
  try { await pickCover(); } catch (e) { alert("图没保存：" + (e?.message || "请重试")); }
}
async function dropCover() { coverMenu.value = false; await clearCover(); }
// 点标题改名（单独同步，两台设备都显示新名字；清空或写回「工作台」就是默认）
async function renameHome() {
  const name = prompt("给这里起个名字？（留空就是「工作台」）", benchName());
  if (name === null) return;
  await renameBench(name);
}
const aiName = id => store.roles.find(r => r.id === id)?.name || "他";
</script>

<template>
  <div class="page bench">
    <!-- 最外层：和底栏别的页一样的大标题；里面一层换成返回键 -->
    <!-- 首页：有首图就铺满顶部、往下淡进页面底色，标题压在图的下沿；没图只留一个淡淡的入口 -->
    <div v-if="!inSub && bench.cover && coverUrl" class="hero" :style="{ backgroundImage: `url(${coverUrl})` }" @click="coverMenu = true">
      <h1 class="tab-title lefty" @click.stop="renameHome">{{ benchName() }}</h1>
    </div>
    <template v-else-if="!inSub">
      <h1 class="tab-title lefty plain" @click="renameHome">{{ benchName() }}</h1>
      <button v-if="bench.ready && !bench.cover" class="addcover" @click="setCover"><Icon name="image" :size="15" />加一张首图</button>
    </template>
    <header v-else class="sub">
      <button class="icon-btn" aria-label="返回" @click="up"><Icon name="back" /></button>
      <div class="t"><h1>{{ title }}</h1><small v-if="crumb">{{ crumb }}</small></div>
      <button class="icon-btn" aria-label="新建" @click="addOpen = true"><Icon name="plus" /></button>
    </header>

    <div class="search">
      <Icon name="search" :size="18" />
      <input v-model="q" type="search" placeholder="搜标题和正文" enterkeyhint="search" />
      <button v-if="q" class="x" aria-label="清掉" @click="q = ''"><Icon name="close" :size="16" /></button>
      <button v-if="!inSub && !q" class="plus" aria-label="新建" @click="addOpen = true"><Icon name="plus" :size="20" /></button>
    </div>

    <!-- 搜索结果 -->
    <section v-if="q.trim()" class="list">
      <button v-for="h in hits" :key="h.note.id" class="row" @click="go(h.note)">
        <span class="ic"><Icon name="file" :size="20" /></span>
        <span class="tx"><b>{{ h.note.title }}</b><small>{{ h.snip }}</small></span>
        <Icon name="right" :size="16" class="chev" />
      </button>
      <p v-if="!hits.length" class="empty-hint">没有找到「{{ q }}」</p>
    </section>

    <!-- 某个文件夹 / 最外层 -->
    <template v-else>
      <div v-if="!inSub && tipCount()" class="quick">
        <span class="chip tipchip">小纸条<i>{{ tipCount() }}</i></span>
      </div>

      <section v-if="!inSub && withTips.length" class="tipbox">
        <p class="cap">他们挂了小纸条，等你点好或不要</p>
        <button v-for="n in withTips" :key="n.id" class="row" @click="go(n)">
          <span class="ic note"><Icon name="bulb" :size="20" /></span>
          <span class="tx"><b>{{ n.title }}</b><small>{{ tipsOf(n.id).map(t => aiName(t.by)).filter((v, i, a) => a.indexOf(v) === i).join("、") }} 提了 {{ tipsOf(n.id).length }} 条建议</small></span>
          <Icon name="right" :size="16" class="chev" />
        </button>
      </section>

      <section class="list">
        <div v-for="f in folders" :key="f.id" class="rowwrap">
          <button class="row" @click="router.push({ path: '/bench', query: { f: f.id } })">
            <span class="ic fold"><Icon name="folder" :size="21" /></span>
            <span class="tx"><b>{{ f.name }}</b><small>{{ count(f) }}</small></span>
          </button>
          <button class="more" aria-label="更多" @click="menu = { kind: 'folder', item: f }"><Icon name="more" :size="18" /></button>
        </div>
        <div v-for="n in notes" :key="n.id" class="rowwrap">
          <button class="row" @click="go(n)">
            <span class="ic"><Icon name="file" :size="20" /></span>
            <span class="tx">
              <b>{{ n.title }}<i v-if="tipsOf(n.id).length" class="dot" title="有小纸条" /></b>
              <small>{{ when(n.ts) }} · {{ snip(n) }}</small>
            </span>
          </button>
          <button class="more" aria-label="更多" @click="menu = { kind: 'note', item: n }"><Icon name="more" :size="18" /></button>
        </div>
        <p v-if="bench.ready && !folders.length && !notes.length" class="empty-hint">
          {{ folder ? "这个文件夹是空的" : "还没有笔记，点右上的 + 新建第一篇" }}
        </p>
      </section>
    </template>

    <Sheet :open="coverMenu" title="首图" @close="coverMenu = false">
      <div class="acts">
        <button class="act" @click="setCover"><Icon name="image" :size="20" />换一张</button>
        <button class="act danger" @click="dropCover"><Icon name="trash" :size="20" />去掉首图</button>
      </div>
    </Sheet>

    <Sheet :open="addOpen" title="新建" @close="addOpen = false">
      <div class="acts">
        <button class="act" @click="addNote"><Icon name="file" :size="20" />新建笔记</button>
        <button class="act" @click="addFolder"><Icon name="folder" :size="20" />新建文件夹</button>
      </div>
    </Sheet>

    <Sheet :open="!!menu && !picking" :title="menu ? (menu.item.title || menu.item.name) : ''" @close="menu = null">
      <div class="acts">
        <button class="act" @click="rename"><Icon name="edit" :size="20" />改名</button>
        <button class="act" @click="picking = true"><Icon name="folder" :size="20" />挪动</button>
        <button class="act danger" @click="remove"><Icon name="trash" :size="20" />删除</button>
      </div>
    </Sheet>
    <FolderPicker :open="picking" :current="menu?.kind === 'note' ? menu.item.folder : menu?.item.parent" :exclude="menu?.kind === 'folder' ? menu.item.id : undefined" @close="picking = false; menu = null" @pick="pick" />
  </div>
</template>

<style scoped>
.hero { position: relative; height: calc(var(--safe-top) + 250px); margin: calc(-1 * (var(--safe-top) + 18px)) -18px 8px; background-size: cover; background-position: center; display: flex; align-items: flex-end; cursor: pointer; }
/* 往下淡进页面底色：用 --bg，浅色深色都自然 */
.hero::after { content: ""; position: absolute; inset: 0; background: linear-gradient(to bottom, color-mix(in srgb, var(--bg) 0%, transparent) 35%, color-mix(in srgb, var(--bg) 70%, transparent) 75%, var(--bg) 100%); pointer-events: none; }
.hero .tab-title { position: relative; z-index: 1; width: 100%; height: auto; padding: 0 18px 4px; margin: 0; text-shadow: 0 1px 8px color-mix(in srgb, var(--bg) 70%, transparent); }
.tab-title.lefty { text-align: left; font-size: 1.3rem; cursor: pointer; overflow: hidden; text-overflow: ellipsis; }
.tab-title.lefty.plain { padding-left: 4px; padding-right: 4px; margin-bottom: 8px; }
.addcover { display: flex; align-items: center; gap: 6px; margin: -6px 0 10px; border: 0; background: none; color: var(--text-3); font-size: .8rem; padding: 6px 12px; }
.sub { display: flex; align-items: center; gap: 12px; margin: 0 0 14px; }
.sub .t { flex: 1; min-width: 0; }
.sub h1 { margin: 0; font-size: 1.2rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub small { color: var(--text-3); font-size: .78rem; }
.sub .sp { width: 42px; }
.search { position: relative; display: flex; align-items: center; gap: 8px; background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 0 8px 0 14px; height: 42px; color: var(--text-3); margin-bottom: 14px; }
.search input { flex: 1; min-width: 0; border: 0; background: none; outline: none; height: 100%; color: var(--text); font-size: 16px; }
.search input::-webkit-search-cancel-button { display: none; }
.search .x, .search .plus { border: 0; background: none; color: var(--text-2); display: grid; place-items: center; width: 30px; height: 30px; }
.quick { display: flex; gap: 8px; margin-bottom: 14px; }
.chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); background: var(--card); border-radius: 999px; padding: 6px 14px; color: var(--text); font-size: .9rem; }
.chip i { font-style: normal; color: var(--text-3); font-size: .78rem; }
.tipchip { background: var(--yellow); border-color: transparent; color: #6b5a1a; }
:root[data-theme="dark"] .tipchip { color: #e8d792; }
.cap { margin: 0 4px 8px; font-size: .8rem; color: var(--text-2); }
.tipbox { margin-bottom: 16px; }
.list { background: var(--card); border-radius: var(--radius); box-shadow: var(--shadow-soft); overflow: hidden; }
.tipbox .row { background: var(--card); border-radius: var(--radius-sm); margin-bottom: 6px; }
.list:empty, .list:has(> .empty-hint:only-child) { background: none; box-shadow: none; }
.rowwrap { display: flex; align-items: center; border-bottom: 1px solid var(--line); }
.rowwrap:last-child { border-bottom: 0; }
.row { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; border: 0; background: none; text-align: left; padding: 12px 8px 12px 14px; width: 100%; }
.row .ic { flex: none; width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center; background: var(--bg-deep); color: var(--text-2); }
.row .ic.fold { background: var(--blue); color: #5b7fa8; }
.row .ic.note { background: var(--yellow); color: #8a7424; }
:root[data-theme="dark"] .row .ic.fold { color: #9ec0ea; }
:root[data-theme="dark"] .row .ic.note { color: #e8d792; }
.tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.tx b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
.tx small { color: var(--text-3); font-size: .8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #e8b84b; }
.more { flex: none; border: 0; background: none; color: var(--text-3); width: 44px; height: 52px; display: grid; place-items: center; }
.acts { display: flex; flex-direction: column; }
.act { display: flex; align-items: center; gap: 12px; border: 0; background: none; padding: 14px 8px; text-align: left; color: var(--text); font-size: 1rem; border-radius: 12px; }
.act.danger { color: var(--danger); }
.act:active { background: var(--bg); }
</style>
