<script setup>
import { ref, watch, computed } from 'vue';
import { listAttachments, listMaterials, uploadAttachment, uploadMaterial, saveAttachmentMaterial, changeMaterial, attachmentUrl, materialUrl, say } from '../lib/workroom.js';
import { toast } from '../lib/toast.js';
const props = defineProps({ project:String, task:String, revision:Number, tasks:{ type:Array, default:() => [] } });
const entries = ref([]), error = ref(''), busy = ref(false), purpose = ref(''), selectedTask = ref(''), picker = ref(null);
const inbox = ref(false), preview = ref(null);
const isMaterials = computed(() => !props.task || inbox.value);
const taskOptions = computed(() => props.tasks.filter(t => t.project === props.project && t.status !== 'archived'));
const source = a => isMaterials.value ? materialUrl(props.project,a.id) : attachmentUrl(props.task,a.id);
const status = a => isMaterials.value ? ({ pending:'待整理', used:'已用于任务', archived:'已归档' }[a.status] || '待整理') : a.notification === 'delivered' ? '已通知 Codex' : '已保存，待通知 Codex';
let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  error.value = '';
  try {
    const result = isMaterials.value ? (await listMaterials(props.project)).materials : (await listAttachments(props.task)).attachments;
    if (seq === loadSeq) entries.value = result || [];
  } catch(e) { if (seq === loadSeq) { error.value = e.message; entries.value = []; } }
}
watch(() => [props.project,props.task,isMaterials.value,props.revision], () => { preview.value = null; load(); }, { immediate:true });
async function run(fn) {
  if (busy.value) return;
  busy.value = true;
  try { await fn(); await load(); } catch(e) { error.value = e.message; toast(e.message,5000); } finally { busy.value = false; }
}
async function notify(a, task = props.task) {
  await say(task, `已追加原始附件。用途：${a.purpose || '请读取原文件，并按任务要求处理。'}`, [a]);
  toast('Codex 已接收附件通知');
}
function upload(event) {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  if (!file.size || file.size > 20 * 1024 * 1024) { toast("文件必须非空且不超过 20 MB"); return; }
  const project = props.project, task = props.task, material = isMaterials.value;
  run(async () => {
    if (material) await uploadMaterial(project,file,purpose.value);
    else {
      const a = await uploadAttachment(task,file,purpose.value);
      // 原件已持久保存；通知失败仍在列表里，可单独重试，不必再次上传。
      try { await notify(a,task); } catch(e) { await load(); throw e; }
    }
    purpose.value = '';
  });
}
function rename(a) {
  const name = prompt('重命名显示名称（保留扩展名；原文件路径保持稳定）',a.name);
  if (name != null) run(() => changeMaterial(props.project,a.id,'rename',{name}));
}
async function copyPath(a) {
  try { await navigator.clipboard.writeText(a.libraryProjectPath || a.projectPath || a.libraryPath || a.path); toast('已复制 Codex 可读取的路径'); }
  catch { toast('复制失败，可在下方选择路径复制'); }
}
function attach(a) {
  const id = props.task || selectedTask.value;
  if (!id) { toast('先选择任务'); return; }
  run(async () => {
    const file = await changeMaterial(props.project,a.id,'attach',{ taskId:id, purpose:purpose.value || a.purpose });
    await notify(file,id);
  });
}
</script>

<template>
  <details class="material-panel" open>
    <summary>{{ isMaterials ? '项目素材收件箱' : '任务原始附件' }}</summary>
    <div class="material-body">
      <div v-if="task" class="material-actions"><button :disabled="busy" @click="inbox = !inbox">{{ inbox ? '返回任务附件' : '从项目素材选择' }}</button></div>
      <p class="material-note">原文件保留，不压缩。每个文件最多 20 MB。任务结束后仍保留；归档只整理引用，不删除原件。</p>
      <label>用途说明<input v-model="purpose" maxlength="2000" placeholder="例如：保留透明背景，统一贴纸颜色" /></label>
      <div class="material-actions">
        <input ref="picker" type="file" hidden accept=".png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.pdf,.txt,.md,.csv,.json,.zip" @change="upload" />
        <button :disabled="busy" @click="picker.click()">{{ busy ? '处理中…' : isMaterials ? '上传原始素材' : '上传并通知 Codex' }}</button>
        <button :disabled="busy" @click="load">刷新列表</button>
      </div>
      <p v-if="error" class="material-error" role="alert">{{ error }}<br />已上传的原件会保留；可刷新后重试通知。</p>
      <label v-if="isMaterials && !task && entries.length">附加到任务<select v-model="selectedTask"><option value="">选择同项目任务</option><option v-for="t in taskOptions" :key="t.id" :value="t.id">{{ t.title }}</option></select></label>
      <p v-if="!entries.length && !error" class="material-note">{{ isMaterials ? '还没有素材，上传后可复制路径或附加到任务。' : '还没有附件，可上传原文件或从项目素材选择。' }}</p>
      <article v-for="a in entries" :key="a.id" class="material-file">
        <button v-if="a.type.startsWith('image/')" class="material-thumb" :aria-label="'预览 ' + a.name" @click="preview = a"><img :src="source(a)" :alt="a.name" loading="lazy" /></button>
        <b>{{ a.name }}</b><small>{{ a.type }} · {{ Math.ceil(a.size/1024) }} KB · {{ status(a) }}</small>
        <p v-if="a.purpose">用途：{{ a.purpose }}</p>
        <code>{{ a.libraryProjectPath || a.projectPath || a.libraryPath || a.path }}</code>
        <small v-if="a.tasks?.length">关联任务：{{ a.tasks.join('、') }}</small>
        <div class="material-actions">
          <a :href="source(a)" target="_blank" rel="noopener noreferrer">预览</a>
          <a :href="source(a) + '?download=1'" download>下载原件</a>
          <button @click="copyPath(a)">复制路径</button>
          <template v-if="isMaterials">
            <button :disabled="busy" @click="rename(a)">重命名</button>
            <button :disabled="busy" @click="attach(a)">附加并通知任务</button>
            <button v-if="a.status !== 'archived'" :disabled="busy" @click="run(() => changeMaterial(project,a.id,'archive'))">保存到素材库</button>
          </template>
          <template v-else>
            <button :disabled="busy" @click="run(() => saveAttachmentMaterial(task,a.id))">保存到项目收件箱</button>
            <button v-if="a.notification !== 'delivered'" :disabled="busy" @click="run(() => notify(a))">通知 Codex / 重试</button>
          </template>
        </div>
      </article>
    </div>
  </details>
  <div v-if="preview" class="material-overlay" role="dialog" aria-modal="true" :aria-label="preview.name" @click.self="preview = null" @keydown.esc="preview = null">
    <button autofocus @click="preview = null">关闭预览</button><img :src="source(preview)" :alt="preview.name" />
  </div>
</template>

<style scoped>
.material-panel { margin:12px 14px; border:1px solid var(--line); border-radius:12px; color:var(--text); font-size:.82rem; overflow-wrap:anywhere; }
summary { padding:12px; cursor:pointer; font-weight:600; }
.material-body { padding:0 12px 12px; }
.material-note, small { color:var(--text-2); }
.material-note { line-height:1.6; }
label { display:grid; gap:6px; margin:8px 0; }
input, select { width:100%; min-width:0; box-sizing:border-box; padding:10px; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px; }
.material-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:8px 0; }
button, a { padding:8px; min-height:36px; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px; font:inherit; cursor:pointer; }
button:disabled { opacity:.5; cursor:wait; }
.material-file { display:flex; flex-direction:column; gap:6px; border-top:1px solid var(--line); padding:12px 0; min-width:0; }
.material-file p { margin:0; }
.material-file code { font-size:.72rem; user-select:all; }
.material-thumb { width:100px; height:100px; padding:0; overflow:hidden; }
.material-thumb img { width:100%; height:100%; object-fit:contain; }
.material-error { color:var(--text); border-left:3px solid var(--text-3); padding:8px; }
.material-overlay { position:fixed; inset:0; z-index:1000; background:var(--bg); padding:20px; display:flex; flex-direction:column; gap:20px; align-items:center; justify-content:center; }
.material-overlay img { max-width:100%; max-height:80vh; object-fit:contain; }
</style>
