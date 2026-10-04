<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { store, today, fmtTokens } from "../store/index.js";
import { toast } from "../lib/toast.js";
import Avatar from "../components/Avatar.vue";
import Icon from "../components/Icon.vue";

const router = useRouter();

const usageToday = computed(() => store.usage[today()] || {});
function usageLine(api) {
  const u = usageToday.value[api.id];
  if (!u) return "今天还没用过";
  return `今天 ${u.calls} 次 · 输入 ${fmtTokens(u.input)} · 输出 ${fmtTokens(u.output)} tokens`;
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
      <div class="list-row">
        <Icon name="palette" :size="20" /><span class="grow">字号</span>
        <div class="seg">
          <button v-for="(l, k) in { small: '小', standard: '标准', large: '大' }" :key="k" :class="{ on: store.settings.fontSize === k }" @click="store.settings.fontSize = k">{{ l }}</button>
        </div>
      </div>
      <button class="list-row" @click="soon"><Icon name="box" :size="20" /><span class="grow">备份<span class="sub">导出 / 导入全部数据</span></span><Icon name="right" class="chev" :size="18" /></button>
    </div>
  </div>
</template>

<style scoped>
.add { color: var(--text-2); }
.api-dot { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: var(--bg-deep); color: var(--text-2); }
.api-dot.def { background: var(--yellow); color: var(--ink); }
.tag { font-size: 0.733rem; background: var(--yellow); border-radius: 6px; padding: 1px 6px; margin-left: 6px; vertical-align: 1px; }
.usage { color: var(--text-3); }
.inline-input { border: 0; background: var(--bg); border-radius: 10px; padding: 6px 10px; width: 42%; text-align: right; outline: none; }
.seg { display: flex; background: var(--bg); border-radius: 12px; padding: 3px; gap: 2px; }
.seg button { border: 0; background: none; border-radius: 9px; padding: 4px 12px; font-size: 0.87rem; color: var(--text-2); }
.seg button.on { background: var(--card); color: var(--text); box-shadow: var(--shadow-soft); font-weight: 600; }
</style>
