import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router.js";
import { loadStore } from "./store/index.js";
import "./styles/base.css";

loadStore().then(() => {
  createApp(App).use(router).mount("#app");
});
