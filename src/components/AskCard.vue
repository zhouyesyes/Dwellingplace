<script setup>
// 提问选项卡：AI 回复底下的一张卡，几道题、每题 2～4 个选项（单选或多选）、最后一个「其他…」；全答完「好了」才亮
// 答完发出后 ask.done 记下选了什么，卡片变淡、选中的留颜色、不能再点（见 lib/ask.js）
import { reactive, computed } from "vue";

const props = defineProps({ ask: Object, disabled: Boolean });
const emit = defineEmits(["submit"]);

const done = computed(() => props.ask.done || null);
const picks = reactive(props.ask.qs.map(() => []));
const otherOn = reactive(props.ask.qs.map(() => false));
const others = reactive(props.ask.qs.map(() => ""));

const pickedOf = i => done.value ? done.value.picks[i] || [] : picks[i];
const otherOf = i => done.value ? !!(done.value.others[i] || "").trim() : otherOn[i];
const otherText = i => done.value ? done.value.others[i] || "" : others[i];
const answered = i => pickedOf(i).length > 0 || (otherOf(i) && otherText(i).trim());
const ready = computed(() => !done.value && props.ask.qs.every((_, i) => answered(i)));

function tap(i, k) {
  if (done.value) return;
  const q = props.ask.qs[i];
  const at = picks[i].indexOf(k);
  if (q.multi) { if (at >= 0) picks[i].splice(at, 1); else picks[i].push(k); return; }
  picks[i] = at >= 0 ? [] : [k]; // 单选：选这个、取消其他项
  otherOn[i] = false;
}
function tapOther(i) {
  if (done.value) return;
  otherOn[i] = !otherOn[i];
  if (otherOn[i] && !props.ask.qs[i].multi) picks[i] = [];
}
const submit = () => ready.value && !props.disabled && emit("submit", {
  picks: picks.map(p => [...p]),
  others: others.map((t, i) => (otherOn[i] ? t.trim() : "")),
});
</script>

<template>
  <div class="ask" :class="{ done }">
    <section v-for="(q, i) in ask.qs" :key="i" class="q">
      <p class="qt">{{ q.q }}<small v-if="q.multi">可多选</small></p>
      <button v-for="(o, k) in q.opts" :key="k" type="button" class="opt" :class="{ on: pickedOf(i).includes(k) }" :disabled="!!done" @click="tap(i, k)">
        <i class="dot" :class="{ box: q.multi }" />
        <span class="tx"><b>{{ o.n }}</b><em v-if="o.d">{{ o.d }}</em></span>
      </button>
      <button type="button" class="opt" :class="{ on: otherOf(i) }" :disabled="!!done" @click="tapOther(i)">
        <i class="dot" :class="{ box: q.multi }" />
        <span class="tx"><b>其他…</b></span>
      </button>
      <input v-if="otherOf(i)" class="other" :value="otherText(i)" @input="others[i] = $event.target.value" :readonly="!!done" maxlength="80" placeholder="自己写一句" @keydown.enter.prevent />
    </section>
    <button v-if="!done" type="button" class="ok" :disabled="!ready || disabled" @click="submit">好了</button>
  </div>
</template>

<style scoped>
.ask { width: min(340px, 100%); padding: 6px 14px 14px; border-radius: 18px; background: var(--ask-bg); border: 1px solid var(--ask-line); color: var(--text); transition: opacity .3s; }
.ask.done { opacity: .6; }
.q { padding-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.q + .q { margin-top: 6px; border-top: 1px dashed var(--ask-line); }
.qt { margin: 0 0 2px; font-size: .95rem; font-weight: 600; line-height: 1.5; }
.qt small { margin-left: 8px; font-size: .68rem; font-weight: 400; color: var(--text-2); }
.opt { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 8px 10px; border: 1px solid var(--ask-line); border-radius: 12px; background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer; }
.opt.on { background: var(--ask-sel); border-color: var(--text-2); }
.opt:disabled { cursor: default; }
.dot { flex: none; width: 15px; height: 15px; margin-top: 3px; border: 1.5px solid var(--text-2); border-radius: 50%; position: relative; }
.dot.box { border-radius: 4px; }
.opt.on .dot { background: var(--text); border-color: var(--text); }
.opt.on .dot::after { content: ""; position: absolute; inset: 3px; border-radius: inherit; background: var(--ask-bg); }
.tx { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tx b { font-size: .92rem; font-weight: 600; overflow-wrap: anywhere; }
.tx em { font-style: normal; font-size: .76rem; line-height: 1.45; color: var(--text-2); overflow-wrap: anywhere; }
.other { width: 100%; box-sizing: border-box; padding: 8px 12px; border: 1px solid var(--ask-line); border-radius: 12px; background: var(--card); color: var(--text); font: inherit; font-size: .9rem; outline: none; }
.other:focus { border-color: var(--text-2); }
.ok { display: block; margin: 14px 0 0 auto; padding: 8px 26px; border: 0; border-radius: 999px; background: var(--ink); color: var(--on-ink); font: inherit; font-weight: 600; cursor: pointer; }
.ok:disabled { opacity: .3; cursor: default; }
</style>
