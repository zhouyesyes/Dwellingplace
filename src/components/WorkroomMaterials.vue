<script setup>
import { ref, watch, computed, onBeforeUnmount } from 'vue';
import { listAttachments, listMaterials, uploadAttachment, uploadMaterial, saveAttachmentMaterial, changeMaterial, attachmentUrl, materialUrl, say, listMaterialGroups, editMaterialGroup } from '../lib/workroom.js';
import WorkroomGallery from './WorkroomGallery.vue';
import WorkroomNameForm from './WorkroomNameForm.vue';
import { toast } from '../lib/toast.js';
const props = defineProps({ project:String, task:String, revision:Number, pick:Boolean, tasks:{ type:Array, default:() => [] } });
const emit = defineEmits(['select']);
const naming = ref(null), groups = ref([]), targetGroup = ref(''), queueGroup = ref('');
const openKey = computed(() => 'workroom-inbox:' + props.project + ':' + (props.task || ''));
const opened = ref(false);
watch(openKey, key => { opened.value = sessionStorage.getItem(key) === 'open'; }, {immediate:true});
function togglePanel(e) { opened.value = e.target.open; sessionStorage.setItem(openKey.value, opened.value ? 'open' : 'closed'); }
const grouped = computed(() => {
  if (!isMaterials.value) return [{id:'task',name:'任务附件',items:entries.value}];
  const used = new Set(groups.value.flatMap(g => g.files));
  const result = groups.value.map(g => ({...g, items:entries.value.filter(a => g.files.includes(a.id))}));
  const older = entries.value.filter(a => !used.has(a.id));
  if (older.length) result.push({id:'legacy',name:'已有素材',items:older});
  return result;
});
async function organizeExisting(name) {
  const project = props.project;
  const files = grouped.value.find(g => g.id === 'legacy')?.items.map(a => a.id) || [];
  const result = await editMaterialGroup(project,{action:'create',name});
  const id = result.groups.at(-1).id;
  if (files.length) await editMaterialGroup(project,{action:'append',id,files});
  return id;
}
function nameGroup(g) {
  naming.value = { title:g ? '文件夹名称' : '新建文件夹', initial:g?.name || '', save:async name => {
    if (g?.id === 'legacy') { await organizeExisting(name); await load(); }
    else {
      const result = await editMaterialGroup(props.project, {action:g ? 'rename':'create', id:g?.id, name});
      groups.value = result.groups;
    }
    toast('名称已保存');
  }};
}
async function deleteGroup(g) {
  if (g.id === 'legacy') return removeSaved([...g.items]);
  if (!confirm('删除「' + g.name + '」及其中 ' + g.items.length + ' 个素材？原件和已有任务引用会保留。')) return;
  await run(async () => { await editMaterialGroup(props.project,{action:'delete',id:g.id}); toast('文件夹已删除'); });
}
const entries = ref([]), error = ref(''), busy = ref(false), purpose = ref(''), selectedTask = ref(''), picker = ref(null), uploadControls = ref(null);
const selecting = ref(false), chosen = ref([]), deleteResult = ref('');
async function removeSaved(items) {
  if (busy.value || !items.length) return;
  if (!confirm(`从当前项目收件箱删除这 ${items.length} 个素材？原件及已有任务、素材库引用会保留。`)) return;
  const project = props.project;
  busy.value = true;
  const failures = [];
  let success = 0;
  try {
    for (const a of items) {
      try { await changeMaterial(project, a.id, 'delete'); success++; chosen.value = chosen.value.filter(id => id !== a.id); }
      catch(e) { failures.push(`${a.name}：${e.message}`); }
    }
    if (project === props.project) { await load(); deleteResult.value = `已删除 ${success} 个` + (failures.length ? `；失败 ${failures.length} 个：${failures.join('；')}` : ''); }
  } finally { busy.value = false; }
}
const inbox = ref(false), preview = ref(null);
const isMaterials = computed(() => !props.task || inbox.value);
watch(() => [props.project, props.task, isMaterials.value], () => { selecting.value = false; chosen.value = []; deleteResult.value = ''; });

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
    if (isMaterials.value) {
      const result = await listMaterialGroups(props.project);
      if (seq === loadSeq) groups.value = result.groups || [];
    }
  } catch(e) { if (seq === loadSeq) { error.value = e.message; } }
}
watch(() => [props.project,props.task,isMaterials.value], () => { preview.value = null; naming.value = null; });
watch(() => [props.project,props.task,isMaterials.value,props.revision], load, { immediate:true });
async function run(fn) {
  if (busy.value) return;
  busy.value = true;
  try { await fn(); await load(); } catch(e) { error.value = e.message; toast(e.message,5000); } finally { busy.value = false; }
}
async function notify(a, task = props.task) {
  await say(task, `已追加原始附件。用途：${a.purpose || '请读取原文件，并按任务要求处理。'}`, [a]);
  toast('Codex 已接收附件通知');
}
const queue = ref([]), batchResult = ref('');
const totalSize = computed(() => queue.value.reduce((n, f) => n + f.file.size, 0));
const failed = computed(() => queue.value.filter(f => f.state === 'failed').length);
const completed = computed(() => queue.value.filter(f => ['success', 'failed'].includes(f.state)).length);
const sizeText = n => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.ceil(n / 1024)} KB`;
function clearQueue() {
  queue.value.forEach(f => { if (f.url) URL.revokeObjectURL(f.url); });
  queue.value = [];
  batchResult.value = ''; queueGroup.value = '';
}
watch(() => [props.project, props.task, isMaterials.value], clearQueue);
onBeforeUnmount(clearQueue);
function removePending(f) {
  if (busy.value || f.state === 'success') return;
  if (f.url) URL.revokeObjectURL(f.url);
  queue.value = queue.value.filter(x => x !== f);
}
function choose(event) {
  for (const file of event.target.files || []) {
    const invalid = !file.size || file.size > 20 * 1024 * 1024 ? '文件必须非空且不超过 20 MB' :
      !/\.(png|jpe?g|gif|webp|mp4|webm|pdf|txt|md|csv|json|zip)$/i.test(file.name) ? '不支持的文件类型' : '';
    queue.value.push({ file, url: !invalid && file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      state: invalid ? 'failed' : 'pending', error: invalid, invalid, uploaded: null });
  }
  event.target.value = '';
  batchResult.value = '';
}
async function uploadBatch(retry = false) {
  if (busy.value) return;
  const items = queue.value.filter(f => f.state === (retry ? 'failed' : 'pending'));
  if (!items.length) return;
  const project = props.project, task = props.task, material = isMaterials.value, usage = purpose.value;
  busy.value = true;
  batchResult.value = '';
  try {
    if (material && !queueGroup.value) {
      if (targetGroup.value === 'legacy') queueGroup.value = await organizeExisting('已有素材');
      else if (targetGroup.value) queueGroup.value = targetGroup.value;
      else {
        const result = await editMaterialGroup(project,{action:'create',name:'上传批次 ' + new Date().toLocaleString('zh-CN')});
        queueGroup.value = result.groups.at(-1).id; groups.value = result.groups;
      }
    }
    for (const f of items) {
      f.state = 'uploading';
      f.error = '';
      try {
        if (f.invalid) throw Error(f.invalid);
        // 通知失败只重试通知，已保存的原件不重复上传。
        if (!f.uploaded) f.uploaded = material ? await uploadMaterial(project, f.file, usage) : await uploadAttachment(task, f.file, usage);
        if (material) await editMaterialGroup(project,{action:'append',id:queueGroup.value,files:[f.uploaded.id]});
        if (!material) await notify(f.uploaded, task);
        f.state = 'success';
      } catch(e) { f.state = 'failed'; f.error = (f.uploaded ? (material ? '原件已保存，分组失败：' : '原件已保存，通知失败：') : '') + e.message; }
    }
    const success = items.filter(f => f.state === 'success').length;
    batchResult.value = `本次成功 ${success} 个，失败 ${items.length - success} 个。已成功的原件会保留。`;
    toast(batchResult.value, 5000);
    await load();
  } catch(e) { error.value = e.message; toast(e.message,5000); } finally { busy.value = false; }
}
function rename(a) {
  naming.value = {title:'素材名称（保留扩展名）',initial:a.name,save:async name => {
    await changeMaterial(props.project,a.id,'rename',{name}); await load(); toast('名称已保存');
  }};
}
async function copyPath(a) {
  try { await navigator.clipboard.writeText(a.libraryProjectPath || a.projectPath || a.libraryPath || a.path); toast('已复制 Codex 可读取的路径'); }
  catch { toast('复制失败，请检查浏览器剪贴板权限后重试'); }
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
  <details class="material-panel" :open="opened" @toggle="togglePanel">
    <summary>{{ isMaterials ? '项目素材收件箱' : '任务原始附件' }}</summary>
    <div class="material-body">
      <WorkroomNameForm v-if="naming" :key="naming" v-bind="naming" @close="naming = null" />
      <details v-if="!pick" ref="uploadControls" class="upload-controls"><summary>上传与整理</summary>
      <button v-if="isMaterials && !pick" :disabled="busy" @click="nameGroup(null)">新建文件夹</button>
      <label v-if="isMaterials && !pick">上传到<select v-model="targetGroup" :disabled="busy || queue.length > 0"><option value="">新的上传批次</option><option v-if="grouped.some(g => g.id === 'legacy')" value="legacy">已有素材</option><option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option></select></label>
      <div v-if="task" class="material-actions"><button :disabled="busy" @click="inbox = !inbox">{{ inbox ? '返回任务附件' : '从项目素材选择' }}</button></div>
      <p v-if="!pick" class="material-note">原文件保留，不压缩。每个文件最多 20 MB。任务结束后仍保留；归档只整理引用，不删除原件。</p>
      <label v-if="!pick">用途说明<input v-model="purpose" maxlength="2000" placeholder="例如：保留透明背景，统一贴纸颜色" /></label>
      <div v-if="!pick" class="material-actions">
        <input ref="picker" type="file" multiple :disabled="busy" hidden accept=".png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.pdf,.txt,.md,.csv,.json,.zip" @change="choose" />
        <button :disabled="busy" @click="picker.click()">选择图片 / 文件（可多选）</button>
        <button :disabled="busy" @click="load">刷新列表</button>
      </div>
      <section v-if="queue.length" class="material-queue" aria-label="待上传文件">
        <p>已选择 {{ queue.length }} 个文件 · 共 {{ sizeText(totalSize) }}<span v-if="completed"> · 成功 {{ queue.filter(f => f.state === 'success').length }} 个 / 失败 {{ failed }} 个</span></p>
        <p class="material-note">同名文件分别保存，不覆盖已有素材。成功项会保留在下方素材列表。</p>
        <div v-for="(f, i) in queue" :key="i" class="material-file">
          <img v-if="f.url" class="pending-thumb" :src="f.url" alt="待上传图片缩略图" />
          <b>{{ f.file.name }}</b><small>{{ sizeText(f.file.size) }} · {{ { pending:'待上传', uploading:'正在处理…', success:'成功', failed:'失败' }[f.state] }}</small>
          <span v-if="f.error" role="alert">{{ f.error }}</span>
          <button v-if="f.state !== 'success'" :disabled="busy" :aria-label="'移除 ' + f.file.name" @click="removePending(f)">移除</button>
        </div>
        <div class="material-actions">
          <button :disabled="busy || !queue.some(f => f.state === 'pending')" @click="uploadBatch()">{{ isMaterials ? '开始上传' : '上传并通知 Codex' }}</button>
          <button v-if="failed" :disabled="busy" @click="uploadBatch(true)">仅重试失败项（{{ failed }}）</button>
          <button :disabled="busy" @click="clearQueue">清空上传清单</button>
        </div>
        <p role="status" aria-live="polite">{{ busy ? `正在处理，已完成 ${completed} / ${queue.length} 个，请保持页面打开…` : batchResult }}</p>
      </section>
      </details>
      <p class="material-note" role="status">已保存 {{ entries.length }} 个{{ isMaterials ? '素材' : '附件' }}</p>
      <p v-if="error" class="material-error" role="alert">{{ error }}<br />已上传的原件会保留；可刷新后重试通知。</p>
      <label v-if="isMaterials && !pick && !task && entries.length">附加到任务<select v-model="selectedTask"><option value="">选择同项目任务</option><option v-for="t in taskOptions" :key="t.id" :value="t.id">{{ t.title }}</option></select></label>
      <p v-if="!entries.length && !error" class="material-note">{{ isMaterials ? '还没有素材，上传后可复制路径或附加到任务。' : '还没有附件，可上传原文件或从项目素材选择。' }}</p>
      <div v-if="isMaterials && !pick && entries.length" class="material-actions">
        <button :disabled="busy" @click="selecting = !selecting; chosen = []">{{ selecting ? '取消多选' : '多选删除' }}</button>
        <template v-if="selecting"><button :disabled="busy || !chosen.length" @click="run(async () => { const id = task || selectedTask; if (!id) throw Error('先选择任务'); for (const a of entries.filter(a => chosen.includes(a.id))) { const file = await changeMaterial(project,a.id,'attach',{taskId:id,purpose}); await notify(file,id); } toast('所选素材已附加'); })">附加所选到任务</button><button :disabled="busy" @click="chosen = entries.map(a => a.id)">全选</button><button :disabled="busy || !chosen.length" @click="removeSaved(entries.filter(a => chosen.includes(a.id)))">删除所选（{{ chosen.length }}）</button></template>
      </div>
      <p v-if="deleteResult" role="status" aria-live="polite">{{ deleteResult }}</p>
      <details v-for="g in grouped" :key="g.id" class="material-group">
        <summary>{{ g.name }} · {{ g.items.length }} 个文件 <span class="covers"><img v-for="a in g.items.filter(a => a.type.startsWith('image/')).slice(0,3)" :key="a.id" :src="source(a)" alt="" /></span></summary>
        <div v-if="!pick && isMaterials" class="material-actions"><button :disabled="busy" @click="nameGroup(g)">重命名文件夹</button><button :disabled="busy || queue.length > 0" @click="targetGroup = g.id; uploadControls.open = true; picker.click()">追加上传</button><button :disabled="busy" @click="deleteGroup(g)">删除此组</button></div>
        <div class="material-grid">
      <article v-for="a in g.items" :key="a.id" class="material-file">
        <button v-if="a.type.startsWith('image/')" class="material-thumb" :aria-label="'预览 ' + a.name" @click="preview = {items:g.items,id:a.id}"><img :src="source(a)" :alt="a.name" loading="lazy" /></button>
        <label v-if="selecting && isMaterials" class="delete-choice"><input v-model="chosen" type="checkbox" :value="a.id" :disabled="busy" />选择 {{ a.name }}</label><b>{{ a.name }}</b>
        <div class="material-actions">
          <button v-if="a.type.startsWith('image/')" @click="preview = {items:g.items,id:a.id}">预览</button><a v-else :href="source(a)" target="_blank" rel="noopener noreferrer">打开文件</a>
          <button v-if="pick" @click="emit('select',a)">选择此素材</button>
          <button v-if="isMaterials && !pick" :disabled="busy" :aria-label="'删除 ' + a.name" @click="removeSaved([a])">删除</button>
          <details v-if="!pick"><summary>更多</summary>
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
          </details>
        </div>
      </article>
        </div>
      </details>
    </div>
  </details>
  <div v-if="preview" class="material-viewer" hidden>
    <button @click="preview = null">收起预览入口</button>
    <WorkroomGallery :files="preview.items" :source="source" :initial-id="preview.id" title="素材预览" expanded @close="preview = null" />
  </div>
</template>

<style scoped>
.material-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:10px; }
.material-group { margin:12px 0; border:1px solid var(--line); border-radius:10px; padding:6px; }
.covers { display:inline-flex; gap:4px; vertical-align:middle; }
.covers img { width:32px; height:36px; object-fit:cover; border-radius:4px; }
.delete-choice { display:flex; align-items:center; min-height:44px; }
.delete-choice input { width:22px; height:22px; }
.material-actions button { min-height:44px; }
.material-queue { border:1px solid var(--line); border-radius:10px; padding:10px; margin:12px 0; }
.material-queue .material-file { display:grid; grid-template-columns:52px minmax(0,1fr) auto; gap:4px 10px; padding:8px 0; min-height:68px; align-items:center; }
.material-queue .material-file b, .material-queue .material-file small, .material-queue .material-file span { grid-column:2; }
.material-queue .material-file button { grid-column:3; grid-row:1 / span 2; min-height:44px; }
.pending-thumb { grid-column:1; grid-row:1 / span 2; width:52px; height:52px; object-fit:contain; }
.material-panel { flex-shrink:0; margin:12px 14px; border:1px solid var(--line); border-radius:12px; color:var(--text); font-size:.82rem; overflow-wrap:anywhere; }
summary { padding:12px; cursor:pointer; font-weight:600; }
.material-body { padding:0 12px 12px; }
.material-note, small { color:var(--text-2); }
.material-note { line-height:1.6; }
label { display:grid; gap:6px; margin:8px 0; }
input, select { font-size:16px; width:100%; min-width:0; box-sizing:border-box; padding:10px; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px; }
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
