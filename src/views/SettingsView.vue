<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { store, today, fmtTokens } from "../store/index.js";
import { syncState } from "../lib/sync.js";
import Icon from "../components/Icon.vue";
import SubHeader from "../components/SubHeader.vue";

const router = useRouter();

const helperGroups = computed(() => store.apis.map(a => ({ api: a, models: [...new Set([a.model, ...(a.favModels || [])].filter(Boolean))] })).filter(g => g.models.length));
const helperKey = computed(() => {
  const h = store.settings.helper;
  return h && store.apis.some(a => a.id === h.apiId) ? `${h.apiId}\u0000${h.model}` : "";
});
function setHelper(v) {
  if (!v) { store.settings.helper = null; return; }
  const [apiId, model] = v.split("\u0000");
  store.settings.helper = { apiId, model };
}
const usageToday = computed(() => store.usage[today()] || {});
function usageLine(api) {
  const u = usageToday.value[api.id];
  if (!u) return "今天还没用过";
  return `今天 ${u.calls} 次 · 输入 ${fmtTokens(u.input)} · 输出 ${fmtTokens(u.output)} tokens`;
}
</script>

<template>
  <div class="page">
    <SubHeader title="设置" home="/" />

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
      <!-- 整理用的模型：聊天摘要、共读的前情、共写的总结（不是他自己想记的记忆） -->
      <label class="list-row helper">
        <Icon name="memory" :size="20" /><span class="grow">整理用的模型<span class="sub">摘要、前情、总结用它，可选便宜的</span></span>
        <select :value="helperKey" @change="e => setHelper(e.target.value)">
          <option value="">和他一样</option>
          <optgroup v-for="g in helperGroups" :key="g.api.id" :label="g.api.name || '未命名'">
            <option v-for="m in g.models" :key="m" :value="g.api.id + '\u0000' + m">{{ m }}</option>
          </optgroup>
        </select>
      </label>
      <button class="list-row" @click="router.push('/settings/billing')">
        <Icon name="box" :size="20" /> <span class="grow">用量和余额<span class="sub">每天用了多少次、多少 tokens；DeepSeek、OpenRouter 的余额</span></span><Icon name="right" class="chev" :size="18" />
      </button>
      <button class="list-row add" @click="router.push('/settings/api/new')">
        <Icon name="plus" :size="20" /> <span class="grow">添加 API</span>
      </button>
    </div>

    <div class="section-label">聊天</div>
    <p class="hint moved">他每次看得到多少条消息，搬到聊天里了：私聊点输入框上面的 token 数字、群聊点「用量」，往左滑就能调。</p>

    <div class="section-label">更多</div>
    <div class="list-card">
      <button class="list-row" @click="router.push('/settings/tools')"><Icon name="tool" :size="20" /><span class="grow">工具<span class="sub">联网搜索{{ store.tools.search?.enabled || store.tools.webSearch ? "（已开启）" : "" }}、浏览器、MCP</span></span><Icon name="right" class="chev" :size="18" /></button>
      <div class="list-row">
        <Icon name="palette" :size="20" /><span class="grow">字号</span>
        <div class="seg">
          <button v-for="(l, k) in { small: '小', standard: '标准', large: '大' }" :key="k" :class="{ on: store.settings.fontSize === k }" @click="store.settings.fontSize = k">{{ l }}</button>
        </div>
      </div>
      <button class="list-row" @click="router.push('/settings/sync')"><Icon name="refresh" :size="20" /><span class="grow">同步<span class="sub">{{ syncState.on ? (syncState.error ? "同步出错了，点进来看看" : "已开启：几台设备共用一份") : "手机、iPad、电脑共用一份栖所" }}</span></span><Icon name="right" class="chev" :size="18" /></button>
      <button v-if="store.archive?.roles.length" class="list-row" @click="router.push('/archive')"><Icon name="home" :size="20" /><span class="grow">旧居<span class="sub">{{ store.archive.roles.map(r => r.name).join("、") }} 的设定、聊天和记忆，都在这里</span></span><Icon name="right" class="chev" :size="18" /></button>
      <button class="list-row" @click="router.push('/settings/backup')"><Icon name="box" :size="20" /><span class="grow">备份<span class="sub">导出 / 导入全部数据</span></span><Icon name="right" class="chev" :size="18" /></button>
    </div>
  </div>
</template>

<style scoped>
.moved { font-size: 0.82rem; color: var(--text-3); line-height: 1.7; margin: 0 6px 18px; }
.add { color: var(--text-2); }
.api-dot { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: var(--bg-deep); color: var(--text-2); }
.api-dot.def { background: var(--yellow); color: var(--ink); }
.tag { font-size: 0.733rem; background: var(--yellow); border-radius: 6px; padding: 1px 6px; margin-left: 6px; vertical-align: 1px; }
.usage { color: var(--text-3); }
.num-input { width: 70px; border: 0; background: var(--bg); border-radius: 10px; padding: 6px 8px; text-align: center; outline: none; }
.inline-input { border: 0; background: var(--bg); border-radius: 10px; padding: 6px 10px; width: 42%; text-align: right; outline: none; }
.seg { display: flex; background: var(--bg); border-radius: 12px; padding: 3px; gap: 2px; }
.seg button { border: 0; background: none; border-radius: 9px; padding: 4px 12px; font-size: 0.87rem; color: var(--text-2); }
.seg button.on { background: var(--card); color: var(--text); box-shadow: var(--shadow-soft); font-weight: 600; }
.helper select { max-width: 42%; border: 1px solid var(--line); background: var(--card); border-radius: 10px; padding: 6px 8px; font-size: .82rem; color: var(--text); }
</style>
