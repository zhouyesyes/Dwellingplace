<script setup>
import { themePref, setTheme } from "../lib/theme.js";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { store } from "../store/index.js";
import { syncState } from "../lib/sync.js";
import Icon from "../components/Icon.vue";
import SubHeader from "../components/SubHeader.vue";
import Sheet from "../components/Sheet.vue";

const router = useRouter();
const lookOpen = ref(false);

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
</script>

<template>
  <div class="page">
    <SubHeader title="设置" home="/" />

    <div class="section-label">API</div>
    <div class="list-card">
      <button class="list-row" @click="router.push('/settings/apis')">
        <Icon name="key" :size="20" /><span class="grow">API<span class="sub">配置接口、查看额度和用量</span></span><Icon name="right" class="chev" :size="18" />
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
    </div>


    <div class="section-label">更多</div>
    <div class="list-card">
      <button class="list-row" @click="router.push('/settings/tools')"><Icon name="tool" :size="20" /><span class="grow">工具<span class="sub">联网搜索{{ store.tools.search?.enabled || store.tools.webSearch ? "（已开启）" : "" }}、浏览器、MCP</span></span><Icon name="right" class="chev" :size="18" /></button>
      <button class="list-row" @click="lookOpen = true"><Icon name="palette" :size="20" /><span class="grow">外观<span class="sub">{{ { light: "浅色", dark: "深色", system: "跟随系统" }[themePref] }} · 字号{{ { small: "小", standard: "标准", large: "大" }[store.settings.fontSize] || "标准" }}</span></span><Icon name="right" class="chev" :size="18" /></button>
      <div class="list-row">
        <Icon name="heart" :size="20" /><span class="grow">桌宠小章鱼<span class="sub">站在输入框上面，他回复时敲键盘；共读时站在「一起读」上面</span></span>
        <div class="seg">
          <button :class="{ on: store.settings.pet !== false }" @click="store.settings.pet = true">开</button>
          <button :class="{ on: store.settings.pet === false }" @click="store.settings.pet = false">关</button>
        </div>
      </div>
      <button class="list-row" @click="router.push('/settings/sync')"><Icon name="refresh" :size="20" /><span class="grow">同步<span class="sub">{{ syncState.on ? (syncState.error ? "同步出错了，点进来看看" : "已开启：几台设备共用一份") : "手机、iPad、电脑共用一份栖所" }}</span></span><Icon name="right" class="chev" :size="18" /></button>
      <button v-if="store.archive?.roles.length" class="list-row" @click="router.push('/archive')"><Icon name="home" :size="20" /><span class="grow">旧居<span class="sub">{{ store.archive.roles.map(r => r.name).join("、") }} 的设定、聊天和记忆，都在这里</span></span><Icon name="right" class="chev" :size="18" /></button>
      <button class="list-row" @click="router.push('/settings/backup')"><Icon name="box" :size="20" /><span class="grow">备份<span class="sub">导出 / 导入全部数据</span></span><Icon name="right" class="chev" :size="18" /></button>
    </div>
    <!-- 外观：点进来再调白天黑夜和字号 -->
    <Sheet :open="lookOpen" title="外观" @close="lookOpen = false">
      <div class="look">
        <div class="look-line"><span>白天黑夜</span>
          <div class="seg">
            <button v-for="(l, k) in { light: '浅色', dark: '深色', system: '跟随系统' }" :key="k" :class="{ on: themePref === k }" @click="setTheme(k)">{{ l }}</button>
          </div>
        </div>
        <div class="look-line"><span>字号</span>
          <div class="seg">
            <button v-for="(l, k) in { small: '小', standard: '标准', large: '大' }" :key="k" :class="{ on: store.settings.fontSize === k }" @click="store.settings.fontSize = k">{{ l }}</button>
          </div>
        </div>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.num-input { width: 70px; border: 0; background: var(--bg); border-radius: 10px; padding: 6px 8px; text-align: center; outline: none; }
.inline-input { border: 0; background: var(--bg); border-radius: 10px; padding: 6px 10px; width: 42%; text-align: right; outline: none; }
.seg { display: flex; background: var(--bg); border-radius: 12px; padding: 3px; gap: 2px; }
.seg button { border: 0; background: none; border-radius: 9px; padding: 4px 12px; font-size: 0.87rem; color: var(--text-2); }
.look { display: flex; flex-direction: column; gap: 16px; padding: 4px 2px 8px; }
.look-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.look-line span { color: var(--text); font-size: .92rem; }
.seg button.on { background: var(--card); color: var(--text); box-shadow: var(--shadow-soft); font-weight: 600; }
.helper select { max-width: 42%; border: 1px solid var(--line); background: var(--card); border-radius: 10px; padding: 6px 8px; font-size: .82rem; color: var(--text); }
</style>
