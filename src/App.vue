<script setup>
import { computed, watchEffect } from "vue";
import { useRoute } from "vue-router";
import TabBar from "./components/TabBar.vue";
import Cropper from "./components/Cropper.vue";
import FullEditor from "./components/FullEditor.vue";
import { store } from "./store/index.js";
import { toastText } from "./lib/toast.js";

import { fileActivity } from "./lib/filePicker.js";

const route = useRoute();
const tab = computed(() => route.meta.tab);

// iPhone：聊天页是整屏固定的，键盘收起后页面有时停在被顶上去的位置，回到列表时底部导航就高出一截。
// 在聊天页里输入框失去焦点时，把页面滚回原位
document.addEventListener("focusout", () => {
  if (!/^\/(chat|group)\//.test(route.path)) return;
  setTimeout(() => { if (window.scrollY || document.documentElement.scrollTop) window.scrollTo(0, 0); }, 60);
});

// 字号：小 / 标准 / 大
const FONT = { small: "13px", standard: "14px", large: "15.5px" };
watchEffect(() => {
  document.documentElement.style.fontSize = FONT[store.settings.fontSize] || FONT.standard;
});
</script>

<template>
  <RouterView />
  <TabBar v-if="tab" :active="tab" />
  <Cropper />
  <FullEditor />
  <!-- 选图时不再盖一层「请在相册中选择」，只在处理图片的那一会儿提示一下 -->
  <div v-if="fileActivity.processing" class="file-progress" role="status" aria-live="polite">
    <div>正在处理图片…</div>
  </div>
  <Transition name="fade"><div v-if="toastText" class="toast">{{ toastText }}</div></Transition>
</template>

<style scoped>
.file-progress { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; background: var(--bg); color: var(--text); }
.file-progress > div { padding: 24px; background: var(--card); border-radius: 16px; }
</style>
