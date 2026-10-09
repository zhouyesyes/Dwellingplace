<script setup>
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { store, roleById } from "../store/index.js";
import { SEARCH_PROVIDERS, relayPing, relaySearch } from "../lib/search.js";
import SubHeader from "../components/SubHeader.vue";
import Icon from "../components/Icon.vue";
import Avatar from "../components/Avatar.vue";

const router = useRouter();
const rolesText = s => (s.roleIds || []).map(id => roleById(id)?.name).filter(Boolean).join("、") || "还没选角色";
const GUIDE = "https://github.com/zhouyesyes/Dwellingplace/blob/main/docs/cloudflare-relay.md";

// 搜索服务的设置平时收起来（不常改）
const searchOpen = ref(false);
// MCP 按人物分组：点一个人展开 TA 的 MCP
const openRole = ref("");
const mcpGroups = computed(() => {
  const groups = store.roles.map(r => ({ id: r.id, role: r, list: store.mcpServers.filter(s => (s.roleIds || []).includes(r.id)) }));
  const none = store.mcpServers.filter(s => !(s.roleIds || []).some(id => roleById(id)));
  if (none.length) groups.push({ id: "_none", role: null, list: none });
  return groups;
});
const toolsText = s => (s.tools?.length ? `工具 ${s.tools.length - (s.disabledTools?.length || 0)}/${s.tools.length}` : "还没读取工具");

const pingState = ref(null); // { ok, text }
const searchState = ref(null); // { ok, text, results }
const testQuery = ref("今天的新闻");
const busy = ref("");

const LATEST_RELAY = 16; // relay/worker.js 里的 version
async function testRelay() {
  busy.value = "ping";
  pingState.value = null;
  try {
    const r = await relayPing();
    const ready = r.ready?.length ? `Worker 里已经配好 Key 的：${r.ready.map(k => SEARCH_PROVIDERS[k]?.label || k).join("、")}` : "Worker 里还没有配搜索服务的 Key（可以在下面填）";
    const v = r.version || 1;
    const old = v < 3 ? "。注意：中转是旧版本，MCP / 网页读取可能用不了，请按说明更新 Worker 代码"
      : v < LATEST_RELAY ? "。中转不是最新版：花园唤醒桥、一次性闹钟、TA 自己来找你（心潮的桥）、醒来时查工具说明要新版才能用" : "";
    // 中转这次从哪儿发出请求：在 HK、CN 这些地区的话，OpenAI 这类模型会拒绝
    const w = r.where?.loc ? `。中转这次从 ${r.where.loc}（机房 ${r.where.colo}）发出请求${/^(HK|CN|MO)$/.test(r.where.loc) ? "：这个地区 OpenAI 等模型不提供服务，走中转也会被拦" : ""}` : "";
    pingState.value = { ok: v >= 3, text: `连上了！中转版本 v${v}${v >= LATEST_RELAY ? "（最新）" : ""}。${ready}${w}${old}` };
  } catch (e) {
    pingState.value = { ok: false, text: e.message };
  } finally {
    busy.value = "";
  }
}

async function testSearch() {
  busy.value = "search";
  searchState.value = null;
  try {
    const r = await relaySearch(testQuery.value.trim() || "今天的新闻");
    searchState.value = { ok: true, text: `搜到 ${r.results.length} 条结果`, results: r.results.slice(0, 3) };
  } catch (e) {
    searchState.value = { ok: false, text: e.message };
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <div class="page">
    <SubHeader title="工具" />

    <!-- 中转 -->
    <div class="section-label">中转（Cloudflare Worker）</div>
    <div class="card body">
      <p class="desc">
        浏览器不能直接访问搜索服务，需要一个中转替它去请求。中转是你自己免费部署的，
        <a :href="GUIDE" target="_blank">看部署步骤</a>。
      </p>
      <label class="field"><span>中转地址</span><input v-model.trim="store.tools.relay.url" class="input" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://qisuo-relay.xxx.workers.dev" /></label>
      <label class="field"><span>中转密码</span><input v-model.trim="store.tools.relay.token" class="input" type="password" autocomplete="off" placeholder="和 Worker 里的 RELAY_TOKEN 一样" /></label>
      <button class="btn soft wide" :disabled="!!busy || !store.tools.relay.url" @click="testRelay">{{ busy === "ping" ? "测试中…" : "测试连接" }}</button>
      <p v-if="pingState" class="result" :class="{ bad: !pingState.ok }">{{ pingState.text }}</p>
    </div>

    <!-- 搜索 -->
    <div class="section-label">联网搜索（通过中转，所有模型都能用）</div>
    <div class="list-card">
      <label class="list-row">
        <Icon name="globe" :size="20" />
        <span class="grow">开启联网搜索<span class="sub">TA 需要时会自己搜</span></span>
        <input v-model="store.tools.search.enabled" type="checkbox" class="sw" />
      </label>
    </div>
    <button class="fold" @click="searchOpen = !searchOpen">{{ searchOpen ? "收起搜索服务设置 ▴" : `搜索服务：${SEARCH_PROVIDERS[store.tools.search.provider]?.label || "还没选"} · 展开设置 ▾` }}</button>
    <div v-if="searchOpen" class="card body" style="margin-top: 8px">
      <div class="field">
        <span>搜索服务</span>
        <div class="providers">
          <button v-for="(p, k) in SEARCH_PROVIDERS" :key="k" :class="{ on: store.tools.search.provider === k }" @click="store.tools.search.provider = k">
            <b>{{ p.label }}</b><small>{{ p.note }}</small>
          </button>
        </div>
      </div>
      <label class="field">
        <span>搜索服务的 Key</span>
        <input v-model.trim="store.tools.search.key" class="input" type="password" autocomplete="off" placeholder="已在 Worker 里配好就留空" />
      </label>
      <div class="test-row">
        <input v-model="testQuery" class="input" placeholder="测试搜点什么" />
        <button class="btn soft" :disabled="!!busy || !store.tools.relay.url" @click="testSearch">{{ busy === "search" ? "搜索中…" : "测试搜索" }}</button>
      </div>
      <div v-if="searchState" class="result" :class="{ bad: !searchState.ok }">
        {{ searchState.text }}
        <ul v-if="searchState.results?.length">
          <li v-for="r in searchState.results" :key="r.url"><a :href="r.url" target="_blank">{{ r.title }}</a></li>
        </ul>
      </div>
    </div>

    <!-- 流式 -->
    <div class="section-label">回复方式</div>
    <div class="list-card">
      <label class="list-row">
        <Icon name="send" :size="20" />
        <span class="grow">流式回复<span class="sub">开着：一边生成一边显示；关掉：等整条写完一次显示</span></span>
        <input v-model="store.tools.stream" type="checkbox" class="sw" />
      </label>
    </div>
    <p class="note">所有 API 通用。关掉以后，开头那段等待没有动静，但中途断掉时整条会自动重试，不会只剩半句；回复很长时要等得久一点。</p>

    <!-- 网页读取 -->
    <div class="section-label">网页读取（fetch）</div>
    <div class="list-card">
      <label class="list-row">
        <Icon name="file" :size="20" />
        <span class="grow">开启网页读取<span class="sub">发链接给 TA，TA 能打开读全文；所有角色都能用</span></span>
        <input v-model="store.tools.fetch.enabled" type="checkbox" class="sw" />
      </label>
    </div>
    <p class="note">和搜索不一样：搜索是找网页，网页读取是打开一个具体的链接读正文。通过上面的中转（需要第 3 版）。</p>

    <!-- 官方自带 -->
    <div class="section-label">官方 Claude 自带搜索</div>
    <div class="list-card">
      <label class="list-row">
        <Icon name="search" :size="20" />
        <span class="grow">官方自带搜索<span class="sub">不需要中转；只对官方 API 有效</span></span>
        <input v-model="store.tools.webSearch" type="checkbox" class="sw" />
      </label>
    </div>
    <p class="note">开了上面的「通过中转搜索」时，会优先用中转，这个开关就不起作用。</p>

    <div class="section-label">MCP</div>
    <div class="list-card">
      <template v-for="g in mcpGroups" :key="g.id">
        <button class="list-row" @click="openRole = openRole === g.id ? '' : g.id">
          <Avatar v-if="g.role" :img="g.role.avatar" :name="g.role.name" :color="g.role.color" :size="28" />
          <Icon v-else name="tool" :size="20" />
          <span class="grow">{{ g.role ? g.role.name : "还没选角色的" }}<span class="sub">{{ g.list.length ? `${g.list.length} 个 MCP · 开着 ${g.list.filter(s => s.enabled).length} 个` : "还没有 MCP" }}</span></span>
          <span class="caret">{{ openRole === g.id ? "▴" : "▾" }}</span>
        </button>
        <template v-if="openRole === g.id">
          <button v-for="s in g.list" :key="s.id" class="list-row inner" @click="router.push(`/settings/mcp/${s.id}`)">
            <Icon name="tool" :size="18" />
            <span class="grow">
              {{ s.name }}<span v-if="!s.enabled" class="off">（已停用）</span>
              <span class="sub">{{ rolesText(s) }} · {{ toolsText(s) }}</span>
            </span>
            <input v-model="s.enabled" type="checkbox" class="sw" @click.stop />
          </button>
        </template>
      </template>
      <button class="list-row add" @click="router.push('/settings/mcp/new')"><Icon name="plus" :size="20" /><span class="grow">添加 MCP</span></button>
    </div>
    <p class="note">每个 MCP 可以选择哪些角色能用；同一个平台不同 AI 的账号，就各添加一个。MCP 通过上面的中转连接。</p>
  </div>
</template>

<style scoped>
.body { padding: 16px 18px; }
.desc { margin: 0 0 12px; font-size: 0.87rem; color: var(--text-2); line-height: 1.7; }
.desc a, .result a { color: var(--accent); }
.wide { width: 100%; }
.sw { width: 20px; height: 20px; accent-color: var(--ink); }
.result { margin: 10px 2px 0; font-size: 0.87rem; color: #3f8f63; line-height: 1.6; word-break: break-all; }
.result.bad { color: var(--danger); }
.result ul { margin: 6px 0 0; padding-left: 18px; }
.providers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.providers button { border: 1px solid var(--line); background: var(--card); border-radius: 14px; padding: 8px 10px; text-align: left; display: flex; flex-direction: column; gap: 1px; }
.providers button b { font-size: 0.9rem; }
.providers button small { font-size: 0.73rem; color: var(--text-3); line-height: 1.4; }
.providers button.on { border-color: var(--ink); background: var(--card-2); }
.test-row { display: flex; gap: 8px; }
.test-row .btn { flex: none; }
.add { color: var(--text-2); }
.inner { padding-left: 34px; background: var(--card-2); }
.caret { color: var(--text-3); font-size: 0.8rem; }
.fold { display: block; width: 100%; margin-top: 8px; border: 0; background: none; color: var(--text-2); font-size: 0.85rem; padding: 8px; text-align: center; }
.off { color: var(--text-3); font-size: 0.8rem; }
.note { font-size: 0.8rem; color: var(--text-3); line-height: 1.7; margin: 10px 8px 0; }
</style>
