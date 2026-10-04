<script setup>
// 普通多行输入框，右上角有个「展开」按钮，点开全屏编辑
import { openEditor } from "../lib/editor.js";
import Icon from "./Icon.vue";

const props = defineProps({ rows: { type: [Number, String], default: 4 }, placeholder: String, title: String });
const model = defineModel({ type: String, default: "" });

async function expand() {
  const t = await openEditor(model.value, { title: props.title, placeholder: props.placeholder });
  if (t !== null) model.value = t;
}
</script>

<template>
  <div class="big-ta">
    <textarea v-model="model" class="input" :rows="rows" :placeholder="placeholder" />
    <button type="button" class="expand" aria-label="展开编辑" @click.prevent="expand"><Icon name="expand" :size="16" /></button>
  </div>
</template>

<style scoped>
.big-ta { position: relative; }
.big-ta textarea { padding-right: 40px; }
.expand {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  border: 0;
  background: var(--bg);
  color: var(--text-2);
  display: grid;
  place-items: center;
  padding: 0;
}
</style>
