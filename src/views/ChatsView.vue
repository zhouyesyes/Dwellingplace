<script setup>
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { store, threadsOf, roleById, groupThread, createGroup } from "../store/index.js";
import { shortTime } from "../lib/time.js";
import { toast } from "../lib/toast.js";
import Avatar from "../components/Avatar.vue";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";

const router = useRouter();

// 一对一和群聊放在一起，按最近聊天排
const rows = computed(() => [
  ...store.roles.map(r => {
    const latest = threadsOf(r.id)[0];
    return { kind: "role", key: r.id, role: r, latest, at: latest?.updatedAt ?? r.createdAt };
  }),
  ...(store.groups || []).map(g => {
    const t = groupThread(g.id);
    return { kind: "group", key: g.id, group: g, latest: t, at: t?.updatedAt ?? g.createdAt };
  }),
].sort((a, b) => b.at - a.at));

function open(row) {
  router.push(row.kind === "role" ? `/chat/${row.role.id}` : `/group/${row.group.id}`);
}
const membersOf = g => g.memberIds.map(roleById).filter(Boolean);

// ---------- 建群 ----------
const creating = ref(null);
function newGroup() {
  if (store.roles.length < 2) return toast("至少要有两个角色才能建群");
  creating.value = { name: "", ids: store.roles.map(r => r.id) };
}
function toggle(id) {
  const ids = creating.value.ids;
  creating.value.ids = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
}
function create() {
  const c = creating.value;
  if (c.ids.length < 2) return toast("至少选两个人");
  const name = c.name.trim() || c.ids.map(id => roleById(id)?.name).join("、");
  const g = createGroup(name, c.ids);
  creating.value = null;
  router.push(`/group/${g.id}`);
}
</script>

<template>
  <div class="page">
    <div class="head">
      <h1 class="page-title">通讯</h1>
      <button class="icon-btn" title="添加角色" @click="router.push('/settings/role/new')"><Icon name="plus" /></button>
    </div>

    <div class="list-card">
      <button v-for="row in rows" :key="row.key" class="list-row" @click="open(row)">
        <Avatar v-if="row.kind === 'role'" :img="row.role.avatar" :name="row.role.name" :color="row.role.color" :size="48" />
        <span v-else class="stack">
          <span v-for="r in membersOf(row.group).slice(0, 3)" :key="r.id" class="st"><Avatar :img="r.avatar" :name="r.name" :color="r.color" :size="30" /></span>
        </span>
        <span class="grow">
          <span class="name-line">
            <b>{{ row.kind === "role" ? row.role.name : row.group.name }}</b>
            <span class="time">{{ shortTime(row.latest?.updatedAt) }}</span>
          </span>
          <span class="sub">{{ row.latest?.preview || (row.kind === "role" ? row.role.signature || "还没有聊过天" : `${membersOf(row.group).length} 个人的群聊`) }}</span>
        </span>
      </button>

      <button class="list-row group" @click="newGroup">
        <span class="group-ava"><Icon name="plus" :size="22" /></span>
        <span class="grow">
          <span class="name-line"><b>建一个群聊</b></span>
          <span class="sub">把几个 AI 拉到一起聊天</span>
        </span>
      </button>
    </div>

    <p v-if="!store.roles.length" class="empty-hint">还没有角色，点右上角 ＋ 添加一个吧</p>

    <Sheet :open="!!creating" title="建一个群聊" @close="creating = null">
      <template v-if="creating">
        <label class="field"><span>群名字<small>（不填就用大家的名字）</small></span><input v-model="creating.name" class="input" placeholder="例如：雾潮群岛" /></label>
        <div class="field"><span>谁在群里</span></div>
        <div class="pick">
          <button v-for="r in store.roles" :key="r.id" class="pick-row" :class="{ on: creating.ids.includes(r.id) }" @click="toggle(r.id)">
            <Avatar :img="r.avatar" :name="r.name" :color="r.color" :size="32" /> <span class="grow">{{ r.name }}</span> <Icon v-if="creating.ids.includes(r.id)" name="check" :size="18" />
          </button>
        </div>
        <button class="btn wide" :disabled="creating.ids.length < 2" @click="create">建群</button>
      </template>
    </Sheet>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; }
.head .page-title { margin-bottom: 14px; }
.list-row { padding: 14px 16px; }
.name-line { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.name-line b { font-weight: 600; font-size: 1.03rem; }
.time { font-size: 0.8rem; color: var(--text-3); flex: none; }
.sub { display: block; margin-top: 1px; }
.stack { flex: none; width: 48px; height: 48px; position: relative; }
.st { position: absolute; border-radius: 50%; box-shadow: 0 0 0 2px var(--card); }
.st:nth-child(1) { left: 0; top: 0; }
.st:nth-child(2) { right: 0; bottom: 0; }
.st:nth-child(3) { left: 10px; bottom: -2px; transform: scale(.8); }
.group-ava {
  display: grid; place-items: center;
  width: 48px; height: 48px; border-radius: 50%;
  background: var(--bg-deep); color: var(--text-2);
  border: 1.5px dashed var(--text-3);
}
.pick { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
.pick-row { display: flex; align-items: center; gap: 10px; border: 0; background: var(--bg); border-radius: 14px; padding: 8px 12px; font-size: 0.93rem; text-align: left; opacity: .55; }
.pick-row.on { opacity: 1; background: var(--card-2); box-shadow: 0 0 0 1px var(--line); }
.grow { flex: 1; }
.wide { width: 100%; }
</style>
