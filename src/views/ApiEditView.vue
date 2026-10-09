<script setup>
import { reactive, ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, uid, apiById, today, fmtTokens } from "../store/index.js";
import { API_TYPES, newApi, fetchModels } from "../lib/providers.js";
import { toast } from "../lib/toast.js";
import { goBack } from "../lib/nav.js";
import SubHeader from "../components/SubHeader.vue";
import Sheet from "../components/Sheet.vue";
import Icon from "../components/Icon.vue";

const route = useRoute();
const router = useRouter();
const isNew = route.params.id === "new";
const original = isNew ? null : apiById(route.params.id);
if (!isNew && !original) router.replace("/settings");

const form = reactive(JSON.parse(JSON.stringify(original || newApi("anthropic"))));
form.favModels ??= [];
form.showThinking ??= false;
form.contextLimit ??= 200000;
const makeDefault = ref(isNew ? !store.apis.length : store.defaultApiId === original?.id);
const loading = ref(false);
const showKey = ref(false);
const valid = computed(() => form.name.trim() && form.baseUrl.trim() && form.model.trim());
const isOpenRouter = computed(() => form.type === "openai" && /openrouter\.ai/i.test(form.baseUrl || ""));

function switchType(type) {
  if (form.type === type) return;
  form.type = type;
  form.baseUrl = API_TYPES[type].baseUrl;
  form.model = API_TYPES[type].model;
  form.models = [];
  form.favModels = [];
}

function toggleFav(m) {
  const i = form.favModels.indexOf(m);
  if (i >= 0) form.favModels.splice(i, 1);
  else form.favModels.push(m);
}
function addFavManually() {
  const m = prompt("模型名")?.trim();
  if (m && !form.favModels.includes(m)) form.favModels.push(m);
}
// 星标列表里也显示手动加的、但不在拉取结果里的模型
const modelChips = computed(() => [...new Set([...form.favModels, ...form.models])]);

// ---------- 用量 ----------
const usageToday = computed(() => (original ? store.usage[today()]?.[original.id] : null));
const usageModels = computed(() =>
  Object.entries(usageToday.value?.models || {}).sort((a, b) => b[1].input + b[1].output - a[1].input - a[1].output),
);
const usageWeek = computed(() => {
  if (!original) return [];
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const u = store.usage[key]?.[original.id];
    out.push({ label: i === 0 ? "今天" : i === 1 ? "昨天" : `${d.getMonth() + 1}/${d.getDate()}`, total: u ? u.input + u.output : 0, calls: u?.calls || 0 });
  }
  return out;
});
const weekMax = computed(() => Math.max(1, ...usageWeek.value.map(d => d.total)));

// ---------- 选择默认模型 ----------
const pickerOpen = ref(false);
const query = ref("");
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? form.models.filter(m => m.toLowerCase().includes(q)) : form.models;
});
async function openPicker() {
  query.value = "";
  if (!form.models.length) await pullModels();
  if (form.models.length) pickerOpen.value = true;
}
function pickDefault(m) {
  form.model = m;
  pickerOpen.value = false;
}

async function pullModels() {
  loading.value = true;
  try {
    form.models = await fetchModels(form);
    toast(form.models.length ? `拉取到 ${form.models.length} 个模型` : "这个接口没有返回模型列表");
    if (!form.model && form.models.length) form.model = form.models[0];
  } catch (e) {
    toast("拉取失败：" + (e?.status ? `${e.status} ` : "") + (e?.message || e).toString().slice(0, 80), 4000);
  } finally {
    loading.value = false;
  }
}

function save() {
  if (!valid.value) return;
  form.name = form.name.trim();
  form.baseUrl = form.baseUrl.trim();
  form.model = form.model.trim();
  if (original) Object.assign(original, form);
  else store.apis.push({ ...form, id: uid() });
  const id = original?.id ?? store.apis[store.apis.length - 1].id;
  if (makeDefault.value) store.defaultApiId = id;
  else if (store.defaultApiId === id) store.defaultApiId = null;
  toast("已保存");
  goBack(router, "/settings");
}

function remove() {
  if (!confirm(`删除「${original.name}」？`)) return;
  store.apis.splice(store.apis.indexOf(original), 1);
  if (store.defaultApiId === original.id) store.defaultApiId = store.apis[0]?.id ?? null;
  router.replace("/settings");
}
</script>

<template>
  <div class="page">
    <SubHeader :title="isNew ? '添加 API' : '编辑 API'">
      <button class="btn small" :disabled="!valid" @click="save">保存</button>
    </SubHeader>

    <div class="card body">
      <label class="field"><span>名字</span><input v-model="form.name" class="input" placeholder="例如：官方 Claude、某某反代" /></label>

      <div class="field">
        <span>接口格式</span>
        <div class="seg">
          <button v-for="(t, k) in API_TYPES" :key="k" :class="{ on: form.type === k }" @click="switchType(k)">{{ t.label }}</button>
        </div>
        <small v-if="form.type === 'anthropic'">官方或 Anthropic 格式的反代，改接口地址就行。</small>
        <small v-else>DeepSeek、各类中转站 / 反代、本地模型等，地址一般以 /v1 结尾。</small>
      </div>

      <label class="field"><span>接口地址</span><input v-model="form.baseUrl" class="input" inputmode="url" autocapitalize="off" /></label>

      <label class="field">
        <span>密钥</span>
        <div class="key-row">
          <input v-model="form.key" class="input" :type="showKey ? 'text' : 'password'" autocomplete="off" autocapitalize="off" placeholder="sk-…" />
          <button class="btn soft small" @click="showKey = !showKey">{{ showKey ? "隐藏" : "显示" }}</button>
        </div>
      </label>

      <div class="field">
        <span>默认模型</span>
        <div class="key-row">
          <input v-model="form.model" class="input" autocapitalize="off" autocorrect="off" placeholder="手动填写或从列表选择" />
          <button class="btn soft small" :disabled="loading" @click="openPicker">{{ loading ? "拉取中…" : "选择" }}</button>
        </div>
        <small>点「选择」会拉取这个接口的模型列表。</small>
      </div>

      <div class="field">
        <span>常用模型 ★</span>
        <small>点亮星标的模型，会出现在聊天页的模型切换里。</small>
        <div class="chips">
          <button v-for="m in modelChips" :key="m" :class="{ on: form.favModels.includes(m) }" @click="toggleFav(m)">
            {{ form.favModels.includes(m) ? "★" : "☆" }} {{ m }}
          </button>
          <button class="add-chip" @click="addFavManually">＋ 手动添加</button>
        </div>
      </div>
    </div>

    <template v-if="original">
      <div class="section-label">用量（本机统计）</div>
      <div class="card body usage">
        <div class="u-title">今天</div>
        <p v-if="!usageModels.length" class="u-empty">今天还没用过</p>
        <div v-for="[m, u] in usageModels" :key="m" class="u-row">
          <span class="u-model">{{ m }}</span>
          <span class="u-num">{{ u.calls }} 次 · 入 {{ fmtTokens(u.input) }} · 出 {{ fmtTokens(u.output) }}</span>
        </div>
        <div class="u-title" style="margin-top: 14px">最近 7 天（tokens）</div>
        <div v-for="d in usageWeek" :key="d.label" class="u-bar">
          <span class="u-day">{{ d.label }}</span>
          <span class="u-track"><i :style="{ width: (d.total / weekMax) * 100 + '%' }" /></span>
          <span class="u-val">{{ fmtTokens(d.total) }}</span>
        </div>
      </div>
    </template>

    <div class="section-label">高级</div>
    <div class="card body">
      <label class="field">
        <span>单次回复最多 tokens</span>
        <input v-model.number="form.maxTokens" class="input" type="number" min="256" step="1000" />
        <small>如果接口报错说 max_tokens 太大，就把它调小一点。</small>
      </label>
      <label v-if="form.type === 'openai'" class="field">
        <span>温度（temperature）</span>
        <input v-model="form.temperature" class="input" type="number" min="0" max="2" step="0.1" inputmode="decimal" placeholder="不填：DeepSeek 用 1.3，其他用模型默认" />
        <small>越高说话越活、越不像模板。DeepSeek 官方建议聊天 1.3。接口报错说不支持 temperature 的话就清空。</small>
      </label>
      <label v-if="form.type === 'anthropic' || isOpenRouter" class="field">
        <span>思考强度（effort）</span>
        <select v-model="form.effort" class="input">
          <option value="">不设置（用模型默认）</option>
          <option value="low">low · 快、省</option>
          <option value="medium">medium</option>
          <option value="high">high · 想得更多</option>
        </select>
        <small>较老的模型不支持这个参数，报错的话选「不设置」。</small>
      </label>
      <label class="field">
        <span>上下文上限（tokens）</span>
        <input v-model.number="form.contextLimit" class="input" type="number" min="1000" step="1000" inputmode="numeric" />
        <small>模型一次最多能看多少内容，用来在聊天页显示「上下文」用了多少。不确定就填 200000。</small>
      </label>
      <label v-if="form.type === 'anthropic' || isOpenRouter" class="switch-row">
        <span>显示思考过程<small class="sub-note">{{ isOpenRouter ? "OpenRouter 要打开才会传回思考；GPT 只给思考摘要，有的模型不给" : "Claude 4.6 及以后的模型；反代的 thinking 模型一般会自动返回，不用开" }}</small></span>
        <input v-model="form.showThinking" type="checkbox" />
      </label>
      <label class="switch-row">
        <span>设为全局默认</span>
        <input v-model="makeDefault" type="checkbox" />
      </label>
    </div>

    <Sheet :open="pickerOpen" title="选择默认模型" @close="pickerOpen = false">
      <div class="picker-top">
        <input v-model="query" class="input" placeholder="搜索模型" autocapitalize="off" autocorrect="off" />
        <button class="btn soft small" :disabled="loading" @click="pullModels">{{ loading ? "…" : "重新拉取" }}</button>
      </div>
      <div class="list-card flat picker-list">
        <button v-for="m in filtered" :key="m" class="list-row" :class="{ cur: form.model === m }" @click="pickDefault(m)">
          <span class="grow">{{ m }}</span>
          <span v-if="form.favModels.includes(m)" class="star">★</span>
          <Icon v-if="form.model === m" name="check" :size="18" />
        </button>
      </div>
      <p v-if="!filtered.length" class="empty-hint">没有匹配的模型</p>
    </Sheet>

    <p class="note">密钥只保存在这台设备的浏览器里，由浏览器直接发给接口。</p>

    <div v-if="!isNew" class="danger-zone"><button class="btn danger" @click="remove">删除这个 API</button></div>
  </div>
</template>

<style scoped>
.body { padding: 18px; }
.seg { display: flex; background: var(--bg-deep); border-radius: 14px; padding: 4px; gap: 4px; }
.seg button { flex: 1; border: 0; background: none; border-radius: 10px; padding: 8px 6px; font-size: 0.867rem; color: var(--text-2); }
.seg button.on { background: var(--card); color: var(--text); box-shadow: var(--shadow-soft); font-weight: 600; }
.key-row { display: flex; gap: 8px; align-items: center; }
.key-row .btn { flex: none; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; max-height: 160px; overflow-y: auto; padding: 4px 2px; }
.chips button { border: 1px solid var(--line); background: var(--card); border-radius: 999px; padding: 3px 10px; font-size: 0.833rem; color: var(--text-2); }
.chips button.on { background: var(--yellow); color: var(--text); border-color: transparent; }
.chips .add-chip { border-style: dashed; }
.u-title { font-size: 0.8rem; color: var(--text-3); margin-bottom: 6px; }
.u-empty { margin: 0; font-size: 0.87rem; color: var(--text-2); }
.u-row { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; font-size: 0.87rem; border-bottom: 1px solid var(--line); }
.u-row:last-of-type { border-bottom: 0; }
.u-model { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.u-num { color: var(--text-2); flex: none; }
.u-bar { display: flex; align-items: center; gap: 10px; font-size: 0.8rem; padding: 3px 0; }
.u-day { width: 36px; color: var(--text-2); }
.u-track { flex: 1; height: 8px; border-radius: 4px; background: var(--bg); overflow: hidden; }
.u-track i { display: block; height: 100%; border-radius: 4px; background: var(--accent); opacity: .55; }
.u-val { width: 52px; text-align: right; color: var(--text-2); }
.picker-top { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.picker-top .btn { flex: none; }
.list-card.flat { box-shadow: none; border: 1px solid var(--line); }
.picker-list .list-row { min-height: 46px; padding: 10px 14px; font-size: 0.93rem; }
.picker-list .list-row .grow { white-space: normal; word-break: break-all; }
.picker-list .cur { background: var(--card-2); font-weight: 600; }
.star { color: #e0b43c; }
.sub-note { display: block; font-size: 0.75rem; color: var(--text-3); margin-top: 2px; }
.switch-row { display: flex; justify-content: space-between; align-items: center; padding: 4px; font-size: 0.933rem; }
.switch-row input { width: 20px; height: 20px; accent-color: var(--ink); }
.note { font-size: 0.8rem; color: var(--text-3); text-align: center; margin: 18px 0; }
.danger-zone { display: flex; justify-content: center; margin-top: 10px; }
</style>
