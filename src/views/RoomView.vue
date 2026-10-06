<script setup>
// 小世界：TA 的像素小屋。点点房间里的东西，TA 和小东西们会有反应
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, roleById } from "../store/index.js";
import { hasXinchao, dashToken, refreshMind, snapOf, fetchCabin } from "../lib/xinchao.js";
import { faceGrid } from "../lib/pixel.js";
import Icon from "../components/Icon.vue";
import Avatar from "../components/Avatar.vue";
import PixelArt from "../components/PixelArt.vue";
import CuiRoom from "../components/room/CuiRoom.vue";
import RowanRoom from "../components/room/RowanRoom.vue";
import LetterSheet from "../components/room/LetterSheet.vue";

const route = useRoute();
const router = useRouter();
const role = computed(() => roleById(route.params.roleId));
if (!role.value) router.replace("/chats");

// 每个人住自己的房间（没设过就按名字认）
const ROOMS = {
  cui: { comp: CuiRoom, idle: n => `${n}靠着窗台坐在地上，膝盖上搁着小本子，看着海发呆。` },
  rowan: { comp: RowanRoom, idle: n => `${n}坐在靠窗的木书桌前，拿羽毛笔在小本子上写写画画。` },
};
const room = computed(() => ROOMS[role.value?.room] || (/rowan/i.test(role.value?.name || "") ? ROOMS.rowan : ROOMS.cui));

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
  said.value = "";
  card.value = null;
  if (!role.value) return;
  if (hasXinchao(role.value) && dashToken(role.value)) refreshMind(role.value);
  checkMail();
}
onMounted(load);
watch(() => route.params.roleId, load);

// 下面那行字：平时说 TA 在做什么，点了东西就说那件东西
const said = ref("");
let sayTimer = 0;
function say(text) {
  said.value = text;
  card.value = null;
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => (said.value = ""), 6000);
}
const idle = computed(() => (asleep.value ? `${role.value.name}睡着了。` : room.value.idle(role.value.name)));

// 点了 TA、信箱、小本子
const card = ref(null);
const lettersOpen = ref(false);
function open(kind) {
  said.value = "";
  if (kind === "ta") card.value = { kind };
  else if (kind === "mailbox") lettersOpen.value = true;
  else if (kind === "notebook") router.push({ path: "/memory", query: { role: role.value.id } });
}
const face = computed(() => faceGrid(asleep.value ? "睡着" : mood.value, snap.value?.emotion?.valence));
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
      <component :is="room.comp" :key="role.id" :name="role.name" :asleep="asleep" :mail-lit="unreadLetters > 0" @say="say" @open="open" />
    </div>

    <div class="caption">
      <div v-if="card?.kind === 'ta'" class="ta">
        <PixelArt :grid="face" :size="34" />
        <div class="grow">
          <b>{{ role.name }}</b>
          <span>{{ asleep ? "正睡着呢" : mood ? `此刻：${mood}` : "在房间里待着" }}</span>
        </div>
        <button class="btn small" @click="goChat">{{ asleep ? "轻轻叫醒" : "去说话" }}</button>
      </div>
      <p v-else class="line">{{ said || idle }}</p>
    </div>
    <p class="hint">点点房间里的东西看看～信箱亮了是 {{ role.name }} 给你写了信，小本子会带你去 TA 的记忆。</p>

    <LetterSheet :role="role" :open="lettersOpen" @close="lettersOpen = false; checkMail()" @changed="unreadLetters = $event" />
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
.frame { border-radius: 22px; overflow: hidden; box-shadow: var(--shadow-soft); background: #2a2a2a; }
.caption { margin-top: 12px; background: var(--card); border-radius: 18px; padding: 12px 16px; min-height: 58px; box-shadow: var(--shadow-soft); display: flex; align-items: center; }
.line { margin: 0; font-size: 0.93rem; line-height: 1.7; color: var(--text-2); }
.ta { display: flex; align-items: center; gap: 12px; width: 100%; }
.grow { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.grow b { font-size: 0.95rem; }
.grow span { font-size: 0.82rem; color: var(--text-3); }
.hint { font-size: 0.75rem; color: var(--text-3); text-align: center; margin: 12px 8px; line-height: 1.6; }
</style>
