<script setup>
import { store } from "../store/index.js";
import Avatar from "../components/Avatar.vue";
import { useImage, pickAndCrop, deleteImage } from "../lib/images.js";

const cover = useImage(() => store.profile.cover);

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
      <p class="bio">点封面、头像、名字都可以修改。简介和小组件桌面会在下一步做好～</p>
    </div>
  </div>
</template>

<style scoped>
.home { min-height: 100%; padding-bottom: calc(var(--tabbar-h) + var(--safe-bottom) + 28px); }
.cover {
  height: calc(var(--safe-top) + min(62vw, 340px));
  background: linear-gradient(135deg, #fde3e8 0%, #ece4fc 45%, #dcebfc 75%, #daf3e7 100%);
  background-size: cover;
  background-position: center;
  cursor: pointer;
}
.head { max-width: 680px; margin: 0 auto; padding: 0 22px; }
.ava { display: block; margin-top: -46px; padding: 0; border: 0; background: none; border-radius: 50%; }
.ava :deep(.avatar) { box-shadow: 0 0 0 3px #fff, 0 4px 14px rgba(40, 40, 60, .12); }
h1 { margin: 12px 2px 4px; font-size: 1.5rem; font-weight: 700; letter-spacing: .5px; cursor: pointer; }
.bio { margin: 0 2px; color: var(--text-2); font-size: 0.93rem; }
</style>
