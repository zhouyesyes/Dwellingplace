<script setup>
import { reactive, ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, uid, apiById } from "../store/index.js";
import { API_TYPES, newApi, fetchModels } from "../lib/providers.js";
import { toast } from "../lib/toast.js";
import { goBack } from "../lib/nav.js";
import SubHeader from "../components/SubHeader.vue";

const route = useRoute();
const router = useRouter();
const isNew = route.params.id === "new";
const original = isNew ? null : apiById(route.params.id);
if (!isNew && !original) router.replace("/settings");

const form = reactive(JSON.parse(JSON.stringify(original || newApi("anthropic"))));
const makeDefault = ref(isNew ? !store.apis.length : store.defaultApiId === original?.id);
const loading = ref(false);
const showKey = ref(false);
const valid = computed(() => form.name.trim() && form.baseUrl.trim() && form.model.trim());

function switchType(type) {
  if (form.type === type) return;
  form.type = type;
  form.baseUrl = API_TYPES[type].baseUrl;
  form.model = API_TYPES[type].model;
  form.models = [];
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
        <span>模型</span>
        <div class="key-row">
          <input v-model="form.model" class="input" list="model-list" autocapitalize="off" placeholder="手动填写或拉取" />
          <button class="btn soft small" :disabled="loading" @click="pullModels">{{ loading ? "拉取中…" : "拉取模型" }}</button>
        </div>
        <datalist id="model-list"><option v-for="m in form.models" :key="m" :value="m" /></datalist>
        <div v-if="form.models.length" class="chips">
          <button v-for="m in form.models" :key="m" :class="{ on: form.model === m }" @click="form.model = m">{{ m }}</button>
        </div>
      </div>
    </div>

    <div class="section-label">高级</div>
    <div class="card body">
      <label class="field">
        <span>单次回复最多 tokens</span>
        <input v-model.number="form.maxTokens" class="input" type="number" min="256" step="1000" />
        <small>如果接口报错说 max_tokens 太大，就把它调小一点。</small>
      </label>
      <label v-if="form.type === 'anthropic'" class="field">
        <span>思考强度（effort）</span>
        <select v-model="form.effort" class="input">
          <option value="">不设置（用模型默认）</option>
          <option value="low">low · 快、省</option>
          <option value="medium">medium</option>
          <option value="high">high · 想得更多</option>
        </select>
        <small>较老的模型不支持这个参数，报错的话选「不设置」。</small>
      </label>
      <label class="switch-row">
        <span>设为全局默认</span>
        <input v-model="makeDefault" type="checkbox" />
      </label>
    </div>

    <p class="note">密钥只保存在这台设备的浏览器里，由浏览器直接发给接口。</p>

    <div v-if="!isNew" class="danger-zone"><button class="btn danger" @click="remove">删除这个 API</button></div>
  </div>
</template>

<style scoped>
.body { padding: 18px; }
.seg { display: flex; background: var(--bg-deep); border-radius: 14px; padding: 4px; gap: 4px; }
.seg button { flex: 1; border: 0; background: none; border-radius: 10px; padding: 8px 6px; font-size: 13px; color: var(--text-2); }
.seg button.on { background: var(--card); color: var(--text); box-shadow: var(--shadow-soft); font-weight: 600; }
.key-row { display: flex; gap: 8px; align-items: center; }
.key-row .btn { flex: none; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; max-height: 160px; overflow-y: auto; padding: 4px 2px; }
.chips button { border: 1px solid var(--line); background: var(--card); border-radius: 999px; padding: 3px 10px; font-size: 12.5px; color: var(--text-2); }
.chips button.on { background: var(--ink); color: #fffdf8; border-color: var(--ink); }
.switch-row { display: flex; justify-content: space-between; align-items: center; padding: 4px; font-size: 14px; }
.switch-row input { width: 20px; height: 20px; accent-color: var(--ink); }
.note { font-size: 12px; color: var(--text-3); text-align: center; margin: 18px 0; }
.danger-zone { display: flex; justify-content: center; margin-top: 10px; }
</style>
