<script setup>
// TA 写的 ```html 小网页：在聊天里变成一张卡片，点开就能玩（关在沙盒里，碰不到栖所的数据）
import { ref, computed } from "vue";

const props = defineProps({ block: { type: String, required: true } });
const m = computed(() => props.block.match(/^```([\w-]*)[^\n]*\n?([\s\S]*?)(\n?```\s*)?$/));
const lang = computed(() => (m.value?.[1] || "").toLowerCase());
const code = computed(() => (m.value ? m.value[2] : props.block));
const done = computed(() => !!m.value?.[3]); // 还在写（流式输出中）就先不让打开
const isPage = computed(() => /^(html|htm|svg)$/.test(lang.value) || /<(!doctype|html|body|svg|canvas)\b/i.test(code.value));
const title = computed(() => code.value.match(/<title>([^<]{1,40})<\/title>/i)?.[1]?.trim() || "小网页");
const open = ref(false);
const showCode = ref(false);
const page = computed(() => (/^svg$/.test(lang.value) || /^\s*<svg/i.test(code.value)
  ? `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;display:grid;place-items:center;min-height:100vh">${code.value}</body>`
  : code.value));
</script>

<template>
  <div class="hb">
  <div v-if="isPage" class="html-card">
    <div class="top">
      <span class="ico">✦</span>
      <b>{{ title }}</b>
    </div>
    <p v-if="!done" class="sub">在做……</p>
    <div v-else class="btns">
      <button class="go" @click.stop="open = true">打开</button>
      <button class="ghost" @click.stop="showCode = !showCode">{{ showCode ? "收起代码" : "看代码" }}</button>
    </div>
    <pre v-if="showCode" class="code" @click.stop>{{ code }}</pre>
    <Teleport to="body">
      <div v-if="open" class="html-full">
        <div class="bar"><b>{{ title }}</b><button @click="open = false">关闭</button></div>
        <iframe :srcdoc="page" sandbox="allow-scripts allow-modals allow-forms allow-pointer-lock" referrerpolicy="no-referrer" />
      </div>
    </Teleport>
  </div>
  <pre v-else class="code plain" @click.stop>{{ code }}</pre>
  </div>
</template>

<style scoped>
.hb { max-width: 100%; min-width: 0; }
.html-card { padding: 12px 14px; border-radius: 16px; background: rgba(255, 255, 255, .9); min-width: 200px; max-width: 100%; box-shadow: 0 1px 3px rgba(40, 40, 60, .08); }
.top { display: flex; align-items: center; gap: 8px; }
.ico { color: #e0a53a; }
.sub { margin: 6px 0 0; font-size: 0.8rem; color: var(--text-2); }
.btns { display: flex; gap: 8px; margin-top: 10px; }
.btns button { border: 0; border-radius: 999px; padding: 6px 16px; font-size: 0.85rem; }
.go { background: var(--ink); color: #fff; }
.ghost { background: var(--bg); color: var(--text-2); }
.code { margin: 10px 0 0; max-height: 40vh; overflow: auto; font-size: 0.72rem; line-height: 1.5; white-space: pre; background: #1e1f24; color: #e8e8ea; border-radius: 10px; padding: 10px; font-family: ui-monospace, Menlo, monospace; }
.code.plain { margin: 0; max-width: 100%; }
.html-full { position: fixed; inset: 0; z-index: 1000; background: #fff; display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; gap: 10px; padding: calc(env(safe-area-inset-top) + 8px) 14px 8px; border-bottom: 1px solid #0000000f; }
.bar b { flex: 1; }
.bar button { border: 0; background: var(--ink); color: #fff; border-radius: 999px; padding: 6px 16px; }
iframe { flex: 1; width: 100%; border: 0; }
</style>
