<script setup>
// 小世界：TA 的像素小屋。点点房间里的东西，TA 和小东西们会有反应
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, roleById, threadsOf, loadMessages } from "../store/index.js";
import { pathOf } from "../lib/chat.js";
import { hasXinchao, dashToken, refreshMind, xcCache } from "../lib/xinchao.js";
import { faceGrid } from "../lib/pixel.js";
import SubHeader from "../components/SubHeader.vue";
import PixelArt from "../components/PixelArt.vue";
import CuiRoom from "../components/room/CuiRoom.vue";
import RowanRoom from "../components/room/RowanRoom.vue";

const route = useRoute();
const router = useRouter();
const role = computed(() => roleById(route.params.roleId));
if (!role.value) router.replace("/chats");

// 房间的样子：没选过就按名字猜一个
const ROOMS = { cui: { label: "海边的暖黄小屋", comp: CuiRoom, idle: n => `${n}靠着窗台坐在地上，膝盖上搁着小本子，看着海发呆。` }, rowan: { label: "灯塔边的向导小屋", comp: RowanRoom, idle: n => `${n}坐在靠窗的木书桌前，拿羽毛笔在小本子上写写画画。` } };
const roomKey = computed({
  get: () => role.value?.room || (/rowan/i.test(role.value?.name || "") ? "rowan" : "cui"),
  set: v => { role.value.room = v; },
});
const room = computed(() => ROOMS[roomKey.value] || ROOMS.cui);

// 心潮：醒着还是睡着、此刻的心情
const snap = computed(() => xcCache[role.value?.id]?.snap || null);
const asleep = computed(() => /sleep|asleep|dream|睡/i.test(snap.value?.runtime?.consciousness || ""));
const mood = computed(() => snap.value?.emotion?.shown || snap.value?.emotion?.label || "");
onMounted(() => { if (role.value && hasXinchao(role.value) && dashToken(role.value)) refreshMind(role.value); });

// 信箱：TA 自己醒来给你发了消息、你还没回 → 有新信
const mailLit = ref(false);
async function checkMail() {
  const t = [...threadsOf(role.value.id)].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  if (!t) return (mailLit.value = false);
  const path = pathOf(t, await loadMessages(t.id));
  const last = path[path.length - 1];
  mailLit.value = !!(last && last.from === "ai" && last.wakeId);
}
onMounted(() => role.value && checkMail());

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
function open(kind) {
  said.value = "";
  if (kind === "ta") card.value = { kind };
  else if (kind === "mailbox") card.value = { kind };
  else if (kind === "notebook") router.push({ path: "/memory", query: { role: role.value.id } });
}
const face = computed(() => faceGrid(asleep.value ? "睡着" : mood.value, snap.value?.emotion?.valence));
const goChat = () => router.push(`/chat/${role.value.id}`);
watch(roomKey, () => { said.value = ""; card.value = null; });
</script>

<template>
  <div v-if="role" class="page">
    <SubHeader :title="`${role.name} 的小屋`">
      <select v-model="roomKey" class="pick" aria-label="房间的样子">
        <option v-for="(r, k) in ROOMS" :key="k" :value="k">{{ r.label }}</option>
      </select>
    </SubHeader>

    <div class="frame">
      <component :is="room.comp" :name="role.name" :asleep="asleep" :mail-lit="mailLit" @say="say" @open="open" />
    </div>

    <div class="caption">
      <template v-if="card?.kind === 'ta'">
        <div class="ta">
          <PixelArt :grid="face" :size="34" />
          <div class="grow">
            <b>{{ role.name }}</b>
            <span>{{ asleep ? "正睡着呢" : mood ? `此刻：${mood}` : "在房间里待着" }}</span>
          </div>
          <button class="btn small" @click="goChat">{{ asleep ? "轻轻叫醒" : "去说话" }}</button>
        </div>
      </template>
      <template v-else-if="card?.kind === 'mailbox'">
        <div class="ta">
          <div class="grow">
            <b>{{ mailLit ? "有一封新信" : "信箱里空空的" }}</b>
            <span>{{ mailLit ? `${role.name}给你写了信，还没回呢` : `想给${role.name}写信的话，就去聊天吧` }}</span>
          </div>
          <button class="btn small" @click="goChat">{{ mailLit ? "去看看" : "写信" }}</button>
        </div>
      </template>
      <p v-else class="line">{{ said || idle }}</p>
    </div>
    <p class="hint">点点房间里的东西看看～小本子会带你去 TA 的记忆，信箱亮了是 TA 给你写了信。</p>
  </div>
</template>

<style scoped>
.frame { border-radius: 22px; overflow: hidden; box-shadow: var(--shadow-soft); background: #2a2a2a; }
.pick { border: 0; background: var(--card); border-radius: 12px; padding: 6px 8px; font-size: 0.8rem; color: var(--text-2); box-shadow: var(--shadow-soft); max-width: 140px; }
.caption { margin-top: 12px; background: var(--card); border-radius: 18px; padding: 12px 16px; min-height: 58px; box-shadow: var(--shadow-soft); display: flex; align-items: center; }
.line { margin: 0; font-size: 0.93rem; line-height: 1.7; color: var(--text-2); }
.ta { display: flex; align-items: center; gap: 12px; width: 100%; }
.grow { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.grow b { font-size: 0.95rem; }
.grow span { font-size: 0.82rem; color: var(--text-3); }
.hint { font-size: 0.75rem; color: var(--text-3); text-align: center; margin: 12px 8px; line-height: 1.6; }
</style>
