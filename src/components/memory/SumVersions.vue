<script setup>
// 摘要的历史版本：每次整理、改、退回之前，旧的那份都留一个（最多 30 个）。点开能看全文，能退回到那一版
import { ref, computed } from "vue";
import { restoreSum } from "../../lib/budget.js";
import { toast } from "../../lib/toast.js";

const props = defineProps({ owner: Object, skey: { type: String, default: "summary" }, unit: { type: String, default: "条" } });
const emit = defineEmits(["restored"]);
const open = ref(false);
const shown = ref(null);
const vers = computed(() => [...(props.owner?.[props.skey + "Vers"] || [])].reverse());
const md = ts => (ts ? new Date(ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const day = ts => (ts ? new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : "?");
const spanOf = ([a, b]) => (day(a) === day(b) ? day(a) : `${day(a)}–${day(b)}`);
const WHY = { limit: "自动整理", full: "快到模型上限，自动整理", manual: "点「现在整理」", edited: "你改过" };
function how(v) {
  if (v.restoredAt) return "退回来的";
  if (v.edited && !v.why) return "你改过";
  return WHY[v.why] || "整理的";
}
function restore(v) {
  if (!confirm(`退回到 ${md(v.at || v.savedAt)} 的这一版？\n这一版之后整理进去的${props.unit === "句" ? "讨论" : "聊天"}会重新变回原文带给他（太多的话下次会再整理一遍）；现在这份也会留一个版本，随时能换回来。`)) return;
  restoreSum(props.owner, props.skey, v);
  shown.value = null;
  emit("restored");
  toast("退回去了");
}
</script>

<template>
  <div v-if="vers.length" class="sv">
    <button class="head" @click="open = !open">历史版本 {{ vers.length }} 个<span>{{ open ? "收起" : "展开" }}</span></button>
    <template v-if="open">
      <article v-for="(v, i) in vers" :key="i" class="ver" @click="shown = shown === v ? null : v">
        <div class="meta">
          <b>{{ md(v.at || v.savedAt) }}</b>
          <span>{{ how(v) }}{{ v.count ? ` · 一共 ${v.count} ${unit}` : "" }}{{ v.last ? `（这次 ${v.last} ${unit}${v.lastSpan ? `，${spanOf(v.lastSpan)}` : ""}）` : "" }}{{ v.model ? ` · ${v.model}` : "" }}</span>
        </div>
        <p :class="{ clamp: shown !== v }">{{ v.text }}</p>
        <button v-if="shown === v" class="btn soft small" @click.stop="restore(v)">退回到这一版</button>
      </article>
      <p class="note">每次整理、改动、退回之前，旧的那份都会留在这里（最多 30 个）。</p>
    </template>
  </div>
</template>

<style scoped>
.sv { margin: 10px 0 4px; }
.head { width: 100%; display: flex; justify-content: space-between; align-items: center; border: 0; background: var(--bg); border-radius: 12px; padding: 9px 12px; font-size: .82rem; color: var(--text-2); font-weight: 600; }
.head span { font-weight: 400; color: var(--text-3); font-size: .76rem; }
.ver { margin-top: 8px; padding: 10px 12px; border-radius: 14px; background: var(--card); box-shadow: var(--shadow-soft); cursor: pointer; }
.meta { display: flex; flex-direction: column; gap: 1px; font-size: .72rem; color: var(--text-3); }
.meta b { color: var(--text); font-size: .8rem; }
.ver p { margin: 6px 0 0; font-size: .8rem; line-height: 1.7; color: var(--text-2); white-space: pre-wrap; }
.ver p.clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ver .btn { margin-top: 8px; }
.note { font-size: .7rem; color: var(--text-3); margin: 8px 2px 0; }
</style>
