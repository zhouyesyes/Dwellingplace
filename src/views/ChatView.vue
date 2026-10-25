<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, MAIN, solo, roleById, threadsOf, createThread, deleteThread, loadMessages, messageCache, saveMessages, apiFor, modelFor, BUBBLE_COLORS, fmtTokens } from "../store/index.js";
import { generating, following, generate, sendMessage, regenerate, editAndResend, deleteMessage, deleteAllVersions, selectVersion, pathOf, splitBubbles, isCodeBubble, fileToAttachment, summarizeThread, describeError, afterSummary } from "../lib/chat.js";
import { pokeText } from "../lib/poke.js";
import { tailFrom, chatTokens, fmtTok, snapshotSum } from "../lib/budget.js";
import PetDock from "../components/pet/PetDock.vue";
import { petOn } from "../lib/pet.js";
import SumVersions from "../components/memory/SumVersions.vue";
import { hasXinchao, dashToken, refreshMind, snapOf } from "../lib/xinchao.js";
import { faceGrid } from "../lib/pixel.js";
import PixelArt from "../components/PixelArt.vue";
import { versionsOf } from "../lib/tree.js";
import { saveImage, CHAT_IMAGE, deleteImage, pickFile, pickAndCrop, useImage } from "../lib/images.js";
import { stamp, shortTime } from "../lib/time.js";
import { toast } from "../lib/toast.js";
import { isFav, toggleFav } from "../lib/recall.js";
import { blockMd as parseBlockMd } from "../lib/inlineMd.js";
// 正文没变的历史气泡不随流式增量重复解析。
const markdownCache = new Map();
function blockMd(text) {
  if (markdownCache.has(text)) return markdownCache.get(text);
  const html = parseBlockMd(text);
  if (markdownCache.size >= 300) markdownCache.clear();
  markdownCache.set(text, html);
  return html;
}
import { onlySticker, stickerUrl, withStickers, stickersOf } from "../lib/stickers.js";
import { startRecording, voiceAttachment, speak, ttsReady } from "../lib/media.js";
import VoiceBubble from "../components/VoiceBubble.vue";
import { WHERE } from "../lib/crabBook.js";
import WorldDrawer from "../components/WorldDrawer.vue";
import SummaryInfo from "../components/memory/SummaryInfo.vue";
import SearchPanel from "../components/SearchPanel.vue";
import LinkCard from "../components/LinkCard.vue";
import AskCard from "../components/AskCard.vue";
import GardenRoomCard from "../components/GardenRoomCard.vue";
import { askAnswerText } from "../lib/ask.js";
import { cardOf, urlsIn, onlyUrl } from "../lib/linkcard.js";
import { goBack } from "../lib/nav.js";
import Avatar from "../components/Avatar.vue";
import Icon from "../components/Icon.vue";
import HtmlBlock from "../components/HtmlBlock.vue";
import Sheet from "../components/Sheet.vue";
import UsageSheet from "../components/UsageSheet.vue";
import ImgThumb from "../components/ImgThumb.vue";
import ImageViewer from "../components/ImageViewer.vue";
import ColorSwatches from "../components/ColorSwatches.vue";
import BigTextarea from "../components/BigTextarea.vue";
import { openEditor } from "../lib/editor.js";
import { runCalendarOp, opButton } from "../lib/calendarTags.js";
import { wakeStatus } from "../lib/wake.js";

const route = useRoute();
const router = useRouter();
const role = computed(() => roleById(route.params.roleId));
// 他正被叫醒、在中转那边行动（比如花园说游戏轮到他了）
const wakeBusy = computed(() => role.value && wakeStatus.busy?.[role.value.id]);

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
// 桌宠现在在干什么：还没开口在想；在用工具；回复短的两条敲、长的四条敲；最后一条出错了就着急
const petWork = computed(() => {
  const last = messages.value[messages.value.length - 1];
  if (busy.value) {
    const m = last?.from === "ai" && last.pending ? last : null;
    if (m?.waiting) return null; // 续发前真的在停：不敲键盘
    if (m?.notes?.some(n => n.before && /…$/.test(n.text || ""))) return "tool";
    if (!m || !m.text) return "think";
    return m.text.length > 500 ? "type4" : "type2";
  }
  return last?.from === "ai" && last.error ? "error" : null;
});
const bgUrl = useImage(() => thread.value?.bg);

async function openThread(id) {
  threadId.value = id;
  role.value.lastThreadId = id;
  showCount.value = PAGE;
  await loadMessages(id);
  await nextTick();
  scrollToBottom(true);
  settleAtBottom();
}

onMounted(async () => {
  if (!role.value) return router.replace("/");
  const list = threadsOf(role.value.id);
  const pick =
    store.threads.find(t => t.id === route.params.threadId && t.roleId === role.value.id && !t.mail) || // 工作室不在列表里，但能直接打开
    list.find(t => t.id === role.value.lastThreadId) ||
    list[0] ||
    createThread(role.value.id);
  await openThread(pick.id);
  refreshMood();
});

// ---------- 消息分组：同一个人 5 分钟内连续的消息算一组 ----------
// 他一边说话一边用工具：提示条（带 at）插在说到一半的地方，前后的话都留着
// at 是流式时记下的位置；后面标记被去掉、文字变短，位置会偏。只在段落边界上切，不切进 [网址卡片:…] 这类方括号指令里面
function safeCut(text, at) {
  at = Math.max(0, Math.min(at, text.length));
  const bounds = [0, text.length];
  for (const m of text.matchAll(/\n[ \t]*\n\s*/g)) bounds.push(m.index, m.index + m[0].length);
  const near = bounds.reduce((a, b) => (Math.abs(b - at) < Math.abs(a - at) ? b : a));
  const line = text.lastIndexOf("\n", near - 1) + 1;
  const open = text.lastIndexOf("[", near - 1);
  // 落在 [ … ] 中间（括号里没有换行）：退到这一行的开头
  if (open >= line && open < near && text.indexOf("]", open) >= near) return line;
  return near;
}
const items = computed(() => {
  const out = [];
  let group = null;
  const event = (m, n, i) => { out.push({ type: "event", m: n, key: `${m.id}:${i}` }); group = null; };
  const add = m => {
    if (group && group.from === m.from && (group.where || "") === (m.where || "") && m.ts - group.lastTs < 5 * 60_000) {
      group.msgs.push(m);
      group.lastTs = m.ts;
    } else {
      group = { type: "group", from: m.from, where: m.where, msgs: [m], lastTs: m.ts, key: m._key || m.id }; // where：小螃蟹从别处（Claude Code、云端）来的消息
      out.push(group);
    }
  };
  for (const m of messages.value) {
    if (m.poke) { event(m, m, "poke"); continue; }
    const all = (m.notes || []).map((n, i) => [n, i]);
    const mid = m.from === "ai" && !m.error ? all.filter(([n]) => n.before && n.at > 0) : [];
    all.filter(([n]) => n.before && !mid.some(([x]) => x === n)).forEach(([n, i]) => event(m, n, i));
    if (!mid.length) { if (m.from !== "ai" || m.pending || splitBubbles(m.text || "").length || m.attachments?.length) add(m); }
    else {
      const text = m.text || "";
      let from = 0;
      mid.forEach(([n, i], k) => {
        const at = Math.max(from, safeCut(text, n.at));
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
// 一次只画最近的一段：聊得久了上千条全画出来，第一次打开要好几秒，老消息里的图片后到还会把画面往上顶
// 往上滑到顶附近再多画一段（画面停在原处不跳）
const PAGE = 40;
const showCount = ref(PAGE);
// 跳到很早的一条（搜索、点引用）：只画那一条前后的一段（win = { start, end }），往上往下滑再接着画；滑到底就回到平常
const win = ref(null);
const hiddenCount = computed(() => (win.value ? win.value.start : Math.max(0, items.value.length - showCount.value)));
const shownItems = computed(() => (win.value ? items.value.slice(win.value.start, win.value.end) : hiddenCount.value ? items.value.slice(hiddenCount.value) : items.value));
let growing = false;
function showMore() {
  const el = scroller.value;
  if (!el || growing || !hiddenCount.value) return;
  growing = true;
  settleStop?.(); // 她在往上翻：别再把她拽回底下
  const fromBottom = el.scrollHeight - el.scrollTop;
  if (win.value) win.value = { ...win.value, start: Math.max(0, win.value.start - PAGE) };
  else showCount.value += PAGE;
  nextTick(() => { el.scrollTop = el.scrollHeight - fromBottom; growing = false; });
}
// 看着很早的那一段、往下滑到底：接着往下画一段；画到最新的了就回到平常
function showLater() {
  if (!win.value || growing) return;
  const end = win.value.end + PAGE;
  if (end >= items.value.length) { showCount.value = items.value.length - win.value.start; win.value = null; }
  else win.value = { ...win.value, end };
}
const onScroll = () => {
  const el = scroller.value;
  if (!el) return;
  if (el.scrollTop < 400) showMore();
  else if (win.value && el.scrollHeight - el.scrollTop - el.clientHeight < 400) showLater();
};
// 「回到最新」
function backToLatest() {
  win.value = null;
  showCount.value = PAGE;
  nextTick(() => scrollToBottom(true));
}

// ---------- 滚动 ----------
const scroller = ref(null);
// 输入框浮在最下面，聊天从它后面滑过去：量一下它多高，聊天底下留出这么多
const dock = ref(null);
const dockH = ref(120);
let dockRO = null;
onMounted(() => {
  dockRO = new ResizeObserver(() => {
    if (!dock.value) return;
    const stick = nearBottom();
    dockH.value = dock.value.offsetHeight;
    if (stick) nextTick(() => { if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight; });
  });
  if (dock.value) dockRO.observe(dock.value);
});
onBeforeUnmount(() => dockRO?.disconnect());
function nearBottom() {
  const el = scroller.value;
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 140;
}
function scrollToBottom(force = false) {
  if (force && win.value) { win.value = null; showCount.value = PAGE; } // 正看着很早的那一段：回到最新
  const el = scroller.value;
  if (el && (force || nearBottom())) el.scrollTop = el.scrollHeight;
}
// 刚打开时图片、表情、字体还在陆续加载，内容会一点点变高：一直贴着底，你一动手指就不管了（最多 10 秒）
// （第一次打开图片要从手机存储里慢慢读，以前只贴 2.5 秒，图片后到就把画面顶到上面去了）
let settleStop = null;
function settleAtBottom() {
  settleStop?.();
  const el = scroller.value;
  if (!el) return;
  const stick = () => { el.scrollTop = el.scrollHeight; };
  const ro = new ResizeObserver(stick);
  for (const c of el.children) ro.observe(c);
  const onImg = e => e.target.tagName === "IMG" && stick();
  el.addEventListener("load", onImg, true);
  const stop = () => {
    ro.disconnect();
    el.removeEventListener("load", onImg, true);
    ["touchstart", "wheel"].forEach(t => el.removeEventListener(t, stop));
    clearTimeout(timer);
    settleStop = null;
  };
  ["touchstart", "wheel"].forEach(t => el.addEventListener(t, stop, { passive: true }));
  const timer = setTimeout(stop, 10_000);
  settleStop = stop;
  requestAnimationFrame(stick);
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
  if (busy.value && !following[threadId.value]) return; // 他在续发的时候可以插话：续发就停下，先听你的
  const text = draft.value.trim();
  if (!text && !attachments.value.length) return;
  // 他正被叫醒、在行动：先只把话放过去，不另外叫他回（不然两边一起动，就重复了）
  if (reply && wakeBusy.value) {
    reply = false;
    toast(`${role.value.name} 正在行动，话先放在这儿；等他做完，需要的话再让他回你`, 4000);
  }
  const atts = attachments.value;
  const quote = quoting.value;
  draft.value = "";
  attachments.value = [];
  quoting.value = null;
  nextTick(autoGrow);
  scrollToBottom(true);
  await sendMessage(thread.value, text, atts, { reply, quote });
}
// 提问卡答完点「好了」：卡片记下选了什么（变淡、不能再点），答案作为她的一条消息发出去，他接着回
async function answerAsk(msg, { picks, others }) {
  if (msg.ask.done) return;
  const text = askAnswerText(msg.ask, picks, others);
  msg.ask.done = { picks, others };
  saveMessages(thread.value.id);
  scrollToBottom(true);
  await sendMessage(thread.value, text, [], { reply: !wakeBusy.value });
}
// 表情包：发出去就是一条 [表情:名字]
const stickerOpen = ref(false);
async function sendSticker(s) {
  stickerOpen.value = false;
  if (busy.value && !following[threadId.value]) return;
  scrollToBottom(true);
  await sendMessage(thread.value, `[表情:${s.name}]`, [], { reply: false });
}
// 最后一条是自己的、他还没回：可以让他回复
const needReply = computed(() => {
  if (busy.value || !currentApi.value) return false;
  const last = messages.value[messages.value.length - 1];
  return !!last && last.from === "user";
});
// 让他回复：输入框里有字就先发出去
async function askReply() {
  if (busy.value) return;
  if (draft.value.trim() || attachments.value.length) return send(true);
  if (!needReply.value) return;
  scrollToBottom(true);
  await generate(thread.value);
}

// 心潮：名字旁边显示他此刻的心情小脸
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
const filesOf = m => (m.attachments || []).filter(a => a.kind !== "image" && a.kind !== "audio");
const voicesOf = m => (m.attachments || []).filter(a => a.kind === "audio");
const VOICE_ONLY = /^\s*\[语音[:：]\s*([^\]\n]{1,500})\]\s*$/;
const voiceText = b => b.match(VOICE_ONLY)?.[1]?.trim() || "";

// ---------- 你的语音消息 ----------
const recording = ref(null); // { ctl, secs }
let recTimer = 0;
async function startRec() {
  if (recording.value || busy.value) return;
  try {
    const ctl = await startRecording();
    recording.value = { ctl, secs: 0 };
    recTimer = setInterval(() => { if (recording.value) recording.value.secs = Math.round((Date.now() - ctl.startedAt) / 1000); }, 300);
  } catch (e) {
    toast(/denied|NotAllowed/i.test(e?.name + e?.message) ? "没有麦克风权限：在系统设置里允许栖所（或浏览器）用麦克风" : (e?.message || String(e)), 4000);
  }
}
function cancelRec() {
  clearInterval(recTimer);
  recording.value?.ctl.cancel();
  recording.value = null;
}
async function sendRec() {
  const r = recording.value;
  if (!r) return;
  clearInterval(recTimer);
  recording.value = null;
  const res = await r.ctl.stop();
  if (res.dur < 1 || !res.blob.size) return toast("太短了");
  const att = await voiceAttachment(res);
  if (att.sttError) toast("语音发出去了，但没转成文字：" + att.sttError.slice(0, 60), 4000);
  scrollToBottom(true);
  await sendMessage(thread.value, "", [att], { reply: false });
}
// 朗读他的一条回复
async function readAloud() {
  const m = actionMsg.value;
  actionMsg.value = null;
  if (!ttsReady()) return toast("先在「设置 → 语音和画画」里设置他的声音", 3500);
  try {
    const a = new Audio(await speak(splitBubbles(m.text).map(b => voiceText(b) || b).join("\n")));
    await a.play();
  } catch (e) { toast((e?.message || String(e)).slice(0, 100), 4000); }
}
const gallery = ref(null); // { m, start }：全屏看图，左右滑
const viewImgs = (m, start = 0) => (gallery.value = { m, start });

function stop() {
  generating[threadId.value]?.abort();
}

// ---------- ＋ 附件 ----------
const plusOpen = ref(false);
async function addImages() {
  plusOpen.value = false;
  const files = await pickFile("image/*", true);
  for (const f of files) {
    try { attachments.value.push({ kind: "image", img: await saveImage(f, CHAT_IMAGE), name: f.name }); }
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
  // 换窗：这个对话的摘要记忆跟着走
  const t = createThread(role.value.id, thread.value);
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

// 气泡颜色：颜色深的话文字用白色
function bubbleVars(c, k) {
  const hex = c.replace("#", "");
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // 浅色的气泡在深色模式下混进卡片色（只留一点颜色），字跟着主题；深色的气泡照旧，配白字
  return lum < 0.55 ? { [`--${k}`]: c, [`--${k}-text`]: "#ffffff" } : { [`--${k}`]: `color-mix(in srgb, ${c} var(--pastel), var(--card))`, [`--${k}-text`]: "var(--text)" };
}
// 他的气泡 + 你自己的（没选过就是卡片色）
const bubbleColors = computed(() => ({
  ...bubbleVars(role.value?.bubbleColor || BUBBLE_COLORS[0], "their"),
  ...(store.profile.bubbleColor ? bubbleVars(store.profile.bubbleColor, "mine") : {}),
}));

const openSources = reactive({});
const openThink = reactive({});

// 超出整理次数的日历操作：你点了才执行
function confirmCal(ev) {
  ev.text = runCalendarOp(role.value, ev.calAction) + "（你帮他记的）";
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
// 上一次大约带了几条：摘要后面的，从后往前凑够「每次带多少原文」
const shownCount = computed(() => {
  const rest = afterSummary(thread.value, messages.value.filter(m => m.from !== "event" && !m.pending && !m.error));
  return rest.length - tailFrom(rest, chatTokens());
});

// 一组 AI 消息用了多少 tokens
function tokensOf(group) {
  if (group.from !== "ai") return "";
  let i = 0, o = 0, c = 0, r = 0, f = 0;
  for (const m of group.msgs) if (!m._src || m._last) { i += m.usage?.input || 0; o += m.usage?.output || 0; c += m.usage?.cached || 0; r += m.rounds || 0; f += m.sends || 0; }
  // 请求了几次：用工具、翻记忆、续发，每多一步都要再请求一次（每次都带着前面的全部内容）
  const req = r > 1 ? ` · 请求 ${r} 次${f ? `（续发 ${f} 条）` : ""}` : "";
  return i || o ? `输入 ${fmtTokens(i)}${c ? `（缓存 ${fmtTokens(c)}）` : ""} · 输出 ${fmtTokens(o)} tokens${req}` : "";
}

// ---------- 消息操作 ----------
const actionMsg = ref(null);
const actionBubble = ref(""); // 点的是他回复里的哪一段（引用就引这一段）
const editing = ref(null); // { msg, text }
// 引用：选一条（他的就是点的那一段），输入框上面出现，发出去时挂在你的消息上
const quoting = ref(null);
function quoteMsg() {
  const m = actionMsg.value;
  actionMsg.value = null;
  const t = (m.from === "ai" ? actionBubble.value || splitBubbles(m.text)[0] || "" : m.text || (voicesOf(m)[0]?.text || "[语音]")).replace(/\s+/g, " ");
  quoting.value = { id: m.id, from: m.from, text: t.slice(0, 80) };
  inputEl.value?.focus();
}
// 点引用块：跳到原来那条
async function jumpTo(id) {
  if (id && !document.querySelector(`[data-mid="${id}"]`)) {
    // 不在画着的这一段里：只画它前后各 20 组，不把到最新为止的全画出来（聊得久了会很卡）
    const i = items.value.findIndex(it => it.m?.id === id || it.msgs?.some(m => m.id === id || m._src?.id === id));
    if (i >= 0) {
      settleStop?.();
      const len = items.value.length;
      if (i >= len - showCount.value) win.value = null;
      else win.value = { start: Math.max(0, i - 20), end: Math.min(len, i + 21) };
      await nextTick();
    }
  }
  const el = id && document.querySelector(`[data-mid="${id}"]`);
  if (!el) return toast("那条消息不在这里了");
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1600);
}

// 搜索里点「去这段对话」：换到那个对话（不在就打开），再滚到那一条、闪一下
async function goFound(id, mid) {
  searchOpen.value = false;
  if (id !== threadId.value) { await openThread(id); router.replace(`/chat/${role.value.id}/${id}`); }
  settleStop?.(); // 别再把画面拽回最底下
  await nextTick();
  setTimeout(() => mid && jumpTo(mid), 350); // 等搜索面板收起来
}

// 点哪条，就在手指旁边弹出一列小选项
if (!window.__tapAt) { // 只挂一次
  window.__tapAt = { x: innerWidth / 2, y: innerHeight / 2 };
  addEventListener("pointerdown", e => { window.__tapAt.x = e.clientX; window.__tapAt.y = e.clientY; }, { passive: true });
}
const lastPt = window.__tapAt;
const menuPos = ref({});
function openActions(m, bubble = "") {
  if (m.pending) return;
  actionBubble.value = bubble;
  const w = 188, x = Math.min(Math.max(lastPt.x - w / 2, 12), innerWidth - w - 12);
  menuPos.value = lastPt.y > innerHeight * 0.55
    ? { left: x + "px", bottom: innerHeight - lastPt.y + 10 + "px" }
    : { left: x + "px", top: lastPt.y + 10 + "px" };
  actionMsg.value = m;
}
async function copyMsg() {
  const m = actionMsg.value;
  actionMsg.value = null;
  const text = m.from === "ai" ? splitBubbles(m.text).join("\n\n") : m.text;
  try { await navigator.clipboard.writeText(text); toast("已复制"); }
  catch { toast("复制失败，浏览器不允许"); }
}
function favMsg() {
  const m = actionMsg.value;
  actionMsg.value = null;
  toast(toggleFav(thread.value, m) ? "收藏好了，在「记忆 → 收藏」里" : "取消收藏了");
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

// ---------- 摘要记忆 ----------
const sumEdit = ref(null);
const sumBusy = ref(false);
function openSummary() { sumEdit.value = { text: thread.value?.summary?.text || "" }; }
function saveSummary() {
  const t = thread.value, text = sumEdit.value.text.trim();
  if (!t) return;
  if (text !== (t.summary?.text || "")) snapshotSum(t, "summary"); // 改之前的留一个版本
  if (!text) delete t.summary;
  else t.summary = { ...(t.summary || { upTo: null, count: 0 }), text, at: Date.now(), edited: true };
  sumEdit.value = null;
  toast("存好了");
}
async function compressNow() {
  sumBusy.value = true;
  try {
    const n = await summarizeThread(thread.value, role.value);
    sumEdit.value = { text: thread.value.summary?.text || "" };
    toast(n ? `把 ${n} 条聊天整理进去了` : "没有新的聊天要整理");
  } catch (e) {
    toast(`没整理成：${describeError(e)}`, 4000);
  } finally {
    sumBusy.value = false;
  }
}

const worldOpen = ref(false); // 小世界：右边滑出来的半边
const searchOpen = ref(false); // 搜聊天：也是右边半边
const smallWorld = () => (worldOpen.value = true);
const back = () => goBack(router, "/");

// 只在头像内记录短点按；移动、长按和取消都不算双击，不拦截滚动。
let avatarTap = null, avatarDown = null;
const pokeAnimation = ref("");
let pokeTimer;
function animatePoke(target) {
  pokeAnimation.value = "";
  nextTick(() => {
    pokeAnimation.value = target;
    clearTimeout(pokeTimer);
    pokeTimer = setTimeout(() => { pokeAnimation.value = ""; }, 420);
  });
}
function avatarStart(e) {
  if (!e.isPrimary || e.button !== 0) return;
  avatarDown = { x: e.clientX, y: e.clientY, at: Date.now(), el: e.currentTarget };
}
function avatarMove(e) {
  if (avatarDown && Math.hypot(e.clientX - avatarDown.x, e.clientY - avatarDown.y) > 10) { avatarDown = null; avatarTap = null; }
}
async function avatarEnd(e) {
  const down = avatarDown; avatarDown = null;
  if (!down || down.el !== e.currentTarget || Date.now() - down.at > 300 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) { avatarTap = null; return; }
  const now = Date.now();
  if (!avatarTap || avatarTap.el !== e.currentTarget || now - avatarTap.at > 330) { avatarTap = { el: e.currentTarget, at: now }; return; }
  avatarTap = null;
  if (!thread.value) return;
  if (busy.value) { toast("等他说完再戳一戳吧", 2000); return; }
  animatePoke("ai");
  await sendMessage(thread.value, pokeText(role.value, "user"), [], { poke: true });
}
watch(() => messages.value.flatMap(m => m.notes || []).filter(n => n.poke === "ai").at(-1), (n, old) => {
  if (n && n !== old && Date.now() - n.ts < 2000) animatePoke("user");
});
onBeforeUnmount(() => clearTimeout(pokeTimer));
</script>

<template>
  <div v-if="role" class="chat" :class="{ 'has-bg': bgUrl }" :style="{ ...bubbleColors, '--dock': dockH + 'px' }">
    <div class="bg" :style="bgUrl ? { backgroundImage: `url(${bgUrl})` } : {}" />

    <header class="top">
      <button class="icon-btn" aria-label="返回" @click="back"><Icon name="back" /></button>
      <div class="who">
        <div v-if="thread?.studio" class="name">Studio</div>
        <div v-if="thread?.studio" class="sig">{{ role.name }} 的工作室 · 连着栖所的仓库</div>
        <div v-if="!thread?.studio" class="name">{{ role.name }}<span v-if="moodFace" class="mood" :title="moodFace.word"><PixelArt :grid="moodFace.grid" :size="20" /></span></div>
        <div v-if="role.signature && !thread?.studio" class="sig">{{ role.signature }}</div>
      </div>
      <button class="icon-btn" aria-label="小世界" @click="smallWorld"><Icon name="house" /></button>
    </header>

    <main ref="scroller" class="scroll" @scroll.passive="onScroll">
      <div class="inner">
        <div v-if="!messages.length" class="hello">
          <Avatar :img="role.avatar" :name="role.name" :color="role.color" :size="64" class="poke-target" :class="{ poked: pokeAnimation === 'ai' }" title="双击戳一戳" @pointerdown="avatarStart" @pointerup="avatarEnd" @pointermove="avatarMove" @pointercancel="avatarTap = null; avatarDown = null" @dblclick.prevent />
          <p>{{ thread?.studio ? `这里是工作室：可以让 ${role.name} 去翻栖所的施工日志和提交记录，把值得记住的写进它的记忆` : `和 ${role.name} 说点什么吧` }}</p>
          <p v-if="!currentApi" class="warn">还没有 API，先去「设置 → API」添加一个</p>
        </div>

        <button v-if="hiddenCount" class="more-hint" @click="showMore">往上滑（或点这里）看更早的</button>
        <template v-for="it in shownItems" :key="it.key">
          <div v-if="it.type === 'event'" class="event">
            <span :class="{ link: it.m.sources?.length || it.m.detail }" @click="(it.m.sources?.length || it.m.detail) && (openSources[it.key] = !openSources[it.key])">
              {{ it.m.text }}<template v-if="it.m.sources?.length || it.m.detail"> {{ openSources[it.key] ? "▴" : "▾" }}</template>
            </span>
            <button v-if="it.m.href" class="cal-btn" @click="router.push(it.m.href)">去看 ›</button>
            <button v-if="it.m.calAction && !it.m.calAction.done" class="cal-btn" @click="confirmCal(it.m)">{{ opButton(it.m.calAction) }}</button>
            <div v-if="it.m.imgs?.length" class="note-imgs"><ImgThumb v-for="id in it.m.imgs" :key="id" :id="id" /></div>
            <pre v-if="openSources[it.key] && it.m.detail" class="detail">{{ it.m.detail }}</pre>
            <div v-if="openSources[it.key] && it.m.sources?.length" class="sources">
              <a v-for="s in it.m.sources" :key="s.url" :href="s.url" target="_blank" rel="noopener">{{ s.title || s.url }}</a>
            </div>
          </div>

          <div v-else class="group" :class="it.from === 'user' ? 'mine' : 'theirs'">
            <div class="ava" :class="{ poked: pokeAnimation === it.from }">
              <Avatar v-if="it.from === 'user'" :img="store.profile.avatar" :name="role.me?.name || store.profile.name" :color="store.profile.color" :size="42" />
              <Avatar v-else :img="role.avatar" :name="role.name" :color="role.color" :size="42" class="poke-target" title="双击戳一戳" @pointerdown="avatarStart" @pointerup="avatarEnd" @pointermove="avatarMove" @pointercancel="avatarTap = null; avatarDown = null" @dblclick.prevent />
            </div>
            <div class="col">
              <template v-for="m in it.msgs" :key="m._key || m.id">
                <template v-if="m.from === 'user'">
                  <div v-if="imgsOf(m).length > 1" class="img-grid" :class="'n' + Math.min(4, imgsOf(m).length)">
                    <div v-for="(a, i) in imgsOf(m).slice(0, 4)" :key="i" class="cell" @click="viewImgs(m, i)">
                      <ImgThumb :id="a.img" />
                      <span v-if="i === 3 && imgsOf(m).length > 4" class="more">+{{ imgsOf(m).length - 4 }}</span>
                    </div>
                  </div>
                  <div v-else-if="imgsOf(m).length" class="att one" @click="viewImgs(m)"><ImgThumb :id="imgsOf(m)[0].img" /></div>
                  <VoiceBubble v-for="a in voicesOf(m)" :key="a.file" :file="a.file" :dur="a.dur" :transcript="a.text" mine @transcribed="t => { a.text = t; saveMessages(thread.id); }" @more="openActions(m)" />
                  <div v-for="(a, i) in filesOf(m)" :key="'f' + i" class="att" @click="openActions(m)">
                    <div class="file-chip"><Icon name="file" :size="18" />{{ a.name }}</div>
                  </div>
                  <div v-if="m.quote" class="quote mine" @click="jumpTo(m.quote.id)"><b>{{ m.quote.from === "ai" ? role.name : "我" }}</b>{{ m.quote.text }}</div>
                  <div v-if="m.hug" class="bubble hug" @click="openActions(m)"><Icon name="heart" :size="16" />抱了抱 {{ role.name }}</div>
                  <img v-else-if="onlySticker(m.text)" :src="stickerUrl(onlySticker(m.text))" :alt="onlySticker(m.text).name" class="sticker" @click="openActions(m)" />
                  <template v-else-if="m.text"><div v-if="!onlyUrl(m.text)" class="bubble" :data-mid="m.id" @click="openActions(m)">{{ m.text }}</div><LinkCard v-for="u in urlsIn(m.text)" :key="u" :url="u" /></template>
                  <div v-if="vers(m).list.length > 1" class="ver">
                    <button :disabled="vers(m).index === 0" aria-label="上一个版本" @click="switchVersion(m, -1)">‹</button>
                    {{ vers(m).index + 1 }} / {{ vers(m).list.length }}
                    <button :disabled="vers(m).index === vers(m).list.length - 1" aria-label="下一个版本" @click="switchVersion(m, 1)">›</button>
                  </div>
                </template>
                <template v-else>
                  <div v-if="src(m).quote && (!m._src || m._first)" class="quote" @click="jumpTo(src(m).quote.id)"><b>{{ src(m).quote.from === "ai" ? role.name : "我" }}</b>{{ src(m).quote.text }}</div>
                  <div v-if="m.thinking && (!m._src || m._first)" class="think" @click="openThink[m.id] = !openThink[m.id]">
                    <Icon name="bulb" :size="14" />
                    {{ m.pending && !splitBubbles(m.text).length ? "思考中…" : "思考过程" }}
                    <span class="arrow">{{ openThink[m.id] ? "▴" : "▾" }}</span>
                  </div>
                  <div v-if="m.thinking && openThink[m.id] && (!m._src || m._first)" class="think-body">{{ m.thinking.trim() }}</div>
                  <div v-if="m.error" class="bubble error" @click="openActions(m)">{{ m.text }}</div>
                  <div v-else-if="m.pending && !splitBubbles(m.text).length" class="bubble typing"><i /><i /><i /></div>
                  <template v-for="(b, i) in splitBubbles(m.text)" v-else :key="i"><HtmlBlock v-if="isCodeBubble(b)" :block="b" @click="openActions(src(m))" /><img v-else-if="onlySticker(b)" :src="stickerUrl(onlySticker(b))" :alt="onlySticker(b).name" class="sticker" @click="openActions(src(m))" /><VoiceBubble v-else-if="voiceText(b)" :text="voiceText(b)" /><LinkCard v-else-if="cardOf(b)" v-bind="cardOf(b)" /><template v-else><div v-if="!onlyUrl(b)" class="bubble" :data-mid="src(m).id" @click="openActions(src(m), b)" v-html="withStickers(blockMd(b))" /><LinkCard v-for="u in urlsIn(b)" :key="u" :url="u" /></template></template>
                  <template v-if="!m._src || m._last">
                    <div v-if="src(m).pending && (src(m).paused || src(m).typing) && splitBubbles(m.text).length" class="bubble typing"><i /><i /><i /></div>
                    <AskCard v-if="src(m).ask && !src(m).pending" :ask="src(m).ask" :disabled="busy" @submit="a => answerAsk(src(m), a)" />
                    <GardenRoomCard v-if="src(m).rooms?.length && !src(m).pending" :rooms="src(m).rooms" :run="src(m).roomRun" :role="role" />
                    <div v-if="src(m).drawing" class="bubble drawing">正在画：{{ src(m).drawing.slice(0, 40) }}…</div>
                    <div v-if="imgsOf(src(m)).length" class="att one" @click="viewImgs(src(m))"><ImgThumb :id="imgsOf(src(m))[0].img" /></div>
                  </template>
                  <div v-if="(!m._src || m._last) && vers(src(m)).list.length > 1" class="ver">
                    <button :disabled="vers(src(m)).index === 0" aria-label="上一个版本" @click="switchVersion(src(m), -1)">‹</button>
                    {{ vers(src(m)).index + 1 }} / {{ vers(src(m)).list.length }}
                    <button :disabled="vers(src(m)).index === vers(src(m)).list.length - 1" aria-label="下一个版本" @click="switchVersion(src(m), 1)">›</button>
                  </div>
                </template>
              </template>
              <div class="stamp">{{ stamp(it.lastTs) }}<template v-if="it.where && WHERE[it.where]"> · {{ WHERE[it.where] }}</template><template v-if="tokensOf(it)"> · {{ tokensOf(it) }}</template></div>
            </div>
          </div>
        </template>
        <div v-if="wakeBusy" class="event wake-busy"><span>{{ role.name }} 刚被叫醒，正在行动（{{ wakeBusy.text.length > 40 ? wakeBusy.text.slice(0, 40) + "…" : wakeBusy.text }}）…做完会出现在这里</span></div>
      </div>
    </main>
    <button v-if="win" class="latest-btn" @click="backToLatest">回到最新 ↓</button>

    <footer ref="dock" class="composer">
      <!-- 桌宠：他（主角色）的小章鱼，站在输入框上面 -->
      <PetDock v-if="petOn() && role.id === MAIN && !thread?.mail" :work="petWork" />
      <!-- 小螃蟹（cc）：同样站在右边，和小章鱼一模一样的动作 -->
      <PetDock v-else-if="petOn('crab') && solo(role) && !thread?.mail" kind="crab" :work="petWork" />
      <div v-if="attachments.length" class="pending-atts">
        <div v-for="(a, i) in attachments" :key="i" class="patt">
          <ImgThumb v-if="a.kind === 'image'" :id="a.img" class="mini" />
          <span v-else class="file-chip"><Icon name="file" :size="16" />{{ a.name }}</span>
          <button class="x" @click="removeAttachment(i)"><Icon name="close" :size="14" /></button>
        </div>
      </div>
      <div v-if="quoting" class="quoting"><span><b>引用{{ quoting.from === "ai" ? role.name : "我" }}：</b>{{ quoting.text }}</span><button aria-label="不引用了" @click="quoting = null"><Icon name="close" :size="14" /></button></div>
      <div class="pill-row">
        <button v-if="ctxInfo" class="ctx" :class="ctxInfo.level" @click="ctxOpen = true">
          <span>{{ fmtTokens(ctxInfo.ctx) }} / {{ fmtTokens(ctxInfo.limit) }}</span>
          <i class="bar"><b :style="{ width: ctxInfo.pct + '%' }" /></i>
        </button>
        <button v-else class="ctx" @click="ctxOpen = true">用量</button>
        <button v-if="draftLong" class="expand-btn" aria-label="展开编辑" @click="expandDraft"><Icon name="expand" :size="15" /> 展开</button>
      </div>
      <div v-if="recording" class="rec-bar">
        <span class="rec-dot" /> 录音中 {{ Math.floor(recording.secs / 60) }}:{{ String(recording.secs % 60).padStart(2, "0") }}
        <span class="grow" />
        <button class="btn soft small" @click="cancelRec">取消</button>
        <button class="btn small" @click="sendRec">发送</button>
      </div>
      <div v-else class="row">
        <button class="tool" aria-label="添加图片或文件" @click="plusOpen = true"><Icon name="plus" :size="26" /></button>
        <button class="tool" aria-label="发语音" @click="startRec"><Icon name="mic" :size="22" /></button>
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
        <button @click="plusOpen = false; stickerOpen = true"><span><Icon name="smile" :size="26" /></span>表情</button>
      </div>
    </Sheet>

    <!-- 表情包 -->
    <Sheet :open="stickerOpen" title="表情包" @close="stickerOpen = false">
      <div v-if="stickersOf(role.id).length" class="st-grid">
        <button v-for="s in stickersOf(role.id)" :key="s.id" @click="sendSticker(s)"><img v-if="stickerUrl(s)" :src="stickerUrl(s)" :alt="s.name" /><span>{{ s.name }}</span></button>
      </div>
      <p v-else class="tip">还没有表情包。去「设置 → 表情包」上传几张。</p>
      <button class="btn soft small st-manage" @click="stickerOpen = false; router.push(`/settings/stickers?owner=${role.id}`)">管理表情包</button>
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
        <button class="list-row" @click="threadsOpen = false; modelOpen = true">
          <Icon name="key" :size="20" />
          <span class="grow">模型<span class="sub">{{ currentModel || "选择模型" }}</span></span>
          <Icon name="right" :size="16" />
        </button>
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
      <div class="section-label">我的气泡颜色</div>
      <div class="list-card flat bubble-pick">
        <ColorSwatches v-model="store.profile.bubbleColor" :colors="BUBBLE_COLORS" />
        <button v-if="store.profile.bubbleColor" class="btn soft small mine-reset" @click="store.profile.bubbleColor = null">恢复默认</button>
      </div>
    </Sheet>

    <!-- 上下文 -->
    <UsageSheet :open="ctxOpen" :all="allMessages" :path="messages" :limit="ctxInfo?.limit || 200000" :shown-count="shownCount" :summary="thread?.summary" @close="ctxOpen = false">
      对话不会「用满」：摘要后面的聊天原文快到 {{ fmtTok(chatTokens()) }} token 的八成，他就把前面的整理进摘要（记忆卡片里的事他一直记得）。想让他记得更细、或者想省一点，往左滑就能改这个数；模型的上限在「设置 → API」里改。
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

    <WorldDrawer :open="worldOpen" :role="role" :thread="thread" @close="worldOpen = false" @threads="worldOpen = false; threadsOpen = true" @search="worldOpen = false; searchOpen = true" @summary="worldOpen = false; openSummary()" />

    <!-- 摘要记忆：这个对话前面的聊天整理成的，一段一段接在后面（以前的不重写） -->
    <Sheet :open="!!sumEdit" title="摘要记忆" @close="sumEdit = null">
      <template v-if="sumEdit">
        <SummaryInfo :thread="thread" />
        <BigTextarea v-model="sumEdit.text" rows="10" title="摘要记忆" placeholder="还没有摘要：点下面「现在整理」，或者聊久了会自己整理" />
        <p class="sum-tip">用「设置 → API」里的整理模型。看到错的可以直接改。换到新对话时，这份摘要会跟着过去。</p>
        <div class="edit-actions">
          <button class="btn soft" :disabled="sumBusy" @click="compressNow">{{ sumBusy ? "在整理……" : "现在整理" }}</button>
          <button class="btn" @click="saveSummary">保存</button>
        </div>
        <SumVersions :owner="thread" @restored="sumEdit.text = thread.summary?.text || ''" />
      </template>
    </Sheet>
    <SearchPanel :open="searchOpen" :role-id="role.id" @close="searchOpen = false" @go="goFound" />

    <!-- 消息操作：手指旁边一列小选项 -->
    <Teleport to="body">
      <div v-if="actionMsg" class="ctx-mask" @click="actionMsg = null" @contextmenu.prevent>
        <div class="ctx-menu" :style="menuPos" @click.stop>
          <button v-if="!actionMsg.error" @click="copyMsg"><Icon name="copy" :size="17" />复制</button>
          <button v-if="!actionMsg.error" @click="quoteMsg"><Icon name="chat" :size="17" />引用</button>
          <button v-if="actionMsg.from === 'ai' && !actionMsg.error" @click="readAloud"><Icon name="volume" :size="17" />朗读</button>
          <button v-if="!actionMsg.error" @click="favMsg"><Icon name="star" :size="17" />{{ isFav(actionMsg) ? "取消收藏" : "收藏" }}</button>
          <button v-if="!actionMsg.error" @click="startEdit"><Icon name="edit" :size="17" />修改</button>
          <button v-if="actionMsg.from === 'ai'" :disabled="busy" @click="regen"><Icon name="refresh" :size="17" />重新生成</button>
          <button class="danger" @click="removeMsg"><Icon name="trash" :size="17" />{{ vers(actionMsg).list.length > 1 ? "删除这个版本" : "删除" }}</button>
          <button v-if="vers(actionMsg).list.length > 1" class="danger" @click="removeAll"><Icon name="trash" :size="17" />删除全部 {{ vers(actionMsg).list.length }} 个</button>
        </div>
      </div>
    </Teleport>

    <!-- 一组图片 -->
    <ImageViewer :open="!!gallery" :images="gallery ? imgsOf(gallery.m).map(a => a.img) : []" :start="gallery?.start || 0"
      @close="gallery = null" @more="openActions(gallery.m); gallery = null" />

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
.poke-target { touch-action: manipulation; user-select: none; cursor: pointer; }
.poked { animation: poke-wiggle .4s ease-out; }
@keyframes poke-wiggle { 25% { transform: rotate(-7deg) scale(1.04); } 60% { transform: rotate(5deg); } 85% { transform: rotate(-2deg); } }
@media (prefers-reduced-motion: reduce) { .poked { animation: none; } }
.event { overflow-wrap: anywhere; }

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
  bottom: auto;
  height: max(100%, 100lvh); /* 背景铺在外层到屏幕最底：iPhone 主屏幕打开时整页会短一截，别把底下露出来 */
  z-index: -1;
  background: var(--bg);
  background-size: cover;
  background-position: center;
}
.has-bg .bg { box-shadow: inset 0 0 0 100vmax rgba(10, 12, 18, var(--img-dim)); } /* 深色模式：背景图压暗一层 */

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
.sig { font-size: 0.833rem; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 消息区：输入框浮在上面，底下留出它的高度，最后一条能滑到它上方 */
.scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.inner { max-width: 760px; margin: 0 auto; padding: 12px 14px calc(var(--dock, 120px) + var(--safe-bottom) + 22px); display: flex; flex-direction: column; gap: 18px; }

.latest-btn { position: absolute; right: 16px; bottom: calc(var(--dock, 120px) + var(--dock-bottom) + 10px); z-index: 4; border: 0; border-radius: 999px; padding: 8px 14px; background: rgba(var(--glass-rgb), .95); color: var(--text); font-size: .8rem; box-shadow: var(--shadow); }
.more-hint { display: block; margin: 4px auto 8px; border: 0; background: none; font-size: .72rem; color: var(--text-3); }
.hello { text-align: center; color: var(--text-2); margin-top: 18vh; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.hello p { margin: 8px 0 0; }
.warn { color: var(--danger); font-size: 0.867rem; }

.event { text-align: center; }
.event span.link { cursor: pointer; }
.wake-busy span { animation: breathe 1.6s ease-in-out infinite; }
@keyframes breathe { 50% { opacity: .55; } }
.ver { display: inline-flex; align-items: center; gap: 2px; font-size: 0.8rem; color: var(--text-2); background: rgba(var(--glass-rgb), .85); border-radius: 999px; padding: 0 2px; box-shadow: 0 1px 3px rgba(40, 40, 60, .08); }
.ver button { border: 0; background: none; color: var(--ink); font-size: 1.4rem; font-weight: 600; line-height: 1; min-width: 44px; height: 38px; padding: 0 0 3px; }
.ver button:disabled { opacity: .2; }
.cal-btn { display: block; margin: 4px auto 0; border: 0; background: var(--ink); color: var(--on-ink); border-radius: 999px; padding: 3px 12px; font-size: 0.73rem; }
.detail { text-align: left; white-space: pre-wrap; word-break: break-all; font-size: 0.72rem; line-height: 1.6; color: var(--text-2); background: rgba(var(--glass-rgb), .85); border-radius: 12px; padding: 8px 10px; margin: 6px auto 0; max-width: 92%; max-height: 40vh; overflow-y: auto; font-family: ui-monospace, Menlo, monospace; }
.sources { display: flex; flex-direction: column; gap: 4px; align-items: center; margin-top: 6px; }
.sources a { font-size: 0.75rem; color: var(--accent); background: rgba(var(--glass-rgb), .8); padding: 2px 10px; border-radius: 999px; max-width: 90%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: none; }
.think {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  font-size: 0.73rem;
  color: var(--text-2);
  background: rgba(var(--glass-rgb), .78);
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
  background: rgba(var(--glass-rgb), .72);
  border-left: 3px solid var(--line);
  border-radius: 6px 14px 14px 6px;
  padding: 8px 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 45vh;
  overflow-y: auto;
}
.ctx { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; padding: 2px 4px; font-size: 0.7rem; color: var(--text-2); }
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
  background: rgba(var(--glass-rgb), .75);
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
  border-radius: 16px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.65;
  font-size: 1rem;
  cursor: pointer;
  user-select: text;
}
.theirs .bubble { background: var(--their); color: var(--their-text); border-bottom-left-radius: 3px; }
.mine .bubble { background: var(--mine, var(--card)); color: var(--mine-text, inherit); border-bottom-right-radius: 3px; filter: drop-shadow(0 1px 1.5px rgba(40, 40, 60, .08)); }
/* 小尖角：贴着气泡底边往外伸出一个尖，内侧一道弧（颜色跟着气泡走） */
.bubble { position: relative; }
/* 他回复里的标题、表格、列表、引用（Markdown） */
.bubble :deep(.md-h) { font-weight: 700; margin: 2px 0 4px; }
.bubble :deep(.md-h1) { font-size: 1.12em; }
.bubble :deep(.md-h2) { font-size: 1.05em; }
.bubble :deep(.md-h3) { font-size: 1em; }
.bubble :deep(.md-list) { margin: 2px 0; padding-left: 1.3em; white-space: normal; }
.bubble :deep(.md-list li) { margin: 2px 0; white-space: pre-wrap; }
.bubble :deep(.md-quote) { margin: 4px 0; padding: 2px 0 2px 10px; border-left: 3px solid var(--line); color: var(--text-2); white-space: normal; }
.bubble :deep(.md-hr) { border: 0; border-top: 1px solid var(--line); margin: 8px 0; }
.bubble :deep(.md-tbl) { overflow-x: auto; margin: 4px 0; white-space: normal; }
.bubble :deep(table) { border-collapse: collapse; font-size: .9em; min-width: 100%; }
.bubble :deep(th), .bubble :deep(td) { border: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top; }
.bubble :deep(th) { background: rgba(var(--tint-rgb), .04); font-weight: 600; }
/* 引用：消息上面一小条灰的；输入框上面显示正在引用哪句 */
.quote { max-width: 82%; align-self: flex-start; margin: 0 4px -2px; padding: 5px 10px; border-left: 3px solid var(--line); border-radius: 4px 10px 10px 4px; background: rgba(var(--tint-rgb), .04); font-size: .76rem; line-height: 1.5; color: var(--text-3); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; cursor: pointer; }
.quote.mine { align-self: flex-end; }
.quote b { font-weight: 600; margin-right: 6px; color: var(--text-2); }
.quoting { display: flex; align-items: center; gap: 8px; margin: 0 4px 6px; padding: 6px 10px; border-radius: 12px; background: var(--bg); font-size: .78rem; color: var(--text-2); }
.quoting span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.quoting button { border: 0; background: none; color: var(--text-3); padding: 2px; display: grid; place-items: center; }
.bubble.flash { animation: qflash 1.6s ease; }
@keyframes qflash { 0%, 60% { box-shadow: 0 0 0 3px rgba(106, 167, 224, .45); } 100% { box-shadow: none; } }
.bubble::after {
  content: ""; position: absolute; bottom: 0; width: 24px; height: 17px; background: inherit; pointer-events: none;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 17'%3E%3Cpath d='M24 0L24 17L0 17C8.5 15.2 13 10 14.2 0Z'/%3E%3C/svg%3E") no-repeat 0 0 / 100% 100%;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 17'%3E%3Cpath d='M24 0L24 17L0 17C8.5 15.2 13 10 14.2 0Z'/%3E%3C/svg%3E") no-repeat 0 0 / 100% 100%;
}
.theirs .bubble::after { left: -11px; }
.mine .bubble::after { right: -11px; transform: scaleX(-1); }
.theirs .bubble.error { background: color-mix(in srgb, #fdecee var(--pastel), var(--card)); color: var(--danger); font-size: 0.9rem; }

.typing { display: flex; gap: 5px; padding: 15px 16px; }
.typing i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); animation: hop 1.2s infinite; }
.typing i:nth-child(2) { animation-delay: .15s; }
.typing i:nth-child(3) { animation-delay: .3s; }
@keyframes hop { 0%, 60%, 100% { transform: none; opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }

.stamp { font-size: 0.7rem; color: var(--text-2); padding: 0 6px; }
.att { cursor: pointer; }
.mood { display: inline-block; vertical-align: -3px; margin-left: 6px; }
.img-grid { display: grid; grid-template-columns: repeat(2, 84px); gap: 4px; border-radius: 16px; overflow: hidden; cursor: pointer; }
.img-grid.n2 { grid-template-columns: repeat(2, 96px); }
.img-grid .cell { position: relative; width: 100%; aspect-ratio: 1; overflow: hidden; background: var(--bg-deep); }
.img-grid .cell :deep(.thumb) { width: 100%; height: 100%; border-radius: 0; box-shadow: none; pointer-events: none; }
.img-grid .cell :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.img-grid .more { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, .38); color: #fff; font-weight: 700; font-size: 1.1rem; }
.att.one :deep(.thumb) { pointer-events: none; } /* 点图片打开看图，不是在新窗口打开 */
.img-grid .cell { cursor: pointer; }
.sends { flex: none; display: flex; gap: 4px; align-items: flex-end; padding-bottom: 2px; }
.send.small { width: 34px; height: 34px; }
.send.reply { width: 40px; height: 40px; }
.send.small.on { background: #9aa0ad; }
.send.reply.on { background: var(--ink); }
.file-chip { display: inline-flex; align-items: center; gap: 6px; background: var(--card); border-radius: 12px; padding: 8px 12px; font-size: 0.867rem; color: var(--text-2); box-shadow: var(--shadow-soft); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 输入面板 */
/* 悬空的一张卡片（和共写一样）：聊天从它后面滑过去，不被切开 */
.composer {
  position: absolute; left: 0; right: 0; bottom: var(--dock-bottom); z-index: 5;
  width: calc(100% - 28px); max-width: 800px; margin: 0 auto; box-sizing: border-box;
  background: rgba(var(--glass-rgb), .97); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px);
  border-radius: 28px; box-shadow: 0 8px 30px rgba(40, 40, 60, .12);
  padding: 8px 10px 8px;
}
.row { display: flex; align-items: flex-end; gap: 4px; max-width: 760px; margin: 0 auto; }
.tool { flex: none; width: 32px; height: 40px; border: 0; background: none; color: var(--text-3); display: grid; place-items: center; }
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
  width: 38px; height: 38px;
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
.patt .x { position: absolute; top: -6px; right: -6px; width: 22px; height: 22px; border-radius: 50%; border: 0; background: var(--ink); color: var(--on-ink); display: grid; place-items: center; padding: 0; }

/* 弹出面板 */
.note-imgs { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin: 6px auto 0; max-width: 92%; }
.note-imgs { flex-wrap: nowrap; overflow-x: auto; justify-content: flex-start; padding: 2px; }
.note-imgs :deep(.thumb) { flex: none; width: auto; height: 120px; max-width: 70vw; border-radius: 10px; }
.note-imgs :deep(.thumb img) { height: 100%; width: auto; }
.rec-bar { display: flex; align-items: center; gap: 8px; max-width: 760px; margin: 0 auto; padding: 6px 4px; font-size: 0.93rem; font-variant-numeric: tabular-nums; }
.rec-bar .grow { flex: 1; }
.rec-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--danger); animation: breathe 1.2s ease-in-out infinite; }
.bubble.drawing { color: var(--text-2); font-size: 0.85rem; animation: breathe 1.6s ease-in-out infinite; }
.sticker { display: block; max-width: 140px; max-height: 140px; object-fit: contain; border-radius: 10px; cursor: pointer; }
.st-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 8px; max-height: 50vh; overflow-y: auto; }
.st-grid button { border: 0; background: var(--bg); border-radius: 14px; padding: 8px 4px 6px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.st-grid img { width: 56px; height: 56px; object-fit: contain; }
.st-grid span { font-size: 0.72rem; color: var(--text-2); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st-manage { display: block; margin: 12px auto 0; }
.grid-actions { display: flex; flex-wrap: wrap; justify-content: space-around; gap: 12px 4px; padding: 6px 0 4px; }
.grid-actions button { display: flex; flex-direction: column; align-items: center; gap: 6px; border: 0; background: none; font-size: 0.867rem; color: var(--text-2); }
.grid-actions button:disabled { opacity: .4; }
.bubble.hug { display: inline-flex; align-items: center; gap: 6px; background: color-mix(in srgb, #fbe7ee var(--pastel), var(--card)) !important; color: #b4587a; }
.grid-actions span { display: grid; place-items: center; width: 58px; height: 58px; border-radius: 20px; background: var(--bg-deep); color: var(--ink); }

.list-card.flat { box-shadow: none; border: 1px solid var(--line); }
.thread { cursor: pointer; }
.thread.cur { background: var(--card-2); }
.thread.cur .grow { font-weight: 600; }
.thread.cur .sub { font-weight: 400; }
.t-time { font-size: 0.8rem; color: var(--text-3); }
.mini-btn { border: 0; background: none; color: var(--text-3); width: 30px; height: 30px; display: grid; place-items: center; padding: 0; }
.new-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; margin-top: 10px; }
.pill-row { max-width: 760px; margin: 0 auto; padding: 2px 8px 0; display: flex; align-items: center; gap: 8px; }
.model-pill {
  border: 0; border-radius: 999px; padding: 2px 10px;
  background: var(--blue); color: var(--accent); font-size: 0.75rem;
  max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.list-row.cur { background: var(--card-2); font-weight: 600; }
.list-row.cur .sub, .t-time { font-weight: 400; }
.bubble-pick { padding: 12px; }
.mine-reset { margin: 10px 4px 0; }
.tip { font-size: 0.8rem; color: var(--text-3); text-align: center; margin: 14px 0 0; }
.edit-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }
.sum-meta { margin: 0 0 10px; font-size: .78rem; color: var(--text-3); }
.sum-tip { margin: 10px 2px 0; font-size: .74rem; line-height: 1.7; color: var(--text-3); }
</style>
