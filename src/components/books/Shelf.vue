<script setup>
// 书架：一层层木板，书立在板上，隔几本斜靠一本，能看到封面。小组件和书架页都用它
import { computed } from "vue";
import BookCover from "./BookCover.vue";
import shelf from "../../assets/books/shelf.webp";

const props = defineProps({ books: Array, perRow: { type: Number, default: 4 }, rows: { type: Number, default: 0 }, editing: Boolean });
const emit = defineEmits(["open", "add", "edit"]);
// 新放的在前面；每层 perRow 本，最后留一个「放一本书」的空位
const rowsOf = computed(() => {
  const list = [...props.books].sort((a, b) => (b.readAt || b.addedAt) - (a.readAt || a.addedAt));
  const slots = [...list, null];
  const out = [];
  for (let i = 0; i < slots.length; i += props.perRow) out.push(slots.slice(i, i + props.perRow));
  while (props.rows && out.length < props.rows) out.push([]);
  return props.rows ? out.slice(0, props.rows) : out;
});
// 斜靠的书：每层第 2 本往右靠，再隔几本往左靠一点
const tilt = (r, i) => (i % 3 === 1 ? "lean-r" : (r + i) % 4 === 3 ? "lean-l" : "");
</script>

<template>
  <div class="shelf-wrap" :style="{ '--per': perRow }">
    <div v-for="(row, r) in rowsOf" :key="r" class="row">
      <div class="books">
        <template v-for="(b, i) in row" :key="b ? b.id : 'add' + r">
          <button v-if="b" class="book" :class="tilt(r, i)" :aria-label="b.title" @click.stop="editing ? emit('edit', b) : emit('open', b)">
            <BookCover :book="b" />
            <span v-if="editing" class="badge">✎</span>
          </button>
          <button v-else class="book add" aria-label="放一本书" @click.stop="emit('add')"><span>＋</span></button>
        </template>
      </div>
      <img :src="shelf" alt="" class="plank" />
    </div>
  </div>
</template>

<style scoped>
.shelf-wrap { display: flex; flex-direction: column; gap: 10px; }
.row { position: relative; }
.books { display: flex; align-items: flex-end; gap: 6%; padding: 0 7%; min-height: 40px; position: relative; z-index: 1; margin-bottom: -9px; }
.book { flex: 0 0 calc((100% - 7% * 2 - 6% * (var(--per) - 1)) / var(--per)); border: 0; padding: 0; background: none; position: relative; transform-origin: 50% 100%; transition: transform .25s; }
.book.lean-r { transform: rotate(8deg) translateX(6%); }
.book.lean-l { transform: rotate(-6deg); }
.book:active { transform: translateY(-6px); }
.book.add { aspect-ratio: 2 / 3; border-radius: 4px; border: 1.5px dashed rgba(150, 120, 90, .45); color: rgba(150, 120, 90, .7); font-size: 1.4rem; display: grid; place-items: center; background: rgba(255, 255, 255, .35); }
.badge { position: absolute; right: -6px; top: -6px; width: 22px; height: 22px; border-radius: 50%; background: var(--ink); color: #fff; font-size: .7rem; display: grid; place-items: center; }
.plank { display: block; width: 100%; height: auto; position: relative; z-index: 2; filter: drop-shadow(0 6px 8px rgba(80, 55, 30, .18)); }
</style>
