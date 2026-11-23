<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { store, threadsOf, loadMessages, MAIN, GROUP_TID, newRole, createThread } from "../store/index.js";
import { unreadMessages } from "../lib/inbox.js";
import { homeDrawerOpen } from "../lib/homeShell.js";
import { shortTime } from "../lib/time.js";
import Avatar from "./Avatar.vue";
import GroupAvatar from "./GroupAvatar.vue";
import Icon from "./Icon.vue";
import MusicPlayer from "./MusicPlayer.vue";
const props = defineProps({ compact: Boolean, role: Object, thread: Object });
const emit = defineEmits(["threads", "summary"]);
const router = useRouter();
const addOpen = ref(false), name = ref(""), adding = ref(""), selected = ref([]);
const now = ref(new Date());
let timer;
const greeting = computed(() => now.value.getHours() < 6 || now.value.getHours() >= 18 ? ["The night", "leaves a light."] : now.value.getHours() < 12 ? ["Softly,", "the morning."] : ["The window", "is still open."]);
const roles = computed(() => [...store.roles].sort((a,b) => Number(b.id === props.role?.id) - Number(a.id === props.role?.id)));
const groupThreads = computed(() => store.threads.filter(t => t.group));
const latest = role => threadsOf(role.id).find(t => t.id === role.lastThreadId) || threadsOf(role.id)[0];
const groupName = t => t.id === GROUP_TID ? store.group.name : (t.name || t.title);
function go(path) { homeDrawerOpen.value = false; router.push(path); }
function openRole(role) { go("/chat/" + role.id); }
function add(kind) { adding.value = kind; addOpen.value = false; name.value = ""; selected.value = store.roles.map(r => r.id); }
function saveNew() {
  if (!name.value.trim()) return;
  if (adding.value === "role") {
    const role = newRole({ name: name.value.trim(), bubbleColor: "#fffaf6", color: "#f1ac91" });
    store.roles.push(role); adding.value = ""; go("/settings/role/" + role.id);
  } else {
    if (!selected.value.length) return;
    const t = createThread(null); t.group = true; t.members = [...selected.value]; t.title = name.value.trim();
    adding.value = ""; go("/group/" + t.id);
  }
}
const settings = computed(() => [
  ["Persona", () => go("/settings/role/" + (props.role?.id || MAIN))],
  ["Summary", () => emit("summary")],
  ["Stickers", () => go("/settings/stickers?owner=" + (props.role?.id || MAIN))],
  ["Voice & drawing", () => go("/settings/media")],
  ["Wake-up", () => go("/settings/wake/" + (props.role?.id || MAIN))],
  ["Little room", () => go("/room/" + (props.role?.id || MAIN))],
  ["Switch conversation", () => emit("threads")],
]);
const spaces = [
  ["Library", "/books"], ["Workbench", "/bench"], ["Tidepool", "/record"],
  ["Tidal room", "/record?view=tide"], ["Letters", "/letters"], ["Mailbox", "/mail/" + MAIN],
  ["Memory", "/memory"], ["Read together", "/books"], ["Co-writing settings", "/write"],
  ["Settings", "/settings"],
];
onMounted(async () => {
  timer = setInterval(() => { now.value = new Date(); }, 60000);
  await Promise.all(store.threads.filter(t => !t.mail && !t.studio).map(async t => {
    const messages = await loadMessages(t.id);
    if (t.readThrough == null) t.readThrough = Math.max(0, ...messages.map(m => m.ts || 0));
  }));
});
onBeforeUnmount(() => clearInterval(timer));
</script>
<template>
  <section class="home-shell" :class="{ compact }">
    <div class="shell-actions">
      <button v-if="compact" class="icon-btn" aria-label="关闭抽屉" @click="homeDrawerOpen = false"><Icon name="close" /></button>
      <button v-else class="icon-btn" aria-label="添加小机或群聊" @click="addOpen = !addOpen"><Icon name="plus" /></button>
      <div v-if="addOpen" class="add-menu"><button @click="add('role')">添加小机</button><button @click="add('group')">添加群聊</button></div>
    </div>
    <header class="shell-heading"><span class="star large" aria-hidden="true">*</span><span class="star little" aria-hidden="true">*</span><h1>{{ greeting[0] }}<br>{{ greeting[1] }}</h1></header>
    <button v-if="compact" class="open-home" @click="go('/')">Open home <Icon name="home" :size="16" /></button>
    <div v-if="compact" class="quick-roles">
      <button v-for="r in roles" :key="r.id" :class="{ selected: r.id === role?.id }" :aria-label="'和' + r.name + '聊天'" @click="openRole(r)"><Avatar :img="r.avatar" :name="r.name" :color="r.color" :size="r.id === role?.id ? 50 : 32" /></button>
      <button aria-label="打开客厅" @click="go('/group')"><GroupAvatar :size="32" /></button>
    </div>
    <div v-else class="shell-inbox">
      <button v-for="r in store.roles" :key="r.id" class="shell-thread" @click="openRole(r)">
        <Avatar :img="r.avatar" :name="r.name" :color="r.color" :size="38" />
        <span class="thread-copy"><strong>{{ r.name }}</strong><small>{{ latest(r)?.preview || "留句话吧" }}</small></span>
        <span class="thread-meta"><time>{{ shortTime(latest(r)?.updatedAt) }}</time><b v-if="unreadMessages(latest(r)).length">{{ unreadMessages(latest(r)).length }}</b></span>
      </button>
      <button v-for="t in groupThreads" :key="t.id" class="shell-thread" @click="go(t.id === GROUP_TID ? '/group' : '/group/' + t.id)">
        <GroupAvatar :size="38" :group="t.id === GROUP_TID ? store.group : t" /><span class="thread-copy"><strong>{{ groupName(t) }}</strong><small>{{ t.preview || "一起坐坐吧" }}</small></span><span class="thread-meta"><time>{{ shortTime(t.updatedAt) }}</time><b v-if="unreadMessages(t).length">{{ unreadMessages(t).length }}</b></span>
      </button>
    </div>
    <details v-if="compact && role" class="shell-section"><summary><span class="star">*</span>Chat settings</summary><button v-for="[label, action] in settings" :key="label" class="space-link" @click="action"><i />{{ label }}</button><label v-if="thread" class="thread-pet-picker"><span><i />Desktop pet</span><select aria-label="当前对话的桌宠" :value="thread.petKind || 'inherit'" @change="thread.petKind = $event.target.value"><option value="inherit">跟随原设置</option><option value="octopus">小章鱼</option><option value="crab">小螃蟹</option><option value="none">不显示</option></select></label></details>
    <details class="shell-section"><summary><span class="star">*</span>Shared spaces</summary><button v-for="[label, path] in spaces" :key="label" class="space-link" @click="go(path)"><i />{{ label }}</button></details>
    <MusicPlayer :compact="compact" />
    <div v-if="adding" class="shell-form-mask" @click.self="adding = ''"><form class="shell-form" @submit.prevent="saveNew"><h2>{{ adding === "role" ? "添加小机" : "添加群聊" }}</h2><input v-model="name" autofocus required maxlength="60" placeholder="名字"><label v-for="r in adding === 'group' ? store.roles : []" :key="r.id"><input v-model="selected" type="checkbox" :value="r.id">{{ r.name }}</label><div><button type="button" @click="adding = ''">取消</button><button class="btn" type="submit" :disabled="adding === 'group' && !selected.length">添加</button></div></form></div>
  </section>
</template>
