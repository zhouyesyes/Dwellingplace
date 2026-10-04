<script setup>
import { ref, computed } from "vue";
import { store, roleById } from "../store/index.js";
import Avatar from "../components/Avatar.vue";
import BioSheet from "../components/home/BioSheet.vue";
import WidgetDesk from "../components/home/WidgetDesk.vue";
import { useImage, pickAndCrop, deleteImage } from "../lib/images.js";

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
    <div class="cover" :style="cover ? { backgroundImage: `url(${cover})` } : {}" @click="changeCover" />
    <div class="head">
      <button class="ava" aria-label="更换头像" @click="changeAvatar">
        <Avatar :img="store.profile.avatar" :name="store.profile.name" :color="store.profile.color" :size="86" />
      </button>
      <h1 @click="rename">{{ store.profile.name }}</h1>

      <div class="bio" @click="bioOpen = true">
        <p v-if="store.profile.bioSelf" class="self">{{ store.profile.bioSelf }}</p>
        <p v-for="b in aiBios" :key="b.role.id" class="ai" :style="{ '--c': b.role.color }">
          {{ b.text.replace(/\n\s*\n/g, "\n") }}<span class="by">— {{ b.role.name }}</span>
        </p>
        <p v-if="!store.profile.bioSelf && !aiBios.length" class="placeholder">点这里写简介，或者让 TA 们帮你写一段 ✎</p>
      </div>

      <WidgetDesk />
    </div>

    <BioSheet :open="bioOpen" @close="bioOpen = false" />
  </div>
</template>

<style scoped>
.home { min-height: 100%; padding-bottom: calc(var(--tabbar-h) + var(--safe-bottom) + 40px); }
.cover {
  height: calc(var(--safe-top) + min(62vw, 340px));
  background: linear-gradient(135deg, #fde3e8 0%, #ece4fc 45%, #dcebfc 75%, #daf3e7 100%);
  background-size: cover;
  background-position: center;
  cursor: pointer;
}
.head { max-width: 680px; margin: 0 auto; padding: 0 18px; }
.ava { display: block; margin: -46px 0 0 4px; padding: 0; border: 0; background: none; border-radius: 50%; }
.ava :deep(.avatar) { box-shadow: 0 0 0 3px #fff, 0 4px 14px rgba(40, 40, 60, .12); }
h1 { margin: 12px 6px 6px; font-size: 1.5rem; font-weight: 700; letter-spacing: .5px; cursor: pointer; }

.bio { margin: 0 6px; cursor: pointer; display: flex; flex-direction: column; gap: 8px; }
.bio p { margin: 0; font-size: 0.93rem; line-height: 1.7; color: var(--text-2); white-space: pre-wrap; }
.bio .self { color: var(--text); }
.bio .ai { padding-left: 10px; border-left: 3px solid var(--c); }
.bio .by { display: inline-block; margin-left: 6px; font-size: 0.8rem; color: var(--c); filter: saturate(1.4) brightness(.85); }
.bio .placeholder { color: var(--text-3); }
</style>
