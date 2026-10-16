<script setup>
import { ref } from 'vue';
const props = defineProps({ title:String, initial:{type:String,default:''}, save:Function });
const emit = defineEmits(['close']);
const name = ref(props.initial), composing = ref(false), saving = ref(false), error = ref('');
async function submit() {
  if (composing.value || saving.value) return;
  if (!name.value.trim()) { error.value = '请输入名称'; return; }
  saving.value = true; error.value = '';
  try { await props.save(name.value.trim()); emit('close'); }
  catch(e) { error.value = e.message || '保存失败，请重试'; }
  finally { saving.value = false; }
}
</script>
<template>
  <form class="name-form" @submit.prevent="submit">
    <label>{{ title }}<input v-model="name" maxlength="120" :disabled="saving" @compositionstart="composing = true" @compositionend="composing = false" @keydown.enter="e => { if (e.isComposing || composing || e.keyCode === 229) e.preventDefault(); }" /></label>
    <p v-if="error" role="alert">{{ error }}</p>
    <button type="submit" :disabled="saving || composing">{{ saving ? '正在保存…' : '确认保存' }}</button>
    <button type="button" :disabled="saving" @click="emit('close')">取消</button>
  </form>
</template>
<style scoped>
.name-form { margin:12px; padding:12px; border:1px solid var(--line); border-radius:12px; background:var(--card); color:var(--text); }
label { display:grid; gap:8px; }
input { box-sizing:border-box; width:100%; font-size:16px; padding:12px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--text); }
button { min-height:44px; margin:8px 8px 0 0; padding:8px 14px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--text); }
</style>
