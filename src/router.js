import { createRouter, createWebHashHistory } from "vue-router";
// 所有页面都打包在一起：GitHub Pages 在国内经常很慢，按需下载会让「点了没反应」
import HomeView from "./views/HomeView.vue";
import ChatView from "./views/ChatView.vue";
import MemoryView from "./views/MemoryView.vue";
import SettingsView from "./views/SettingsView.vue";
import RoleEditView from "./views/RoleEditView.vue";
import ApiEditView from "./views/ApiEditView.vue";
import BackupView from "./views/BackupView.vue";
import SyncView from "./views/SyncView.vue";
import ToolsView from "./views/ToolsView.vue";
import McpEditView from "./views/McpEditView.vue";
import WakeView from "./views/WakeView.vue";
import WakeRoleView from "./views/WakeRoleView.vue";


export const router = createRouter({
  history: createWebHashHistory(),
  // 换页回到顶上（返回时回到原来的位置）。也顺便把 iPhone 键盘收起后没复位的那点偏移归零，
  // 不然底部导航会被顶上去一截
  scrollBehavior: (to, from, saved) => saved || { top: 0 },
  routes: [
    { path: "/", component: HomeView, meta: { tab: "home" } },
    { path: "/chats", redirect: "/chat/main" }, // 只有一个 AI：通讯直接就是和 TA 的对话
    { path: "/chat/:roleId/:threadId?", component: ChatView },
    { path: "/memory", component: MemoryView, meta: { tab: "memory" } },
    { path: "/room/:roleId", component: () => import("./views/RoomView.vue") },
    { path: "/mail/:roleId", component: () => import("./views/MailView.vue") },
    { path: "/settings", component: SettingsView }, // 从主页右上的齿轮进来，不在底栏
    { path: "/settings/role/:id", component: RoleEditView },
    { path: "/settings/api/:id", component: ApiEditView },
    { path: "/settings/backup", component: BackupView },
    { path: "/archive", component: () => import("./views/archive/ArchiveView.vue") },
    { path: "/archive/thread/:tid", component: () => import("./views/archive/ArchiveThreadView.vue") },
    { path: "/archive/:id", component: () => import("./views/archive/ArchiveRoleView.vue") },
    { path: "/settings/sync", component: SyncView },
    { path: "/letters", component: () => import("./views/LettersView.vue") },
    { path: "/books", component: () => import("./views/BooksView.vue") },
    { path: "/books/talk/:id", component: () => import("./views/ReadTalkView.vue") },
    { path: "/read/:id", component: () => import("./views/ReaderView.vue") },
    { path: "/write", component: () => import("./views/WriteView.vue") },
    { path: "/write/desk", component: () => import("./views/DeskPreviewView.vue") }, // 像素书桌：还在做，先这样看看
    { path: "/write/:id", component: () => import("./views/WriteProjectView.vue") },
    { path: "/settings/media", component: () => import("./views/MediaView.vue") },
    { path: "/settings/stickers", component: () => import("./views/StickersView.vue") },
    { path: "/settings/billing", component: () => import("./views/BillingView.vue") },
    { path: "/settings/tools", component: ToolsView },
    { path: "/settings/mcp/:id", component: McpEditView },
    { path: "/settings/wake", component: WakeView },
    { path: "/settings/wake/:id", component: WakeRoleView },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
