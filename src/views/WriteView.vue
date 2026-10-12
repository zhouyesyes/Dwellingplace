<script setup>
// 共写：在写的书一本本排着（像素书桌还在做，做好了再换上）。点一本进去；右上放新书
import { computed } from "vue";
import { useRouter } from "vue-router";
import { store, MAIN, roleById } from "../store/index.js";
import { projects, newProject, cardsOf, freshNotes, SPINES } from "../lib/writing.js";
import { goBack } from "../lib/nav.js";
import Icon from "../components/Icon.vue";

const router = useRouter();
const role = computed(() => roleById(MAIN));
const books = computed(() => [...projects()].sort((a, b) => b.updatedAt - a.updatedAt));
function add() {
  const t = prompt("新书的名字");
  if (!t?.trim()) return;
  router.push(`/write/${newProject(t).id}`);
}
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

    <div class="list">
      <button v-for="b in books" :key="b.id" class="book" @click="router.push(`/write/${b.id}`)">
        <i class="spine" :style="{ background: SPINES[b.color % SPINES.length] }" />
        <span class="grow"><b>{{ b.title }}</b><small>{{ b.pitch ? b.pitch + " · " : "" }}{{ cardsOf(b.id).length }} 张卡片 · {{ when(b.updatedAt) }}</small></span>
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
.spine { width: 10px; height: 44px; border-radius: 2px; flex: none; box-shadow: inset -2px 0 0 rgba(0, 0, 0, .08); }
.spine.ph { background: none; border: 1.5px dashed var(--line); }
.book b { display: block; font-size: 1rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.book small { font-size: .75rem; color: var(--text-3); }
.book.add { color: var(--text-2); background: var(--card-2); box-shadow: inset 0 0 0 1.5px var(--line); }
.fresh { font-size: .7rem; color: #4d7aa3; background: #e4eefa; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
.chev { color: var(--text-3); }
</style>
