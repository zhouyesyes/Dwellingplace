<script setup>
// 摘要记忆现在是什么情况：整理了多少条、上一次是怎么整理的、下一次什么时候
import { ref, computed, watchEffect } from "vue";
import { store, loadMessages } from "../../store/index.js";
import { autoAt, SUM_WHY, pathOf } from "../../lib/chat.js";
import { sumTokens, chatTokens, fmtTok } from "../../lib/budget.js";

const props = defineProps({ thread: Object });
const s = computed(() => props.thread?.summary);
const limit = computed(() => (void store.settings.historyTokens, chatTokens()));
// 这个对话一共多少条（这一条线上的）、整理进摘要的占多少
const counts = ref(null);
watchEffect(async () => {
  const t = props.thread, upTo = t?.summary?.upTo;
  if (!t) return (counts.value = null);
  const real = pathOf(t, await loadMessages(t.id)).filter(m => m.from !== "event" && !m.pending);
  const i = upTo ? real.findIndex(m => m.id === upTo) : -1;
  counts.value = { total: real.length, done: i + 1, rest: real.length - i - 1, restTok: sumTokens(real.slice(i + 1)) };
});
const when = ts => new Date(ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
</script>

<template>
  <div class="si">
    <p v-if="counts" class="cnt">这个对话一共 <b>{{ counts.total }}</b> 条；整理进摘要 <b>{{ counts.done }}</b> 条{{ counts.total ? `（${Math.round((counts.done / counts.total) * 100)}%）` : "" }}；摘要后面还有 <b>{{ counts.rest }}</b> 条，约 <b>{{ fmtTok(counts.restTok) }}</b> token（到 {{ fmtTok(autoAt()) }} 自动整理）。</p>
    <template v-if="s?.text">
      <p>已经整理了 <b>{{ s.count || 0 }}</b> 条聊天{{ s.from ? `（含从「${s.from}」带过来的）` : "" }}。</p>
      <p v-if="s.at">上一次：{{ when(s.at) }}，{{ s.edited && !s.why ? "你改过" : SUM_WHY[s.why] || "自动整理的" }}{{ s.last ? `，整理进去 ${s.last} 条` : "" }}{{ s.model ? `，用 ${s.model}` : "" }}{{ s.restoredAt ? "（退回来的版本）" : "" }}。</p>
    </template>
    <p v-else>还没有摘要。</p>
    <p class="rule">摘要后面的聊天原样带给他，最多约 {{ fmtTok(limit) }} token（记忆设置、聊天输入框上方的用量里都能调）。到八成（{{ fmtTok(autoAt()) }}），或者内容到了模型上限的七成，就会自动整理：把这份摘要和前面的聊天合成新的一份，最近约 {{ fmtTok(limit / 2) }} token 留着不动。点「现在整理」也一样。每次整理、改动之前的那份都留在下面的历史版本里。</p>
  </div>
</template>

<style scoped>
.si { font-size: .76rem; line-height: 1.7; color: var(--text-2); margin: 0 2px 10px; }
.si p { margin: 0 0 2px; }
.si b { color: var(--text); }
.rule { color: var(--text-3); margin-top: 4px !important; }
</style>
