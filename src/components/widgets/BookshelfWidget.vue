<script setup>
// 主页的小书架（共读）：最近读的几本书斜靠在架子上；点书接着读，点空位或别处去书架
import { computed } from "vue";
import { useRouter } from "vue-router";
import { store } from "../../store/index.js";
import Shelf from "../books/Shelf.vue";

const props = defineProps({ size: String, editing: Boolean });
const router = useRouter();
const books = computed(() => store.books || []);
const unread = computed(() => (store.bookNotes || []).filter(n => n.from === "ai" && !n.seen).length);
const go = path => { if (!props.editing) router.push(path); };
</script>

<template>
  <div class="bw" @click="go('/books')">
    <div class="head"><b>Bookshelf</b><span v-if="unread" class="dot">{{ unread }} 张新便利贴</span><span v-else class="sub">{{ books.length ? `${books.length} 本` : "放一本书进来" }}</span></div>
    <Shelf :books="books" :per-row="4" :rows="books.length >= 4 ? 2 : 1" @open="b => go(`/read/${b.id}`)" @add="go('/books')" />
  </div>
</template>

<style scoped>
.bw { height: 100%; padding: 14px 12px 12px; background: linear-gradient(180deg, #fbf8f3, #f3ece2); cursor: pointer; display: flex; flex-direction: column; gap: 6px; }
.head { display: flex; align-items: baseline; justify-content: space-between; padding: 0 6px 4px; }
.head b { font-weight: 300; letter-spacing: .14em; font-size: 1.05rem; color: #5b4a3a; }
.sub { font-size: .72rem; color: #a08a70; }
.dot { font-size: .72rem; color: #fff; background: #d9a441; padding: 2px 9px; border-radius: 999px; }
</style>
