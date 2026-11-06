<script setup>
// 他写的 ```html 小网页：直接在消息里展开显示（关在沙盒里，碰不到栖所的数据）；点「全屏」看大的
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { toast } from "../lib/toast.js";

const props = defineProps({ block: { type: String, required: true } });
const m = computed(() => props.block.match(/^```([\w-]*)[^\n]*\n?([\s\S]*?)(\n?```\s*)?$/));
const lang = computed(() => (m.value?.[1] || "").toLowerCase());
const code = computed(() => (m.value ? m.value[2] : props.block));
const done = computed(() => !!m.value?.[3]); // 还在写（流式输出中）就先不渲染
const isPage = computed(() => /^(html|htm|svg)$/.test(lang.value) || /<(!doctype|html|body|svg|canvas)\b/i.test(code.value));
const title = computed(() => code.value.match(/<title>([^<]{1,40})<\/title>/i)?.[1]?.trim() || "小网页");
const open = ref(false);
const showCode = ref(false);
const page = computed(() => (/^svg$/.test(lang.value) || /^\s*<svg/i.test(code.value)
  ? `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;display:grid;place-items:center;min-height:100vh">${code.value}</body>`
  : code.value));

// 内联显示：小网页自己把高度报告出来，外面按它撑开（沙盒里读不到内部，只能靠它发消息）
const MAX_H = 640; // 特别长的内容到这个高度就停，里面自己滚
const uid = Math.random().toString(36).slice(2);
const height = ref(160);
const frame = ref(null);
const reporter = `<script>(function(){var id=${JSON.stringify(uid)};function h(){var d=document.documentElement,b=document.body;return Math.ceil(d.getBoundingClientRect().height||d.scrollHeight)}function s(){try{parent.postMessage({qisuoHtml:id,h:h()},"*")}catch(e){}}addEventListener("load",s);if(window.ResizeObserver)new ResizeObserver(s).observe(document.documentElement);setInterval(s,1000);s()})()<\/script>`;
const inlineDoc = computed(() => page.value + reporter);
function onMsg(e) {
  if (!frame.value || e.source !== frame.value.contentWindow || e.data?.qisuoHtml !== uid) return;
  const h = Number(e.data.h);
  if (h > 0) height.value = Math.min(MAX_H, Math.max(30, h));
}
onMounted(() => window.addEventListener("message", onMsg));
onBeforeUnmount(() => window.removeEventListener("message", onMsg));

async function copy() {
  try { await navigator.clipboard.writeText(code.value); toast("已复制"); } catch { toast("复制失败，浏览器不允许"); }
}
</script>

<template>
  <div class="hb">
  <div v-if="isPage" class="html-card">
    <p v-if="!done" class="sub">✦ {{ title }} 在做……</p>
    <iframe v-else ref="frame" class="inline" :style="{ height: height + 'px' }" :srcdoc="inlineDoc" sandbox="allow-scripts allow-modals allow-forms allow-pointer-lock" referrerpolicy="no-referrer" />
    <div v-if="done" class="btns">
      <button @click.stop="copy">复制代码</button>
      <button @click.stop="open = true">全屏</button>
      <button @click.stop="showCode = !showCode">{{ showCode ? "收起代码" : "看代码" }}</button>
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
.html-card { width: 100%; min-width: 0; max-width: 100%; border-radius: 16px; overflow: hidden; background: rgba(var(--glass-rgb), .9); border: 1px solid var(--line, #00000014); box-shadow: 0 1px 3px rgba(40, 40, 60, .08); }
.sub { margin: 0; padding: 12px 14px; font-size: 0.8rem; color: var(--text-2); }
.btns { display: flex; justify-content: flex-end; gap: 6px; padding: 6px 8px; border-top: 1px solid var(--line, #00000012); }
.btns button { border: 0; border-radius: 999px; padding: 3px 10px; font-size: 0.72rem; background: transparent; color: var(--text-2); }
.btns button:active { background: var(--bg); }
.code { margin: 0; border-radius: 0; max-height: 40vh; overflow: auto; font-size: 0.72rem; line-height: 1.5; white-space: pre; background: #1e1f24; color: #e8e8ea; border-radius: 10px; padding: 10px; font-family: ui-monospace, Menlo, monospace; }
.code.plain { margin: 0; border-radius: 10px; max-width: 100%; }
.html-full { position: fixed; inset: 0; z-index: 1000; background: var(--card); display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; gap: 10px; padding: calc(env(safe-area-inset-top) + 8px) 14px 8px; border-bottom: 1px solid #0000000f; }
.bar b { flex: 1; }
.bar button { border: 0; background: var(--ink); color: var(--on-ink); border-radius: 999px; padding: 6px 16px; }
iframe { flex: 1; width: 100%; border: 0; }
iframe.inline { flex: none; display: block; background: #fff; color-scheme: light; }
</style>
