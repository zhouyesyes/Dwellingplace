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
import { wr, refresh as refreshWorkroom } from "../lib/workroom.js";

const refreshing = ref(false);
const refreshError = ref("");
const checked = ref(false);
const refreshLabel = computed(() => {
  if (refreshing.value || syncState.busy) return "正在同步…";
  if (refreshError.value || syncState.error) return "刷新失败，点此重试";
  if (syncState.deferred || syncState.pending) return "仍有内容待同步 · 刷新";
  if (!syncState.on) return "刷新 · 尚未连接同步";
  if (checked.value || syncState.lastAt) return syncState.updated ? "已更新 · 刷新" : "已是最新 · 刷新";
  return "刷新";
});
async function refreshHome() {
  if (refreshing.value) return;
  refreshing.value = true;
  refreshError.value = "";
  try {
    await startSync();
    if (store.widgets.some(w => w.type === "work")) {
      await refreshWorkroom();
      if (wr.error) throw new Error(wr.error);
    }
    checked.value = true;
  } catch (e) { refreshError.value = e.message || String(e); }
  finally { refreshing.value = false; }
}
let foregroundAt = 0;
function foreground() {
  if (document.visibilityState !== "visible" || Date.now() - foregroundAt < 1000) return;
  foregroundAt = Date.now();
  resumeSync();
  if (store.widgets.some(w => w.type === "work")) refreshWorkroom();
}
onMounted(() => {
  foreground();
  document.addEventListener("visibilitychange", foreground);
  window.addEventListener("pageshow", foreground);
  window.addEventListener("focus", foreground);
  window.addEventListener("online", foreground);
});
onBeforeUnmount(() => {
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
  <div class="home">
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
      <h1 @click="rename">{{ store.profile.name }}</h1>

      <div class="bio" @click="bioOpen = true">
        <p v-if="store.profile.bioSelf" class="self">{{ store.profile.bioSelf }}</p>
        <p v-for="b in aiBios" :key="b.role.id" class="ai" :style="{ '--c': b.role.color }">
          {{ b.text.replace(/\n\s*\n/g, "\n") }}<span class="by">— {{ b.role.name }}</span>
        </p>
        <p v-if="!store.profile.bioSelf && !aiBios.length" class="placeholder">点这里写简介，或者让他帮你写一段 ✎</p>
      </div>

      <div class="refresh-row" aria-live="polite" role="status">
        <button class="refresh-home" :disabled="refreshing || syncState.busy" :aria-busy="refreshing || syncState.busy" @click="refreshHome">↻ {{ refreshLabel }}</button>
        <span v-if="refreshError || syncState.error" class="refresh-error">{{ refreshError || syncState.error }}</span>
      </div>
      <WidgetDesk />
    </div>

    <BioSheet :open="bioOpen" @close="bioOpen = false" />
  </div>
</template>

<style scoped>
.refresh-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin: 12px 6px 0; }
.refresh-home { min-height: 44px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--card); color: var(--text-2); font-size: .8rem; cursor: pointer; }
.refresh-home:disabled { opacity: .7; cursor: progress; }
.refresh-error { color: var(--danger); font-size: .75rem; overflow-wrap: anywhere; }
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
