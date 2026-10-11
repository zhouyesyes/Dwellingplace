<script setup>
// 旧居：以前住在栖所里的 AI。只看，不再聊天、不再醒来
import { computed } from "vue";
import { useRouter } from "vue-router";
import { store, archivedRole } from "../../store/index.js";
import { shortTime } from "../../lib/time.js";
import Avatar from "../../components/Avatar.vue";
import Icon from "../../components/Icon.vue";
import SubHeader from "../../components/SubHeader.vue";

const router = useRouter();
const a = computed(() => store.archive || { roles: [], threads: [], groups: [] });
const lastOf = id => Math.max(0, ...a.value.threads.filter(t => t.roleId === id).map(t => t.updatedAt || 0));
const groupThreads = computed(() => a.value.threads.filter(t => t.groupId).sort((x, y) => y.updatedAt - x.updatedAt));
const groupOf = t => a.value.groups.find(g => g.id === t.groupId);
const membersOf = t => (groupOf(t)?.memberIds || []).map(archivedRole).filter(Boolean);
</script>

<template>
  <div class="page">
    <SubHeader title="旧居" />
    <p class="lead">以前住在栖所里的 TA 们。设定、聊天、记忆都好好留着，只是不再醒来。</p>

    <div class="list-card">
      <button v-for="r in a.roles" :key="r.id" class="list-row" @click="router.push(`/archive/${r.id}`)">
        <Avatar :img="r.avatar" :name="r.name" :color="r.color" :size="48" />
        <span class="grow">
          <b>{{ r.name }}</b>
          <span class="sub">{{ r.signature || "（没有签名）" }}<template v-if="lastOf(r.id)"> · 最后一次聊天 {{ shortTime(lastOf(r.id)) }}</template></span>
        </span>
        <Icon name="right" class="chev" :size="18" />
      </button>
    </div>

    <template v-if="groupThreads.length">
      <div class="section-label">群聊</div>
      <div class="list-card">
        <button v-for="t in groupThreads" :key="t.id" class="list-row" @click="router.push(`/archive/thread/${t.id}`)">
          <span class="stack"><span v-for="r in membersOf(t).slice(0, 3)" :key="r.id" class="st"><Avatar :img="r.avatar" :name="r.name" :color="r.color" :size="30" /></span></span>
          <span class="grow"><b>{{ groupOf(t)?.name || t.title }}</b><span class="sub">{{ t.preview || "" }}</span></span>
          <Icon name="right" class="chev" :size="18" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.lead { margin: -6px 6px 16px; font-size: 0.9rem; color: var(--text-2); line-height: 1.7; }
.list-row b { font-weight: 600; }
.stack { flex: none; width: 48px; height: 48px; position: relative; }
.st { position: absolute; border-radius: 50%; box-shadow: 0 0 0 2px var(--card); }
.st:nth-child(1) { left: 0; top: 0; }
.st:nth-child(2) { right: 0; bottom: 0; }
.st:nth-child(3) { left: 10px; bottom: -2px; transform: scale(.8); }
</style>
