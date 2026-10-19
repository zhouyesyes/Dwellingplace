<script setup>
import { themePref, setTheme } from "../lib/theme.js";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { store, uid, roleById, crabRole, CRAB } from "../store/index.js";
import { newApi, isCrabApi } from "../lib/providers.js";
import { toast } from "../lib/toast.js";
import { syncState } from "../lib/sync.js";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";

const router = useRouter();

// ---------- 小螃蟹（服务器上的 Claude Code，用 Claude 订阅）----------
const crab = computed(() => roleById(CRAB));
const crabBusy = ref(false);
async function inviteCrab() {
  // 地址：服务器安装完打出来的 …/p/口令/claude/v1；已经有走自己服务器的 API 的话，照着它猜一个
  const own = store.apis.find(a => /\/p\/[^/]+\//.test(a.baseUrl || ""));
  const guess = own ? own.baseUrl.replace(/(\/p\/[^/]+\/).*/, "$1claude/v1") : "";
  const url = prompt("小螃蟹的接口地址（服务器安装完「栖所服务器信息」里那一行，…/claude/v1）", guess)?.trim().replace(/\/+$/, "");
  if (!url) return;
  crabBusy.value = true;
  try {
    const st = await fetch(url.replace(/\/v1$/i, "") + "/status").then(r => r.json()).catch(() => null);
    if (!st) return toast("连不上这个地址：看看是不是抄错了，或者服务器还没更新（再运行一次安装那一行）", 4500);
    if (!st.installed) return toast("服务器上还没装 Claude Code：再运行一次安装那一行", 4500);
    if (!st.loggedIn) return toast("小螃蟹还没登录：在服务器终端里再运行一次安装那一行，按提示登录 Claude", 4500);
    let api = store.apis.find(a => isCrabApi(a) && a.baseUrl.replace(/\/+$/, "") === url);
    if (!api) {
      api = { ...newApi("openai"), id: uid(), name: "小螃蟹（Claude 订阅）", baseUrl: url, key: "plan", model: "sonnet", favModels: ["sonnet", "opus"] };
      store.apis.push(api);
    }
    if (!crab.value) store.roles.push(crabRole(api.id));
    toast("小螃蟹住进来了 🦀");
    router.push(`/chat/${CRAB}`); // 设定在聊天里的小世界
  } finally { crabBusy.value = false; }
}
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
  <div class="page settings">
    <h1 class="tab-title">Settings</h1>

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


    <!-- 小螃蟹住进来以后，它的设定在它聊天里的小世界，这里就不放了 -->
    <div v-if="!crab" class="section-label">小螃蟹</div>
    <div v-if="!crab" class="list-card">
      <button class="list-row" :disabled="crabBusy" @click="inviteCrab"><Icon name="plus" :size="20" /><span class="grow">请小螃蟹住进来<span class="sub">服务器上的 Claude Code，和 Claude 共用订阅额度</span></span><Icon name="right" class="chev" :size="18" /></button>
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
        <div class="look-line"><span>飘落的东西</span>
          <div class="seg">
            <button v-for="(l, k) in { petals: '花瓣', none: '关' }" :key="k" :class="{ on: (store.settings.foreground ?? 'petals') === k }" @click="store.settings.foreground = k">{{ l }}</button>
          </div>
        </div>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
/* 和主页下面那几条一样：不装在白框里，铺满左右，细线隔开 */
.settings { padding-left: 0; padding-right: 0; font-family: "Poppins", var(--font); }
.settings .section-label { padding: 0 24px; }
.settings .list-card { background: none; box-shadow: none; border-radius: 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); margin-bottom: 22px; }
.settings .list-row { padding: 13px 24px; min-height: 0; background: none; }
.settings .list-row + .list-row { border-top: 0; position: relative; }
.settings .list-row + .list-row::before { content: ""; position: absolute; top: 0; left: 24px; right: 0; height: 1px; background: var(--line); }
.settings .list-row .grow { font-size: .92rem; font-weight: 500; }
.settings .list-row .sub { font-size: .76rem; color: var(--text-3); font-weight: 300; }
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
