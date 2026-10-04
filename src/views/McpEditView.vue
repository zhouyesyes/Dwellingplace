<script setup>
import { reactive, ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store } from "../store/index.js";
import { newServer, parseMcpJson, refreshTools } from "../lib/mcp.js";
import { goBack } from "../lib/nav.js";
import { toast } from "../lib/toast.js";
import { openEditor } from "../lib/editor.js";
import SubHeader from "../components/SubHeader.vue";
import Avatar from "../components/Avatar.vue";
import Icon from "../components/Icon.vue";

const route = useRoute();
const router = useRouter();
const isNew = route.params.id === "new";
const original = isNew ? null : store.mcpServers.find(s => s.id === route.params.id);
if (!isNew && !original) router.replace("/settings/tools");

const form = reactive(JSON.parse(JSON.stringify(original || newServer())));
const testing = ref(false);
const testMsg = ref(null); // { ok, text }
const showSecrets = ref(false);
const valid = computed(() => form.name.trim() && /^https?:\/\//i.test(form.url.trim()));

async function pasteJson() {
  const text = await openEditor("", { title: "粘贴 MCP 配置", placeholder: '把 MCP 平台给的 JSON 整段粘贴进来，比如 { "mcpServers": { ... } }' });
  if (!text?.trim()) return;
  try {
    const [first, ...rest] = parseMcpJson(text);
    form.url = first.url;
    form.headers = first.headers;
    if (!form.name.trim()) form.name = first.name || "MCP";
    toast(rest.length ? `读到了 ${rest.length + 1} 个，先填入第一个「${first.name}」` : "已填入");
  } catch (e) {
    toast(e.message, 4000);
  }
}

function toggleRole(id) {
  const i = form.roleIds.indexOf(id);
  if (i >= 0) form.roleIds.splice(i, 1);
  else form.roleIds.push(id);
}

async function test() {
  testing.value = true;
  testMsg.value = null;
  try {
    const { tools, serverInfo } = await refreshTools(form);
    const who = serverInfo?.name ? `（${serverInfo.name}）` : "";
    testMsg.value = { ok: true, text: `连上了${who}！读到 ${tools.length} 个工具。` };
  } catch (e) {
    testMsg.value = { ok: false, text: e.message };
  } finally {
    testing.value = false;
  }
}

function save() {
  if (!valid.value) return;
  form.name = form.name.trim().replace(/\./g, "·"); // 名字里不能有「.」，聊天里要用「名字.工具」来区分
  form.url = form.url.trim();
  if (original) Object.assign(original, JSON.parse(JSON.stringify(form)));
  else store.mcpServers.push(JSON.parse(JSON.stringify(form)));
  toast(form.tools.length ? "已保存" : "已保存（还没读取工具，记得点「测试并读取工具」）", 2500);
  goBack(router, "/settings/tools");
}

function remove() {
  if (!confirm(`删除「${original.name}」？`)) return;
  store.mcpServers.splice(store.mcpServers.indexOf(original), 1);
  router.replace("/settings/tools");
}
</script>

<template>
  <div class="page">
    <SubHeader :title="isNew ? '添加 MCP' : '编辑 MCP'">
      <button class="btn small" :disabled="!valid" @click="save">保存</button>
    </SubHeader>

    <button class="btn soft wide" @click="pasteJson"><Icon name="copy" :size="16" /> 粘贴 MCP 平台给的 JSON</button>
    <p class="hint">也可以在下面手动填。每个 AI 的账号不一样的话，就给每个 AI 各添加一个。</p>

    <div class="card body">
      <label class="field"><span>名字</span><input v-model="form.name" class="input" placeholder="例如：花园·心晴" /></label>
      <label class="field"><span>地址（url）</span><input v-model.trim="form.url" class="input" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://…" /></label>

      <div class="field">
        <span>请求头（headers）<button class="link-btn" @click="showSecrets = !showSecrets">{{ showSecrets ? "隐藏" : "显示" }}</button></span>
        <div v-for="(h, i) in form.headers" :key="i" class="hrow">
          <input v-model.trim="h.key" class="input key" placeholder="名字" autocapitalize="off" />
          <input v-model.trim="h.value" class="input" :type="showSecrets ? 'text' : 'password'" placeholder="值，比如 Bearer 你的token" autocomplete="off" autocapitalize="off" />
          <button class="x" aria-label="删掉这一行" @click="form.headers.splice(i, 1)"><Icon name="close" :size="14" /></button>
        </div>
        <button class="link-btn" @click="form.headers.push({ key: '', value: '' })">＋ 再加一行</button>
        <small>token 一般填在 Authorization 里，格式是「Bearer 你的token」（Bearer 后面有一个空格）。</small>
      </div>

      <label class="switch-row">
        <span>通过中转<small class="sub-note">大多数 MCP 不允许浏览器直接访问，建议打开</small></span>
        <input v-model="form.viaRelay" type="checkbox" />
      </label>
    </div>

    <div class="section-label">哪些角色可以用</div>
    <div class="list-card">
      <button v-for="r in store.roles" :key="r.id" class="list-row" @click="toggleRole(r.id)">
        <Avatar :img="r.avatar" :name="r.name" :color="r.color" :size="32" />
        <span class="grow">{{ r.name }}</span>
        <span class="check" :class="{ on: form.roleIds.includes(r.id) }"><Icon v-if="form.roleIds.includes(r.id)" name="check" :size="16" /></span>
      </button>
    </div>
    <p v-if="!form.roleIds.length" class="hint warn">还没有勾选角色：没有勾的角色用不了这个 MCP。</p>

    <div class="section-label">测试</div>
    <div class="card body">
      <button class="btn wide" :disabled="testing || !valid" @click="test">{{ testing ? "连接中…" : "测试并读取工具" }}</button>
      <p v-if="testMsg" class="result" :class="{ bad: !testMsg.ok }">{{ testMsg.text }}</p>
      <div v-if="form.tools.length" class="tools">
        <div v-for="t in form.tools" :key="t.name" class="tool">
          <b>{{ t.name }}</b>
          <span>{{ t.description }}</span>
        </div>
      </div>
    </div>

    <div v-if="!isNew" class="danger-zone"><button class="btn danger" @click="remove">删除这个 MCP</button></div>
  </div>
</template>

<style scoped>
.wide { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; }
.hint { font-size: 0.8rem; color: var(--text-3); margin: 8px 6px 14px; line-height: 1.6; }
.hint.warn { color: var(--danger); margin-top: 8px; }
.body { padding: 16px 18px; }
.hrow { display: flex; gap: 6px; align-items: center; }
.hrow + .hrow { margin-top: 6px; }
.hrow .key { flex: 0 0 34%; }
.x { border: 0; background: var(--bg); width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; padding: 0; color: var(--text-3); flex: none; }
.link-btn { border: 0; background: none; color: var(--accent); font-size: 0.8rem; padding: 4px 4px 0; align-self: flex-start; }
.field > span .link-btn { margin-left: 8px; padding: 0; }
.switch-row { display: flex; justify-content: space-between; align-items: center; padding: 4px; font-size: 0.93rem; }
.switch-row input { width: 20px; height: 20px; accent-color: var(--ink); }
.sub-note { display: block; font-size: 0.75rem; color: var(--text-3); margin-top: 2px; }
.check { width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid var(--line); display: grid; place-items: center; color: #fff; }
.check.on { background: var(--ink); border-color: var(--ink); }
.result { margin: 10px 2px 0; font-size: 0.87rem; color: #3f8f63; line-height: 1.6; word-break: break-all; }
.result.bad { color: var(--danger); }
.tools { margin-top: 10px; max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.tool { background: var(--bg); border-radius: 12px; padding: 8px 10px; font-size: 0.8rem; display: flex; flex-direction: column; gap: 2px; }
.tool span { color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.danger-zone { display: flex; justify-content: center; margin-top: 24px; }
</style>
