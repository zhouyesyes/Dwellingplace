import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router.js";
import { loadStore } from "./store/index.js";
import { startWake } from "./lib/wake.js";
import { startSync } from "./lib/sync.js";
import { startCrabBook } from "./lib/crabBook.js";
import "@fontsource-variable/jost";
import "./styles/base.css";
import "./lib/theme.js"; // 深色 / 浅色：要在组件之前就定好

// 离线缓存（只在正式版里）
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
// 万一某个文件没下载下来，刷新一次
addEventListener("vite:preloadError", () => location.reload());

loadStore().then(() => {
  createApp(App).use(router).mount("#app");
  startWake(router);
  startSync();
  startCrabBook();
});
