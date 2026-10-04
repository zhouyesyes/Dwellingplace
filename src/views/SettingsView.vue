<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { store, today } from "../store/index.js";
import { toast } from "../lib/toast.js";
import Avatar from "../components/Avatar.vue";
import Icon from "../components/Icon.vue";

const router = useRouter();

const fmt = n => (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n));
const usageToday = computed(() => store.usage[today()] || {});
function usageLine(api) {
  const u = usageToday.value[api.id];
  if (!u) return "今天还没用过";
  return `今天 ${u.calls} 次 · 输入 ${fmt(u.input)} · 输出 ${fmt(u.output)} tokens`;
}
const soon = () => toast("这一项会在后面的步骤里做好～");
</script>

<template>
  <div class="page">
    <h1 class="page-title">设置</h1>

    <div class="section-label">角色</div>
    <div class="list-card">
      <button v-for="r in store.roles" :key="r.id" class="list-row" @click="router.push(`/settings/role/${r.id}`)">
        <Avatar :img="r.avatar" :name="r.name" :color="r.color" :size="36" />
        <span class="grow">{{ r.name }}<span class="sub">{{ r.persona || "还没有写设定" }}</span></span>
        <Icon name="right" class="chev" :size="18" />
      </button>
      <button class="list-row add" @click="router.push('/settings/role/new')">
        <Icon name="plus" :size="20" /> <span class="grow">添加角色</span>
      </button>
    </div>

    <div class="section-label">API</div>
    <div class="list-card">
      <button v-for="a in store.apis" :key="a.id" class="list-row" @click="router.push(`/settings/api/${a.id}`)">
        <span class="api-dot" :class="{ def: a.id === store.defaultApiId }"><Icon :name="a.id === store.defaultApiId ? 'star' : 'key'" :size="18" /></span>
        <span class="grow">
          <span>{{ a.name || "未命名" }}</span><span v-if="a.id === store.defaultApiId" class="tag">默认</span>
          <span class="sub">{{ a.model || "未选模型" }}</span>
          <span class="sub usage">{{ usageLine(a) }}</span>
        </span>
        <Icon name="right" class="chev" :size="18" />
      </button>
      <button class="list-row add" @click="router.push('/settings/api/new')">
        <Icon name="plus" :size="20" /> <span class="grow">添加 API</span>
      </button>
    </div>

    <div class="section-label">更多</div>
    <div class="list-card">
      <button class="list-row" @click="soon"><Icon name="tool" :size="20" /><span class="grow">工具<span class="sub">联网搜索、MCP</span></span><Icon name="right" class="chev" :size="18" /></button>
      <button class="list-row" @click="soon"><Icon name="palette" :size="20" /><span class="grow">外观</span><Icon name="right" class="chev" :size="18" /></button>
      <button class="list-row" @click="soon"><Icon name="box" :size="20" /><span class="grow">备份<span class="sub">导出 / 导入全部数据</span></span><Icon name="right" class="chev" :size="18" /></button>
    </div>
  </div>
</template>

<style scoped>
.add { color: var(--text-2); }
.api-dot { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: var(--bg-deep); color: var(--text-2); }
.api-dot.def { background: var(--yellow); color: var(--ink); }
.tag { font-size: 11px; background: var(--yellow); border-radius: 6px; padding: 1px 6px; margin-left: 6px; vertical-align: 1px; }
.usage { color: var(--text-3); }
</style>
