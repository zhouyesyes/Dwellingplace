<script setup>
import Icon from "./Icon.vue";
defineProps({ active: String });
const tabs = [
  { key: "home", to: "/", icon: "home", label: "主页", tint: "var(--pink)" },
  { key: "chats", to: "/chats", icon: "chat", label: "通讯", tint: "var(--green)" },
  { key: "memory", to: "/memory", icon: "memory", label: "记忆", tint: "var(--yellow)" },
  { key: "settings", to: "/settings", icon: "settings", label: "设置", tint: "var(--blue)" },
];
</script>

<template>
  <nav class="tabbar">
    <RouterLink v-for="t in tabs" :key="t.key" :to="t.to" replace class="tab" :class="{ on: active === t.key }" :style="{ '--tint': t.tint }">
      <span class="ico"><Icon :name="t.icon" :size="24" /></span>
      <span class="lbl">{{ t.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  left: 50%;
  bottom: calc(var(--safe-bottom) + 12px);
  transform: translateX(-50%);
  width: min(420px, calc(100vw - 32px));
  height: 64px;
  display: flex;
  justify-content: space-around;
  align-items: center;
  background: rgba(255, 253, 248, .92);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border-radius: 999px;
  box-shadow: 0 6px 24px rgba(120, 90, 60, .12), 0 0 0 1px rgba(236, 227, 212, .7);
  z-index: 20;
}
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  text-decoration: none;
  color: var(--text-3);
  font-size: 11px;
  width: 64px;
}
.ico { position: relative; display: grid; place-items: center; width: 40px; height: 30px; }
.ico::before {
  content: "";
  position: absolute;
  inset: 3px 6px;
  border-radius: 12px;
  background: var(--tint);
  transform: scale(0);
  transition: transform .2s;
  z-index: -1;
}
.ico svg { position: relative; }
.tab.on { color: var(--ink); font-weight: 600; }
.tab.on .ico::before { transform: scale(1); }
</style>
