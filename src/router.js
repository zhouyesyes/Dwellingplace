import { createRouter, createWebHashHistory } from "vue-router";
// 所有页面都打包在一起：GitHub Pages 在国内经常很慢，按需下载会让「点了没反应」
import HomeView from "./views/HomeView.vue";
import ChatsView from "./views/ChatsView.vue";
import ChatView from "./views/ChatView.vue";
import MemoryView from "./views/MemoryView.vue";
import SettingsView from "./views/SettingsView.vue";
import RoleEditView from "./views/RoleEditView.vue";
import ApiEditView from "./views/ApiEditView.vue";
import BackupView from "./views/BackupView.vue";
import ToolsView from "./views/ToolsView.vue";
import McpEditView from "./views/McpEditView.vue";
import WakeView from "./views/WakeView.vue";
import WakeRoleView from "./views/WakeRoleView.vue";

import GroupView from "./views/GroupView.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  // 换页回到顶上（返回时回到原来的位置）。也顺便把 iPhone 键盘收起后没复位的那点偏移归零，
  // 不然底部导航会被顶上去一截
  scrollBehavior: (to, from, saved) => saved || { top: 0 },
  routes: [
    { path: "/", component: HomeView, meta: { tab: "home" } },
    { path: "/chats", component: ChatsView, meta: { tab: "chats" } },
    { path: "/chat/:roleId/:threadId?", component: ChatView },
    { path: "/memory", component: MemoryView, meta: { tab: "memory" } },
    { path: "/room/:roleId", component: () => import("./views/RoomView.vue") },
    { path: "/group/:id", component: GroupView },
    { path: "/settings", component: SettingsView, meta: { tab: "settings" } },
    { path: "/settings/role/:id", component: RoleEditView },
    { path: "/settings/api/:id", component: ApiEditView },
    { path: "/settings/backup", component: BackupView },
    { path: "/settings/tools", component: ToolsView },
    { path: "/settings/mcp/:id", component: McpEditView },
    { path: "/settings/wake", component: WakeView },
    { path: "/settings/wake/:id", component: WakeRoleView },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
