<script setup>
// 挑一个文件夹（挪笔记、挪文件夹用）：从最外层一层层列出来，缩进表示嵌套
import { computed } from "vue";
import Sheet from "../Sheet.vue";
import Icon from "../Icon.vue";
import { bench, childFolders } from "../../lib/notes.js";
const props = defineProps({ open: Boolean, title: { type: String, default: "挪到哪里" }, current: String, exclude: String });
const emit = defineEmits(["close", "pick"]);
// 要挪的文件夹自己和它下面的不能选（挪进自己里面会断掉）
const rows = computed(() => {
  const out = [{ id: null, name: "最外层", depth: 0 }];
  const walk = (parent, depth) => {
    for (const f of childFolders(parent)) {
      if (f.id === props.exclude) continue;
      out.push({ id: f.id, name: f.name, depth });
      walk(f.id, depth + 1);
    }
  };
  if (bench.ready) walk(null, 1);
  return out;
});
</script>

<template>
  <Sheet :open="open" :title="title" @close="emit('close')">
    <div class="rows">
      <button v-for="r in rows" :key="r.id || 'root'" class="row" :class="{ on: (r.id || null) === (current || null) }" :style="{ paddingLeft: 14 + r.depth * 18 + 'px' }" @click="emit('pick', r.id)">
        <Icon name="folder" :size="18" /><span>{{ r.name }}</span><Icon v-if="(r.id || null) === (current || null)" name="check" :size="16" />
      </button>
    </div>
  </Sheet>
</template>

<style scoped>
.rows { display: flex; flex-direction: column; max-height: 50vh; overflow-y: auto; }
.row { display: flex; align-items: center; gap: 10px; border: 0; background: none; padding: 12px 14px; text-align: left; border-radius: 12px; color: var(--text); }
.row span { flex: 1; }
.row.on { color: var(--text-2); }
.row:active { background: var(--bg); }
</style>
