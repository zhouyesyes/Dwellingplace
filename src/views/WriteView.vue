<script setup>
// 共写：在写的书一本本排着（像素书桌还在做，做好了再换上）。点一本进去；右上放新书
import { computed } from "vue";
import { useRouter } from "vue-router";
import { store, MAIN, roleById } from "../store/index.js";
import { projects, newProject, cardsOf, freshNotes, SPINES, ideaBox, openIdeaBox } from "../lib/writing.js";
import { goBack } from "../lib/nav.js";
import Icon from "../components/Icon.vue";

const router = useRouter();
const role = computed(() => roleById(MAIN));
const books = computed(() => [...projects()].sort((a, b) => !!a.archived - !!b.archived || b.updatedAt - a.updatedAt)); // 归档的排后面
function add() {
  const t = prompt("新书的名字");
  if (!t?.trim()) return;
  router.push(`/write/${newProject(t).id}`);
}
// 灵感抽屉：书桌外面单独一个地方
const box = computed(() => ideaBox());
const boxInfo = computed(() => {
  const b = box.value;
  if (!b) return "还没有灵感卡片和以前的书";
  const n = cardsOf(b.id).filter(c => !c.groupId).length;
  return `${n} 张灵感 · ${(b.groups || []).length} 本以前的书`;
});
const goBox = () => router.push(`/write/${openIdeaBox().id}`);
const when = ts => new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
</script>

<template>
  <div class="page write">
    <header class="head">
      <button class="icon-btn" aria-label="返回" @click="goBack(router, '/')"><Icon name="back" /></button>
      <span class="grow" />
      <button class="icon-btn" aria-label="放一本新书" @click="add"><Icon name="plus" /></button>
    </header>
    <div class="title"><h1>共写</h1><span class="side">at the desk<br />with {{ role?.name || "him" }}</span></div>

    <button class="drawer-in" @click="goBox">
      <span class="knob" />
      <span class="grow"><b>灵感抽屉</b><small>{{ boxInfo }}</small></span>
      <span v-if="box && freshNotes(box.id).length" class="fresh">{{ freshNotes(box.id).length }} 张新便利贴</span>
      <Icon name="right" :size="16" class="chev" />
    </button>

    <div class="list">
      <button v-for="b in books" :key="b.id" class="book" :class="{ arch: b.archived }" @click="router.push(`/write/${b.id}`)">
        <i class="spine" :style="{ background: SPINES[b.color % SPINES.length] }" />
        <span class="grow"><b>{{ b.title }}</b><small>{{ b.pitch ? b.pitch + " · " : "" }}{{ cardsOf(b.id).length }} 张卡片 · {{ when(b.updatedAt) }}{{ b.archived ? " · 已归档" : "" }}</small></span>
        <span v-if="freshNotes(b.id).length" class="fresh">{{ freshNotes(b.id).length }} 张新便利贴</span>
        <Icon name="right" :size="16" class="chev" />
      </button>
      <button class="book add" @click="add"><i class="spine ph" /><span class="grow"><b>放一本新书</b><small>一本书一个地方：卡片、资料、和他讨论</small></span></button>
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; gap: 10px; }
.grow { flex: 1; min-width: 0; }
.title { display: flex; align-items: flex-end; gap: 14px; margin: 22px 4px 26px; }
.title h1 { margin: 0; font-size: clamp(3rem, 16vw, 4.2rem); font-weight: 200; letter-spacing: .18em; line-height: 1; }
.side { font-size: .7rem; letter-spacing: .22em; text-transform: uppercase; color: var(--text-3); line-height: 1.6; padding-bottom: 6px; }
.list { display: flex; flex-direction: column; gap: 10px; }
.book { display: flex; align-items: center; gap: 14px; text-align: left; border: 0; background: var(--card); border-radius: 18px; padding: 14px 16px; box-shadow: var(--shadow-soft); }
.spine { width: 10px; height: 44px; border-radius: 2px; flex: none; box-shadow: inset -2px 0 0 rgba(var(--tint-rgb), .08); }
.spine.ph { background: none; border: 1.5px dashed var(--line); }
.book b { display: block; font-size: 1rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.book small { font-size: .75rem; color: var(--text-3); }
.book.add { color: var(--text-2); background: var(--card-2); box-shadow: inset 0 0 0 1.5px var(--line); }
.fresh { font-size: .7rem; color: #4d7aa3; background: color-mix(in srgb, #e4eefa var(--pastel), var(--card)); padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
.chev { color: var(--text-3); }
.drawer-in { width: 100%; display: flex; align-items: center; gap: 14px; text-align: left; border: 0; margin-bottom: 18px; padding: 16px 16px; border-radius: 14px; background: linear-gradient(color-mix(in srgb, #f6efe4 var(--pastel), var(--card)), color-mix(in srgb, #efe5d6 var(--pastel), var(--card))); box-shadow: inset 0 -3px 0 rgba(120, 90, 50, .12), var(--shadow-soft); }
.drawer-in .knob { width: 26px; height: 8px; border-radius: 4px; background: #c9b08a; box-shadow: inset 0 1px 2px rgba(0, 0, 0, .2); flex: none; }
.drawer-in b { display: block; font-size: 1rem; font-weight: 600; }
.drawer-in small { font-size: .75rem; color: var(--text-3); }
.book.arch { opacity: .55; }
</style>
