<script setup>
import Icon from "./Icon.vue";
defineProps({ active: String });
const tabs = [
  { key: "home", to: "/", icon: "home", label: "主页", tint: "var(--pink)" },
  { key: "memory", to: "/memory", icon: "memory", label: "记忆", tint: "var(--yellow)" },
];
</script>

<template>
  <nav class="tabbar">
    <RouterLink v-for="t in tabs" :key="t.key" :to="t.to" replace class="tab" :class="{ on: active === t.key }"
      :style="{ '--tint': t.tint }" :aria-label="t.label">
      <Icon :name="t.icon" :size="23" />
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  left: 50%;
  bottom: calc(var(--safe-bottom) + 10px);
  transform: translateX(-50%);
  width: min(360px, calc(100vw - 48px));
  height: 52px;
  display: flex;
  justify-content: space-around;
  align-items: center;
  background: rgba(var(--glass-rgb), .97);
  border-radius: 999px;
  box-shadow: 0 6px 22px rgba(40, 40, 60, .1), 0 0 0 1px var(--line);
  z-index: 20;
}
.tab {
  display: grid;
  place-items: center;
  width: 52px;
  height: 36px;
  border-radius: 14px;
  color: var(--text-3);
  transition: background .2s, color .2s;
}
.tab.on { color: var(--ink); background: var(--tint); }

/* 平板横屏：导航竖着放在左边 */
@media (min-width: 1000px) {
  .tabbar {
    left: calc(var(--safe-left, 0px) + 18px);
    top: 50%;
    bottom: auto;
    transform: translateY(-50%);
    width: 60px;
    height: auto;
    flex-direction: column;
    gap: 10px;
    padding: 12px 0;
    border-radius: 30px;
  }
  .tab { width: 44px; height: 44px; }
}
</style>
