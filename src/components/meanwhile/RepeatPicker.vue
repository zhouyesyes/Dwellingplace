<script setup>
// 待续的周期设置：默认「不重复」，选了别的才展开。表单的样子见 lib/meanwhile.js 的 emptyRepeatForm
import { computed } from "vue";

const props = defineProps({ form: Object, noNone: Boolean });
const f = computed(() => props.form);
const TYPES = [
  { v: "none", name: "不重复" },
  { v: "daily", name: "每天" },
  { v: "weekly", name: "每周几" },
  { v: "monthly", name: "每月几号" },
  { v: "interval", name: "每隔几天" },
  { v: "yearly", name: "每年几月几号" },
];
const types = computed(() => (props.noNone ? TYPES.slice(1) : TYPES));
const DAYS = [["一", 1], ["二", 2], ["三", 3], ["四", 4], ["五", 5], ["六", 6], ["日", 0]];
const toggleDay = d => { const w = f.value.wd; const i = w.indexOf(d); if (i >= 0) w.splice(i, 1); else w.push(d); };
</script>

<template>
  <div class="rp">
    <label class="row">
      <span class="lab">周期</span>
      <select v-model="f.type" class="input sel" aria-label="周期">
        <option v-for="t in types" :key="t.v" :value="t.v">{{ t.name }}</option>
      </select>
    </label>
    <template v-if="f.type !== 'none'">
      <div v-if="f.type === 'weekly'" class="days">
        <button v-for="[n, d] in DAYS" :key="d" type="button" class="day" :class="{ on: f.wd.includes(d) }" @click="toggleDay(d)">{{ n }}</button>
      </div>
      <label v-if="f.type === 'monthly'" class="row">
        <span class="lab">每月</span><input v-model.number="f.dom" class="input num" type="number" min="1" max="31" inputmode="numeric" /><span class="lab">号<small>（小月没有就挂最后一天）</small></span>
      </label>
      <label v-if="f.type === 'interval'" class="row">
        <span class="lab">每隔</span><input v-model.number="f.n" class="input num" type="number" min="1" max="365" inputmode="numeric" /><span class="lab">天（从开始日起算）</span>
      </label>
      <label v-if="f.type === 'yearly'" class="row">
        <span class="lab">每年</span><input v-model.number="f.mo" class="input num" type="number" min="1" max="12" inputmode="numeric" /><span class="lab">月</span><input v-model.number="f.day" class="input num" type="number" min="1" max="31" inputmode="numeric" /><span class="lab">日</span>
      </label>
      <label class="row">
        <span class="lab">开始</span><input v-model="f.start" class="input date" type="date" />
      </label>
      <div class="row">
        <span class="lab">停止</span>
        <button type="button" class="chip" :class="{ on: f.stop === 'forever' }" @click="f.stop = 'forever'">一直重复</button>
        <button type="button" class="chip" :class="{ on: f.stop === 'until' }" @click="f.stop = 'until'">到某天 / 持续几天</button>
        <button type="button" class="chip" :class="{ on: f.stop === 'whole' }" @click="f.stop = 'whole'">整件做完才停</button>
      </div>
      <div v-if="f.stop === 'until'" class="row">
        <button type="button" class="chip" :class="{ on: f.untilMode === 'date' }" @click="f.untilMode = 'date'">结束日期</button>
        <button type="button" class="chip" :class="{ on: f.untilMode === 'days' }" @click="f.untilMode = 'days'">持续天数</button>
        <input v-if="f.untilMode === 'date'" v-model="f.until" class="input date" type="date" :min="f.start" />
        <template v-else><input v-model.number="f.days" class="input num" type="number" min="1" max="3650" inputmode="numeric" /><span class="lab">天</span></template>
      </div>
      <p v-if="f.stop === 'whole'" class="note">一直出现，直到你在这件待续的小卡里点「整件停掉」。</p>
    </template>
  </div>
</template>

<style scoped>
.rp { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.lab { font-size: .8rem; color: var(--text-2); }
.lab small { color: var(--text-3); font-size: .7rem; }
.sel { width: auto; flex: 1; min-width: 150px; }
.num { width: 76px; flex: none; }
.date { width: auto; flex: 1; min-width: 150px; }
.days { display: flex; gap: 6px; }
.day { flex: 1; max-width: 44px; aspect-ratio: 1; border-radius: 50%; border: 1px solid var(--line); background: var(--card); color: var(--text-2); font-size: .82rem; padding: 0; }
.day.on { background: color-mix(in srgb, var(--accent) 16%, var(--card)); border-color: var(--accent); color: var(--text); }
.chip { display: inline-flex; align-items: center; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--text-2); font-size: .78rem; }
.chip.on { background: color-mix(in srgb, var(--accent) 16%, var(--card)); border-color: var(--accent); color: var(--text); }
.note { margin: 0; font-size: .74rem; color: var(--text-3); line-height: 1.5; }
</style>
