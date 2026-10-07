<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, roleById, threadsOf, createThread, deleteThread, loadMessages, messageCache, saveMessages, apiFor, modelFor, BUBBLE_COLORS, fmtTokens } from "../store/index.js";
import { generating, generate, sendMessage, HUG_TEXT, regenerate, editAndResend, deleteMessage, deleteAllVersions, selectVersion, pathOf, splitBubbles, fileToAttachment } from "../lib/chat.js";
import { hasXinchao, dashToken, refreshMind, snapOf } from "../lib/xinchao.js";
import { faceGrid } from "../lib/pixel.js";
import PixelArt from "../components/PixelArt.vue";
import { versionsOf } from "../lib/tree.js";
import { saveImage, deleteImage, pickFile, pickAndCrop, useImage } from "../lib/images.js";
import { stamp, shortTime } from "../lib/time.js";
import { toast } from "../lib/toast.js";
import { goBack } from "../lib/nav.js";
import Avatar from "../components/Avatar.vue";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";
import UsageSheet from "../components/UsageSheet.vue";
import ImgThumb from "../components/ImgThumb.vue";
import ColorSwatches from "../components/ColorSwatches.vue";
import BigTextarea from "../components/BigTextarea.vue";
import { openEditor } from "../lib/editor.js";
import { runCalendarOp, opButton } from "../lib/calendarTags.js";

const route = useRoute();
const router = useRouter();
const role = computed(() => roleById(route.params.roleId));

// ---------- 当前对话 ----------
const threadId = ref(null);
const thread = computed(() => store.threads.find(t => t.id === threadId.value));
// 这个对话的所有消息（包括其他版本），以及当前显示的这一条路径
const allMessages = computed(() => messageCache[threadId.value] || []);
const messages = computed(() => (thread.value ? pathOf(thread.value, allMessages.value) : []));

// 同一位置有几个版本
function vers(m) {
  return versionsOf(allMessages.value, m);
}
function switchVersion(m, step) {
  const { list, index } = vers(m);
  const next = list[index + step];
  if (next && !busy.value) selectVersion(thread.value, next);
}
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
  refreshMood();
});

// ---------- 消息分组：同一个人 5 分钟内连续的消息算一组 ----------
// TA 一边说话一边用工具：提示条（带 at）插在说到一半的地方，前后的话都留着
const items = computed(() => {
  const out = [];
  let group = null;
  const event = (m, n, i) => { out.push({ type: "event", m: n, key: `${m.id}:${i}` }); group = null; };
  const add = m => {
    if (group && group.from === m.from && m.ts - group.lastTs < 5 * 60_000) {
      group.msgs.push(m);
      group.lastTs = m.ts;
    } else {
      group = { type: "group", from: m.from, msgs: [m], lastTs: m.ts, key: m._key || m.id };
      out.push(group);
    }
  };
  for (const m of messages.value) {
    const all = (m.notes || []).map((n, i) => [n, i]);
    const mid = m.from === "ai" && !m.error ? all.filter(([n]) => n.before && n.at > 0) : [];
    all.filter(([n]) => n.before && !mid.some(([x]) => x === n)).forEach(([n, i]) => event(m, n, i));
    if (!mid.length) add(m);
    else {
      const text = m.text || "";
      let from = 0;
      mid.forEach(([n, i], k) => {
        const at = Math.min(n.at, text.length);
        const part = text.slice(from, at);
        if (part.trim()) add({ ...m, text: part, pending: false, _src: m, _key: `${m.id}~${k}`, _first: from === 0 });
        event(m, n, i);
        from = at;
      });
      add({ ...m, text: text.slice(from), _src: m, _key: `${m.id}~end`, _last: true, _first: from === 0 });
    }
    all.filter(([n]) => !n.before).forEach(([n, i]) => event(m, n, i));
  }
  return out;
});
const src = m => m._src || m;

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

// 字多的时候出现「展开」按钮
const draftLong = computed(() => draft.value.length > 40 || draft.value.includes("\n"));
async function expandDraft() {
  const t = await openEditor(draft.value, { title: `写给 ${role.value.name}`, placeholder: "What do you want to share?" });
  if (t !== null) {
    draft.value = t;
    nextTick(autoGrow);
  }
}

function onKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !coarse) {
    e.preventDefault();
    send(false);
  }
}

async function send(reply = true) {
  if (busy.value) return;
  const text = draft.value.trim();
  if (!text && !attachments.value.length) return;
  const atts = attachments.value;
  draft.value = "";
  attachments.value = [];
  nextTick(autoGrow);
  scrollToBottom(true);
  await sendMessage(thread.value, text, atts, { reply });
}
// 抱抱 TA：发一个小拥抱，TA 马上回应（接了心潮的话，心潮也会知道）
async function hug() {
  plusOpen.value = false;
  if (busy.value) return;
  scrollToBottom(true);
  await sendMessage(thread.value, HUG_TEXT, [], { hug: true, reply: !!currentApi.value });
}
// 最后一条是自己的、TA 还没回：可以让 TA 回复
const needReply = computed(() => {
  if (busy.value || !currentApi.value) return false;
  const last = messages.value[messages.value.length - 1];
  return !!last && last.from === "user";
});
// 让 TA 回复：输入框里有字就先发出去
async function askReply() {
  if (busy.value) return;
  if (draft.value.trim() || attachments.value.length) return send(true);
  if (!needReply.value) return;
  scrollToBottom(true);
  await generate(thread.value);
}

// 心潮：名字旁边显示 TA 此刻的心情小脸
const mind = computed(() => snapOf(role.value));
const moodFace = computed(() => {
  const s = mind.value;
  if (!s) return null;
  const asleep = /sleep|asleep|dream|睡/i.test(s.runtime?.consciousness || "");
  return { grid: faceGrid(asleep ? "睡着" : s.emotion?.shown || s.emotion?.label, s.emotion?.valence), word: asleep ? "睡着了" : s.emotion?.shown || s.emotion?.label };
});
function refreshMood() {
  if (role.value && hasXinchao(role.value) && dashToken(role.value)) refreshMind(role.value);
}
watch(() => messages.value.length, () => setTimeout(refreshMood, 4000));

// 多张图片：缩成一格，点开看全部
const imgsOf = m => (m.attachments || []).filter(a => a.kind === "image");
const filesOf = m => (m.attachments || []).filter(a => a.kind !== "image");
const gallery = ref(null);

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
  threadsOpen.value = false;
  const id = await pickAndCrop({ aspect: innerWidth / innerHeight, title: "调整背景", maxSize: 1800 });
  if (!id) return;
  const old = thread.value.bg;
  thread.value.bg = id;
  if (old) deleteImage(old);
}
function clearBg() {
  deleteImage(thread.value.bg);
  thread.value.bg = null;
}
const currentApi = computed(() => apiFor(thread.value, role.value));
const currentModel = computed(() => modelFor(thread.value, role.value));

// ---------- 模型切换（只列出每个 API 的默认模型 + 星标模型） ----------
const modelOpen = ref(false);
const modelGroups = computed(() =>
  store.apis.map(a => ({ api: a, models: [...new Set([a.model, ...(a.favModels || [])].filter(Boolean))] })),
);
function pickModel(api, model) {
  modelOpen.value = false;
  if (!api) { thread.value.apiId = null; thread.value.model = null; return; }
  thread.value.apiId = api.id;
  thread.value.model = model;
}
const isPicked = (api, m) => currentApi.value?.id === api.id && currentModel.value === m;

// 对方气泡：颜色深的话文字用白色
const theirBubble = computed(() => {
  const c = role.value?.bubbleColor || BUBBLE_COLORS[0];
  const hex = c.replace("#", "");
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return { "--their": c, "--their-text": lum < 0.55 ? "#ffffff" : "var(--text)" };
});

const openSources = reactive({});
const openThink = reactive({});

// 超出整理次数的日历操作：你点了才执行
function confirmCal(ev) {
  ev.text = runCalendarOp(role.value, ev.calAction) + "（你帮 TA 记的）";
  ev.calAction.done = true;
  saveMessages(thread.value.id);
}

// ---------- 上下文 / 累计用量 ----------
const ctxOpen = ref(false);
const ctxInfo = computed(() => {
  const last = [...messages.value].reverse().find(m => m.from === "ai" && !m.error && (m.ctx || m.usage?.input));
  if (!last) return null;
  const ctx = last.ctx || last.usage.input;
  const limit = Number(currentApi.value?.contextLimit) || 200000;
  const pct = Math.min(100, Math.round((ctx / limit) * 100));
  return { ctx, limit, pct, level: pct >= 85 ? "high" : pct >= 60 ? "mid" : "" };
});
const shownCount = computed(() => Math.min(messages.value.filter(m => m.from !== "event").length, Number(store.settings.historyLimit) || 80));

// 一组 AI 消息用了多少 tokens
function tokensOf(group) {
  if (group.from !== "ai") return "";
  let i = 0, o = 0, c = 0;
  for (const m of group.msgs) if (!m._src || m._last) { i += m.usage?.input || 0; o += m.usage?.output || 0; c += m.usage?.cached || 0; }
  return i || o ? `输入 ${fmtTokens(i)}${c ? `（缓存 ${fmtTokens(c)}）` : ""} · 输出 ${fmtTokens(o)} tokens` : "";
}

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
  await regenerate(thread.value, m.id);
}
async function removeAll() {
  const m = actionMsg.value;
  actionMsg.value = null;
  const n = vers(m).list.length;
  if (!confirm(`删除这里的全部 ${n} 个版本（以及它们后面的对话）？`)) return;
  await deleteAllVersions(thread.value, m.id);
}
async function removeMsg() {
  const m = actionMsg.value;
  actionMsg.value = null;
  if (!confirm(vers(m).list.length > 1 ? "删除这个版本（以及它后面的对话）？其他版本会保留。" : "删除这条消息（以及它后面的对话）？")) return;
  await deleteMessage(thread.value, m.id);
}

const smallWorld = () => router.push(`/room/${role.value.id}`);
const back = () => goBack(router, "/chats");
</script>

<template>
  <div v-if="role" class="chat" :class="{ 'has-bg': bgUrl }" :style="theirBubble">
    <div class="bg" :style="bgUrl ? { backgroundImage: `url(${bgUrl})` } : {}" />

    <header class="top">
      <button class="icon-btn" aria-label="返回" @click="back"><Icon name="back" /></button>
      <div class="who">
        <div class="name">{{ role.name }}<span v-if="moodFace" class="mood" :title="moodFace.word"><PixelArt :grid="moodFace.grid" :size="20" /></span></div>
        <div v-if="role.signature" class="sig">{{ role.signature }}</div>
      </div>
      <button class="icon-btn" aria-label="小世界" @click="smallWorld"><Icon name="house" /></button>
    </header>

    <main ref="scroller" class="scroll">
      <div class="inner">
        <div v-if="!messages.length" class="hello">
          <Avatar :img="role.avatar" :name="role.name" :color="role.color" :size="64" />
          <p>和 {{ role.name }} 说点什么吧</p>
          <p v-if="!currentApi" class="warn">还没有 API，先去「设置 → API」添加一个</p>
        </div>

        <template v-for="it in items" :key="it.key">
          <div v-if="it.type === 'event'" class="event">
            <span :class="{ link: it.m.sources?.length || it.m.detail }" @click="(it.m.sources?.length || it.m.detail) && (openSources[it.key] = !openSources[it.key])">
              {{ it.m.text }}<template v-if="it.m.sources?.length || it.m.detail"> {{ openSources[it.key] ? "▴" : "▾" }}</template>
            </span>
            <button v-if="it.m.calAction && !it.m.calAction.done" class="cal-btn" @click="confirmCal(it.m)">{{ opButton(it.m.calAction) }}</button>
            <pre v-if="openSources[it.key] && it.m.detail" class="detail">{{ it.m.detail }}</pre>
            <div v-if="openSources[it.key] && it.m.sources?.length" class="sources">
              <a v-for="s in it.m.sources" :key="s.url" :href="s.url" target="_blank" rel="noopener">{{ s.title || s.url }}</a>
            </div>
          </div>

          <div v-else class="group" :class="it.from === 'user' ? 'mine' : 'theirs'">
            <div class="ava">
              <Avatar v-if="it.from === 'user'" :img="role.me?.avatar || store.profile.avatar" :name="role.me?.name || store.profile.name" :color="store.profile.color" :size="42" />
              <Avatar v-else :img="role.avatar" :name="role.name" :color="role.color" :size="42" />
            </div>
            <div class="col">
              <template v-for="m in it.msgs" :key="m._key || m.id">
                <template v-if="m.from === 'user'">
                  <div v-if="imgsOf(m).length > 1" class="img-grid" :class="'n' + Math.min(4, imgsOf(m).length)" @click="gallery = m">
                    <div v-for="(a, i) in imgsOf(m).slice(0, 4)" :key="i" class="cell">
                      <ImgThumb :id="a.img" />
                      <span v-if="i === 3 && imgsOf(m).length > 4" class="more">+{{ imgsOf(m).length - 4 }}</span>
                    </div>
                  </div>
                  <div v-else-if="imgsOf(m).length" class="att" @click="openActions(m)"><ImgThumb :id="imgsOf(m)[0].img" /></div>
                  <div v-for="(a, i) in filesOf(m)" :key="'f' + i" class="att" @click="openActions(m)">
                    <div class="file-chip"><Icon name="file" :size="18" />{{ a.name }}</div>
                  </div>
                  <div v-if="m.hug" class="bubble hug" @click="openActions(m)"><Icon name="heart" :size="16" />抱了抱 {{ role.name }}</div>
                  <div v-else-if="m.text" class="bubble" @click="openActions(m)">{{ m.text }}</div>
                  <div v-if="vers(m).list.length > 1" class="ver">
                    <button :disabled="vers(m).index === 0" aria-label="上一个版本" @click="switchVersion(m, -1)">‹</button>
                    {{ vers(m).index + 1 }} / {{ vers(m).list.length }}
                    <button :disabled="vers(m).index === vers(m).list.length - 1" aria-label="下一个版本" @click="switchVersion(m, 1)">›</button>
                  </div>
                </template>
                <template v-else>
                  <div v-if="m.thinking && (!m._src || m._first)" class="think" @click="openThink[m.id] = !openThink[m.id]">
                    <Icon name="bulb" :size="14" />
                    {{ m.pending && !splitBubbles(m.text).length ? "思考中…" : "思考过程" }}
                    <span class="arrow">{{ openThink[m.id] ? "▴" : "▾" }}</span>
                  </div>
                  <div v-if="m.thinking && openThink[m.id] && (!m._src || m._first)" class="think-body">{{ m.thinking.trim() }}</div>
                  <div v-if="m.error" class="bubble error" @click="openActions(m)">{{ m.text }}</div>
                  <div v-else-if="m.pending && !splitBubbles(m.text).length" class="bubble typing"><i /><i /><i /></div>
                  <div v-for="(b, i) in splitBubbles(m.text)" v-else :key="i" class="bubble" @click="openActions(src(m))">{{ b }}</div>
                  <div v-if="(!m._src || m._last) && vers(src(m)).list.length > 1" class="ver">
                    <button :disabled="vers(src(m)).index === 0" aria-label="上一个版本" @click="switchVersion(src(m), -1)">‹</button>
                    {{ vers(src(m)).index + 1 }} / {{ vers(src(m)).list.length }}
                    <button :disabled="vers(src(m)).index === vers(src(m)).list.length - 1" aria-label="下一个版本" @click="switchVersion(src(m), 1)">›</button>
                  </div>
                </template>
              </template>
              <div class="stamp">{{ stamp(it.lastTs) }}<template v-if="tokensOf(it)"> · {{ tokensOf(it) }}</template></div>
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
      <div class="pill-row">
        <button class="model-pill" @click="modelOpen = true">{{ currentModel || "选择模型" }}</button>
        <button v-if="ctxInfo" class="ctx" :class="ctxInfo.level" @click="ctxOpen = true">
          <span>{{ fmtTokens(ctxInfo.ctx) }} / {{ fmtTokens(ctxInfo.limit) }}</span>
          <i class="bar"><b :style="{ width: ctxInfo.pct + '%' }" /></i>
        </button>
        <button v-if="draftLong" class="expand-btn" aria-label="展开编辑" @click="expandDraft"><Icon name="expand" :size="15" /> 展开</button>
      </div>
      <div class="row">
        <button class="tool" aria-label="添加图片或文件" @click="plusOpen = true"><Icon name="plus" :size="26" /></button>
        <button class="tool" aria-label="切换对话" @click="threadsOpen = true"><Icon name="threads" :size="22" /></button>
        <textarea ref="inputEl" v-model="draft" rows="1" placeholder="What do you want to share?"
          :enterkeyhint="coarse ? 'enter' : 'send'" @input="autoGrow" @keydown="onKeydown" />
        <div class="sends">
          <button class="send small" :class="{ on: draft.trim() || attachments.length }" aria-label="发送" @click="send(false)"><Icon name="send" :size="20" /></button>
          <button v-if="busy" class="send reply on" aria-label="停止" @click="stop"><Icon name="stop" :size="20" /></button>
          <button v-else class="send reply" :class="{ on: needReply || draft.trim() || attachments.length }" :aria-label="`让 ${role.name} 回复`" @click="askReply"><Icon name="chat" :size="20" /></button>
        </div>
      </div>
    </footer>

    <!-- ＋ -->
    <Sheet :open="plusOpen" @close="plusOpen = false">
      <div class="grid-actions">
        <button @click="addImages"><span><Icon name="image" :size="26" /></span>图片</button>
        <button @click="addFiles"><span><Icon name="file" :size="26" /></span>文件</button>
        <button :disabled="busy" @click="hug"><span class="hug-ic"><Icon name="heart" :size="26" /></span>抱抱 TA</button>
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
      </div>

      <div class="section-label">{{ role.name }} 的气泡颜色</div>
      <div class="list-card flat bubble-pick">
        <ColorSwatches v-model="role.bubbleColor" :colors="BUBBLE_COLORS" />
      </div>
    </Sheet>

    <!-- 上下文 -->
    <UsageSheet :open="ctxOpen" :all="allMessages" :path="messages" :limit="ctxInfo?.limit || 200000" :shown-count="shownCount" @close="ctxOpen = false">
      对话不会「用满」：超过 {{ store.settings.historyLimit }} 条后，更早的消息 TA 就不再看到（记忆卡片里的事 TA 一直记得）。想让 TA 记得更久、或者想省一点，可以在「设置 → 聊天」里改这个数字；模型的上限在「设置 → API」里改。
    </UsageSheet>

    <!-- 模型切换 -->
    <Sheet :open="modelOpen" title="切换模型" @close="modelOpen = false">
      <div class="list-card flat">
        <button class="list-row" :class="{ cur: !thread?.apiId }" @click="pickModel(null)">
          <span class="grow">跟随默认<span class="sub">角色设置或全局默认的 API</span></span>
          <Icon v-if="!thread?.apiId" name="check" :size="18" />
        </button>
      </div>
      <template v-for="g in modelGroups" :key="g.api.id">
        <div class="section-label">{{ g.api.name }}</div>
        <div class="list-card flat">
          <button v-for="m in g.models" :key="m" class="list-row" :class="{ cur: thread?.apiId && isPicked(g.api, m) }" @click="pickModel(g.api, m)">
            <span class="grow">{{ m }}</span>
            <Icon v-if="thread?.apiId && isPicked(g.api, m)" name="check" :size="18" />
          </button>
        </div>
      </template>
      <p v-if="!store.apis.length" class="empty-hint">还没有 API，先去「设置 → API」添加</p>
      <p v-else class="tip">在「设置 → API」里给模型点星标，就会出现在这里</p>
    </Sheet>

    <!-- 消息操作 -->
    <Sheet :open="!!actionMsg" @close="actionMsg = null">
      <div v-if="actionMsg" class="grid-actions">
        <button v-if="!actionMsg.error" @click="copyMsg"><span><Icon name="copy" :size="24" /></span>复制</button>
        <button v-if="!actionMsg.error" @click="startEdit"><span><Icon name="edit" :size="24" /></span>修改</button>
        <button v-if="actionMsg.from === 'ai'" :disabled="busy" @click="regen"><span><Icon name="refresh" :size="24" /></span>重新生成</button>
        <button @click="removeMsg"><span><Icon name="trash" :size="24" /></span>{{ vers(actionMsg).list.length > 1 ? "删除这个版本" : "删除" }}</button>
        <button v-if="vers(actionMsg).list.length > 1" @click="removeAll"><span><Icon name="trash" :size="24" /></span>删除全部 {{ vers(actionMsg).list.length }} 个</button>
      </div>
    </Sheet>

    <!-- 一组图片 -->
    <Sheet :open="!!gallery" :title="gallery ? `${imgsOf(gallery).length} 张图片` : ''" @close="gallery = null">
      <div v-if="gallery" class="gallery">
        <ImgThumb v-for="(a, i) in imgsOf(gallery)" :key="i" :id="a.img" />
      </div>
      <div v-if="gallery" class="edit-actions"><button class="btn soft" @click="openActions(gallery); gallery = null">更多操作</button></div>
    </Sheet>

    <!-- 修改 -->
    <Sheet :open="!!editing" title="修改消息" @close="editing = null">
      <template v-if="editing">
        <BigTextarea v-model="editing.text" rows="7" title="修改消息" />
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
  background: var(--bg);
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
.who { flex: 1; text-align: center; min-width: 0; }
.name { font-size: 1.13rem; font-weight: 700; letter-spacing: 1px; }
.has-bg .name, .has-bg .sig { text-shadow: 0 0 10px rgba(255, 255, 255, .9), 0 0 2px rgba(255, 255, 255, .8); }
.sig { font-size: 0.833rem; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 消息区 */
.scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.inner { max-width: 760px; margin: 0 auto; padding: 12px 14px 24px; display: flex; flex-direction: column; gap: 18px; }

.hello { text-align: center; color: var(--text-2); margin-top: 18vh; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.hello p { margin: 8px 0 0; }
.warn { color: var(--danger); font-size: 0.867rem; }

.event { text-align: center; }
.event span.link { cursor: pointer; }
.ver { display: inline-flex; align-items: center; gap: 2px; font-size: 0.8rem; color: var(--text-2); background: rgba(255, 255, 255, .85); border-radius: 999px; padding: 0 2px; box-shadow: 0 1px 3px rgba(40, 40, 60, .08); }
.ver button { border: 0; background: none; color: var(--ink); font-size: 1.4rem; font-weight: 600; line-height: 1; min-width: 44px; height: 38px; padding: 0 0 3px; }
.ver button:disabled { opacity: .2; }
.cal-btn { display: block; margin: 4px auto 0; border: 0; background: var(--ink); color: #fff; border-radius: 999px; padding: 3px 12px; font-size: 0.73rem; }
.detail { text-align: left; white-space: pre-wrap; word-break: break-all; font-size: 0.72rem; line-height: 1.6; color: var(--text-2); background: rgba(255, 255, 255, .85); border-radius: 12px; padding: 8px 10px; margin: 6px auto 0; max-width: 92%; max-height: 40vh; overflow-y: auto; font-family: ui-monospace, Menlo, monospace; }
.sources { display: flex; flex-direction: column; gap: 4px; align-items: center; margin-top: 6px; }
.sources a { font-size: 0.75rem; color: var(--accent); background: rgba(255, 255, 255, .8); padding: 2px 10px; border-radius: 999px; max-width: 90%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: none; }
.think {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  font-size: 0.73rem;
  color: var(--text-2);
  background: rgba(255, 255, 255, .78);
  padding: 3px 10px;
  border-radius: 999px;
  cursor: pointer;
}
.think .arrow { font-size: 0.7rem; }
.think-body {
  max-width: 100%;
  font-size: 0.78rem;
  line-height: 1.7;
  color: var(--text-2);
  background: rgba(255, 255, 255, .72);
  border-left: 3px solid var(--line);
  border-radius: 6px 14px 14px 6px;
  padding: 8px 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 45vh;
  overflow-y: auto;
}
.ctx { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; padding: 2px 4px; font-size: 0.7rem; color: var(--text-3); }
.bar { display: inline-block; width: 44px; height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; }
.bar b { display: block; height: 100%; background: #9cc5a1; border-radius: 2px; }
.ctx.mid .bar b, .bar.mid b { background: #f0c36a; }
.ctx.high .bar b, .bar.high b { background: var(--danger); }
.ctx.high { color: var(--danger); }
.expand-btn { margin-left: auto; border: 0; background: var(--bg); color: var(--text-2); border-radius: 999px; padding: 2px 10px; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 3px; }
/* 细细的一条；换行后每一行各自是一条两端圆角的细条 */
.event { padding: 0 6%; line-height: 2.1; overflow-wrap: anywhere; min-width: 0; }
.event span {
  font-size: 0.73rem;
  color: var(--text-2);
  background: rgba(255, 255, 255, .75);
  padding: 2px 10px;
  border-radius: 999px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}

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
  font-size: 1rem;
  cursor: pointer;
  user-select: text;
}
.theirs .bubble { background: var(--their); color: var(--their-text); border-top-left-radius: 8px; }
.mine .bubble { background: #fff; border-top-right-radius: 8px; box-shadow: 0 1px 3px rgba(40, 40, 60, .06); }
.theirs .bubble.error { background: #fdecee; color: var(--danger); font-size: 0.9rem; }

.typing { display: flex; gap: 5px; padding: 15px 16px; }
.typing i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); animation: hop 1.2s infinite; }
.typing i:nth-child(2) { animation-delay: .15s; }
.typing i:nth-child(3) { animation-delay: .3s; }
@keyframes hop { 0%, 60%, 100% { transform: none; opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }

.stamp { font-size: 0.68rem; color: var(--text-3); padding: 0 6px; }
.has-bg .stamp { color: var(--text-2); }
.att { cursor: pointer; }
.mood { display: inline-block; vertical-align: -3px; margin-left: 6px; }
.img-grid { display: grid; grid-template-columns: repeat(2, 84px); gap: 4px; border-radius: 16px; overflow: hidden; cursor: pointer; }
.img-grid.n2 { grid-template-columns: repeat(2, 96px); }
.img-grid .cell { position: relative; width: 100%; aspect-ratio: 1; overflow: hidden; background: var(--bg-deep); }
.img-grid .cell :deep(.thumb) { width: 100%; height: 100%; border-radius: 0; box-shadow: none; pointer-events: none; }
.img-grid .cell :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.img-grid .more { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, .38); color: #fff; font-weight: 700; font-size: 1.1rem; }
.gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.gallery :deep(.thumb) { width: 100%; max-width: none; }
.sends { flex: none; display: flex; gap: 6px; align-items: flex-end; }
.send.small { width: 40px; height: 40px; }
.send.reply { width: 40px; height: 40px; }
.send.small.on { background: #9aa0ad; }
.send.reply.on { background: var(--ink); }
.file-chip { display: inline-flex; align-items: center; gap: 6px; background: var(--card); border-radius: 12px; padding: 8px 12px; font-size: 0.867rem; color: var(--text-2); box-shadow: var(--shadow-soft); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 输入面板 */
.composer {
  background: rgba(255, 255, 255, .97);
  border-radius: 30px 30px 0 0;
  box-shadow: 0 -6px 30px rgba(40, 40, 60, .08);
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
textarea::placeholder { color: var(--text-3); font-weight: 400; font-size: 0.93rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.send {
  flex: none;
  width: 44px; height: 44px;
  border-radius: 50%;
  border: 0;
  display: grid; place-items: center;
  background: var(--bg-deep);
  color: #ffffff;
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
.grid-actions button { display: flex; flex-direction: column; align-items: center; gap: 6px; border: 0; background: none; font-size: 0.867rem; color: var(--text-2); }
.grid-actions button:disabled { opacity: .4; }
.grid-actions span.hug-ic { color: #d9789a; background: #fbe7ee; }
.bubble.hug { display: inline-flex; align-items: center; gap: 6px; background: #fbe7ee !important; color: #b4587a; }
.grid-actions span { display: grid; place-items: center; width: 58px; height: 58px; border-radius: 20px; background: var(--bg-deep); color: var(--ink); }

.list-card.flat { box-shadow: none; border: 1px solid var(--line); }
.thread { cursor: pointer; }
.thread.cur { background: var(--card-2); }
.thread.cur .grow { font-weight: 600; }
.thread.cur .sub { font-weight: 400; }
.t-time { font-size: 0.8rem; color: var(--text-3); }
.mini-btn { border: 0; background: none; color: var(--text-3); width: 30px; height: 30px; display: grid; place-items: center; padding: 0; }
.new-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; margin-top: 10px; }
.pill-row { max-width: 760px; margin: 0 auto 4px; padding: 0 8px; display: flex; align-items: center; gap: 8px; }
.model-pill {
  border: 0; border-radius: 999px; padding: 2px 10px;
  background: var(--blue); color: #4b74a8; font-size: 0.75rem;
  max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.list-row.cur { background: var(--card-2); font-weight: 600; }
.list-row.cur .sub, .t-time { font-weight: 400; }
.bubble-pick { padding: 12px; }
.tip { font-size: 0.8rem; color: var(--text-3); text-align: center; margin: 14px 0 0; }
.edit-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }
</style>
