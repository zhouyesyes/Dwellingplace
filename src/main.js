import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router.js";
import { loadStore, store } from "./store/index.js";
import { startWake } from "./lib/wake.js";
import { startSync } from "./lib/sync.js";
import { startCrabBook } from "./lib/crabBook.js";
import { startCodexJobs } from "./lib/codexJobs.js";
import "./styles/base.css";
import "./styles/mobile-shell.css";
import "./lib/theme.js"; // 深色 / 浅色：要在组件之前就定好

// 离线缓存（只在正式版里）
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
// 万一某个文件没下载下来，刷新一次
addEventListener("vite:preloadError", () => location.reload());

loadStore().then(() => {
  // 首次启用新外观只替换旧的默认气泡，自选颜色继续沿用原字段。
  if (!store.settings.mobileShellTheme) {
    for (const role of store.roles) {
      if (["#eeeff3", "#e3effd"].includes(role.bubbleColor)) role.bubbleColor = "#fffaf6";
    }
    store.profile.bubbleColor ||= "#ffe9dd";
    store.settings.mobileShellTheme = "peach";
  }
  createApp(App).use(router).mount("#app");
  startWake(router);
  startSync();
  startCrabBook();
  startCodexJobs();
});
