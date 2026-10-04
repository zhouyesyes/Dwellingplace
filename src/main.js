import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router.js";
import { loadStore } from "./store/index.js";
import "./styles/base.css";

// 离线缓存（只在正式版里）
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
// 万一某个文件没下载下来，刷新一次
addEventListener("vite:preloadError", () => location.reload());

loadStore().then(() => {
  createApp(App).use(router).mount("#app");
});
