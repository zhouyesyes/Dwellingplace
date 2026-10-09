<script setup>
// 小世界：TA 的像素小屋。点点房间里的东西，TA 和小东西们会有反应
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, roleById } from "../store/index.js";
import { hasXinchao, dashToken, refreshMind, snapOf, fetchCabin, xinchaoStatus } from "../lib/xinchao.js";
import Icon from "../components/Icon.vue";
import Avatar from "../components/Avatar.vue";
import PixelRoom from "../components/room/PixelRoom.vue";
import LetterSheet from "../components/room/LetterSheet.vue";
import BlackBoxSheet from "../components/room/BlackBoxSheet.vue";

const route = useRoute();
const router = useRouter();
const role = computed(() => roleById(route.params.roleId));
if (!role.value) router.replace("/chats");

// 每个人住自己的房间（没设过就按名字认）
const kind = computed(() => (["cui", "rowan"].includes(role.value?.room) ? role.value.room : /rowan/i.test(role.value?.name || "") ? "rowan" : "cui"));

// 换人：房间、名字、TA 都跟着换
const switchOpen = ref(false);
function switchTo(r) {
  switchOpen.value = false;
  if (r.id !== role.value.id) router.replace(`/room/${r.id}`);
}
// 退出：回到现在这个人的聊天
function exit() {
  const target = `/chat/${role.value.id}`;
  const back = window.history.state?.back;
  if (back === target) return router.back();
  if (back && back.startsWith("/chat/")) {
    const off = router.afterEach(() => { off(); router.replace(target); });
    return router.back();
  }
  router.replace(target);
}

// 心潮：醒着还是睡着、此刻的心情
const snap = computed(() => snapOf(role.value));
const asleep = computed(() => /sleep|asleep|dream|睡/i.test(snap.value?.runtime?.consciousness || ""));
const mood = computed(() => snap.value?.emotion?.shown || snap.value?.emotion?.label || "");

// 信箱：心潮小屋里有 TA 写来、你还没读的信，就亮
const unreadLetters = ref(0);
async function checkMail() {
  unreadLetters.value = 0;
  if (!hasXinchao(role.value) || !dashToken(role.value)) return;
  try {
    const c = await fetchCabin(role.value);
    unreadLetters.value = Number(c?.unreadAiNotes) || 0;
  } catch { /* 取不到就不亮 */ }
}
function load() {
  said.value = null;
  card.value = null;
  if (!role.value) return;
  if (hasXinchao(role.value) && dashToken(role.value)) refreshMind(role.value);
  checkMail();
}
onMounted(load);
watch(() => route.params.roleId, load);

// 下面那行字：平时说 TA 在做什么，点了东西就说那件东西
const said = ref(null); // { title, text, action }
let sayTimer = 0;
function say(msg) {
  said.value = msg;
  card.value = null;
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => (said.value = null), msg.action ? 12000 : 7000);
}
// TA 现在在干嘛（小屋里走到哪、做什么，由小屋告诉我们）
const doing = ref("");
const idle = computed(() => `${role.value.name}${doing.value || (asleep.value ? "睡着了" : "在屋里待着")}。`);

// 点了 TA：房间下面冒一个气泡，写着 TA 在干嘛，还有心潮的状态
const card = ref(null);
function tapMe(text) {
  said.value = null;
  card.value = { doing: text };
  if (status.value.tone === "off" || status.value.tone === "sync") refreshMind(role.value, { force: true });
}
const status = computed(() => xinchaoStatus(role.value));
function retry() {
  if (status.value.tone === "off") refreshMind(role.value, { force: true });
}
// 墙上的信箱、黑匣子
const lettersOpen = ref(false);
const boxOpen = ref(false);
function open(what) {
  if (what === "mailbox") router.push(`/mail/${role.value.id}`); // 墙上的信箱：TA 自己的邮箱
  else if (what === "letters") { said.value = null; card.value = null; lettersOpen.value = true; } // 你们俩的书信
  else if (what === "blackbox") { said.value = null; boxOpen.value = true; }
}
const goChat = () => router.push(`/chat/${role.value.id}`);
</script>

<template>
  <div v-if="role" class="page">
    <header class="head">
      <button class="icon-btn" aria-label="返回" @click="exit"><Icon name="back" /></button>
      <h1>{{ role.name }} 的小屋</h1>
      <div class="who-switch">
        <button class="who-btn" aria-label="换一个人" @click="switchOpen = !switchOpen">
          <Avatar :img="role.avatar" :name="role.name" :color="role.color" :size="26" />
          <i class="caret">{{ switchOpen ? "▴" : "▾" }}</i>
        </button>
        <div v-if="switchOpen" class="who-menu">
          <button v-for="r in store.roles" :key="r.id" :class="{ on: r.id === role.id }" @click="switchTo(r)">
            <Avatar :img="r.avatar" :name="r.name" :color="r.color" :size="26" /> {{ r.name }} 的小屋
          </button>
        </div>
      </div>
    </header>

    <div class="frame">
      <PixelRoom :key="role.id" :kind="kind" :name="role.name" :asleep="asleep" :mood="mood" :mail-lit="unreadLetters > 0"
        @say="say" @open="open" @tap-me="tapMe" @doing="doing = $event" />
    </div>

    <div v-if="card" class="bubble" :class="kind">
      <div class="b-top">
        <div class="grow">
          <p class="b-doing"><b>{{ role.name }}</b>{{ card.doing }}</p>
          <p class="b-xc" :class="{ tappable: status.tone === 'off' }" @click="retry">
            <i class="dot" :class="status.tone" />心潮 · {{ status.text }}<span>{{ status.detail }}</span>
          </p>
        </div>
        <button class="btn small" @click="goChat">{{ asleep ? "轻轻叫醒" : "去说话" }}</button>
      </div>
    </div>
    <div v-else class="bubble" :class="kind">
      <div class="b-top">
        <div class="grow">
          <p v-if="said" class="b-doing"><b v-if="said.title">{{ said.title }}</b>{{ said.text }}</p>
          <p v-else class="b-doing">{{ idle }}</p>
        </div>
        <button v-if="said?.action === 'mailbox'" class="btn soft small" @click="open('letters')">书信</button>
        <button v-if="said?.action" class="btn small" @click="open(said.action)">{{ said.action === "mailbox" ? "打开邮箱" : "看看" }}</button>
      </div>
    </div>
    <p class="hint">左右拖动看整间屋～点 {{ role.name }} 看 TA 在干嘛；墙上的信箱竖起小旗，是 TA 给你写了信；火、灯、门都能点。</p>

    <LetterSheet :role="role" :open="lettersOpen" @close="lettersOpen = false; checkMail()" @changed="unreadLetters = $event" />
    <BlackBoxSheet :role="role" :open="boxOpen" @close="boxOpen = false" />
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.head h1 { flex: 1; margin: 0; font-size: 1.2rem; font-weight: 600; }
.who-switch { position: relative; z-index: 5; }
.who-btn { display: flex; align-items: center; gap: 4px; border: 0; background: var(--card); border-radius: 999px; padding: 4px 8px 4px 4px; box-shadow: var(--shadow-soft); }
.caret { font-style: normal; color: var(--text-3); font-size: 0.7rem; }
.who-menu { position: absolute; right: 0; top: calc(100% + 6px); background: var(--card); border-radius: 16px; box-shadow: var(--shadow); padding: 6px; min-width: 170px; }
.who-menu button { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: none; padding: 8px; border-radius: 12px; font-size: 0.9rem; text-align: left; }
.who-menu button.on { background: var(--bg); font-weight: 600; }
.frame { border-radius: 22px; overflow: hidden; box-shadow: var(--shadow-soft); background: #2a2a2a; margin: 0 -4px; }
.bubble { position: relative; margin-top: 14px; border-radius: 18px; padding: 12px 14px; border: 2.5px solid #3a2a1c; background: #fff8ec; color: #3a2a1c; box-shadow: 0 3px 0 #3a2a1c; }
.bubble:before { content: ""; position: absolute; top: -11px; left: 50%; margin-left: -9px; border: 9px solid transparent; border-bottom-color: #3a2a1c; border-top: 0; }
.bubble.rowan { background: #1e2a33; border-color: #c9b98a; color: #e9dfc4; box-shadow: 0 3px 0 #0e1418; }
.bubble.rowan:before { border-bottom-color: #c9b98a; }
.b-top { display: flex; align-items: center; gap: 10px; min-height: 30px; }
.b-doing { margin: 0; font-size: 0.95rem; line-height: 1.6; }
.b-doing b { margin-right: 8px; }
.b-xc { margin: 4px 0 0; font-size: 0.8rem; opacity: 0.85; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.b-xc span { opacity: 0.7; }
.b-xc.tappable { cursor: pointer; text-decoration: underline dotted; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; background: #8a8a8a; }
.dot.ok { background: #5fb86a; }
.dot.sync { background: #e8b040; }
.grow { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.hint { font-size: 0.75rem; color: var(--text-3); text-align: center; margin: 12px 8px; line-height: 1.6; }
</style>
