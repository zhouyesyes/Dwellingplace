<script setup>
// 主页：上面一张封面（点了换图），我和他的头像挨在一起、两个人的名字、一句简介；
// 下面一列紧挨着的条：第一条颜色不一样，是和他的聊天（点了就进去），后面几条是共读、共写、信、纪念日
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { store, roleById, threadsOf, MAIN } from "../store/index.js";
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
const bio = computed(() => store.profile.bioSelf || store.profile.bios[MAIN]?.text || "");
async function changeCover() {
  const id = await pickAndCrop({ aspect: Math.min(innerWidth, 680) / 230, title: "调整封面", maxSize: 1800 });
  if (!id) return;
  deleteImage(store.profile.cover);
  store.profile.cover = id;
}
async function changeAvatar() {
  const id = await pickAndCrop({ aspect: 1, round: true, title: "调整头像", maxSize: 500 });
  if (!id) return;
  deleteImage(store.profile.avatar);
  store.profile.avatar = id;
}
function rename() {
  const name = prompt("你的名字", store.profile.name);
  if (name?.trim()) store.profile.name = name.trim().slice(0, 20);
}

// ---------- 下面那一列 ----------
const thread = computed(() => threadsOf(MAIN)[0]);
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
  {
    key: "read", icon: "book", tint: "var(--green)", title: "共读", badge: bookNotes.value,
    sub: book.value ? `《${book.value.title}》${bookNotes.value ? ` · ${bookNotes.value} 张新便利贴` : ""}` : "放一本想一起读的书",
    go: () => router.push("/books"),
  },
  {
    key: "write", icon: "edit", tint: "var(--yellow)", title: "共写", badge: writeNotes.value,
    sub: project.value ? `《${project.value.title}》${writeNotes.value ? ` · ${writeNotes.value} 张新便利贴` : ""}` : "开一本一起写的书",
    go: () => router.push("/write"),
  },
  {
    key: "letter", icon: "mail", tint: "var(--pink)", title: "信", badge: unreadLetters.value,
    sub: unreadLetters.value ? `有 ${unreadLetters.value} 封还没拆` : (store.letters || []).length ? `一共 ${store.letters.length} 封` : "给他写第一封信",
    go: () => router.push("/letters"),
  },
  {
    key: "days", icon: "heart", tint: "var(--lilac)", title: "纪念日", badge: 0,
    sub: dayInfo.value ? (dayInfo.value.future ? `还有 ${dayInfo.value.until} 天` : `在一起第 ${dayInfo.value.day} 天 · 离${dayInfo.value.nextLabel}还有 ${dayInfo.value.until} 天`) : "加一个纪念日",
    go: () => anniv.value?.openManage(),
  },
]);
</script>

<template>
  <div ref="home" class="home">
    <div class="pull" :class="{ on: pullLabel }" role="status" aria-live="polite">{{ pullLabel }}</div>

    <div class="cover" :class="{ img: cover }" :style="cover ? { backgroundImage: `url(${cover})` } : null" @click="changeCover">
      <button class="gear" aria-label="设置" @click.stop="router.push('/settings')"><Icon name="settings" :size="18" /></button>
    </div>

    <div class="head">
      <div class="duo">
        <button class="ava" aria-label="换头像" @click="changeAvatar"><Avatar :img="store.profile.avatar" :name="store.profile.name" :color="store.profile.color" :size="78" /></button>
        <button v-if="him" class="ava his" :aria-label="`和${him.name}聊天`" @click="router.push(`/chat/${MAIN}`)"><Avatar :img="him.avatar" :name="him.name" :color="him.color" :size="78" /></button>
      </div>
      <h1><span @click="rename">{{ store.profile.name }}</span><i v-if="him"> &amp; </i><span v-if="him">{{ him.name }}</span></h1>
      <p class="bio" :class="{ ph: !bio }" @click="bioOpen = true">{{ bio || "点这里写一句简介，或者让他帮你写" }}</p>
    </div>

    <!-- 一列紧挨着的条：第一条是聊天 -->
    <div class="list">
      <button v-if="him" class="row chat" @click="router.push(`/chat/${MAIN}`)">
        <Avatar :img="him.avatar" :name="him.name" :color="him.color" :size="48" />
        <span class="txt"><b>{{ him.name }}</b><small>{{ thread?.preview || "和他说说话" }}</small></span>
        <span class="time">{{ when(thread?.updatedAt) }}</span>
      </button>
      <button v-for="r in rows" :key="r.key" class="row" @click="r.go()">
        <span class="ic" :style="{ background: r.tint }"><Icon :name="r.icon" :size="21" /></span>
        <span class="txt"><b>{{ r.title }}</b><small>{{ r.sub }}</small></span>
        <span v-if="r.badge" class="badge">{{ r.badge }}</span>
        <Icon v-else name="right" :size="16" class="chev" />
      </button>
    </div>

    <BioSheet :open="bioOpen" @close="bioOpen = false" />
    <!-- 纪念日的管理弹窗借用原来的小组件（它本身不显示） -->
    <div hidden><AnnivWidget ref="anniv" size="small" /></div>
  </div>
</template>

<style scoped>
.home { min-height: 100%; max-width: 680px; margin: 0 auto; padding: calc(var(--safe-top) + 10px) 14px calc(var(--tabbar-h) + var(--safe-bottom) + 36px); }
@media (min-width: 1000px) { .home { padding-bottom: 40px; } }
.pull { position: fixed; top: calc(var(--safe-top) + 10px); left: 50%; transform: translate(-50%, -8px); z-index: 5; padding: 6px 14px; border-radius: 999px; background: rgba(var(--glass-rgb), .92); box-shadow: var(--shadow-soft); font-size: .8rem; color: var(--text-2); opacity: 0; transition: opacity .2s, transform .2s; pointer-events: none; }
.pull.on { opacity: 1; transform: translate(-50%, 0); }

/* 封面：圆角的一张，默认是淡淡的雾蓝 */
.cover {
  position: relative; height: 210px; border-radius: 26px; cursor: pointer;
  background: linear-gradient(160deg, color-mix(in srgb, #dfe7f1 var(--pastel), var(--card)), color-mix(in srgb, #eef0f3 var(--pastel), var(--card)) 60%, color-mix(in srgb, #f3eef0 var(--pastel), var(--card)));
  background-size: cover; background-position: center;
}
.cover.img { box-shadow: inset 0 0 0 100vmax rgba(10, 12, 18, var(--img-dim)); }
.gear { position: absolute; top: 12px; right: 12px; width: 36px; height: 36px; border: 0; border-radius: 50%; display: grid; place-items: center; background: rgba(var(--glass-rgb), .78); color: var(--ink); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }

.head { padding: 0 10px; position: relative; z-index: 1; }
.duo { display: flex; margin: -44px 0 0 4px; }
.ava { padding: 0; border: 0; background: none; border-radius: 50%; }
.ava.his { margin-left: -14px; }
.ava :deep(.avatar) { box-shadow: 0 0 0 4px var(--bg), 0 6px 18px rgba(40, 40, 60, .12); }
h1 { margin: 12px 0 4px; font-size: 1.6rem; font-weight: 700; letter-spacing: .3px; line-height: 1.25; }
h1 i { font-style: normal; font-weight: 400; color: var(--text-3); }
.bio { margin: 0; font-size: .9rem; line-height: 1.6; color: var(--text-2); white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; cursor: pointer; }
.bio.ph { color: var(--text-3); }

/* 一列条：挨在一起，中间一道细线，整列是一张圆角的卡 */
.list { margin-top: 22px; background: var(--card); border-radius: 24px; box-shadow: var(--shadow); overflow: hidden; }
.row { width: 100%; display: flex; align-items: center; gap: 14px; padding: 14px 16px; border: 0; background: none; text-align: left; color: var(--text); position: relative; }
.row + .row::before { content: ""; position: absolute; top: 0; left: 78px; right: 16px; height: 1px; background: var(--line); }
.row.chat { background: color-mix(in srgb, var(--blue) 65%, var(--card)); padding: 16px; }
.row.chat + .row::before { display: none; }
.ic { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; flex: none; color: var(--ink); }
.txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.txt b { font-size: 1.02rem; font-weight: 600; }
.txt small { font-size: .82rem; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.time { align-self: flex-start; margin-top: 4px; font-size: .75rem; color: var(--text-3); flex: none; }
.badge { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--accent); color: #fff; font-size: .72rem; display: grid; place-items: center; flex: none; }
.chev { color: var(--text-3); flex: none; }
</style>
