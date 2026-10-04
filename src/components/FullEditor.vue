<script setup>
import { ref, watch, nextTick } from "vue";
import { editorState, closeEditor } from "../lib/editor.js";

const area = ref(null);
watch(() => editorState.open, open => { if (open) nextTick(() => area.value?.focus()); });
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="editorState.open" class="full-editor">
        <header>
          <button class="btn soft small" @click="closeEditor(false)">取消</button>
          <b>{{ editorState.title }}</b>
          <button class="btn small" @click="closeEditor(true)">完成</button>
        </header>
        <textarea ref="area" v-model="editorState.text" :placeholder="editorState.placeholder" />
        <div class="count">{{ editorState.text.length }} 字</div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.full-editor {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: var(--card);
  display: flex;
  flex-direction: column;
  padding: calc(var(--safe-top) + 10px) 16px calc(var(--safe-bottom) + 10px);
}
header { display: flex; align-items: center; gap: 10px; max-width: 760px; width: 100%; margin: 0 auto 8px; }
header b { flex: 1; text-align: center; font-size: 1rem; }
textarea {
  flex: 1;
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  border: 0;
  outline: none;
  resize: none;
  background: var(--card-2);
  border-radius: 18px;
  padding: 16px;
  line-height: 1.75;
  font-size: 1rem;
  color: var(--text);
}
.count { text-align: right; font-size: 0.75rem; color: var(--text-3); max-width: 760px; width: 100%; margin: 6px auto 0; }
</style>
