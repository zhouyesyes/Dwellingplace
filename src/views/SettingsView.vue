<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { store, today, fmtTokens } from "../store/index.js";
import Avatar from "../components/Avatar.vue";
import Icon from "../components/Icon.vue";
import BigTextarea from "../components/BigTextarea.vue";

const router = useRouter();

const usageToday = computed(() => store.usage[today()] || {});
function usageLine(api) {
  const u = usageToday.value[api.id];
  if (!u) return "今天还没用过";
  return `今天 ${u.calls} 次 · 输入 ${fmtTokens(u.input)} · 输出 ${fmtTokens(u.output)} tokens`;
}
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

    <div class="section-label">聊天</div>
    <div class="list-card">
      <label class="list-row">
        <Icon name="chat" :size="20" />
        <span class="grow">TA 每次能看到最近多少条消息<span class="sub">越多记得越久，也越费 tokens</span></span>
        <input v-model.number="store.settings.historyLimit" class="num-input" type="number" min="2" max="1000" step="10" inputmode="numeric" />
      </label>
      <label class="list-row">
        <Icon name="chat" :size="20" />
        <span class="grow">群聊里看得到多少条私聊<span class="sub">轮到 TA 在群里说话时，附上 TA 和你最近的私聊；0 就是不附</span></span>
        <input v-model.number="store.settings.groupPrivateLimit" class="num-input" type="number" min="0" max="500" step="10" inputmode="numeric" />
      </label>
      <label class="list-row">
        <Icon name="chat" :size="20" />
        <span class="grow">私聊里看得到多少条群聊<span class="sub">私聊时附上 TA 在的群里最近聊的；0 就是不附</span></span>
        <input v-model.number="store.settings.privateGroupLimit" class="num-input" type="number" min="0" max="500" step="10" inputmode="numeric" />
      </label>
      <label class="list-row">
        <Icon name="alarm" :size="20" />
        <span class="grow">TA 醒来时看多少条聊天<span class="sub">一天会醒好几次，少一点更省；不会超过上面第一项</span></span>
        <input v-model.number="store.settings.wakeHistoryLimit" class="num-input" type="number" min="2" max="500" step="10" inputmode="numeric" />
      </label>
    </div>

    <div class="section-label">对外保密</div>
    <div class="card body privacy">
      <p class="hint">所有 AI 通用。TA 们发邮件、在花园等地方发东西时，都不会说出这里写的事。</p>
      <BigTextarea v-model="store.settings.privacy" rows="3" title="对外保密" placeholder="比如：我的真名、住在哪里、在哪个平台写小说、笔名是什么" />
    </div>

    <div class="section-label">更多</div>
    <div class="list-card">
      <button class="list-row" @click="router.push('/settings/wake')"><Icon name="bell" :size="20" /><span class="grow">唤醒<span class="sub">{{ store.wake?.enabled ? "已开启：TA 们会自己醒来" : "让 TA 们按时间自己醒来，给你发消息" }}</span></span><Icon name="right" class="chev" :size="18" /></button>
      <button class="list-row" @click="router.push('/settings/tools')"><Icon name="tool" :size="20" /><span class="grow">工具<span class="sub">联网搜索{{ store.tools.search?.enabled || store.tools.webSearch ? "（已开启）" : "" }}、MCP</span></span><Icon name="right" class="chev" :size="18" /></button>
      <div class="list-row">
        <Icon name="palette" :size="20" /><span class="grow">字号</span>
        <div class="seg">
          <button v-for="(l, k) in { small: '小', standard: '标准', large: '大' }" :key="k" :class="{ on: store.settings.fontSize === k }" @click="store.settings.fontSize = k">{{ l }}</button>
        </div>
      </div>
      <button class="list-row" @click="router.push('/settings/backup')"><Icon name="box" :size="20" /><span class="grow">备份<span class="sub">导出 / 导入全部数据</span></span><Icon name="right" class="chev" :size="18" /></button>
    </div>
  </div>
</template>

<style scoped>
.add { color: var(--text-2); }
.privacy { padding: 14px 16px; }
.privacy .hint { margin: 0 0 8px; font-size: 0.8rem; color: var(--text-3); }
.api-dot { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: var(--bg-deep); color: var(--text-2); }
.api-dot.def { background: var(--yellow); color: var(--ink); }
.tag { font-size: 0.733rem; background: var(--yellow); border-radius: 6px; padding: 1px 6px; margin-left: 6px; vertical-align: 1px; }
.usage { color: var(--text-3); }
.num-input { width: 70px; border: 0; background: var(--bg); border-radius: 10px; padding: 6px 8px; text-align: center; outline: none; }
.inline-input { border: 0; background: var(--bg); border-radius: 10px; padding: 6px 10px; width: 42%; text-align: right; outline: none; }
.seg { display: flex; background: var(--bg); border-radius: 12px; padding: 3px; gap: 2px; }
.seg button { border: 0; background: none; border-radius: 9px; padding: 4px 12px; font-size: 0.87rem; color: var(--text-2); }
.seg button.on { background: var(--card); color: var(--text); box-shadow: var(--shadow-soft); font-weight: 600; }
</style>
