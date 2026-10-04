<script setup>
import { store } from "../store/index.js";
import Avatar from "../components/Avatar.vue";
import { useImage } from "../lib/images.js";

const cover = useImage(() => store.profile.cover);
</script>

<template>
  <div class="page home">
    <div class="profile card">
      <div class="cover" :style="cover ? { backgroundImage: `url(${cover})` } : {}" />
      <div class="avatar-wrap">
        <Avatar :img="store.profile.avatar" :name="store.profile.name" :color="store.profile.color" :size="88" />
      </div>
      <h1>{{ store.profile.name }}</h1>
      <p class="bio">简介、组件桌面、小鸡、纪念日和日历，会在下一步做好～</p>
    </div>
  </div>
</template>

<style scoped>
.profile { overflow: hidden; padding-bottom: 22px; }
.cover {
  height: 170px;
  background: linear-gradient(135deg, #f3d9d2, #f6e7bf 55%, #dfead3);
  background-size: cover;
  background-position: center;
}
.avatar-wrap { margin: -48px 0 0 22px; }
h1 { margin: 10px 24px 4px; font-size: 22px; }
.bio { margin: 0 24px; color: var(--text-2); font-size: 14px; }
</style>
