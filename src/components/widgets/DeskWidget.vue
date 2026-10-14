<script setup>
// 主页的共写小组件（像素书桌做好之前先用这个）：几本书的书脊立着，旁边写在写什么
import { computed } from "vue";
import { useRouter } from "vue-router";
import { projects, freshNotes, SPINES } from "../../lib/writing.js";

const props = defineProps({ size: String, editing: Boolean });
const router = useRouter();
const books = computed(() => [...projects()].sort((a, b) => b.updatedAt - a.updatedAt));
const fresh = computed(() => freshNotes().length);
const go = () => { if (!props.editing) router.push("/write"); };
const H = [82, 70, 90, 76, 86, 72];
</script>

<template>
  <div class="dw" :class="size" @click="go">
    <div class="spines">
      <i v-for="(b, i) in books.slice(0, size === 'large' ? 5 : 3)" :key="b.id" :style="{ background: SPINES[b.color % SPINES.length], height: H[i % H.length] + '%' }" />
      <i v-if="!books.length" class="ph" />
    </div>
    <div class="txt">
      <b>Writing</b>
      <span v-if="books[0]">在写《{{ books[0].title }}》</span>
      <span v-else>放一本在写的书</span>
      <small v-if="fresh" class="fresh">{{ fresh }} 张新便利贴</small>
      <small v-else-if="books.length > 1">还有 {{ books.length - 1 }} 本</small>
    </div>
  </div>
</template>

<style scoped>
.dw { position: absolute; inset: 0; border-radius: inherit; display: flex; align-items: stretch; gap: 14px; padding: 18px 18px 16px; background: var(--card); cursor: pointer; }
.dw.small { flex-direction: column; gap: 8px; }
.spines { display: flex; align-items: flex-end; gap: 4px; padding-bottom: 4px; border-bottom: 3px solid #ece5da; min-width: 64px; }
.dw.small .spines { flex: 1; }
.spines i { width: 12px; border-radius: 2px 2px 0 0; box-shadow: inset -2px 0 0 rgba(var(--tint-rgb), .07); }
.spines i:nth-child(3) { transform: rotate(8deg); transform-origin: 0 100%; margin-left: 4px; }
.spines .ph { width: 12px; height: 60%; border: 1.5px dashed var(--line); background: none; box-shadow: none; }
.txt { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; gap: 3px; min-width: 0; }
.txt b { font-weight: 300; letter-spacing: .2em; font-size: 1.05rem; }
.txt span { font-size: .85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.txt small { font-size: .72rem; color: var(--text-3); }
.txt .fresh { color: #4d7aa3; }
</style>
