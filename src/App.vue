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
  <div v-if="fileActivity.selecting || fileActivity.processing" class="file-progress" role="status" aria-live="polite">
    <div>{{ fileActivity.processing ? "正在处理图片…" : "请在相册或文件中选择" }}
      <button v-if="fileActivity.selecting" class="btn soft" @click="fileActivity.cancel?.()">取消选择</button>
    </div>
  </div>
  <Transition name="fade"><div v-if="toastText" class="toast">{{ toastText }}</div></Transition>
</template>

<style scoped>
.file-progress { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; background: var(--bg); color: var(--text); }
.file-progress > div { padding: 24px; background: var(--card); border-radius: 16px; }
.file-progress button { display: block; margin: 16px auto 0; }
</style>
