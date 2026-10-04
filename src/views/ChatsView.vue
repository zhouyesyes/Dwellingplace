<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { store, threadsOf } from "../store/index.js";
import { shortTime } from "../lib/time.js";
import { toast } from "../lib/toast.js";
import Avatar from "../components/Avatar.vue";
import Icon from "../components/Icon.vue";

const router = useRouter();

const rows = computed(() =>
  store.roles
    .map(r => {
      const latest = threadsOf(r.id)[0];
      return { role: r, latest };
    })
    .sort((a, b) => (b.latest?.updatedAt ?? b.role.createdAt) - (a.latest?.updatedAt ?? a.role.createdAt)),
);

function open(role) {
  router.push(`/chat/${role.id}`);
}
</script>

<template>
  <div class="page">
    <div class="head">
      <h1 class="page-title">通讯</h1>
      <button class="icon-btn" title="添加角色" @click="router.push('/settings/role/new')"><Icon name="plus" /></button>
    </div>

    <div class="list-card">
      <button v-for="{ role, latest } in rows" :key="role.id" class="list-row" @click="open(role)">
        <Avatar :img="role.avatar" :name="role.name" :color="role.color" :size="48" />
        <span class="grow">
          <span class="name-line">
            <b>{{ role.name }}</b>
            <span class="time">{{ shortTime(latest?.updatedAt) }}</span>
          </span>
          <span class="sub">{{ latest?.preview || role.signature || "还没有聊过天" }}</span>
        </span>
      </button>

      <button class="list-row group" @click="toast('群聊还在准备中，之后再开放～')">
        <span class="group-ava"><Icon name="chat" :size="22" /></span>
        <span class="grow">
          <span class="name-line"><b>群聊</b></span>
          <span class="sub">即将开放</span>
        </span>
      </button>
    </div>

    <p v-if="!store.roles.length" class="empty-hint">还没有角色，点右上角 ＋ 添加一个吧</p>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; }
.head .page-title { margin-bottom: 14px; }
.list-row { padding: 14px 16px; }
.name-line { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.name-line b { font-weight: 600; font-size: 15.5px; }
.time { font-size: 12px; color: var(--text-3); flex: none; }
.sub { display: block; margin-top: 1px; }
.group { opacity: .7; }
.group-ava {
  display: grid; place-items: center;
  width: 48px; height: 48px; border-radius: 50%;
  background: var(--bg-deep); color: var(--text-2);
  border: 1.5px dashed var(--text-3);
}
</style>
