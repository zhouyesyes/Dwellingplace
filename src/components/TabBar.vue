<script setup>
// 底栏：四样海边的小东西（她生成的水彩图）——扇贝是家、海螺是记录、漂流瓶是记忆、海星是设置
import home from "../assets/tabbar/home.png";
import record from "../assets/tabbar/record.png";
import memory from "../assets/tabbar/memory.png";
import settings from "../assets/tabbar/settings.png";
defineProps({ active: String });
const tabs = [
  { key: "home", to: "/", img: home, label: "Home" },
  { key: "record", to: "/record", img: record, label: "Record" },
  { key: "memory", to: "/memory", img: memory, label: "Memory" },
  { key: "settings", to: "/settings", img: settings, label: "Settings" },
];
</script>

<template>
  <nav class="tabbar">
    <RouterLink v-for="t in tabs" :key="t.key" :to="t.to" replace class="tab" :class="{ on: active === t.key }" :aria-label="t.label">
      <img :src="t.img" alt="" draggable="false" />
      <span>{{ t.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  left: 50%;
  bottom: calc(var(--safe-bottom) + 10px);
  transform: translateX(-50%);
  width: min(380px, calc(100vw - 32px));
  height: 64px;
  display: flex;
  justify-content: space-around;
  align-items: center;
  background: rgba(var(--glass-rgb), .97);
  border-radius: 24px;
  box-shadow: 0 6px 22px rgba(40, 40, 60, .08), 0 0 0 1px var(--line);
  z-index: 20;
  font-family: "Poppins", var(--font);
}
.tab { display: flex; flex-direction: column; align-items: center; gap: 1px; width: 72px; padding-top: 2px; color: var(--text-3); text-decoration: none; }
.tab img { width: 34px; height: 34px; opacity: .72; filter: saturate(.8); transition: opacity .2s, transform .2s, filter .2s; -webkit-user-select: none; user-select: none; }
.tab span { font-size: .66rem; font-weight: 600; letter-spacing: .2px; }
.tab.on { color: var(--text); }
.tab.on img { opacity: 1; filter: none; transform: translateY(-1px) scale(1.06); }
:root[data-theme="dark"] .tab img { opacity: .6; }
:root[data-theme="dark"] .tab.on img { opacity: .95; }

/* 平板横屏：导航竖着放在左边 */
@media (min-width: 1000px) {
  .tabbar {
    left: calc(var(--safe-left, 0px) + 18px);
    top: 50%;
    bottom: auto;
    transform: translateY(-50%);
    width: 76px;
    height: auto;
    flex-direction: column;
    gap: 14px;
    padding: 14px 0;
    border-radius: 28px;
  }
}
</style>
