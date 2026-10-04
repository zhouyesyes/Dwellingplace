<script setup>
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, roleById, threadsOf, createThread, deleteThread, loadMessages, messageCache, saveMessages, apiFor } from "../store/index.js";
import { generating, sendMessage, regenerate, editAndResend, deleteMessage, splitBubbles, fileToAttachment } from "../lib/chat.js";
import { saveImage, deleteImage, pickFile, useImage } from "../lib/images.js";
import { stamp, shortTime } from "../lib/time.js";
import { toast } from "../lib/toast.js";
import { goBack } from "../lib/nav.js";
import Avatar from "../components/Avatar.vue";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";
import ImgThumb from "../components/ImgThumb.vue";

const route = useRoute();
const router = useRouter();
const role = computed(() => roleById(route.params.roleId));

// ---------- 当前对话 ----------
const threadId = ref(null);
const thread = computed(() => store.threads.find(t => t.id === threadId.value));
const messages = computed(() => messageCache[threadId.value] || []);
const busy = computed(() => !!generating[threadId.value]);
const bgUrl = useImage(() => thread.value?.bg);

async function openThread(id) {
  threadId.value = id;
  role.value.lastThreadId = id;
  await loadMessages(id);
  await nextTick();
  scrollToBottom(true);
}

onMounted(async () => {
  if (!role.value) return router.replace("/chats");
  const list = threadsOf(role.value.id);
  const pick =
    list.find(t => t.id === route.params.threadId) ||
    list.find(t => t.id === role.value.lastThreadId) ||
    list[0] ||
    createThread(role.value.id);
  await openThread(pick.id);
});

// ---------- 消息分组：同一个人 5 分钟内连续的消息算一组 ----------
const items = computed(() => {
  const out = [];
  let group = null;
  for (const m of messages.value) {
    if (m.from === "event") { out.push({ type: "event", m }); group = null; continue; }
    if (group && group.from === m.from && m.ts - group.lastTs < 5 * 60_000) {
      group.msgs.push(m);
      group.lastTs = m.ts;
    } else {
      group = { type: "group", from: m.from, msgs: [m], lastTs: m.ts, key: m.id };
      out.push(group);
    }
  }
  return out;
});

// ---------- 滚动 ----------
const scroller = ref(null);
function nearBottom() {
  const el = scroller.value;
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 140;
}
function scrollToBottom(force = false) {
  const el = scroller.value;
  if (el && (force || nearBottom())) el.scrollTop = el.scrollHeight;
}
watch(
  () => { const l = messages.value; return l.length + ":" + (l[l.length - 1]?.text?.length ?? 0); },
  () => { const stick = nearBottom(); nextTick(() => stick && scrollToBottom(true)); },
);

// ---------- 输入 ----------
const draft = ref("");
const attachments = ref([]);
const inputEl = ref(null);
const coarse = matchMedia("(pointer: coarse)").matches;

function autoGrow() {
  const el = inputEl.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 140) + "px";
}

function onKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !coarse) {
    e.preventDefault();
    send();
  }
}

async function send() {
  if (busy.value) return;
  const text = draft.value.trim();
  if (!text && !attachments.value.length) return;
  const atts = attachments.value;
  draft.value = "";
  attachments.value = [];
  nextTick(autoGrow);
  scrollToBottom(true);
  await sendMessage(thread.value, text, atts);
}

function stop() {
  generating[threadId.value]?.abort();
}

// ---------- ＋ 附件 ----------
const plusOpen = ref(false);
async function addImages() {
  plusOpen.value = false;
  const files = await pickFile("image/*", true);
  for (const f of files) {
    try { attachments.value.push({ kind: "image", img: await saveImage(f), name: f.name }); }
    catch { toast("这张图片读不了：" + f.name); }
  }
}
async function addFiles() {
  plusOpen.value = false;
  const files = await pickFile(".pdf,.txt,.md,.json,.csv,.html,.js,.py,text/*,application/pdf", true);
  for (const f of files) {
    try { attachments.value.push(await fileToAttachment(f)); }
    catch (e) { toast(e.message, 3000); }
  }
}
function removeAttachment(i) {
  const [a] = attachments.value.splice(i, 1);
  if (a.kind === "image") deleteImage(a.img);
}

// ---------- 对话切换 ----------
const threadsOpen = ref(false);
const threadList = computed(() => (role.value ? threadsOf(role.value.id) : []));
async function newThread() {
  threadsOpen.value = false;
  const t = createThread(role.value.id);
  await openThread(t.id);
}
async function switchThread(id) {
  threadsOpen.value = false;
  if (id !== threadId.value) await openThread(id);
}
function renameThread(t) {
  const name = prompt("给这个对话起个名字", t.title);
  if (name?.trim()) t.title = name.trim().slice(0, 30);
}
async function removeThread(t) {
  if (!confirm(`删除对话「${t.title}」？里面的消息会全部删除。`)) return;
  const wasCurrent = t.id === threadId.value;
  if (t.bg) deleteImage(t.bg);
  await deleteThread(t.id);
  if (wasCurrent) {
    const next = threadsOf(role.value.id)[0] || createThread(role.value.id);
    await openThread(next.id);
  }
}
async function changeBg() {
  const [f] = await pickFile("image/*");
  if (!f) return;
  const old = thread.value.bg;
  thread.value.bg = await saveImage(f, { maxSize: 1800, quality: 0.82 });
  if (old) deleteImage(old);
}
function clearBg() {
  deleteImage(thread.value.bg);
  thread.value.bg = null;
}
const currentApi = computed(() => apiFor(thread.value, role.value));

// ---------- 消息操作 ----------
const actionMsg = ref(null);
const editing = ref(null); // { msg, text }

function openActions(m) {
  if (m.pending) return;
  actionMsg.value = m;
}
async function copyMsg() {
  const m = actionMsg.value;
  actionMsg.value = null;
  const text = m.from === "ai" ? splitBubbles(m.text).join("\n\n") : m.text;
  try { await navigator.clipboard.writeText(text); toast("已复制"); }
  catch { toast("复制失败，浏览器不允许"); }
}
function startEdit() {
  const m = actionMsg.value;
  actionMsg.value = null;
  editing.value = { msg: m, text: m.text };
}
async function saveEdit(resend) {
  const { msg, text } = editing.value;
  editing.value = null;
  if (resend) {
    await editAndResend(thread.value, msg.id, text.trim());
  } else {
    msg.text = text.trim();
    msg.edited = true;
    saveMessages(thread.value.id);
  }
}
async function regen() {
  const m = actionMsg.value;
  actionMsg.value = null;
  if (busy.value) return;
  const isLast = messages.value.filter(x => x.from !== "event").at(-1)?.id === m.id;
  if (!isLast && !confirm("重新生成会删掉这条之后的所有消息，确定吗？")) return;
  await regenerate(thread.value, m.id);
}
async function removeMsg() {
  const m = actionMsg.value;
  actionMsg.value = null;
  if (!confirm("删除这条消息？")) return;
  await deleteMessage(thread.value, m.id);
}

const smallWorld = () => toast(`${role.value.name} 的小世界还在建造中～`);
const back = () => goBack(router, "/chats");
</script>

<template>
  <div v-if="role" class="chat" :class="{ 'has-bg': bgUrl }">
    <div class="bg" :style="bgUrl ? { backgroundImage: `url(${bgUrl})` } : {}" />

    <div class="top-wrap"><header class="top">
      <button class="icon-btn" aria-label="返回" @click="back"><Icon name="back" /></button>
      <div class="who">
        <div class="name">{{ role.name }}</div>
        <div v-if="role.signature" class="sig">{{ role.signature }}</div>
      </div>
      <button class="icon-btn" aria-label="小世界" @click="smallWorld"><Icon name="house" /></button>
    </header></div>

    <main ref="scroller" class="scroll">
      <div class="inner">
        <div v-if="!messages.length" class="hello">
          <Avatar :img="role.avatar" :name="role.name" :color="role.color" :size="64" />
          <p>和 {{ role.name }} 说点什么吧</p>
          <p v-if="!currentApi" class="warn">还没有 API，先去「设置 → API」添加一个</p>
        </div>

        <template v-for="it in items" :key="it.type === 'event' ? it.m.id : it.key">
          <div v-if="it.type === 'event'" class="event"><span>{{ it.m.text }}</span></div>

          <div v-else class="group" :class="it.from === 'user' ? 'mine' : 'theirs'">
            <div class="ava">
              <Avatar v-if="it.from === 'user'" :img="store.profile.avatar" :name="store.profile.name" :color="store.profile.color" :size="42" />
              <Avatar v-else :img="role.avatar" :name="role.name" :color="role.color" :size="42" />
            </div>
            <div class="col">
              <template v-for="m in it.msgs" :key="m.id">
                <template v-if="m.from === 'user'">
                  <div v-for="(a, i) in m.attachments || []" :key="i" class="att" @click="openActions(m)">
                    <ImgThumb v-if="a.kind === 'image'" :id="a.img" />
                    <div v-else class="file-chip"><Icon name="file" :size="18" />{{ a.name }}</div>
                  </div>
                  <div v-if="m.text" class="bubble" @click="openActions(m)">{{ m.text }}</div>
                </template>
                <template v-else>
                  <div v-if="m.error" class="bubble error" @click="openActions(m)">{{ m.text }}</div>
                  <div v-else-if="m.pending && !splitBubbles(m.text).length" class="bubble typing"><i /><i /><i /></div>
                  <div v-for="(b, i) in splitBubbles(m.text)" v-else :key="i" class="bubble" @click="openActions(m)">{{ b }}</div>
                </template>
              </template>
              <div class="stamp">{{ stamp(it.lastTs) }}</div>
            </div>
          </div>
        </template>
      </div>
    </main>

    <footer class="composer">
      <div v-if="attachments.length" class="pending-atts">
        <div v-for="(a, i) in attachments" :key="i" class="patt">
          <ImgThumb v-if="a.kind === 'image'" :id="a.img" class="mini" />
          <span v-else class="file-chip"><Icon name="file" :size="16" />{{ a.name }}</span>
          <button class="x" @click="removeAttachment(i)"><Icon name="close" :size="14" /></button>
        </div>
      </div>
      <div class="row">
        <button class="tool" aria-label="添加图片或文件" @click="plusOpen = true"><Icon name="plus" :size="26" /></button>
        <button class="tool" aria-label="切换对话" @click="threadsOpen = true"><Icon name="threads" :size="22" /></button>
        <textarea ref="inputEl" v-model="draft" rows="1" placeholder="The world is your origami……"
          :enterkeyhint="coarse ? 'enter' : 'send'" @input="autoGrow" @keydown="onKeydown" />
        <button v-if="busy" class="send on" aria-label="停止" @click="stop"><Icon name="stop" :size="22" /></button>
        <button v-else class="send" :class="{ on: draft.trim() || attachments.length }" aria-label="发送" @click="send"><Icon name="send" :size="24" /></button>
      </div>
    </footer>

    <!-- ＋ -->
    <Sheet :open="plusOpen" @close="plusOpen = false">
      <div class="grid-actions">
        <button @click="addImages"><span><Icon name="image" :size="26" /></span>图片</button>
        <button @click="addFiles"><span><Icon name="file" :size="26" /></span>文件</button>
      </div>
    </Sheet>

    <!-- 对话切换 -->
    <Sheet :open="threadsOpen" :title="`和 ${role.name} 的对话`" @close="threadsOpen = false">
      <div class="list-card flat">
        <div v-for="t in threadList" :key="t.id" class="list-row thread" :class="{ cur: t.id === threadId }" @click="switchThread(t.id)">
          <span class="grow">
            {{ t.title }}
            <span class="sub">{{ t.preview || "空对话" }}</span>
          </span>
          <span class="t-time">{{ shortTime(t.updatedAt) }}</span>
          <button class="mini-btn" aria-label="重命名" @click.stop="renameThread(t)"><Icon name="edit" :size="16" /></button>
          <button class="mini-btn" aria-label="删除" @click.stop="removeThread(t)"><Icon name="trash" :size="16" /></button>
        </div>
      </div>
      <button class="btn soft new-btn" @click="newThread"><Icon name="plus" :size="16" /> 新对话</button>

      <div class="section-label">这个对话</div>
      <div class="list-card flat">
        <div class="list-row">
          <Icon name="image" :size="20" />
          <span class="grow">背景</span>
          <button v-if="thread?.bg" class="btn soft small" @click="clearBg">恢复默认</button>
          <button class="btn soft small" @click="changeBg">换背景</button>
        </div>
        <label class="list-row">
          <Icon name="key" :size="20" />
          <span class="grow">API<span class="sub">现在用：{{ currentApi ? `${currentApi.name} · ${currentApi.model}` : "无" }}</span></span>
          <select v-if="thread" v-model="thread.apiId" class="api-select">
            <option :value="null">跟随角色 / 默认</option>
            <option v-for="a in store.apis" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </label>
      </div>
    </Sheet>

    <!-- 消息操作 -->
    <Sheet :open="!!actionMsg" @close="actionMsg = null">
      <div v-if="actionMsg" class="grid-actions">
        <button v-if="!actionMsg.error" @click="copyMsg"><span><Icon name="copy" :size="24" /></span>复制</button>
        <button v-if="!actionMsg.error" @click="startEdit"><span><Icon name="edit" :size="24" /></span>修改</button>
        <button v-if="actionMsg.from === 'ai'" :disabled="busy" @click="regen"><span><Icon name="refresh" :size="24" /></span>重新生成</button>
        <button @click="removeMsg"><span><Icon name="trash" :size="24" /></span>删除</button>
      </div>
    </Sheet>

    <!-- 修改 -->
    <Sheet :open="!!editing" title="修改消息" @close="editing = null">
      <template v-if="editing">
        <textarea v-model="editing.text" class="input" rows="7" />
        <div class="edit-actions">
          <button class="btn soft" @click="saveEdit(false)">仅保存</button>
          <button v-if="editing.msg.from === 'user'" class="btn" :disabled="busy" @click="saveEdit(true)">保存并重新回答</button>
        </div>
      </template>
    </Sheet>
  </div>
</template>

<style scoped>
.chat {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  height: 100dvh;
}
.bg {
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(180deg, #f6f1e8 0%, #efe8dd 100%);
  background-size: cover;
  background-position: center;
}

/* 顶部 */
.top {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: calc(var(--safe-top) + 10px) 16px 10px;
}
.top-wrap { background: linear-gradient(180deg, rgba(248, 243, 234, .92) 40%, rgba(248, 243, 234, 0)); }
.has-bg .top-wrap { background: linear-gradient(180deg, rgba(248, 243, 234, .75) 30%, rgba(248, 243, 234, 0)); }
.who { flex: 1; text-align: center; min-width: 0; }
.name { font-size: 18px; font-weight: 700; letter-spacing: 1px; }
.sig { font-size: 12.5px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 消息区 */
.scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.inner { max-width: 760px; margin: 0 auto; padding: 12px 14px 24px; display: flex; flex-direction: column; gap: 18px; }

.hello { text-align: center; color: var(--text-2); margin-top: 18vh; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.hello p { margin: 8px 0 0; }
.warn { color: var(--danger); font-size: 13px; }

.event { text-align: center; }
.event span { font-size: 12px; color: var(--text-2); background: rgba(255, 253, 248, .7); padding: 3px 12px; border-radius: 999px; }

.group { display: flex; gap: 10px; align-items: flex-start; }
.group.mine { flex-direction: row-reverse; }
.ava { flex: none; padding-top: 2px; }
.col { display: flex; flex-direction: column; gap: 6px; min-width: 0; max-width: min(78%, 560px); }
.mine .col { align-items: flex-end; }
.theirs .col { align-items: flex-start; }

.bubble {
  padding: 10px 15px;
  border-radius: 20px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.65;
  font-size: 15px;
  cursor: pointer;
  user-select: text;
}
.theirs .bubble { background: rgba(255, 253, 248, .96); border-top-left-radius: 8px; box-shadow: 0 1px 2px rgba(120, 90, 60, .05); }
.mine .bubble { background: #ebe3d6; border-top-right-radius: 8px; }
.has-bg .mine .bubble { background: rgba(235, 227, 214, .95); }
.bubble.error { background: #fbeeea; color: var(--danger); font-size: 13.5px; }

.typing { display: flex; gap: 5px; padding: 15px 16px; }
.typing i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); animation: hop 1.2s infinite; }
.typing i:nth-child(2) { animation-delay: .15s; }
.typing i:nth-child(3) { animation-delay: .3s; }
@keyframes hop { 0%, 60%, 100% { transform: none; opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }

.stamp { font-size: 11px; color: var(--text-3); padding: 0 6px; }
.has-bg .stamp { color: var(--text-2); }
.att { cursor: pointer; }
.file-chip { display: inline-flex; align-items: center; gap: 6px; background: var(--card); border-radius: 12px; padding: 8px 12px; font-size: 13px; color: var(--text-2); box-shadow: var(--shadow-soft); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 输入面板 */
.composer {
  background: rgba(253, 251, 247, .97);
  border-radius: 30px 30px 0 0;
  box-shadow: 0 -6px 30px rgba(120, 90, 60, .08);
  padding: 14px 14px calc(var(--safe-bottom) + 14px);
}
.row { display: flex; align-items: flex-end; gap: 4px; max-width: 760px; margin: 0 auto; }
.tool { flex: none; width: 40px; height: 44px; border: 0; background: none; color: var(--text-3); display: grid; place-items: center; }
.tool:active { color: var(--ink); }
textarea {
  flex: 1;
  border: 0;
  outline: none;
  resize: none;
  background: none;
  padding: 10px 6px;
  line-height: 1.5;
  max-height: 140px;
  color: var(--text);
}
textarea::placeholder { color: #a99d91; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.send {
  flex: none;
  width: 44px; height: 44px;
  border-radius: 50%;
  border: 0;
  display: grid; place-items: center;
  background: var(--bg-deep);
  color: #fffdf8;
  transition: background .2s;
}
.send.on { background: var(--ink); }

.pending-atts { display: flex; gap: 8px; overflow-x: auto; max-width: 760px; margin: 0 auto 10px; padding: 2px; }
.patt { position: relative; flex: none; }
.patt :deep(.thumb) { width: 64px; height: 64px; }
.patt :deep(.thumb img) { width: 64px; height: 64px; object-fit: cover; }
.patt .x { position: absolute; top: -6px; right: -6px; width: 22px; height: 22px; border-radius: 50%; border: 0; background: var(--ink); color: #fff; display: grid; place-items: center; padding: 0; }

/* 弹出面板 */
.grid-actions { display: flex; justify-content: space-around; padding: 6px 0 4px; }
.grid-actions button { display: flex; flex-direction: column; align-items: center; gap: 6px; border: 0; background: none; font-size: 13px; color: var(--text-2); }
.grid-actions button:disabled { opacity: .4; }
.grid-actions span { display: grid; place-items: center; width: 58px; height: 58px; border-radius: 20px; background: var(--bg-deep); color: var(--ink); }

.list-card.flat { box-shadow: none; border: 1px solid var(--line); }
.thread { cursor: pointer; }
.thread.cur { background: var(--card-2); }
.thread.cur .grow { font-weight: 600; }
.thread.cur .sub { font-weight: 400; }
.t-time { font-size: 12px; color: var(--text-3); }
.mini-btn { border: 0; background: none; color: var(--text-3); width: 30px; height: 30px; display: grid; place-items: center; padding: 0; }
.new-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; margin-top: 10px; }
.api-select { border: 1px solid var(--line); background: var(--card); border-radius: 10px; padding: 6px 8px; max-width: 46%; font-size: 14px; }
.edit-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }
</style>
