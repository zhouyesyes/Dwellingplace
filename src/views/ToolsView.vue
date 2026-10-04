<script setup>
import { store } from "../store/index.js";
import SubHeader from "../components/SubHeader.vue";
import Icon from "../components/Icon.vue";
</script>

<template>
  <div class="page">
    <SubHeader title="工具" />

    <div class="list-card">
      <label class="list-row">
        <Icon name="globe" :size="20" />
        <span class="grow">联网搜索<span class="sub">TA 需要时会自己上网查</span></span>
        <input v-model="store.tools.webSearch" type="checkbox" class="sw" />
      </label>
    </div>
    <p class="note">
      只在 <b>Anthropic 格式</b>的 API 上生效，搜索由 Anthropic 那边完成，不需要自己的服务器；会额外产生搜索费用。
      反代平台不一定支持，如果打开后聊天报错，就先关掉。
    </p>

    <div class="section-label">MCP</div>
    <div class="card body">
      <p class="soon">接入 MCP 服务器（让 TA 能用更多外部工具）的入口先留在这里，之后再一个个接。</p>
    </div>
  </div>
</template>

<style scoped>
.sw { width: 20px; height: 20px; accent-color: var(--ink); }
.note { font-size: 0.8rem; color: var(--text-3); line-height: 1.7; margin: 10px 8px 0; }
.body { padding: 16px 18px; }
.soon { margin: 0; font-size: 0.93rem; color: var(--text-2); line-height: 1.7; }
</style>
