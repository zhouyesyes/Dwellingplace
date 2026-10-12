<script setup>
// 书架（共读）：所有的书。点书去读；右上角放新书（txt / epub）；「整理」里能换封面、改名、拿下来
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { store } from "../store/index.js";
import { importBook, removeBook } from "../lib/books.js";
import { pickFile, pickAndCrop, deleteImage } from "../lib/images.js";
import { toast } from "../lib/toast.js";
import { goBack } from "../lib/nav.js";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";
import Shelf from "../components/books/Shelf.vue";

const router = useRouter();
const books = computed(() => store.books || []);
const perRow = computed(() => (innerWidth >= 760 ? 5 : 3));
const busy = ref(false);
const editing = ref(false);
const editBook = ref(null);

async function add() {
  const [file] = await pickFile(".txt,.epub,text/plain,application/epub+zip");
  if (!file) return;
  busy.value = true;
  try {
    const id = await importBook(file);
    toast("放上书架了");
    router.push(`/read/${id}`);
  } catch (e) {
    toast(`没放上去：${e.message}`, 4000);
  } finally {
    busy.value = false;
  }
}
async function changeCover(b) {
  const id = await pickAndCrop({ aspect: 2 / 3, title: "书的封面", maxSize: 600 });
  if (!id) return;
  if (b.cover) deleteImage(b.cover);
  b.cover = id;
}
function rename(b) {
  const t = prompt("书名", b.title);
  if (t?.trim()) b.title = t.trim().slice(0, 80);
}
async function takeDown(b) {
  if (!confirm(`把《${b.title}》从书架上拿下来？里面的便利贴也会一起没有。`)) return;
  editBook.value = null;
  await removeBook(b);
}
</script>

<template>
  <div class="books-page">
    <header class="head">
      <button class="icon-btn" aria-label="返回" @click="goBack(router, '/')"><Icon name="back" /></button>
      <div class="title">
        <h1>Bookshelf</h1>
        <p class="sub">{{ books.length ? `${books.length} 本书` : "书架还是空的" }}</p>
      </div>
      <div class="acts">
        <button v-if="books.length" class="btn soft small" @click="editing = !editing">{{ editing ? "好了" : "整理" }}</button>
        <button class="btn small" :disabled="busy" @click="add"><Icon name="plus" :size="16" /> {{ busy ? "在放…" : "放书" }}</button>
      </div>
    </header>

    <div class="case">
      <Shelf :books="books" :per-row="perRow" :rows="3" :editing="editing" @open="b => router.push(`/read/${b.id}`)" @add="add" @edit="b => (editBook = b)" />
    </div>
    <p class="hint">支持 txt 和 epub。书会跟着同步到你的各台设备；读的时候点一段，可以贴便利贴，也可以问问他。</p>

    <Sheet :open="!!editBook" :title="editBook ? `《${editBook.title}》` : ''" @close="editBook = null">
      <div v-if="editBook" class="edit-list">
        <button class="list-row" @click="changeCover(editBook)"><Icon name="image" :size="20" /><span class="grow">换封面</span></button>
        <button class="list-row" @click="rename(editBook)"><Icon name="edit" :size="20" /><span class="grow">改书名</span></button>
        <button class="list-row danger" @click="takeDown(editBook)"><Icon name="trash" :size="20" /><span class="grow">从书架上拿下来</span></button>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.books-page { min-height: 100%; padding: calc(var(--safe-top) + 16px) 18px calc(var(--safe-bottom) + 40px); max-width: 760px; margin: 0 auto; }
.head { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; margin-bottom: 18px; }
.head > :first-child { justify-self: start; }
.acts { justify-self: end; display: flex; gap: 6px; }
.acts .btn { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.title { text-align: center; }
.title h1 { margin: 0; font-size: clamp(1.4rem, 6.5vw, 2rem); font-weight: 300; letter-spacing: .14em; line-height: 1.2; }
.sub { margin: 2px 0 0; font-size: .78rem; color: var(--text-2); }
.case { padding: 22px 14px 18px; border-radius: 22px; background: linear-gradient(180deg, #fbf8f3, #efe6d9); box-shadow: inset 0 0 0 1px rgba(160, 130, 100, .12), 0 10px 30px rgba(80, 55, 30, .08); }
.hint { text-align: center; color: var(--text-3); font-size: .78rem; line-height: 1.7; margin: 16px 10px; }
.edit-list { display: flex; flex-direction: column; }
.danger { color: var(--danger); }
</style>
