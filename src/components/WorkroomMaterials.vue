<script setup>
// 工作间的素材：存图片、文件，派活时带给他和 Codex。
// 三种样子：
//   项目页（没有 task）：一行「素材库 · N 个」+ 几张小图，点开是整页素材库
//   任务页（有 task）：一行「这个任务的附件 · N 个」，点开看附件，也能从素材库挑
//   挑选（pick）：新建任务时挑素材，点一张就选中
// 素材库里：点一下放大看；长按进入选择，可以接着点选好几张，底下一条操作栏（发给任务 / 删除）
// 原件都留在服务器上，删除只是从这里拿掉（已经发给任务的照样在）
import { ref, watch, computed, onBeforeUnmount } from 'vue';
import { listAttachments, listMaterials, uploadAttachment, uploadMaterial, changeMaterial, attachmentUrl, materialUrl, say, listMaterialGroups, editMaterialGroup } from '../lib/workroom.js';
import WorkroomGallery from './WorkroomGallery.vue';
import WorkroomNameForm from './WorkroomNameForm.vue';
import { toast } from '../lib/toast.js';
const props = defineProps({ project:String, task:String, revision:Number, pick:Boolean, tasks:{ type:Array, default:() => [] } });
const emit = defineEmits(['select']);

const open = ref(false);       // 整页打开着没有
const fromLib = ref(false);    // 任务页里：在看素材库（挑了直接发给这个任务）
const lib = computed(() => !props.task || fromLib.value); // 现在看的是素材库还是任务附件
const entries = ref([]), groups = ref([]), busy = ref(false), error = ref('');
const preview = ref(null), naming = ref(null), menuFor = ref(null);
const picker = ref(null), uploadInto = ref('');
const selecting = ref(false), chosen = ref([]);

const source = a => lib.value ? materialUrl(props.project, a.id) : attachmentUrl(props.task, a.id);
const isImg = a => (a.type || '').startsWith('image/');
const ext = a => (a.name.split('.').pop() || '文件').toUpperCase();
const taskOptions = computed(() => props.tasks.filter(t => t.project === props.project && t.status !== 'archived'));
const grouped = computed(() => {
  if (!lib.value) return [{ id:'task', name:'', items:entries.value }];
  const used = new Set(groups.value.flatMap(g => g.files));
  const out = groups.value.map(g => ({ ...g, items:entries.value.filter(a => g.files.includes(a.id)) })); // 空文件夹也显示（刚建的）
  const rest = entries.value.filter(a => !used.has(a.id));
  if (rest.length) out.push({ id:'', name:'没分组的', items:rest });
  return out;
});
const covers = computed(() => entries.value.filter(isImg).slice(0, 4));

let seq = 0;
async function load() {
  const n = ++seq;
  error.value = '';
  try {
    const list = lib.value ? (await listMaterials(props.project)).materials : (await listAttachments(props.task)).attachments;
    const gs = lib.value ? (await listMaterialGroups(props.project)).groups : [];
    if (n === seq) { entries.value = list || []; groups.value = gs || []; }
  } catch (e) { if (n === seq) error.value = e.message; }
}
watch(() => [props.project, props.task, lib.value, props.revision], load, { immediate:true });
watch(() => [props.project, props.task, lib.value], () => { selecting.value = false; chosen.value = []; preview.value = null; menuFor.value = null; });
async function run(fn) {
  if (busy.value) return;
  busy.value = true;
  try { await fn(); await load(); } catch (e) { toast(e.message, 5000); } finally { busy.value = false; }
}

// ---------- 点一下 / 长按 ----------
let pressTimer = null, pressed = false;
function pressStart(a) {
  if (props.pick) return;
  pressed = false;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => { pressed = true; selecting.value = true; toggle(a); navigator.vibrate?.(10); }, 450);
}
const pressEnd = () => clearTimeout(pressTimer);
function tap(a, g) {
  if (pressed) { pressed = false; return; } // 刚长按过，这一下不算
  if (props.pick) return emit('select', a);
  if (selecting.value) return toggle(a);
  if (props.task && fromLib.value) return sendTo(props.task, [a]);
  if (isImg(a)) preview.value = { items:g.items, id:a.id };
  else window.open(source(a), '_blank', 'noopener');
}
function toggle(a) {
  chosen.value = chosen.value.includes(a.id) ? chosen.value.filter(x => x !== a.id) : [...chosen.value, a.id];
  if (!chosen.value.length) selecting.value = false;
}
const endSelect = () => { selecting.value = false; chosen.value = []; };
const picked = () => entries.value.filter(a => chosen.value.includes(a.id));

// ---------- 发给任务、删除 ----------
async function sendTo(taskId, items) {
  if (!taskId || !items.length) return;
  await run(async () => {
    const files = lib.value ? await Promise.all(items.map(a => changeMaterial(props.project, a.id, 'attach', { taskId, purpose:a.purpose || '' }))) : items;
    await say(taskId, `给你 ${files.length} 个素材，请按任务要求使用。`, files);
    toast(`发给任务了（${files.length} 个）`);
    endSelect();
    if (props.task) fromLib.value = false;
  });
}
const sendTarget = ref('');
watch(sendTarget, id => { if (id) { sendTo(id, picked()); sendTarget.value = ''; } });
async function removeChosen() {
  const items = picked();
  if (!items.length || !confirm(`删掉这 ${items.length} 个素材？已经发给任务的不受影响。`)) return;
  await run(async () => { for (const a of items) await changeMaterial(props.project, a.id, 'delete'); endSelect(); toast('删掉了'); });
}

// ---------- 上传 ----------
function upload(groupId = '') { uploadInto.value = groupId; picker.value.click(); }
async function chooseFiles(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  const ok = files.filter(f => f.size && f.size <= 20 * 1024 * 1024 && /\.(png|jpe?g|gif|webp|mp4|webm|pdf|txt|md|csv|json|zip)$/i.test(f.name));
  if (ok.length < files.length) toast(`有 ${files.length - ok.length} 个文件太大或格式不支持，跳过了`, 4000);
  if (!ok.length) return;
  await run(async () => {
    if (!lib.value) {
      for (const f of ok) { const a = await uploadAttachment(props.task, f, ''); await say(props.task, '给你一个附件，请按任务要求使用。', [a]); }
      toast(`传好了 ${ok.length} 个，已经告诉 Codex`);
      return;
    }
    let gid = uploadInto.value;
    if (!gid) {
      const r = await editMaterialGroup(props.project, { action:'create', name:new Date().toLocaleDateString('zh-CN', { month:'numeric', day:'numeric' }) + ' 传的' });
      gid = r.groups.at(-1).id;
    }
    const ids = [];
    for (const f of ok) ids.push((await uploadMaterial(props.project, f, '')).id);
    await editMaterialGroup(props.project, { action:'append', id:gid, files:ids });
    toast(`传好了 ${ok.length} 个`);
  });
}

// ---------- 文件夹 ----------
function renameGroup(g) {
  menuFor.value = null;
  naming.value = { title:'文件夹名字', initial:g.name, save:async name => { await editMaterialGroup(props.project, { action:'rename', id:g.id, name }); await load(); } };
}
async function deleteGroup(g) {
  menuFor.value = null;
  if (!confirm(`删掉文件夹「${g.name}」和里面的 ${g.items.length} 个素材？已经发给任务的不受影响。`)) return;
  await run(() => editMaterialGroup(props.project, { action:'delete', id:g.id }));
}
function newGroup() {
  naming.value = { title:'新文件夹的名字', initial:'', save:async name => { await editMaterialGroup(props.project, { action:'create', name }); await load(); } };
}

// 打开时后面的工作间页面别跟着滑
watch(open, v => { document.body.style.overflow = v ? 'hidden' : ''; });
onBeforeUnmount(() => { document.body.style.overflow = ''; });
function close() { open.value = false; endSelect(); fromLib.value = false; menuFor.value = null; }
onBeforeUnmount(() => clearTimeout(pressTimer));
</script>

<template>
  <!-- 挑选：直接一格格的小图 -->
  <div v-if="pick" class="pick">
    <p v-if="!entries.length" class="hint">素材库里还没有东西</p>
    <div v-for="g in grouped" :key="g.id" class="group">
      <p v-if="g.name" class="gname">{{ g.name }}</p>
      <div class="grid">
        <button v-for="a in g.items" :key="a.id" class="cell" @click="tap(a, g)"><img v-if="isImg(a)" :src="source(a)" alt="" loading="lazy" /><span v-else class="file">{{ ext(a) }}</span></button>
      </div>
    </div>
  </div>

  <template v-else>
    <!-- 入口：一行 -->
    <button class="entry" @click="open = true">
      <b>{{ task ? '这个任务的附件' : '素材库' }}</b><small>{{ entries.length }} 个</small>
      <span class="covers"><img v-for="a in covers" :key="a.id" :src="source(a)" alt="" /></span>
      <i>›</i>
    </button>

    <!-- 整页 -->
    <Teleport to="body"><div v-if="open" class="page">
      <header>
        <button class="back" aria-label="返回" @click="selecting ? endSelect() : fromLib ? (fromLib = false) : close()">‹</button>
        <b>{{ selecting ? `选了 ${chosen.length} 个` : fromLib ? '从素材库挑（点一下就发给这个任务）' : task ? '这个任务的附件' : '素材库' }}</b>
        <template v-if="!selecting">
          <button v-if="task && !fromLib" class="act" @click="fromLib = true">从素材库挑</button>
          <button v-if="lib && !task" class="act" @click="newGroup">新文件夹</button>
          <button v-if="!fromLib" class="act main" :disabled="busy" @click="upload()">＋ 上传</button>
        </template>
      </header>
      <WorkroomNameForm v-if="naming" class="naming" v-bind="naming" @close="naming = null" />
      <p v-if="!selecting && !fromLib && !naming" class="hint">{{ task ? '传上来的会直接告诉 Codex。' : '存在这里的图片和文件，派活时可以一起带给他。长按可以多选。' }}</p>
      <p v-if="error" class="hint bad">{{ error }}</p>
      <p v-if="busy" class="hint">在处理…</p>
      <div class="body">
        <p v-if="!entries.length && !groups.length && !error" class="hint">还没有东西，点右上角「＋ 上传」</p>
        <section v-for="g in grouped" :key="g.id" class="group">
          <div v-if="g.name" class="ghead">
            <p class="gname">{{ g.name }} <small>{{ g.items.length }}</small></p>
            <template v-if="g.id && !fromLib">
              <button class="more" aria-label="文件夹选项" @click="menuFor = menuFor === g.id ? null : g.id">…</button>
              <div v-if="menuFor === g.id" class="menu">
                <button @click="menuFor = null; upload(g.id)">往这里加</button>
                <button @click="renameGroup(g)">改名字</button>
                <button class="danger" @click="deleteGroup(g)">删掉文件夹</button>
              </div>
            </template>
          </div>
          <button v-if="!g.items.length && !fromLib" class="empty" @click="upload(g.id)">空的，点这里往里加</button>
          <div class="grid">
            <button v-for="a in g.items" :key="a.id" class="cell" :class="{ on: chosen.includes(a.id) }"
              @pointerdown="pressStart(a)" @pointerup="pressEnd" @pointerleave="pressEnd" @pointercancel="pressEnd" @contextmenu.prevent
              @click="tap(a, g)">
              <img v-if="isImg(a)" :src="source(a)" alt="" loading="lazy" draggable="false" />
              <span v-else class="file">{{ ext(a) }}<small>{{ a.name }}</small></span>
              <i v-if="selecting" class="tick">{{ chosen.includes(a.id) ? '✓' : '' }}</i>
            </button>
          </div>
        </section>
      </div>
      <footer v-if="selecting" class="bar">
        <label v-if="lib && !task" class="send">发给任务…<select v-model="sendTarget"><option value="" disabled>选一个任务</option><option v-for="x in taskOptions" :key="x.id" :value="x.id">{{ x.title }}</option></select></label>
        <button v-else-if="task" @click="sendTo(task, picked())">再发给 Codex</button>
        <button v-if="lib" class="danger" @click="removeChosen">删除</button>
        <button @click="endSelect">取消</button>
      </footer>
    </div></Teleport>
    <input ref="picker" type="file" multiple hidden accept=".png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.pdf,.txt,.md,.csv,.json,.zip" @change="chooseFiles" />
  </template>
  <div v-if="preview" hidden>
    <WorkroomGallery :files="preview.items" :source="source" :initial-id="preview.id" title="素材" expanded @close="preview = null" />
  </div>
</template>

<style scoped>
.entry { display:flex; align-items:center; gap:8px; width:calc(100% - 32px); margin:10px 16px 0; border:0; background:var(--card); border-radius:14px; padding:10px 14px; box-shadow:var(--shadow-soft); color:var(--text); text-align:left; font-size:.84rem; }
.entry small { color:var(--text-3); font-size:.72rem; }
.entry .covers { flex:1; display:flex; justify-content:flex-end; gap:4px; }
.entry .covers img { width:26px; height:26px; object-fit:cover; border-radius:6px; }
.entry i { font-style:normal; color:var(--text-3); }
.page { position:fixed; inset:0; z-index:60; overscroll-behavior:none; background:var(--bg); display:flex; flex-direction:column; font-size:.82rem; color:var(--text); }
header { display:flex; align-items:center; gap:6px; padding:calc(var(--safe-top) + 10px) 12px 8px; }
header b { flex:1; min-width:0; font-size:.92rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
header button { border:0; background:none; color:var(--text-2); font-size:.78rem; padding:6px 8px; border-radius:999px; }
header .back { font-size:1.5rem; line-height:1; color:var(--text); padding:2px 10px 4px; }
header .main { background:var(--ink); color:var(--on-ink); padding:6px 12px; }
.hint { margin:0 16px 8px; font-size:.74rem; color:var(--text-3); line-height:1.6; }
.hint.bad { color:var(--danger); }
.body { flex:1; overflow-y:auto; padding:0 12px calc(var(--safe-bottom) + 80px); }
.group { margin-bottom:14px; position:relative; }
.empty { display:block; width:100%; border:1.5px dashed var(--line); background:none; border-radius:10px; padding:14px; font-size:.74rem; color:var(--text-3); }
.naming { margin:0 12px 10px; font-size:.82rem; }
.ghead { display:flex; align-items:center; }
.gname { flex:1; margin:6px 4px; font-size:.76rem; color:var(--text-2); }
.gname small { color:var(--text-3); margin-left:4px; }
.more { border:0; background:none; color:var(--text-3); font-size:1rem; padding:0 8px; }
.menu { position:absolute; right:4px; top:28px; z-index:2; background:var(--card); border-radius:12px; box-shadow:var(--shadow-soft); display:flex; flex-direction:column; padding:4px; }
.menu button { border:0; background:none; color:var(--text); font-size:.8rem; padding:8px 14px; text-align:left; }
.danger { color:var(--danger) !important; }
.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(76px, 1fr)); gap:6px; }
.cell { position:relative; aspect-ratio:1; padding:0; border:0; border-radius:10px; overflow:hidden; background:var(--card); box-shadow:var(--shadow-soft); -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; }
.cell img { width:100%; height:100%; object-fit:contain; pointer-events:none; }
.cell.on { box-shadow:0 0 0 2px var(--accent); }
.file { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; font-size:.72rem; font-weight:600; color:var(--text-2); padding:4px; }
.file small { font-weight:400; font-size:.6rem; color:var(--text-3); max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tick { position:absolute; top:4px; right:4px; width:18px; height:18px; border-radius:50%; background:rgba(var(--glass-rgb), .9); box-shadow:inset 0 0 0 1.5px var(--line); font-style:normal; font-size:.7rem; line-height:18px; text-align:center; color:var(--accent); }
.cell.on .tick { background:var(--accent); color:#fff; box-shadow:none; }
.bar { position:fixed; left:0; right:0; bottom:0; display:flex; gap:8px; justify-content:center; padding:10px 14px calc(var(--safe-bottom) + 12px); background:rgba(var(--glass-rgb), .94); -webkit-backdrop-filter:blur(18px); backdrop-filter:blur(18px); }
.bar button, .bar .send { border:0; background:var(--card); color:var(--text); font-size:.8rem; padding:8px 14px; border-radius:999px; box-shadow:var(--shadow-soft); position:relative; }
.bar .send select { position:absolute; inset:0; opacity:0; font-size:16px; }
.pick .grid { grid-template-columns:repeat(auto-fill, minmax(64px, 1fr)); }
.pick .hint { margin:6px 0; }
</style>
