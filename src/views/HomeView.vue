<script setup>
// 主页：最上面「Dwelling place」，一张封面（点了换图；设置在底栏），我和他的头像挨在一起、两个人的名字、一句简介；
// 下面一列紧挨着的条：第一条颜色不一样，是和他的聊天（点了就进去），后面几条只有一个英文粗标题（共读、共写、信、纪念日）。英文用 Poppins
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { store, uid, roleById, apiById, threadsOf, studioThreadOf, MAIN, CRAB } from "../store/index.js";
import { newApi } from "../lib/providers.js";
import { useImage, pickAndCrop, deleteImage } from "../lib/images.js";
import { anniversaryInfo } from "../lib/dates.js";
import { projects, freshNotes } from "../lib/writing.js";
import { syncState, startSync, resumeSync } from "../lib/sync.js";
import { useHomePullRefresh } from "../lib/homePullRefresh.js";
import Icon from "../components/Icon.vue";
import Avatar from "../components/Avatar.vue";
import BioSheet from "../components/home/BioSheet.vue";
import AnnivWidget from "../components/widgets/AnnivWidget.vue";

const router = useRouter();

// ---------- 下拉刷新、回到前台自动同步（和以前一样） ----------
const refreshing = ref(false);
const home = ref(null);
const feedback = ref("");
let feedbackTimer, disposed = false;
const busy = computed(() => refreshing.value || syncState.busy);
const { distance, armed } = useHomePullRefresh(home, busy, refreshHome);
const pullLabel = computed(() => distance.value ? (armed.value ? "松开刷新" : "下拉刷新") : refreshing.value ? "正在刷新…" : feedback.value);
async function refreshHome() {
  if (busy.value) return;
  clearTimeout(feedbackTimer);
  refreshing.value = true;
  let failed = false;
  try {
    await startSync();
    if (syncState.error) throw new Error(syncState.error);
    feedback.value = syncState.deferred || syncState.pending ? "仍有内容待同步" : !syncState.on ? "尚未连接同步" : "已是最新";
  } catch {
    failed = true;
    feedback.value = "刷新失败，请重试";
  } finally {
    refreshing.value = false;
    if (!disposed) feedbackTimer = setTimeout(() => { feedback.value = ""; }, failed ? 3500 : 1800);
  }
}
let foregroundAt = 0;
function foreground() {
  if (document.visibilityState !== "visible" || Date.now() - foregroundAt < 1000) return;
  foregroundAt = Date.now();
  resumeSync();
}
onMounted(() => {
  foreground();
  document.addEventListener("visibilitychange", foreground);
  window.addEventListener("pageshow", foreground);
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(feedbackTimer);
  document.removeEventListener("visibilitychange", foreground);
  window.removeEventListener("pageshow", foreground);
});

// ---------- 封面、头像、名字、简介 ----------
const him = computed(() => roleById(MAIN));
const cover = useImage(() => store.profile.cover);
const bioOpen = ref(false);
const bioOf = id => store.profile.bios[id]?.text?.replace(/\n\s*\n/g, "\n") || "";
const hisBio = computed(() => bioOf(MAIN));
async function changeCover() {
  const id = await pickAndCrop({ aspect: Math.min(innerWidth, 680) / 230, title: "调整封面", maxSize: 1800 });
  if (!id) return;
  deleteImage(store.profile.cover);
  store.profile.cover = id;
}
// 我的名字：用设定里写的（他角色设定里的「我」的称呼 > 用户名），不用主页标题「栖所」
const myName = computed(() => him.value?.me?.name || store.profile.userName || "我");

// ---------- 下面那一列 ----------
const thread = computed(() => threadsOf(MAIN)[0]);
// 小螃蟹住进来了的话：他下面再一条
const crab = computed(() => roleById(CRAB));
const crabThread = computed(() => threadsOf(CRAB)[0]);
const studioThread = computed(() => store.threads.find(t => t.roleId === CRAB && t.studio));
// 工作室：照着小螃蟹聊天的地址（…/claude/v1）配一个工作室的（…/claude/studio/v1），单独一个对话
function openStudio() {
  const chatApi = apiById(crab.value.apiId);
  if (!chatApi) return router.push(`/settings/role/${CRAB}`);
  const url = chatApi.baseUrl.replace(/\/+$/, "").replace(/\/claude\/v1$/i, "/claude/studio/v1");
  let api = store.apis.find(a => a.baseUrl?.replace(/\/+$/, "") === url);
  if (!api) {
    api = { ...newApi("openai"), id: uid(), name: "小螃蟹的工作室", baseUrl: url, key: "plan", model: chatApi.model || "sonnet", favModels: ["sonnet", "opus"] };
    store.apis.push(api);
  }
  router.push(`/chat/${CRAB}/${studioThreadOf(CRAB, api.id).id}`);
}
const when = ts => {
  if (!ts) return "";
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const book = computed(() => [...(store.books || [])].sort((a, b) => (b.readAt || b.addedAt || 0) - (a.readAt || a.addedAt || 0))[0]);
const bookNotes = computed(() => (store.bookNotes || []).filter(n => n.from === "ai" && !n.seen).length);
const project = computed(() => [...projects()].sort((a, b) => b.updatedAt - a.updatedAt)[0]);
const writeNotes = computed(() => freshNotes().length);
const unreadLetters = computed(() => (store.letters || []).filter(l => l.from === "ai" && !l.readAt).length);
const day = computed(() => store.anniversaries.find(a => a.roleId === MAIN) || store.anniversaries[0] || null);
const dayInfo = computed(() => day.value && anniversaryInfo(day.value.date));
const anniv = ref(null);

const rows = computed(() => [
  { key: "read", title: "Reading", meta: book.value ? `《${book.value.title}》` : "", badge: bookNotes.value, go: () => router.push("/books") },
  { key: "write", title: "Writing", meta: project.value ? `《${project.value.title}》` : "", badge: writeNotes.value, go: () => router.push("/write") },
  { key: "letter", title: "Letters", meta: (store.letters || []).length ? `${store.letters.length} 封` : "", badge: unreadLetters.value, go: () => router.push("/letters") },
  { key: "days", title: "Days", meta: dayInfo.value ? (dayInfo.value.future ? `还有 ${dayInfo.value.until} 天` : `第 ${dayInfo.value.day} 天`) : "", badge: 0, go: () => anniv.value?.openManage() },
]);
</script>

<template>
  <div ref="home" class="home">
    <div class="pull" :class="{ on: pullLabel }" role="status" aria-live="polite">{{ pullLabel }}</div>

    <h1 class="tab-title">Dwelling place</h1>
    <div class="cover" :class="{ img: cover }" :style="cover ? { backgroundImage: `url(${cover})` } : null" @click="changeCover" />

    <div class="head">
      <!-- 头像挨在中间：他在左、我在正中、小螃蟹在右；点他们的进各自的聊天，我的头像在「设置 → 外观」里换 -->
      <div class="duo">
        <button v-if="him" class="ava his" :aria-label="`和${him.name}聊天`" @click="router.push(`/chat/${MAIN}`)"><Avatar :img="him.avatar" :name="him.name" :color="him.color" :size="68" /></button>
        <span class="ava me"><Avatar :img="store.profile.avatar" :name="myName" :color="store.profile.color" :size="68" /></span>
        <button v-if="crab" class="ava crab" :aria-label="`和${crab.name}聊天`" @click="router.push(`/chat/${CRAB}`)"><Avatar :img="crab.avatar" :name="crab.name" :color="crab.color" :size="68" /></button>
      </div>
      <div class="bios" @click="bioOpen = true">
        <p v-if="store.profile.bioSelf" class="bio">{{ store.profile.bioSelf }}</p>
        <p v-if="hisBio" class="bio his">{{ hisBio }}<span class="by"> — {{ him.name }}</span></p>
        <p v-if="crab && bioOf(CRAB)" class="bio his">{{ bioOf(CRAB) }}<span class="by"> — {{ crab.name }}</span></p>
        <p v-if="!store.profile.bioSelf && !hisBio" class="bio ph">点这里写一句简介，或者让他帮你写</p>
      </div>
    </div>

    <!-- 一列紧挨着的条：第一条是聊天 -->
    <div class="list">
      <button v-if="him" class="row chat" @click="router.push(`/chat/${MAIN}`)">
        <Avatar :img="him.avatar" :name="him.name" :color="him.color" :size="36" class="flat" />
        <span class="txt"><b>{{ him.name }}</b><small>{{ thread?.preview || "和他说说话" }}</small></span>
        <span class="time">{{ when(thread?.updatedAt) }}</span>
      </button>
      <button v-if="crab" class="row chat crab" @click="router.push(`/chat/${CRAB}`)">
        <Avatar :img="crab.avatar" :name="crab.name" :color="crab.color" :size="36" class="flat" />
        <span class="txt"><b>{{ crab.name }}</b><small>{{ crabThread?.preview || "来小螃蟹的房间坐坐" }}</small></span>
        <span class="time">{{ when(crabThread?.updatedAt) }}</span>
      </button>
      <button v-if="crab" class="row chat crab studio" @click="openStudio">
        <span class="desk">🦀</span>
        <span class="txt"><b>小螃蟹的工作室</b><small>{{ studioThread?.preview || "让它自己翻栖所的施工日志，写进它的记忆" }}</small></span>
        <span class="time">{{ when(studioThread?.updatedAt) }}</span>
      </button>
      <button v-for="r in rows" :key="r.key" class="row plain" @click="r.go()">
        <b class="en">{{ r.title }}</b>
        <span class="meta">{{ r.meta }}</span>
        <span v-if="r.badge" class="badge">{{ r.badge }}</span>
        <Icon name="right" :size="15" class="chev" />
      </button>
    </div>

    <BioSheet :open="bioOpen" @close="bioOpen = false" />
    <!-- 纪念日的管理弹窗借用原来的小组件（它本身不显示） -->
    <div hidden><AnnivWidget ref="anniv" size="small" /></div>
  </div>
</template>

<style scoped>
.home {
  /* 聊天那条用底栏海星的淡粉，和底栏统一 */
  --home-bg: var(--bg); --home-card: #fbfaf8; --home-chat: #f8e6e6; --home-line: var(--line);
  font-family: "Poppins", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", system-ui, sans-serif;
  min-height: 100%; max-width: 680px; margin: 0 auto; background: var(--home-bg); padding: 0 0 calc(var(--tabbar-h) + var(--safe-bottom) + 36px); }
@media (min-width: 1000px) { .home { padding-bottom: 40px; } }
:root[data-theme="dark"] .home { --home-card: var(--card); --home-chat: #3d2f33; }
.pull { position: fixed; top: calc(var(--safe-top) + 10px); left: 50%; transform: translate(-50%, -8px); z-index: 5; padding: 6px 14px; border-radius: 999px; background: rgba(var(--glass-rgb), .92); box-shadow: var(--shadow-soft); font-size: .8rem; color: var(--text-2); opacity: 0; transition: opacity .2s, transform .2s; pointer-events: none; }
.pull.on { opacity: 1; transform: translate(-50%, 0); }

/* 封面：圆角的一张，默认是淡淡的雾蓝 */
.cover {
  position: relative; height: 200px; margin: 0 8px; border-radius: 12px; cursor: pointer;
  background: linear-gradient(160deg, color-mix(in srgb, #e4e6e8 var(--pastel), var(--card)), color-mix(in srgb, #ece9e5 var(--pastel), var(--card)) 60%, color-mix(in srgb, #efe9e6 var(--pastel), var(--card)));
  background-size: cover; background-position: center;
}
.cover.img { box-shadow: inset 0 0 0 100vmax rgba(10, 12, 18, var(--img-dim)); }

.head { padding: 0 24px; position: relative; z-index: 1; text-align: center; }
.duo { display: flex; justify-content: center; align-items: center; margin: -36px 0 0; }
.ava { padding: 0; border: 0; background: none; border-radius: 50%; flex: none; }
.ava + .ava { margin-left: -12px; }
.ava.me { z-index: 2; }
.ava { position: relative; z-index: 1; }
.ava :deep(.avatar) { box-shadow: 0 0 0 2.5px var(--home-bg), 0 6px 16px rgba(40, 40, 60, .1); }
.bios { margin: 12px auto 0; max-width: 320px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
.bio.his { color: var(--text-2); }
.by { color: var(--text-3); white-space: nowrap; }
.bio { margin: 0; font-size: .82rem; line-height: 1.6; color: var(--text-2); white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; cursor: pointer; }
.bio.ph { color: var(--text-3); }

/* 一列条：挨在一起，中间一道细线，整列是一张圆角的卡 */
.list { margin-top: 26px; border-top: 1px solid var(--home-line); border-bottom: 1px solid var(--home-line); }
.row { width: 100%; display: flex; align-items: center; gap: 14px; padding: 14px 24px; border-radius: 0; border: 0; background: none; text-align: left; color: var(--text); position: relative; }
.row + .row::before { content: ""; position: absolute; top: 0; left: 24px; right: 0; height: 1px; background: var(--home-line); }
.row.chat { background: var(--home-chat); padding: 10px 24px; gap: 12px; }
.row.chat :deep(.avatar.flat) { box-shadow: none; }
/* 小螃蟹那条：淡淡的珊瑚橘，和他那条一样细；两条之间一道细线 */
.row.chat.crab { background: color-mix(in srgb, #f7e3d6 70%, var(--home-bg)); }
:root[data-theme="dark"] .row.chat.crab { background: #3a3029; }
.desk { width: 36px; height: 36px; flex: none; display: grid; place-items: center; font-size: 1.15rem; border-radius: 50%; background: rgba(var(--glass-rgb), .6); }
.row.chat + .row.chat.crab::before { display: block; left: 24px; background: rgba(var(--tint-rgb), .05); }
.row.plain { padding: 13px 24px; }
.en { flex: 1; font-size: .92rem; font-weight: 600; letter-spacing: .1px; }
.meta { font-size: .8rem; color: var(--text-3); max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row.chat + .row::before { display: none; }
.txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0; }
.txt b { font-size: .88rem; font-weight: 600; }
.txt small { font-size: .82rem; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.time { align-self: flex-start; margin-top: 2px; font-size: .75rem; color: var(--text-3); flex: none; }
.badge { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--accent); color: #fff; font-size: .72rem; display: grid; place-items: center; flex: none; }
.chev { color: var(--text-3); flex: none; }
</style>
