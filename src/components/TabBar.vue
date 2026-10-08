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
    <RouterLink v-for="t in tabs" :key="t.key" :to="t.to" replace class="tab" :class="{ on: active === t.key }"
      :style="{ '--tint': t.tint }" :aria-label="t.label">
      <Icon :name="t.icon" :size="23" :class="'ic-' + t.icon" />
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
  background: rgba(255, 255, 255, .97);
  border-radius: 999px;
  box-shadow: 0 6px 22px rgba(40, 40, 60, .1), 0 0 0 1px rgba(235, 235, 239, .8);
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
/* 对话气泡下面有个小尾巴，图形本身偏上：往下挪一点，看起来才和其他三个齐 */
.ic-chat { transform: translateY(1.5px); }
</style>
