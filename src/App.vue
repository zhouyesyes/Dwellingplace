<script setup>
import { computed, watchEffect } from "vue";
import { useRoute } from "vue-router";
import TabBar from "./components/TabBar.vue";
import Foreground from "./components/Foreground.vue";
import Cropper from "./components/Cropper.vue";
import FullEditor from "./components/FullEditor.vue";
import { store } from "./store/index.js";
import { toastText } from "./lib/toast.js";

import { fileActivity } from "./lib/filePicker.js";

const route = useRoute();
const tab = computed(() => route.meta.tab);

// iPhone：聊天页是整屏固定的，键盘弹出时 iOS 会把整页（window / visualViewport）顶上去，
// 键盘收起后有时不复原：顶栏下面多出一截空白、触摸位置和画面对不上，输入框点不动。
// 键盘收起（失焦、视口变化）时把滚动和偏移复位；多补几次，等键盘收起动画走完
const inChat = () => /^\/(chat|group)\//.test(route.path);
const editing = () => /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
function resetViewport() {
  if (!inChat() || editing()) return;
  const vv = window.visualViewport;
  if (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || (vv && (vv.offsetTop || vv.pageTop))) {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }
}
function resetSoon() { [0, 60, 250, 500, 900].forEach(ms => setTimeout(resetViewport, ms)); }
document.addEventListener("focusout", resetSoon);
window.visualViewport?.addEventListener("resize", resetSoon);
window.visualViewport?.addEventListener("scroll", resetViewport);
window.addEventListener("scroll", resetViewport, { passive: true });
// 点输入框以外的地方（键盘随之收起）
document.addEventListener("touchend", e => { if (inChat() && !e.target.closest?.("textarea,input")) resetSoon(); }, { passive: true });
// 切回 App 时也复位一次
document.addEventListener("visibilitychange", () => { if (!document.hidden) resetSoon(); });

// 字号：小 / 标准 / 大
const FONT = { small: "13px", standard: "14px", large: "15.5px" };
watchEffect(() => {
  document.documentElement.style.fontSize = FONT[store.settings.fontSize] || FONT.standard;
});
</script>

<template>
  <RouterView />
  <Foreground v-if="tab" />
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
