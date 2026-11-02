<script setup>
// 桌宠：小章鱼、小螃蟹各一个开关，各管各的
import { store } from "../store/index.js";
import Icon from "../components/Icon.vue";
import SubHeader from "../components/SubHeader.vue";
</script>

<template>
  <div class="page pet">
    <SubHeader title="桌宠" />
    <div class="list-card">
      <div class="list-row">
        <Icon name="heart" :size="20" /><span class="grow">桌宠小章鱼<span class="sub">站在输入框上面，他回复时敲键盘；共读时站在「一起读」上面</span></span>
        <div class="seg">
          <button :class="{ on: store.settings.pet !== false }" @click="store.settings.pet = true">开</button>
          <button :class="{ on: store.settings.pet === false }" @click="store.settings.pet = false">关</button>
        </div>
      </div>
      <div class="list-row">
        <Icon name="heart" :size="20" /><span class="grow">桌宠小螃蟹<span class="sub">在 CC 的聊天页，站在输入框上面，动作和小章鱼一样</span></span>
        <div class="seg">
          <button :class="{ on: store.settings.petCrab !== false }" @click="store.settings.petCrab = true">开</button>
          <button :class="{ on: store.settings.petCrab === false }" @click="store.settings.petCrab = false">关</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.seg { display: flex; background: var(--bg); border-radius: 12px; padding: 3px; gap: 2px; }
.seg button { border: 0; background: none; border-radius: 9px; padding: 4px 12px; font-size: 0.87rem; color: var(--text-2); }
.seg button.on { background: var(--card); color: var(--text); box-shadow: var(--shadow-soft); font-weight: 600; }
.list-row .sub { display: block; font-size: .76rem; color: var(--text-3); font-weight: 300; }
</style>
