<script setup>
// 旧居里的一个 AI：设定、聊天记录、记忆（接了心潮的话就是心潮的记忆库）
import { ref, computed, reactive } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, archivedRole } from "../../store/index.js";
import { memoriesOf } from "../../lib/memoryTags.js";
import { hasXinchao } from "../../lib/xinchao.js";
import { imageURL } from "../../lib/images.js";
import { shortTime } from "../../lib/time.js";
import Avatar from "../../components/Avatar.vue";
import Icon from "../../components/Icon.vue";
import SubHeader from "../../components/SubHeader.vue";
import XinchaoDrawer from "../../components/xinchao/XinchaoDrawer.vue";

const route = useRoute();
const router = useRouter();
const role = computed(() => archivedRole(route.params.id));
if (!role.value) router.replace("/archive");

const TABS = { persona: "设定", chats: "聊天", memory: "记忆" };
const tab = ref("persona");

const threads = computed(() => (store.archive?.threads || []).filter(t => t.roleId === role.value?.id).sort((a, b) => b.updatedAt - a.updatedAt));
const xinchao = computed(() => role.value && hasXinchao(role.value));
const cards = computed(() => (role.value ? memoriesOf(role.value.id) : []));
const imgUrls = reactive({});
function imgOf(m) {
  if (m.img && !imgUrls[m.img]) imageURL(m.img).then(u => (imgUrls[m.img] = u));
  return m.img ? imgUrls[m.img] : null;
}
const sections = computed(() => {
  const r = role.value;
  if (!r) return [];
  return [
    ["我是谁 · 说话的样子", r.style],
    ["以前的设定", r.persona],
    ["签名", r.signature],
    ["他怎么称呼我", r.me?.name],
    ["我在他面前", r.me?.about],
  ].filter(([, v]) => v && String(v).trim());
});
</script>

<template>
  <div v-if="role" class="page">
    <SubHeader :title="role.name" />

    <div class="hero">
      <Avatar :img="role.avatar" :name="role.name" :color="role.color" :size="72" />
      <div class="grow">
        <h2>{{ role.name }}</h2>
        <p>{{ role.signature || "（没有签名）" }}</p>
      </div>
      <button class="btn soft small" @click="router.push(`/room/${role.id}`)">小屋</button>
    </div>

    <div class="seg">
      <button v-for="(l, k) in TABS" :key="k" :class="{ on: tab === k }" @click="tab = k">{{ l }}</button>
    </div>

    <template v-if="tab === 'persona'">
      <div v-for="[label, text] in sections" :key="label">
        <div class="section-label">{{ label }}</div>
        <div class="card body"><p class="text">{{ text }}</p></div>
      </div>
      <p v-if="!sections.length" class="empty-hint">没有写过设定</p>
    </template>

    <template v-else-if="tab === 'chats'">
      <div class="list-card">
        <button v-for="t in threads" :key="t.id" class="list-row" @click="router.push(`/archive/thread/${t.id}`)">
          <Icon name="chat" :size="20" />
          <span class="grow">{{ t.mail ? "邮箱里的小对话" : t.title || "对话" }}<span class="sub">{{ shortTime(t.updatedAt) }} · {{ t.preview || "" }}</span></span>
          <Icon name="right" class="chev" :size="18" />
        </button>
      </div>
      <p v-if="!threads.length" class="empty-hint">没有聊天记录</p>
    </template>

    <template v-else>
      <XinchaoDrawer v-if="xinchao" :key="role.id" :role="role" />
      <template v-else>
        <div class="cards">
          <article v-for="m in cards" :key="m.id" class="mcard">
            <div class="meta"><span>{{ m.date }}</span><span>{{ m.author === "me" ? "我写的" : `${role.name} 写的` }}</span></div>
            <img v-if="imgOf(m)" :src="imgOf(m)" alt="" class="pic" />
            <h3>{{ m.title }}</h3>
            <p>{{ m.content }}</p>
          </article>
        </div>
        <p v-if="!cards.length" class="empty-hint">
          没有记忆卡片。<template v-if="(store.mcpServers || []).some(s => s.roleIds?.includes(role.id))">他的心潮现在连不上（在「设置 → 工具 → MCP」里看看还开着没有）。</template>
        </p>
      </template>
    </template>
  </div>
</template>

<style scoped>
.hero { display: flex; align-items: center; gap: 14px; margin: 0 4px 16px; }
.hero h2 { margin: 0; font-size: 1.25rem; }
.hero p { margin: 2px 0 0; color: var(--text-2); font-size: 0.9rem; }
.grow { flex: 1; min-width: 0; }
.seg { display: flex; background: var(--bg-deep); border-radius: 14px; padding: 4px; gap: 4px; margin-bottom: 6px; }
.seg button { flex: 1; border: 0; background: none; border-radius: 10px; padding: 8px 6px; color: var(--text-2); }
.seg button.on { background: var(--card); color: var(--text); box-shadow: var(--shadow-soft); font-weight: 600; }
.body { padding: 14px 16px; }
.text { margin: 0; white-space: pre-wrap; line-height: 1.75; font-size: 0.93rem; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; margin-top: 16px; }
.mcard { background: var(--card); border-radius: 18px; padding: 14px; box-shadow: var(--shadow); }
.mcard .meta { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-3); }
.mcard h3 { margin: 6px 0 4px; font-size: 1rem; }
.mcard p { margin: 0; font-size: 0.87rem; line-height: 1.7; color: var(--text-2); white-space: pre-wrap; }
.pic { width: 100%; border-radius: 12px; margin-top: 8px; }
</style>
