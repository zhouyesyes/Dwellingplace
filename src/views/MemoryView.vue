<script setup>
// 记忆库：每个角色一个抽屉。分三页——
//   Timeline：记忆卡片排成时间轴，上面一排按钮自己筛；每个点是一只小章鱼，样子看这条记忆从哪来
//   Drawers：其他的资料（聊天摘要、此刻、板块记忆、来往的信、共读共写）叠成一叠文件夹，平时合着
//   Scenes：场景记忆，共读、共写里才带的
// 「看看发给他的」、记忆体检、整理建议、设置、说明书都收在右边的 ⋯ 里
import { chatPreview, summarizeThread, describeError, meName } from "../lib/chat.js";
import { toast } from "../lib/toast.js";
import { momentParts, momentsOf, removeMoment, ago, MOMENT_MAX } from "../lib/moment.js";
import { projects } from "../lib/writing.js";
import { setProgress, palsOf, setPal, removePal, roundOf, PROGRESS_MAX, IMPRESSION_MAX, PAL_MAX } from "../lib/board.js";
import SceneMemory from "../components/memory/SceneMemory.vue";
import PromptPreview from "../components/memory/PromptPreview.vue";
import MemoryGuide from "../components/memory/MemoryGuide.vue";
import SummaryInfo from "../components/memory/SummaryInfo.vue";
import SumVersions from "../components/memory/SumVersions.vue";
import TryRecall from "../components/memory/TryRecall.vue";
import MemoryHealth from "../components/memory/MemoryHealth.vue";
import ReviewSheet from "../components/memory/ReviewSheet.vue";
import { openItems } from "../lib/review.js";
import { INSIGHT_CATS, insightsOf, removeInsight } from "../lib/insights.js";
import { snapshotSum } from "../lib/budget.js";
import MemorySettings from "../components/memory/MemorySettings.vue";
import { classifyMemories, CATS, lettersLog, isLive, accessOf, setAccess, confirmMemory, markObsolete, trashMemory, restoreMemory, purgeMemory, recallCount, PIN_MAX, ACCESS, SRC, BY } from "../lib/memoryTags.js";
import { ref, reactive, computed, watch, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, uid, roleById, authorInfo, threadsOf, solo } from "../store/index.js";
import { memoriesOf, memKind } from "../lib/memoryTags.js";
import { todayYmd } from "../lib/dates.js";
import { imageURL, pickAndCrop, deleteImage, useImage } from "../lib/images.js";
import Sheet from "../components/Sheet.vue";
import Icon from "../components/Icon.vue";
import Avatar from "../components/Avatar.vue";
import BigTextarea from "../components/BigTextarea.vue";
import XinchaoDrawer from "../components/xinchao/XinchaoDrawer.vue";
import { hasXinchao } from "../lib/xinchao.js";

// 记住上次看的是谁，下次进来还是他
const LAST = "memory-last-role";
const saved = (() => { try { return localStorage.getItem(LAST); } catch { return null; } })();
// 从日历点进来会带上 ?role=…&open=…：直接打开那一条
const route = useRoute();
const router = useRouter();
const openId = ref(route.query.open || null);
const fromRoute = route.query.role;
const tab = ref(roleById(fromRoute) ? fromRoute : roleById(saved) ? saved : store.roles[0]?.id ?? null);
if (route.query.role || route.query.open) router.replace({ path: "/memory" });
watch(tab, v => { try { v && localStorage.setItem(LAST, v); } catch {} });
watch(() => store.roles.length, () => { if (!roleById(tab.value)) tab.value = store.roles[0]?.id ?? null; });
const role = computed(() => roleById(tab.value));
const switchOpen = ref(false);
// 接了心潮的角色：记忆都在心潮里
const xinchao = computed(() => hasXinchao(role.value));

const view = ref("timeline"); // timeline：记忆卡片；drawers：其他资料；scene：场景记忆
const menuOpen = ref(false);
const guideOpen = ref(false);
const setOpen = ref(false);
const letterLines = computed(() => (role.value ? lettersLog(role.value, meName(role.value)) : ""));

// ---------- 记忆卡片：常驻 / 普通 / 归档 / 待确认 / 已过时（+ 回收站）----------
const all = computed(() => (tab.value ? memoriesOf(tab.value) : []));
const BUCKETS = {
  all: { label: "全部", test: m => isLive(m) && memKind(m) === "card", tip: "" },
  pinned: { label: "常驻", test: m => isLive(m) && accessOf(m) === "pinned", tip: `每次、每个房间都带着，最多 ${PIN_MAX} 张` },
  normal: { label: "普通", test: m => isLive(m) && accessOf(m) === "normal" && memKind(m) === "card", tip: "平时不全带：按你说的话，每次自动想起最相关的几张" },
  archived: { label: "归档", test: m => isLive(m) && accessOf(m) === "archived", tip: "还成立，但不常用了：不自动想起，只在搜索时出现" },
  pending: { label: "待确认", test: m => m.status === "pending", tip: "整理时挑出来的：确认前不给他、不自动想起" },
  obsolete: { label: "已过时", test: m => m.status === "obsolete", tip: "以前成立、现在不是了：留作历史，不当成现在的事" },
  deleted: { label: "回收站", test: m => m.status === "deleted" && memKind(m) !== "insight", tip: "不再给他；可以恢复，也可以彻底删掉" },
};
const bucket = ref("all");
const countOf = k => all.value.filter(BUCKETS[k].test).length;
const query = ref("");
const withArchived = ref(true);
const withHistory = ref(false);
const hit = m => { const q = query.value.trim().toLowerCase(); return !q || (m.title + m.content + m.date + (m.tags || []).join(" ")).toLowerCase().includes(q); };
// 搜索的时候：在常驻、普通里找；勾上了再加归档、已过时
const cards = computed(() => {
  if (query.value.trim()) return all.value.filter(m => hit(m) && ((isLive(m) && (accessOf(m) !== "archived" || withArchived.value)) || (m.status === "obsolete" && withHistory.value)));
  return all.value.filter(BUCKETS[bucket.value].test);
});
// 从共读、共写整理过来的（也在全局记忆里，排在常驻卡片后面）
const derived = computed(() => all.value.filter(m => memKind(m) !== "card" && memKind(m) !== "insight" && isLive(m) && accessOf(m) !== "archived" && hit(m)));
// 时间轴：新的在上，按月份分段
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const timeline = computed(() => {
  const groups = [];
  const thisYear = String(new Date().getFullYear());
  for (const m of [...cards.value].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.ts || 0) - (a.ts || 0))) {
    const key = (m.date || "").slice(0, 7);
    if (groups.at(-1)?.key !== key) groups.push({ key, label: `${MONTHS[Number(key.slice(5, 7)) - 1] || ""}${key.slice(0, 4) !== thisYear ? ` ${key.slice(0, 4)}` : ""}`, items: [] });
    groups.at(-1).items.push(m);
  }
  return groups;
});
// 小章鱼的样子看这条记忆讲的是什么（m.cat）：常驻的最开心；喜好脸红、约定抱信、心事在想、时刻欢呼、读写捧书、日常抱小本子
const OCT = Object.fromEntries(Object.entries(import.meta.glob("../assets/memory/oct-*.png", { eager: true, import: "default" })).map(([k, v]) => [k.match(/oct-(\w+)\.png/)[1], v]));
const CAT_OCT = { 喜好: "like", 约定: "promise", 心事: "feel", 时刻: "moment", 读写: "book", 日常: "daily" };
const LEGEND = [{ k: "pin", label: "常驻" }, ...CATS.map(c => ({ k: CAT_OCT[c], label: c }))];
function octOf(m) {
  if (isLive(m) && accessOf(m) === "pinned") return "pin";
  if (CAT_OCT[m.cat]) return CAT_OCT[m.cat];
  // 还没分类的：从共读、共写来的捧书，其他先当日常
  return m.bookId || m.writingId || /讨论室|^共写/.test(m.source?.label || "") ? "book" : "daily";
}
// 给还没分类的卡片分类（整理模型过一遍）
const unsorted = computed(() => all.value.filter(m => memKind(m) === "card" && m.status !== "deleted" && !m.cat).length);
const sorting = ref("");
async function sortCats() {
  if (!role.value || sorting.value) return;
  if (!confirm(`让整理模型给 ${unsorted.value} 张还没分类的卡片分类？会花一点整理模型的额度。`)) return;
  sorting.value = "0";
  try {
    const { done, total } = await classifyMemories(role.value, (d, t) => (sorting.value = `${d}/${t}`));
    toast(done < total ? `分好了 ${done} 张，还有 ${total - done} 张没认出来，可以再点一次` : `${done} 张都分好了`, 3500);
  } catch (e) { toast(`没分成：${describeError(e)}`, 4000); } finally { sorting.value = ""; }
}
// 抽屉
const DRAWERS = [
  { key: "sum", en: "SUMMARY", title: "聊天摘要", sub: "每个对话一份" },
  { key: "now", en: "NOW", title: "此刻", sub: "最近 24 小时" },
  { key: "board", en: "BOARD", title: "板块记忆", sub: "长期的进展" },
  { key: "letters", en: "LETTERS", title: "来往的信", sub: "他记得最近 5 封" },
  { key: "insight", en: "NOTEBOOK", title: "心得本", sub: "游戏经验 · 社交感悟" },
  { key: "rw", en: "READ · WRITE", title: "共读和共写", sub: "整理来的笔记和总结" },
];
// 共读共写还没给小螃蟹接：没有「共读和共写」抽屉，板块记忆里只有笔友；场景记忆也是共读共写里的，不给它看
const drawers = computed(() => (solo(role.value) ? DRAWERS.filter(d => d.key !== "rw") : DRAWERS));
watch(role, r => { if (solo(r) && view.value === "scene") view.value = "timeline"; });
const openDrawer = ref(null);
// 心得本：他自己记的，分两栏；点 × 删掉（同步时不会又冒出来）
const insights = computed(() => (void store.memories.length, tab.value ? insightsOf(tab.value) : []));
const insightCols = computed(() => Object.entries(INSIGHT_CATS).map(([k, label]) => ({ k, label, list: insights.value.filter(m => m.insight === k) })));
function dropInsight(m) {
  if (confirm("把这条心得删掉？")) removeInsight(m);
}
function drawerCount(k) {
  if (k === "sum") return `${sums.value.length} 份`;
  if (k === "now") return `${moment.value.filter(x => x.text).length} 条`;
  if (k === "board") return `${boardWrite.value.length + boardRead.value.length + boardPals.value.length} 项`;
  if (k === "insight") return `${insights.value.length} 条`;
  if (k === "letters") return `${letterLines.value ? letterLines.value.split("\n").length : 0} 封`;
  return `${derived.value.length} 条`;
}
// 谁记的：他聊天时自己记的 / 整理模型从哪挑出来的 / 他整理时改的 / 你写的
function whoOf(m) {
  const t = m.source?.type;
  if (t === "manual" || m.author === "me") return "你写的";
  if (t === "helper") return `整理时从${m.source?.label || "聊天"}里挑的`;
  if (t === "review") return "他整理时改的";
  return `${role.value?.name || "他"}自己记的`;
}
const badge = m => (m.status === "pending" ? "待确认" : m.status === "obsolete" ? "已过时" : m.status === "deleted" ? "回收站" : ACCESS[accessOf(m)]);
const srcLine = m => [SRC[m.source?.type] || "", m.source?.label || "", BY[m.source?.by] || (m.author === "me" ? "你写的" : "他自己记的")].filter(Boolean).join(" · ");
const fmt = ts => (ts ? new Date(ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
function act(m, what) {
  let err = "";
  if (what === "confirm") err = confirmMemory(m, "normal");
  else if (what === "confirmPin") err = confirmMemory(m, "pinned");
  else if (what === "pin") err = setAccess(m, "pinned");
  else if (what === "normal") err = setAccess(m, "normal");
  else if (what === "archive") err = setAccess(m, "archived");
  else if (what === "obsolete") markObsolete(m);
  else if (what === "trash") trashMemory(m);
  else if (what === "restore") restoreMemory(m);
  else if (what === "purge") { if (!confirm("彻底删掉这张卡片？删了就找不回来了。")) return; purgeMemory(m); viewing.value = null; return; }
  if (err) return toast(err, 3500);
  viewing.value = null;
}
// 每个对话的摘要记忆
const sums = computed(() => (tab.value ? threadsOf(tab.value) : []).filter(t => t.summary?.text && !t.mail).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
const sumEdit = ref(null);
const sumBusy = ref(false);
function saveSum() {
  const { t, text } = sumEdit.value;
  if (text.trim() !== (t.summary?.text || "")) snapshotSum(t, "summary"); // 改之前的留一个版本
  if (text.trim()) t.summary = { ...t.summary, text: text.trim(), at: Date.now(), edited: true };
  else delete t.summary;
  sumEdit.value = null;
}
async function sumNow() {
  sumBusy.value = true;
  try {
    const n = await summarizeThread(sumEdit.value.t, role.value);
    sumEdit.value.text = sumEdit.value.t.summary?.text || "";
    toast(n ? `把 ${n} 条聊天整理进去了` : "没有新的聊天要整理");
  } catch (e) { toast(`没整理成：${describeError(e)}`, 4000); } finally { sumBusy.value = false; }
}
// 临时带着的：附在新消息前面的【此刻】里，有的时候才有（只是看看，不会记成他看过了）
const RULES = {
  letters: { label: "信箱", rule: "你新寄的信，他下一次聊天时读一次全文；他寄的信你还没拆，就一直挂着，直到你拆开；24 小时里寄出、读过的信，一共最多 3 封，只带标题和第一句。上了锁的只告诉他有几封。" },
  read: { label: "共读：24 小时里读过的书", rule: "每本分开：书名、读到哪、他最新的印象、24 小时里你们来往的划线和批注（每本最多 10 条）。超过 24 小时就不带了。读后感他没看过的，看一次。" },
  self: { label: `他自己记的（最多 ${MOMENT_MAX} 条）`, rule: "他回复时写 [此刻:…] 记下的小事（心情、待会儿要做的），35 字以内，24 小时后自动忘。不想他记着的可以点 × 删掉。" },
};
const now = ref(Date.now());
const momentOpen = reactive({}); // 此刻里每一块默认折叠，点开看全部
const tick = setInterval(() => (now.value = Date.now()), 60_000);
onUnmounted(() => clearInterval(tick));
const moment = computed(() => {
  if (!role.value) return [];
  void now.value; void store.bookNotes?.length; void store.letters?.length; void store.moments?.length; // 这些变了重新算
  return momentParts(role.value, meName(role.value), { peek: true }).map(p => ({ ...p, ...RULES[p.key] }));
});
const selfMoments = computed(() => (void now.value, void store.moments?.length, role.value ? momentsOf(role.value.id) : []));
// 板块记忆：长期的进展（在写的书、在读和读完的书、笔友），点一行能改
const boardWrite = computed(() => projects().filter(x => !x.archived).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
const boardRead = computed(() => (store.books || []).filter(b => b.readAt || b.mine).sort((a, b) => !!a.mine - !!b.mine || (b.readAt || 0) - (a.readAt || 0)));
const boardPals = computed(() => (void store.penpals?.length, role.value ? palsOf(role.value.id) : []));
function editProgress(x) {
  const progress = prompt(`《${x.title}》现在到哪了？（${PROGRESS_MAX} 字以内）`, x.board?.progress || "");
  if (progress == null) return;
  const next = prompt("下一步要做什么？", x.board?.next || "");
  if (next != null) setProgress(x, { progress, next }, "me");
}
function editImpression(b) {
  const t = prompt(`《${b.title}》读完的印象（${IMPRESSION_MAX} 字以内）`, b.impression?.text || "");
  if (t == null) return;
  if (t.trim()) b.impression = { text: t.trim().slice(0, IMPRESSION_MAX), at: Date.now(), by: "me" };
  else delete b.impression;
}
function editPal(x) {
  const name = x ? x.name || x.email : prompt("笔友的名字或邮箱");
  if (!name?.trim()) return;
  const t = prompt(`${role.value.name}记着的 ${name}（${PAL_MAX} 字以内）`, x?.note || "");
  if (t == null) return;
  if (x) Object.assign(x, { note: t.trim().slice(0, PAL_MAX), at: Date.now(), by: "me" });
  else setPal(role.value, /@/.test(name) ? { email: name.trim(), note: t } : { name: name.trim(), note: t }, "me");
}
const preview = ref(null);
const tryOpen = ref(false);
const healthOpen = ref(false);
const reviewOpen = ref(false);
const reviewWaiting = computed(() => (role.value ? openItems(role.value.id).length : 0));
async function showChat() { preview.value = { title: "聊天时发给他的", parts: await chatPreview(role.value) }; }

const imgUrls = reactive({});
function imgOf(m) {
  if (m.img && !imgUrls[m.img]) imageURL(m.img).then(u => (imgUrls[m.img] = u));
  return m.img ? imgUrls[m.img] : null;
}
const md = d => d.slice(5).replace("-", ".");
const tint = c => `color-mix(in srgb, ${c} 14%, var(--card))`;

// ---------- 查看 ----------
const viewing = ref(null);

// ---------- 新建 / 编辑 ----------
const draft = ref(null);
const draftImg = useImage(() => draft.value?.img);
function newCard() {
  if (!role.value) return;
  const now = Date.now();
  draft.value = { id: uid(), roleId: tab.value, title: "", content: "", img: null, date: todayYmd(), author: "me", ts: now, createdAt: now, updatedAt: now,
    status: "valid", access: bucket.value === "pinned" ? "pinned" : bucket.value === "archived" ? "archived" : "normal", source: { type: "manual", by: "me" }, tags: [], importance: 3, cat: "", _tags: "", _isNew: true };
}
function editCard(m) {
  viewing.value = null;
  draft.value = { ...m, cat: m.cat || "", _tags: (m.tags || []).join("，"), _isNew: false };
}
async function changeImg() {
  const id = await pickAndCrop({ aspect: 4 / 3, title: "调整图片", maxSize: 1400 });
  if (!id) return;
  const orig = store.memories.find(x => x.id === draft.value.id);
  if (draft.value.img && draft.value.img !== orig?.img) deleteImage(draft.value.img);
  draft.value.img = id;
}
function save() {
  const { _isNew, _tags, ...m } = draft.value;
  m.tags = _tags.split(/[，,、\s]+/).map(x => x.trim()).filter(Boolean).slice(0, 8);
  m.importance = Number(m.importance) || 3;
  if (!m.cat) delete m.cat;
  if (_isNew && m.access === "pinned" && all.value.filter(BUCKETS.pinned.test).length >= PIN_MAX) { m.access = "normal"; toast(`常驻已经满 ${PIN_MAX} 张了，先放进普通`, 3000); }
  m.title = m.title.trim() || m.content.trim().slice(0, 12);
  m.content = m.content.trim();
  if (!m.content) return;
  const i = store.memories.findIndex(x => x.id === m.id);
  if (i >= 0) {
    if (store.memories[i].img && store.memories[i].img !== m.img) deleteImage(store.memories[i].img);
    store.memories[i] = { ...m, ts: Date.now(), updatedAt: Date.now() };
  } else {
    store.memories.push(m);
  }
  tab.value = m.roleId;
  draft.value = null;
}
// 删除：先进回收站（不再给他），回收站里可以恢复或者彻底删掉
function remove() {
  const m = store.memories.find(x => x.id === draft.value.id);
  if (m) trashMemory(m);
  draft.value = null;
  toast("放进回收站了");
}
</script>

<template>
  <div class="page memory">
    <h1 class="tab-title">Memory Studio</h1>

    <!-- 换角色：右上角展开 -->
    <p v-if="role" class="drawer-name">{{ role.name }} 的抽屉</p>
    <div v-if="role && store.roles.length > 1" class="who-switch">
      <button class="who-btn" @click="switchOpen = !switchOpen">
        <Avatar :img="role.avatar" :name="role.name" :color="role.color" :size="26" />
        <i class="caret">{{ switchOpen ? "▴" : "▾" }}</i>
      </button>
      <div v-if="switchOpen" class="who-menu">
        <button v-for="r in store.roles" :key="r.id" :class="{ on: tab === r.id }" @click="tab = r.id; switchOpen = false">
          <Avatar :img="r.avatar" :name="r.name" :color="r.color" :size="26" /> {{ r.name }} 的抽屉
        </button>
      </div>
    </div>

    <div v-if="role" class="views">
      <button :class="{ on: view === 'timeline' }" @click="view = 'timeline'">Timeline</button>
      <button :class="{ on: view === 'drawers' }" @click="view = 'drawers'">Drawers</button>
      <button v-if="!solo(role)" :class="{ on: view === 'scene' }" @click="view = 'scene'">Scenes</button>
      <button class="more" :class="{ due: reviewWaiting }" aria-label="更多" @click="menuOpen = !menuOpen">⋯</button>
      <!-- 以前那一列小链接、设置和说明书都收在这里 -->
      <div v-if="menuOpen" class="more-menu" @click="menuOpen = false">
        <button @click="showChat">看看聊天时发给{{ role.name }}的全部</button>
        <button @click="tryOpen = true">试试{{ role.name }}翻记忆会翻到什么</button>
        <button v-if="unsorted || sorting" :disabled="!!sorting" @click="sortCats">{{ sorting ? `正在分类… ${sorting}` : `给记忆分类（${unsorted} 张还没分）` }}</button>
        <button @click="healthOpen = true">记忆体检</button>
        <button :class="{ due: reviewWaiting }" @click="reviewOpen = true">{{ role.name }}的整理建议{{ reviewWaiting ? `（${reviewWaiting} 条等你看）` : "" }}</button>
        <button @click="setOpen = true">记忆设置</button>
        <button @click="guideOpen = true">说明书</button>
      </div>
    </div>
    <MemorySettings :open="setOpen" :him="role?.name || '他'" @close="setOpen = false" />
    <MemoryGuide :open="guideOpen" :him="role?.name || '他'" @close="guideOpen = false" />
    <PromptPreview :open="!!preview" :title="preview?.title" :parts="preview?.parts" @close="preview = null" />
    <TryRecall v-if="role" :open="tryOpen" :role="role" @close="tryOpen = false" />
    <ReviewSheet v-if="role" :open="reviewOpen" :role="role" @close="reviewOpen = false" @view="m => { reviewOpen = false; viewing = m; }" />
    <MemoryHealth v-if="role" :open="healthOpen" :role="role" @close="healthOpen = false" @view="m => { healthOpen = false; viewing = m; }" />

    <SceneMemory v-if="role && view === 'scene'" :role="role" />

    <!-- 时间轴：记忆卡片按日期排成一条线，每个点是一只小章鱼（样子看这条记忆从哪来） -->
    <template v-if="view === 'timeline'">
    <XinchaoDrawer v-if="xinchao" :key="role.id" :role="role" :open-id="openId" @opened="openId = null" />
    <template v-else-if="role">
    <div class="buckets">
      <button v-for="(b, k) in BUCKETS" :key="k" :class="{ on: bucket === k && !query.trim(), warn: k === 'pending' && countOf(k) }" @click="bucket = k; query = ''">
        {{ b.label }}<small>{{ k === "pinned" ? `${countOf(k)}/${PIN_MAX}` : countOf(k) }}</small>
      </button>
    </div>
    <div class="search">
      <Icon name="search" :size="16" />
      <input v-model="query" placeholder="搜索标题、内容、标签、日期" />
    </div>
    <div v-if="query.trim()" class="stoggles">
      <label><input v-model="withArchived" type="checkbox" /> 包含归档</label>
      <label><input v-model="withHistory" type="checkbox" /> 包含已过时</label>
    </div>
    <p v-else-if="bucket !== 'all'" class="btip">{{ BUCKETS[bucket].tip }}{{ bucket === "normal" ? `（现在每次最多 ${recallCount()} 张，⋯ → 记忆设置 里调）` : "" }}</p>
    <!-- 小章鱼的小表情是他的；小螃蟹的以后换成螃蟹，先只放一个小圆点 -->
    <div v-if="!solo(role)" class="legend"><span v-for="x in LEGEND" :key="x.k"><img :src="OCT[x.k]" alt="" />{{ x.label }}</span></div>

    <div class="tl">
      <template v-for="g in timeline" :key="g.key">
        <div class="mon">{{ g.label }}</div>
        <article v-for="m in g.items" :key="m.id" class="it" :class="{ off: !isLive(m) || accessOf(m) === 'archived' }" @click="viewing = m">
          <img v-if="!solo(role)" class="oct" :src="OCT[octOf(m)]" alt="" />
          <i v-else class="dot" />
          <div class="d">{{ md(m.date) }}</div>
          <img v-if="imgOf(m)" :src="imgOf(m)" alt="" class="pic" />
          <b>{{ m.title }}</b>
          <p>{{ m.content }}</p>
          <div class="tg">
            <span v-if="badge(m) !== '普通'" class="bdg" :class="[m.status || 'valid', accessOf(m)]">{{ badge(m) }}</span>
            <span v-if="m.cat">{{ m.cat }}</span>
            <span>{{ whoOf(m) }}</span>
          </div>
        </article>
      </template>
    </div>

    <p v-if="!cards.length" class="empty-hint">
      {{ query ? "没有找到相关的记忆（可以勾上「包含归档」「包含已过时」再找找）" : bucket === "all" || bucket === "normal" ? `还没有记忆。聊天时${role.name}会自己写下记忆，你也可以点右下角 ＋ 自己写。` : `「${BUCKETS[bucket].label}」里还没有卡片。` }}
    </p>

    <button class="fab" aria-label="写一张记忆卡片" @click="newCard"><Icon name="plus" :size="24" /></button>
    </template>
    </template>
    <p v-if="!store.roles.length" class="empty-hint">还没有角色，先去「设置」里添加一个吧</p>

    <!-- 抽屉：其他的资料，一叠文件夹，平时合着，点一个拉开 -->
    <div v-if="role && view === 'drawers'" class="drawers">
      <section v-for="(d, i) in drawers" :key="d.key" class="drw" :class="['k-' + d.key, { open: openDrawer === d.key }]" :style="{ zIndex: i + 1 }">
        <span class="lab" :style="{ marginLeft: 12 + i * 15 + '%' }">{{ d.en }}</span>
        <button class="drw-head" @click="openDrawer = openDrawer === d.key ? null : d.key">
          <b>{{ d.title }}</b><span>{{ d.sub }}</span><i>{{ openDrawer === d.key ? "收起 ▴" : drawerCount(d.key) }}</i>
        </button>
        <div v-if="openDrawer === d.key" class="drw-body">
          <template v-if="d.key === 'sum'">
      <article v-for="t in sums" :key="t.id" class="sum" @click="sumEdit = { t, text: t.summary.text }">
        <div class="meta"><span>「{{ t.title }}」 · {{ t.summary.count || 0 }} 条整理成{{ t.summary.from ? `（从「${t.summary.from}」带来）` : "" }}</span><span>{{ t.summary.at ? new Date(t.summary.at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : "" }}</span></div>
        <p>{{ t.summary.text }}</p>
      </article>
      <p v-if="!sums.length" class="empty-hint small">还没有聊天摘要。聊久了会自己整理，也可以在聊天的小世界里点「摘要记忆 → 现在整理」。</p>

          </template>
          <template v-else-if="d.key === 'now'">
      <article v-for="x in moment" :key="x.key" class="sum tmp">
        <div class="meta"><span>{{ x.label }}</span><span :class="x.text ? 'on' : ''">{{ x.text ? "现在带着" : "现在没有" }}</span></div>
        <ul v-if="x.key === 'self' && selfMoments.length" class="moms">
          <li v-for="m in selfMoments" :key="m.id"><span>{{ m.text }}</span><small>{{ ago(m.ts) }}</small><button aria-label="删掉" @click="removeMoment(m)"><Icon name="close" :size="14" /></button></li>
        </ul>
        <p v-else-if="x.text" class="pre fold" :class="{ open: momentOpen[x.key] }" @click="momentOpen[x.key] = !momentOpen[x.key]">{{ x.text }}</p>
        <button v-if="x.text && x.key !== 'self' && x.text.split('\n').length > 4" class="fold-btn" @click="momentOpen[x.key] = !momentOpen[x.key]">{{ momentOpen[x.key] ? "收起" : "展开全部" }}</button>
        <small class="rule">{{ x.rule }}</small>
      </article>

          </template>
          <template v-else-if="d.key === 'board'">
      <article v-if="!solo(role)" class="sum tmp board">
        <div class="meta"><span>共写：在写的书</span><span>归档了就不再记</span></div>
        <button v-for="x in boardWrite" :key="x.id" class="brow" @click="editProgress(x)"><b>《{{ x.title }}》</b><span>{{ x.board?.progress || x.board?.next ? `现在：${x.board.progress || "—"}；下一步：${x.board.next || "—"}` : "还没记进度" }}</span></button>
        <p v-if="!boardWrite.length" class="none">书桌上没有在写的书</p>
      </article>
      <article v-if="!solo(role)" class="sum tmp board">
        <div class="meta"><span>共读：在读和读完的书</span><span>读完的记一句印象</span></div>
        <button v-for="b in boardRead" :key="b.id" class="brow" :disabled="!b.mine" @click="editImpression(b)"><b>《{{ b.title }}》<template v-if="roundOf(b) > 1">（第 {{ roundOf(b) }} 次）</template></b><span>{{ b.mine ? b.impression?.text || "读完了，印象还没整理（点这里写）" : `在读，读到第 ${(b.pos?.ch || 0) + 1} / ${b.chapters.length} 章` }}</span></button>
        <p v-if="!boardRead.length" class="none">还没开始读书</p>
      </article>
      <article class="sum tmp board">
        <div class="meta"><span>邮箱：笔友</span><button class="add" @click="editPal()">＋ 记一个</button></div>
        <div v-for="x in boardPals" :key="x.id" class="brow pal" @click="editPal(x)"><b>{{ x.name || x.email }}</b><span>{{ x.note || "—" }}</span><button aria-label="删掉" @click.stop="removePal(x)"><Icon name="close" :size="14" /></button></div>
        <p v-if="!boardPals.length" class="none">还没记笔友。{{ role.name }}在邮箱里会自己记，邮箱页点开笔友也能写。</p>
      </article>

          </template>
          <template v-else-if="d.key === 'insight'">
            <p class="ins-note">这是{{ role.name }}自己的一本。进花园的几间屋子前他会先看最近的几条；看完通知、玩完一局、聊出想法后，他会自己往里记。</p>
            <div class="ins-cols">
              <section v-for="c in insightCols" :key="c.k" class="ins-col">
                <h4>{{ c.label }}<small>{{ c.list.length }}</small></h4>
                <article v-for="m in c.list" :key="m.id" class="sum tmp ins">
                  <div class="meta"><span>{{ md(m.date) }}</span><button aria-label="删掉" @click="dropInsight(m)"><Icon name="close" :size="14" /></button></div>
                  <p>{{ m.content }}</p>
                </article>
                <p v-if="!c.list.length" class="none">还没有</p>
              </section>
            </div>
          </template>
          <template v-else-if="d.key === 'letters'">
            <article class="sum tmp"><p class="pre">{{ letterLines || "还没有来往的信。" }}</p></article>
          </template>
          <template v-else>
        <article v-for="m in derived" :key="m.id" class="sum" @click="viewing = m">
          <div class="meta"><span>{{ m.bookId ? "共读 · 读书笔记" : "共写 · 写书的总结" }}</span><span>{{ md(m.date) }}</span></div>
          <h3>{{ m.title }}</h3>
          <p>{{ m.content }}</p>
        </article>
            <p v-if="!derived.length" class="empty-hint small">还没有从共读、共写整理来的。</p>
          </template>
        </div>
      </section>
    </div>

    <Sheet :open="!!sumEdit" title="聊天摘要" @close="sumEdit = null">
      <template v-if="sumEdit">
        <SummaryInfo :thread="sumEdit.t" />
        <BigTextarea v-model="sumEdit.text" rows="10" title="聊天摘要" />
        <p class="tip">用整理模型。看到错的可以直接改。</p>
        <div class="edit-actions">
          <button class="btn soft" :disabled="sumBusy" @click="sumNow">{{ sumBusy ? "在整理……" : "现在整理" }}</button>
          <button class="btn" @click="saveSum">保存</button>
        </div>
        <SumVersions :owner="sumEdit.t" @restored="sumEdit.text = sumEdit.t.summary?.text || ''" />
      </template>
    </Sheet>

    <!-- 查看 -->
    <Sheet :open="!!viewing" @close="viewing = null">
      <template v-if="viewing">
        <img v-if="imgOf(viewing)" :src="imgOf(viewing)" alt="" class="view-pic" />
        <div class="view-meta">{{ viewing.date }} · {{ viewing.source?.by === "helper" ? "整理模型建议的" : viewing.author === "me" ? "我写的" : `${roleById(viewing.roleId)?.name} 写的` }}{{ viewing.tags?.length ? ` · #${viewing.tags.join(" #")}` : "" }}{{ viewing.importance && viewing.importance !== 3 ? ` · ${"★".repeat(viewing.importance)}` : "" }}</div>
        <h2 class="view-title">{{ viewing.title }}</h2>
        <p class="view-body">{{ viewing.content }}</p>
        <p class="src">来源：{{ srcLine(viewing) }}<br />现在：{{ badge(viewing) }}{{ viewing.status === "valid" ? `（${ACCESS[accessOf(viewing)]}）` : "" }} · 创建 {{ fmt(viewing.createdAt || viewing.ts) }}{{ viewing.updatedAt && viewing.updatedAt !== viewing.createdAt ? ` · 更新 ${fmt(viewing.updatedAt)}` : "" }}</p>
        <div class="mem-acts">
          <template v-if="viewing.status === 'pending'">
            <button class="btn small" @click="act(viewing, 'confirm')">确认（放进普通）</button>
            <button class="btn soft small" @click="act(viewing, 'confirmPin')">确认并设为常驻</button>
          </template>
          <template v-else-if="viewing.status === 'deleted'">
            <button class="btn small" @click="act(viewing, 'restore')">恢复</button>
            <button class="btn soft small danger" @click="act(viewing, 'purge')">彻底删除</button>
          </template>
          <template v-else-if="viewing.status === 'obsolete'">
            <button class="btn soft small" @click="act(viewing, 'normal')">又成立了（放回普通）</button>
          </template>
          <template v-else>
            <button v-if="accessOf(viewing) !== 'pinned'" class="btn soft small" @click="act(viewing, 'pin')">设为常驻</button>
            <button v-if="accessOf(viewing) !== 'normal'" class="btn soft small" @click="act(viewing, 'normal')">{{ accessOf(viewing) === "pinned" ? "取消常驻" : "移回普通" }}</button>
            <button v-if="accessOf(viewing) !== 'archived'" class="btn soft small" @click="act(viewing, 'archive')">归档</button>
            <button class="btn soft small" @click="act(viewing, 'obsolete')">标记为已过时</button>
          </template>
          <button v-if="viewing.status !== 'deleted'" class="btn soft small" @click="editCard(viewing)"><Icon name="edit" :size="15" /> 编辑</button>
          <button v-if="viewing.status !== 'deleted'" class="btn soft small danger" @click="act(viewing, 'trash')">删除</button>
        </div>
      </template>
    </Sheet>

    <!-- 编辑 -->
    <Sheet :open="!!draft" :title="draft?._isNew ? '写一张记忆卡片' : '编辑记忆卡片'" @close="draft = null">
      <template v-if="draft">
        <label class="field">
          <span>放进谁的抽屉</span>
          <select v-model="draft.roleId" class="input">
            <option v-for="r in store.roles" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </label>
        <label class="field"><span>标题</span><input v-model="draft.title" class="input" placeholder="例如：第一次给小鸡起名字" /></label>
        <label class="field"><span>内容</span><BigTextarea v-model="draft.content" rows="5" title="记忆内容" placeholder="想让他一直记得的事" /></label>
        <div class="field two">
          <label><span>日期</span><input v-model="draft.date" class="input" type="date" /></label>
          <label><span>类别</span><select v-model="draft.cat" class="input"><option value="">还没分</option><option v-for="c in CATS" :key="c" :value="c">{{ c }}</option></select></label>
        </div>
        <div class="field two">
          <label><span>标签（逗号隔开，可不填）</span><input v-model="draft._tags" class="input" placeholder="比如：身体，学校" /></label>
          <label><span>重要程度</span><select v-model.number="draft.importance" class="input"><option v-for="n in 5" :key="n" :value="n">{{ "★".repeat(n) }}</option></select></label>
        </div>
        <div class="field">
          <span>图片（可选）</span>
          <div class="img-row">
            <div class="img-prev" :style="draftImg ? { backgroundImage: `url(${draftImg})` } : {}"><Icon v-if="!draftImg" name="image" :size="20" /></div>
            <button class="btn soft small" @click="changeImg">{{ draft.img ? "换一张" : "添加图片" }}</button>
            <button v-if="draft.img" class="btn soft small" @click="draft.img = null">去掉</button>
          </div>
        </div>
        <div class="edit-actions">
          <button v-if="!draft._isNew" class="btn danger" @click="remove">删除（进回收站）</button>
          <span class="spacer" />
          <button class="btn" :disabled="!draft.content.trim()" @click="save">保存</button>
        </div>
      </template>
    </Sheet>
  </div>
</template>

<style scoped>
.memory { position: relative; }
.drawer-name { text-align: center; margin: -6px 0 14px; font-size: 0.87rem; color: var(--text-2); }
.who-switch { position: absolute; top: calc(var(--safe-top, 0px) + 26px); right: 16px; z-index: 20; }
.who-btn { display: flex; align-items: center; gap: 4px; border: 0; background: var(--card); border-radius: 999px; padding: 4px 8px 4px 4px; box-shadow: var(--shadow-soft); font-size: 0.85rem; }
.caret { font-style: normal; color: var(--text-3); font-size: 0.7rem; }
.who-menu { position: absolute; right: 0; top: calc(100% + 6px); background: var(--card); border-radius: 16px; box-shadow: var(--shadow); padding: 6px; min-width: 170px; }
.who-menu button { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: none; padding: 8px; border-radius: 12px; font-size: 0.9rem; text-align: left; }
.who-menu button.on { background: var(--bg); font-weight: 600; }
.tabs { display: flex; justify-content: center; gap: 18px; overflow-x: auto; scrollbar-width: none; margin-bottom: 14px; }
.tabs::-webkit-scrollbar { display: none; }
.tabs button {
  flex: none;
  border: 0;
  background: none;
  padding: 4px 2px 6px;
  font-size: 0.8rem;
  color: var(--text-3);
  border-bottom: 2px solid transparent;
}
.tabs button.on { color: var(--text); font-weight: 600; border-bottom-color: var(--ink); }

.search {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--card);
  border-radius: 999px;
  padding: 9px 16px;
  box-shadow: var(--shadow-soft);
  color: var(--text-3);
  margin-bottom: 16px;
}
.search input { flex: 1; border: 0; outline: none; background: none; font-size: 0.93rem; color: var(--text); }

/* 三个标签：细字，下面一道线 */
.views { position: relative; display: flex; border-bottom: 1px solid var(--line); margin: 0 6px 12px; font-family: "Poppins", var(--font); }
.views .more { flex: none; width: 40px; color: var(--text-2); font-size: 1.1rem; letter-spacing: 1px; }
.views .more.due { color: #c9304c; }
.more-menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 25; width: 230px; background: var(--card); border-radius: 16px; box-shadow: 0 10px 30px rgba(40, 40, 60, .16); padding: 4px 0; font-family: var(--font); }
.more-menu button { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 10px 16px; font-size: .86rem; color: var(--text); border-radius: 0; }
.more-menu button + button { border-top: 1px solid var(--line); }
.more-menu button.due { color: #c9304c; font-weight: 600; }

/* 时间轴 */
.legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 2px 4px 6px; font-size: .7rem; color: var(--text-3); }
.legend span { display: flex; align-items: center; gap: 2px; }
.legend img { width: 30px; height: auto; image-rendering: pixelated; }
.tl { position: relative; padding: 6px 4px 0 58px; }
.tl::before { content: ""; position: absolute; left: 28px; top: 14px; bottom: 6px; width: 1px; background: var(--line); }
.mon { margin: 10px 0 8px -40px; font-family: "Poppins", var(--font); font-size: .68rem; letter-spacing: 2px; color: var(--text-3); }
.it { position: relative; margin-bottom: 14px; cursor: pointer; }
.it .dot { position: absolute; left: -36px; top: 4px; width: 11px; height: 11px; border-radius: 50%; background: var(--bg); box-shadow: 0 0 0 2px var(--text-3); }
.it .oct { position: absolute; left: -54px; top: -5px; width: 48px; height: auto; image-rendering: pixelated; background: var(--bg); padding: 1px 0; }
.it .d { font-family: "Poppins", var(--font); font-size: .7rem; color: var(--text-3); }
.it b { display: block; font-size: .95rem; font-weight: 600; margin: 1px 0 2px; }
.it p { margin: 0; font-size: .84rem; line-height: 1.55; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.it .pic { display: block; width: 120px; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 10px; margin: 4px 0; }
.it .tg { display: flex; gap: 5px; margin-top: 5px; }
.it .tg span { font-size: .66rem; padding: 1px 8px; border-radius: 999px; background: var(--card); color: var(--text-2); box-shadow: 0 0 0 1px var(--line); }
.it .tg .bdg.pinned { background: #f8e6e6; color: #c26f7c; box-shadow: none; }
:root[data-theme="dark"] .it .tg .bdg.pinned { background: #3d2f33; color: #f0a7b4; }
.it.off { opacity: .55; }

/* 抽屉：一叠文件夹，颜色照她的课表（奶咖、雾粉、灰豆沙、灰绿、鼠尾草绿） */
.drawers { padding: 18px 0 0; }
.drw { --c: #f1eadc; position: relative; margin-top: -16px; background: var(--c); border-radius: 6px 6px 0 0; box-shadow: 0 -2px 6px rgba(60, 50, 40, .05); }
.drw:first-child { margin-top: 0; }
.drw.k-now { --c: #eed5d6; }
.drw.k-board { --c: #e6d4cf; }
.drw.k-letters { --c: #dce0d4; }
.drw.k-insight { --c: #e3dcc8; }
.drw.k-rw { --c: #ced9d1; }
.drw:last-child, .drw.open { border-radius: 6px; padding-bottom: 6px; }
.drw.open { margin-bottom: 22px; }
:root[data-theme="dark"] .drw { --c: #3a362f; }
:root[data-theme="dark"] .drw.k-now { --c: #3d2f33; }
:root[data-theme="dark"] .drw.k-board { --c: #3b3230; }
:root[data-theme="dark"] .drw.k-letters { --c: #33362f; }
:root[data-theme="dark"] .drw.k-insight { --c: #38352b; }
:root[data-theme="dark"] .drw.k-rw { --c: #2e3632; }
.lab { position: absolute; top: -13px; height: 14px; padding: 0 12px; border-radius: 6px 6px 0 0; background: var(--c); font-family: "Poppins", var(--font); font-size: .6rem; letter-spacing: 1.8px; line-height: 16px; color: var(--text-2); }
.drw-head { display: flex; align-items: baseline; gap: 8px; width: 100%; border: 0; background: none; padding: 16px 16px 38px; text-align: left; color: var(--text); border-radius: 0; }
.drw.open .drw-head, .drw:last-child .drw-head { padding-bottom: 12px; }
.drw-head b { font-size: .95rem; font-weight: 500; }
.drw-head span { font-size: .74rem; color: var(--text-2); }
.drw-head i { margin-left: auto; font-style: normal; font-size: .74rem; color: var(--text-3); }
.drw-body { padding: 0 10px 6px; }
.drw-body .sum { border-radius: 6px; box-shadow: 0 1px 2px rgba(60, 50, 40, .06); }
.peek { display: block; margin: -4px 0 14px auto; border: 0; background: none; color: var(--text-2); font-size: .8rem; }
.peek + .peek { margin-top: -8px; }
.peek.due { color: #c9304c; font-weight: 600; }
.sec { margin: 18px 4px 10px; font-size: .92rem; font-weight: 600; }
.sec small { margin-left: 8px; font-weight: 400; font-size: .72rem; color: var(--text-3); }
.sum { background: var(--card); border-radius: 18px; padding: 12px 16px; margin-bottom: 10px; box-shadow: var(--shadow-soft); cursor: pointer; }
.ins-note { margin: 0 4px 10px; font-size: .76rem; line-height: 1.6; color: var(--text-3); }
.ins-cols { display: grid; grid-template-columns: 1fr; gap: 10px; }
@media (min-width: 640px) { .ins-cols { grid-template-columns: 1fr 1fr; align-items: start; } }
.ins-col h4 { margin: 2px 4px 6px; font-size: .84rem; font-weight: 500; color: var(--text-2); }
.ins-col h4 small { margin-left: 6px; color: var(--text-3); }
.ins-col .none { margin: 0 4px; font-size: .78rem; color: var(--text-3); }
.sum.ins { cursor: default; padding: 10px 14px; }
.sum.ins .meta button { border: 0; background: none; padding: 0; color: var(--text-3); display: grid; place-items: center; }
.sum.ins p { -webkit-line-clamp: unset; display: block; }
.sum h3 { margin: 0 0 4px; font-size: .95rem; }
.sum p { margin: 0; font-size: .85rem; line-height: 1.7; color: var(--text-2); white-space: pre-wrap; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
.empty-hint.small { font-size: .8rem; }
.tmp { cursor: default; }
.tmp .pre { -webkit-line-clamp: unset; display: block; }
.sug { border: 1.5px dashed var(--line); box-shadow: none; cursor: default; }
.sug-acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.mcard.off { opacity: .6; }
.buckets { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 2px 2px 8px; }
.buckets::-webkit-scrollbar { display: none; }
.buckets button { flex: none; border: 0; background: none; padding: 5px 12px; border-radius: 999px; font-size: .8rem; color: var(--text-2); box-shadow: inset 0 0 0 1px var(--line); }
.buckets button small { margin-left: 4px; font-size: .7rem; color: var(--text-3); }
.buckets button.on { background: var(--ink); color: var(--on-ink); font-weight: 600; }
.buckets button.on small { color: rgba(var(--glass-rgb), .7); }
.buckets button.warn:not(.on) { box-shadow: inset 0 0 0 1.5px #e9657e; }
.btip { margin: 0 4px 10px; font-size: .74rem; color: var(--text-3); line-height: 1.6; }
.stoggles { display: flex; gap: 14px; margin: -8px 6px 12px; font-size: .78rem; color: var(--text-2); }
.stoggles input { accent-color: var(--ink); }
.bdg { font-size: .66rem; padding: 1px 8px; border-radius: 999px; background: rgba(var(--glass-rgb), .7); }
.bdg.pending { background: color-mix(in srgb, #fde3ea var(--pastel), var(--card)); color: #c9304c; }
.bdg.obsolete, .bdg.deleted { background: var(--bg-deep); color: var(--text-3); }
.src { font-size: .74rem; line-height: 1.7; color: var(--text-3); margin: 12px 0 0; }
.field.two { display: grid; grid-template-columns: 1fr 120px; gap: 10px; }
.field.two label { display: flex; flex-direction: column; gap: 6px; }
.mem-acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.mem-acts .btn { display: inline-flex; align-items: center; gap: 4px; }
.tmp .on { color: #c9304c; font-weight: 600; }
.board { display: flex; flex-direction: column; gap: 6px; }
.brow { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; text-align: left; width: 100%; border: 0; background: rgba(var(--tint-rgb), .03); border-radius: 12px; padding: 8px 12px; font-size: .84rem; color: var(--text-2); cursor: pointer; }
.brow:disabled { cursor: default; color: var(--text-2); opacity: 1; }
.brow b { font-size: .86rem; color: var(--text); font-weight: 600; }
.brow.pal { position: relative; padding-right: 34px; }
.brow.pal button { position: absolute; right: 6px; top: 6px; border: 0; background: none; color: var(--text-3); padding: 4px; display: grid; place-items: center; }
.board .none { font-size: .8rem; color: var(--text-3); margin: 2px 0; }
.board .add { border: 0; background: none; color: var(--text-2); font-size: .76rem; padding: 0; }
.moms { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.moms li { display: flex; align-items: center; gap: 8px; font-size: .85rem; color: var(--text-2); background: rgba(var(--tint-rgb), .03); border-radius: 12px; padding: 6px 6px 6px 12px; }
.moms li span { flex: 1; min-width: 0; }
.moms li small { color: var(--text-3); font-size: .7rem; white-space: nowrap; }
.moms li button { border: 0; background: none; color: var(--text-3); padding: 4px; display: grid; place-items: center; }
.pre.fold:not(.open) { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; cursor: pointer; }
.fold-btn { border: 0; background: none; padding: 2px 0; font-size: .74rem; color: var(--text-3); }
.tmp .rule { display: block; margin-top: 6px; font-size: .7rem; line-height: 1.6; color: var(--text-3); }
.tip { font-size: .74rem; color: var(--text-3); line-height: 1.7; margin: 8px 2px 0; }
.views > button { flex: 1; border: 0; background: none; border-radius: 0; padding: 10px 4px; color: var(--text-3); font-size: .88rem; font-weight: 400; }
.views > button.on { color: var(--text); font-weight: 500; box-shadow: inset 0 -1.5px 0 var(--text); }
.hits { display: flex; flex-direction: column; gap: 10px; }
.hit { background: var(--card); border-radius: 18px; padding: 12px 14px; box-shadow: var(--shadow-soft); cursor: pointer; border-left: 4px solid var(--blue); }
.hit.mine { border-left-color: var(--pink); }
.hit-meta { display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--text-3); }
.hit p { margin: 4px 0 0; font-size: 0.9rem; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.hit p.clamp { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.hit .btn { margin-top: 8px; }
.star { border: 0; background: none; color: var(--text-3); padding: 2px; display: grid; place-items: center; }
.star.on { color: #e0a53a; }
.star.on :deep(path) { fill: currentColor; }
.cards { display: flex; flex-direction: column; gap: 14px; }
@media (min-width: 760px) {
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); align-items: start; }
}
.mcard {
  border-radius: 20px;
  padding: 14px 16px 12px;
  box-shadow: var(--shadow-soft);
  cursor: pointer;
}
.meta { display: flex; justify-content: space-between; font-size: 0.73rem; color: var(--text-3); margin-bottom: 8px; }
.pic { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 14px; margin-bottom: 10px; }
.mcard h3 { margin: 0 0 4px; font-size: 1rem; font-weight: 700; }
.mcard p {
  margin: 0;
  font-size: 0.87rem;
  color: var(--text-2);
  line-height: 1.65;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.by { display: flex; align-items: center; gap: 6px; margin-top: 10px; font-size: 0.75rem; color: var(--text-2); }
.by .chev { margin-left: auto; color: var(--text-3); }

.fab {
  position: fixed;
  right: max(20px, calc((100vw - 820px) / 2 + 20px));
  bottom: calc(var(--safe-bottom) + 80px);
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 0;
  background: var(--card);
  color: var(--ink);
  box-shadow: 0 6px 20px rgba(40, 40, 60, .16);
  display: grid;
  place-items: center;
  z-index: 15;
}

.view-pic { display: block; width: 100%; border-radius: 16px; margin-bottom: 12px; }
.view-meta { font-size: 0.8rem; color: var(--text-3); }
.view-title { margin: 6px 0 8px; font-size: 1.2rem; }
.view-body { margin: 0; white-space: pre-wrap; line-height: 1.75; font-size: 0.97rem; }
.edit-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.edit-actions .btn { display: flex; align-items: center; gap: 4px; }
.spacer { flex: 1; }
.img-row { display: flex; align-items: center; gap: 10px; }
.img-prev { width: 64px; height: 48px; border-radius: 10px; background: var(--bg) center / cover; display: grid; place-items: center; color: var(--text-3); box-shadow: 0 0 0 1px var(--line); }
</style>
