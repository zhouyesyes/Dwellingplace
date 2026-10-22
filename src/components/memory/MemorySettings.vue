<script setup>
// 记忆设置：几个和记忆有关的数字、整理用的模型，放在一起（别的地方也还能改，改的是同一个）
import { computed } from "vue";
import { store } from "../../store/index.js";
import { fmtTok } from "../../lib/budget.js";
import Sheet from "../Sheet.vue";

defineProps({ open: Boolean, him: String });
defineEmits(["close"]);
const ROWS = [
  { key: "historyTokens", def: 50000, opts: [20000, 30000, 50000, 80000, 120000], unit: "token", fmt: fmtTok, title: "聊天：每次带多少聊天原文", note: "摘要后面的聊天原样带给他，到这个数的八成就整理一次，留最近一半。也在聊天输入框上方的用量里。" },
  { key: "sceneChatTokens", def: 6000, opts: [3000, 6000, 10000], unit: "token", fmt: fmtTok, title: "共读、共写里带多少主聊天", note: "进到共读、共写，也带上主聊天最近的这么多，他在哪都接得上平时聊的。" },
  { key: "recallCount", def: 5, opts: [0, 3, 5, 8], unit: "张", title: "普通记忆：每次自动想起最多几张", note: "按你最新说的话，找最相关的几张附上；对不上就一张也不放。常驻的不算在里面（最多 20 张，一直带着）。" },
  { key: "reviewEvery", def: 14, opts: [0, 7, 14, 30], unit: "", fmt: n => (n ? `${n} 天` : "不自动"), title: "他多久把记忆卡片整理一遍", note: "用他自己的模型，从头看一遍：合并重复的、标出过时的、挑要常驻的。都是建议，记忆库里「整理建议」等你采纳。选「不」就只在你点的时候整理。" },
  { key: "readSumChars", def: 60000, opts: [30000, 60000, 100000], unit: "字", fmt: n => `${n / 10000} 万`, title: "共读：原文攒到多少字整理一次前情", note: "等这一章读完再整理（一直没读完一章，多 1 万字就直接整理）；整理模型只整理新读的那段，客观地写梗概。上次整理之后的原文他都看得见。也在读书页 Aa 里。" },
  { key: "readImprChars", def: 20000, opts: [10000, 20000, 30000], unit: "字", fmt: n => `${n / 10000} 万`, title: "共读：每读多少字他写一句中途印象", note: "用他自己的模型，100 字以内，每一版都留着（书的信息页能看他的理解怎么变的），平时只带最新的一版。" },
  { key: "roomTokens", def: 20000, opts: [10000, 20000, 30000, 50000], unit: "token", fmt: fmtTok, title: "小世界花园房间：每次带多少对话原文", note: "逛、玩、雾潮群岛三间房共用，到八成就整理成这间房自己的摘要，留最近一半。也在房间右上角「⋯」里。" },
  { key: "writeTokens", def: 30000, opts: [10000, 20000, 30000, 50000], unit: "token", fmt: fmtTok, title: "共写：每次带多少讨论原文", note: "到八成就整理成讨论摘要（只在那本书里），留最近一半。也在共写「⋯」里。" },
];
const val = r => Number(store.settings[r.key] ?? r.def);
const groups = computed(() => store.apis.map(a => ({ api: a, models: [...new Set([a.model, ...(a.favModels || [])].filter(Boolean))] })).filter(g => g.models.length));
const helperKey = computed(() => {
  const h = store.settings.helper;
  return h && store.apis.some(a => a.id === h.apiId) ? `${h.apiId}\u0000${h.model}` : "";
});
function setHelper(v) {
  if (!v) { store.settings.helper = null; return; }
  const [apiId, model] = v.split("\u0000");
  store.settings.helper = { apiId, model };
}
</script>

<template>
  <Sheet :open="open" title="记忆设置" @close="$emit('close')">
    <div class="ms">
      <div v-for="r in ROWS" :key="r.key" class="row">
        <b>{{ r.title }}</b>
        <div class="seg"><button v-for="n in r.opts" :key="n" :class="{ on: val(r) === n }" @click="store.settings[r.key] = n">{{ r.fmt ? r.fmt(n) : n }} {{ r.unit }}</button></div>
        <small>{{ r.note }}</small>
      </div>
      <div class="row">
        <b>整理用的模型</b>
        <select :value="helperKey" @change="e => setHelper(e.target.value)">
          <option value="">和{{ him }}一样</option>
          <optgroup v-for="g in groups" :key="g.api.id" :label="g.api.name || '未命名'">
            <option v-for="m in g.models" :key="m" :value="g.api.id + '\u0000' + m">{{ m }}</option>
          </optgroup>
        </select>
        <small>聊天摘要、共读前情、共写讨论摘要、挑候选记忆用它，可以选便宜的（比如 DeepSeek）。{{ him }}说的话、批注、自己写的记忆不用它。</small>
      </div>
    </div>
  </Sheet>
</template>

<style scoped>
.ms { display: flex; flex-direction: column; gap: 18px; }
.row { display: flex; flex-direction: column; gap: 8px; }
.row b { font-size: .9rem; font-weight: 600; }
.row small { font-size: .74rem; line-height: 1.6; color: var(--text-3); }
.seg { display: flex; flex-wrap: wrap; gap: 6px; }
.seg button { border: 0; background: var(--bg); padding: 6px 12px; border-radius: 999px; font-size: .82rem; color: var(--text-2); }
.seg button.on { background: var(--ink); color: var(--on-ink); font-weight: 600; }
select { border: 1px solid var(--line); background: var(--card); border-radius: 12px; padding: 8px 10px; font-size: .88rem; color: var(--text); }
</style>
