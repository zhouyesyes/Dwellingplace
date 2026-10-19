<script setup>
// 底栏：四样海边的小东西（她生成的水彩图）——扇贝是家、海螺是记录、漂流瓶是记忆、海星是设置
import home from "../assets/tabbar/home.png";
import record from "../assets/tabbar/record.png";
import memory from "../assets/tabbar/memory.png";
import settings from "../assets/tabbar/settings.png";
defineProps({ active: String });
const tabs = [
  // tilt：有两个随手歪一点，不是每个都歪
  { key: "home", to: "/", img: home, label: "Home", tilt: 0 },
  { key: "record", to: "/record", img: record, label: "Record", tilt: -9 },
  { key: "memory", to: "/memory", img: memory, label: "Memory", tilt: 10 },
  { key: "settings", to: "/settings", img: settings, label: "Settings", tilt: 0 },
];
</script>

<template>
  <nav class="tabbar">
    <RouterLink v-for="t in tabs" :key="t.key" :to="t.to" replace class="tab" :class="{ on: active === t.key }" :aria-label="t.label">
      <img :src="t.img" alt="" draggable="false" :style="{ '--tilt': t.tilt + 'deg' }" />
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
  height: 44px; /* 底下这条压矮：图标从上沿冒出去一点 */
  display: flex;
  justify-content: space-around;
  align-items: flex-end;
  padding-bottom: 5px;
  background: rgba(var(--glass-rgb), .97);
  border-radius: 18px;
  box-shadow: 0 6px 22px rgba(40, 40, 60, .08), 0 0 0 1px var(--line);
  z-index: 20;
  font-family: "Poppins", var(--font);
}
.tab { display: flex; flex-direction: column; align-items: center; gap: 0; width: 72px; margin-top: -22px; color: var(--text-2); text-decoration: none; }
/* 不分深浅：选中的只是大一点点 */
.tab img { width: 36px; height: 36px; filter: drop-shadow(0 2px 3px rgba(60, 50, 40, .08)); transform: rotate(var(--tilt, 0deg)); transition: transform .2s; -webkit-user-select: none; user-select: none; }
.tab span { font-size: .66rem; font-weight: 600; letter-spacing: .2px; }
.tab.on { color: var(--text); }
.tab.on img { transform: rotate(var(--tilt, 0deg)) scale(1.14); }

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
    align-items: center;
    gap: 14px;
    padding: 14px 0;
    border-radius: 28px;
  }
  .tab { margin-top: 0; }
}
</style>
