import { createRouter, createWebHashHistory } from "vue-router";
import HomeView from "./views/HomeView.vue";
import ChatsView from "./views/ChatsView.vue";
import MemoryView from "./views/MemoryView.vue";
import SettingsView from "./views/SettingsView.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: HomeView, meta: { tab: "home" } },
    { path: "/chats", component: ChatsView, meta: { tab: "chats" } },
    { path: "/chat/:roleId/:threadId?", component: () => import("./views/ChatView.vue") },
    { path: "/memory", component: MemoryView, meta: { tab: "memory" } },
    { path: "/settings", component: SettingsView, meta: { tab: "settings" } },
    { path: "/settings/role/:id", component: () => import("./views/RoleEditView.vue") },
    { path: "/settings/api/:id", component: () => import("./views/ApiEditView.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
