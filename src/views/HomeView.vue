<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { store, roleById, MAIN } from "../store/index.js";
import Icon from "../components/Icon.vue";
import Avatar from "../components/Avatar.vue";
import BioSheet from "../components/home/BioSheet.vue";
import WidgetDesk from "../components/home/WidgetDesk.vue";
import { useImage, pickAndCrop, deleteImage } from "../lib/images.js";

import { syncState, startSync, resumeSync } from "../lib/sync.js";
import { useHomePullRefresh } from "../lib/homePullRefresh.js";

const refreshing = ref(false);
const refreshError = ref("");
const home = ref(null);
const feedback = ref("");
let feedbackTimer;
let disposed = false;
const busy = computed(() => refreshing.value || syncState.busy);
const { distance, armed } = useHomePullRefresh(home, busy, refreshHome);
const pullLabel = computed(() => distance.value ? (armed.value ? "松开刷新" : "下拉刷新") : refreshing.value ? "正在刷新…" : feedback.value);
const refreshLabel = computed(() => busy.value ? "正在刷新…" : refreshError.value || syncState.error ? "刷新失败，点击重试" : "刷新主页");
async function refreshHome() {
  if (busy.value) return;
  clearTimeout(feedbackTimer);
  feedback.value = "";
  refreshing.value = true;
  refreshError.value = "";
  try {
    await startSync();
    if (syncState.error) throw new Error(syncState.error);
    feedback.value = syncState.deferred || syncState.pending ? "仍有内容待同步" : !syncState.on ? "尚未连接同步" : "已是最新";
  } catch (e) {
    refreshError.value = e.message || String(e);
    feedback.value = "刷新失败，请重试";
  } finally {
    refreshing.value = false;
    if (!disposed) feedbackTimer = setTimeout(() => { feedback.value = ""; }, refreshError.value ? 3500 : 1800);
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
  window.addEventListener("focus", foreground);
  window.addEventListener("online", foreground);
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(feedbackTimer);
  document.removeEventListener("visibilitychange", foreground);
  for (const event of ["pageshow", "focus", "online"]) window.removeEventListener(event, foreground);
});

const router = useRouter();
const him = computed(() => roleById(MAIN));
const cover = useImage(() => store.profile.cover);
const bioOpen = ref(false);

const aiBios = computed(() =>
  Object.entries(store.profile.bios)
    .map(([id, b]) => ({ role: roleById(id), ...b }))
    .filter(b => b.role),
);

function coverAspect() {
  const w = innerWidth;
  const h = Math.min(w * 0.62, 340) + 47; // 大约加上状态栏的高度
  return w / h;
}

async function changeCover() {
  const id = await pickAndCrop({ aspect: coverAspect(), title: "调整封面", maxSize: 1800 });
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
  const name = prompt("主页的名字", store.profile.name);
  if (name?.trim()) store.profile.name = name.trim().slice(0, 20);
}
</script>

<template>
  <div ref="home" class="home">
    <div class="pull-space" :style="{ height: `calc(${distance || (pullLabel ? 40 : 0)}px + ${distance || pullLabel ? 'var(--safe-top)' : '0px'})` }">
      <div class="pull-status" role="status" aria-live="polite"><span v-if="pullLabel" aria-hidden="true">↻ </span>{{ pullLabel }}</div>
    </div>
    <div class="cover" :class="{ img: cover }" :style="cover ? { backgroundImage: `url(${cover})` } : {}" @click="changeCover" />
    <div class="head">
      <!-- 我和他的头像挨在一起；右边是进聊天的入口 -->
      <div class="duo">
        <button class="ava" aria-label="更换头像" @click="changeAvatar">
          <Avatar :img="store.profile.avatar" :name="store.profile.name" :color="store.profile.color" :size="86" />
        </button>
        <button v-if="him" class="ava his" :aria-label="`和${him.name}聊天`" @click="router.push(`/chat/${MAIN}`)">
          <Avatar :img="him.avatar" :name="him.name" :color="him.color" :size="86" />
        </button>
        <button class="tools" aria-label="设置" @click="router.push('/settings')"><Icon name="settings" :size="19" /></button>
        <button v-if="him" class="talk" @click="router.push(`/chat/${MAIN}`)"><Icon name="chat" :size="18" />对话</button>
      </div>
      <div class="name-row">
        <h1 @click="rename">{{ store.profile.name }}</h1>
        <button class="refresh-home" :disabled="busy" :aria-busy="busy" :aria-label="refreshLabel" :title="refreshLabel" @click="refreshHome">↻</button>
      </div>

      <div class="bio" @click="bioOpen = true">
        <p v-if="store.profile.bioSelf" class="self">{{ store.profile.bioSelf }}</p>
        <p v-for="b in aiBios" :key="b.role.id" class="ai" :style="{ '--c': b.role.color }">
          {{ b.text.replace(/\n\s*\n/g, "\n") }}<span class="by">— {{ b.role.name }}</span>
        </p>
        <p v-if="!store.profile.bioSelf && !aiBios.length" class="placeholder">点这里写简介，或者让他帮你写一段 ✎</p>
      </div>

      <WidgetDesk />
    </div>

    <BioSheet :open="bioOpen" @close="bioOpen = false" />
  </div>
</template>

<style scoped>
.pull-space { overflow: hidden; transition: height .18s ease; }
.pull-status { box-sizing: border-box; padding-top: var(--safe-top); height: 100%; display: flex; justify-content: center; align-items: center; gap: 5px; font-size: .8rem; color: var(--text-2); }
.name-row { display: flex; align-items: center; gap: 8px; }
.name-row h1 { flex: 1; }
.refresh-home { flex: none; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--text-2); font-size: 1.4rem; }
.refresh-home:disabled { opacity: .5; cursor: progress; }
.refresh-home:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .pull-space { transition: none; } }
.home { min-height: 100%; padding-bottom: calc(var(--tabbar-h) + var(--safe-bottom) + 40px); }
.cover {
  height: calc(var(--safe-top) + min(62vw, 340px));
  background: linear-gradient(135deg, color-mix(in srgb, #fde3e8 var(--pastel), var(--card)) 0%, color-mix(in srgb, #ece4fc var(--pastel), var(--card)) 45%, color-mix(in srgb, #dcebfc var(--pastel), var(--card)) 75%, color-mix(in srgb, #daf3e7 var(--pastel), var(--card)) 100%);
  background-size: cover;
  background-position: center;
  cursor: pointer;
}
.cover.img { box-shadow: inset 0 0 0 100vmax rgba(10, 12, 18, var(--img-dim)); }
.head { max-width: 680px; margin: 0 auto; padding: 0 18px; }
@media (min-width: 760px) { .head { max-width: 820px; padding: 0 28px; } }
@media (min-width: 1000px) { .home { padding-bottom: 40px; } }
.duo { display: flex; align-items: flex-end; margin: -46px 0 0 4px; }
.ava { display: block; padding: 0; border: 0; background: none; border-radius: 50%; position: relative; }
.ava.his { margin-left: -16px; }
/* 和头像一样，一半在封面上、一半在白底上 */
.tools { margin: 0 8px 0 auto; align-self: center; width: 44px; height: 44px; border-radius: 50%; border: 0; display: grid; place-items: center; background: var(--card); color: var(--ink); box-shadow: 0 0 0 3px var(--card), 0 4px 14px rgba(40, 40, 60, .14); }
.talk { margin: 0 2px; align-self: center; display: flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; padding: 9px 18px; background: var(--ink); color: var(--on-ink); font-weight: 600; font-size: .9rem; box-shadow: 0 4px 14px rgba(40, 40, 60, .14); }
.ava :deep(.avatar) { box-shadow: 0 0 0 3px var(--card), 0 4px 14px rgba(40, 40, 60, .12); }
h1 { margin: 12px 6px 6px; font-size: 1.5rem; font-weight: 700; letter-spacing: .5px; cursor: pointer; }

.bio { margin: 0 6px; cursor: pointer; display: flex; flex-direction: column; gap: 8px; }
.bio p { margin: 0; font-size: 0.93rem; line-height: 1.7; color: var(--text-2); white-space: pre-wrap; }
.bio .self { color: var(--text); }
.bio .ai { padding-left: 10px; border-left: 3px solid var(--c); }
.bio .by { display: inline-block; margin-left: 6px; font-size: 0.8rem; color: var(--c); filter: saturate(1.4) brightness(.85); }
.bio .placeholder { color: var(--text-3); }
</style>
