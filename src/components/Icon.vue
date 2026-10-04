<script setup>
// 简单的线条图标
defineProps({ name: String, size: { type: [Number, String], default: 22 } });
const P = {
  home: '<path d="M4 11.2 12 4.5l8 6.7"/><path d="M6.2 9.6V19a1 1 0 0 0 1 1h3.3v-5.2a1.5 1.5 0 0 1 3 0V20h3.3a1 1 0 0 0 1-1V9.6"/>',
  chat: '<path d="M5 18.5V7.8A2.8 2.8 0 0 1 7.8 5h8.4A2.8 2.8 0 0 1 19 7.8v5.4a2.8 2.8 0 0 1-2.8 2.8H9.2L5 18.5Z"/><path d="M9 10.5h.01M12 10.5h.01M15 10.5h.01" stroke-width="2.2"/>',
  memory: '<path d="M6 4.5h10.5A1.5 1.5 0 0 1 18 6v13.5H7.5A1.5 1.5 0 0 1 6 18V4.5Z"/><path d="M6 18a1.5 1.5 0 0 1 1.5-1.5H18"/><path d="M9.5 8.5h5"/>',
  settings: '<path d="M5 7.5h8M17 7.5h2M5 16.5h2M11 16.5h8"/><circle cx="15" cy="7.5" r="2"/><circle cx="9" cy="16.5" r="2"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  house: '<path d="M4.5 11 12 4.8l7.5 6.2"/><path d="M6.5 9.5v9.3h11V9.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  threads: '<rect x="4.5" y="7" width="12" height="11" rx="2.5"/><path d="M8 4.5h8.5A3 3 0 0 1 19.5 7.5V15"/>',
  send: '<path d="M12 18.5v-13M6.5 11 12 5.5l5.5 5.5"/>',
  stop: '<rect x="7.5" y="7.5" width="9" height="9" rx="1.8" fill="currentColor"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m5 17 4.5-4.5 3.5 3.5 2.5-2.5L20 17"/>',
  file: '<path d="M7 3.8h6.5L18 8.3V19a1.2 1.2 0 0 1-1.2 1.2H7A1.2 1.2 0 0 1 5.8 19V5A1.2 1.2 0 0 1 7 3.8Z"/><path d="M13.3 4v4.5H18"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15"/>',
  edit: '<path d="M5 19h4L18.5 9.5a2.1 2.1 0 0 0-3-3L6 16v3Z"/>',
  refresh: '<path d="M18.5 9A7 7 0 1 0 19 13"/><path d="M19 4.5V9h-4.5"/>',
  trash: '<path d="M5 7h14M10 4.5h4M7 7l.8 11.2A1.5 1.5 0 0 0 9.3 19.5h5.4a1.5 1.5 0 0 0 1.5-1.3L17 7"/>',
  right: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  check: '<path d="m5.5 12.5 4 4 9-9"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  star: '<path d="m12 4.8 2.2 4.5 4.9.7-3.6 3.5.9 4.9L12 16.1l-4.4 2.3.9-4.9-3.6-3.5 4.9-.7Z"/>',
  key: '<circle cx="8.5" cy="12" r="3.5"/><path d="M12 12h8M17 12v3M20 12v2"/>',
  user: '<circle cx="12" cy="9" r="3.5"/><path d="M5.5 19a6.5 6.5 0 0 1 13 0"/>',
  tool: '<path d="M14.5 5.5a4 4 0 0 0 4.9 4.9l-8.9 8.9a2 2 0 0 1-2.8-2.8l8.9-8.9a4 4 0 0 0-2.1-2.1Z"/>',
  palette: '<path d="M12 4.5a7.5 7.5 0 1 0 0 15c1.2 0 1.6-.9 1.2-1.8-.5-1-.1-2.2 1.2-2.2h1.6a3.5 3.5 0 0 0 3.5-3.5c0-4.1-3.4-7.5-7.5-7.5Z"/><circle cx="8.5" cy="11" r=".9" fill="currentColor"/><circle cx="11" cy="8" r=".9" fill="currentColor"/><circle cx="15" cy="8.5" r=".9" fill="currentColor"/>',
  box: '<path d="M4.5 8.5 12 5l7.5 3.5v8L12 20l-7.5-3.5Z"/><path d="M4.5 8.5 12 12l7.5-3.5M12 12v8"/>',
  more: '<path d="M6.5 12h.01M12 12h.01M17.5 12h.01" stroke-width="2.6"/>',
};
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="P[name]" />
</template>
