<script setup>
// 潮汐表（日历）：日式，每格只有左边一竖、底下一横，像纸上压出来的印子。
// 每格：日期、当天三个人的水温小图标、有没有记录（右上一个小点）。月初的空格放当月的「待续」
import { computed } from "vue";
import { todayYmd, MONTHS_EN } from "../../lib/dates.js";
import { moodByKey, moodsOn, postsOf, plansOf, whoList, whoInfo } from "../../lib/meanwhile.js";

const props = defineProps({ month: String, selected: String });
const emit = defineEmits(["select", "shift", "today", "plans"]);

const WEEK = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const today = todayYmd();
const y = computed(() => Number(props.month.slice(0, 4)));
const m = computed(() => Number(props.month.slice(5, 7)));
const lead = computed(() => new Date(y.value, m.value - 1, 1).getDay());
const dayCount = computed(() => new Date(y.value, m.value, 0).getDate());
const pad = n => String(n).padStart(2, "0");

const recorded = computed(() => {
  const s = new Set();
  for (const p of postsOf()) if (p.date.startsWith(props.month)) s.add(p.date);
  return s;
});
const cells = computed(() => Array.from({ length: dayCount.value }, (_, i) => {
  const d = i + 1, date = `${props.month}-${pad(d)}`;
  const order = whoList();
  const moods = moodsOn(date).sort((a, b) => order.indexOf(a.who) - order.indexOf(b.who)).map(x => ({ ...x, mood: moodByKey(x.key) })).filter(x => x.mood);
  return { d, date, moods, has: recorded.value.has(date), today: date === today, future: date > today };
}));
const plans = computed(() => plansOf(props.month));
const todo = computed(() => plans.value.slice(0, 3));
const monthEn = computed(() => MONTHS_EN[m.value - 1]);
const isThisMonth = computed(() => props.month === today.slice(0, 7));
const nameOf = who => whoInfo(who).name;
const label = c => `${m.value} 月 ${c.d} 日${c.moods.length ? "，水温：" + c.moods.map(x => `${nameOf(x.who)}${x.mood.name}`).join("、") : ""}${c.has ? "，有记录" : ""}`;
</script>

<template>
  <section class="cal" aria-label="潮汐表">
    <div class="head">
      <button class="nav" aria-label="上个月" @click="emit('shift', -1)">‹</button>
      <div class="ttl">
        <span class="yr">{{ String(y).slice(0, 2) }}</span>
        <span class="mo">{{ monthEn }}</span>
        <span class="yr">{{ String(y).slice(2) }}</span>
      </div>
      <button class="nav" aria-label="下个月" @click="emit('shift', 1)">›</button>
    </div>
    <div class="sub-ttl">
      <span>潮汐表</span>
      <button v-if="!isThisMonth" class="back-today" @click="emit('today')">回到今天</button>
    </div>
    <div class="grid">
      <div v-for="w in WEEK" :key="w" class="wk">{{ w }}</div>
      <!-- 月初的空格：当月的待续 -->
      <button v-if="lead >= 2" class="todo" :style="{ gridColumn: `span ${lead}` }" @click="emit('plans')">
        <b>待续</b>
        <span v-for="p in todo" :key="p.id" class="ln" :class="{ done: p.doneAt }">{{ p.text }}</span>
        <span v-if="!plans.length" class="ln ph">写点接下来想做的 +</span>
      </button>
      <div v-else-if="lead === 1" class="blank" />
      <button v-for="c in cells" :key="c.date" class="cell" :class="{ today: c.today, sel: c.date === selected, future: c.future }" :aria-label="label(c)" @click="emit('select', c.date)">
        <span class="d">{{ c.d }}</span>
        <i v-if="c.has" class="dot" />
        <span v-if="c.moods.length" class="ms" :class="`n${c.moods.length}`">
          <img v-for="x in c.moods" :key="x.id" :src="x.mood.img" alt="" draggable="false" />
        </span>
      </button>
    </div>
    <!-- 空格不到两个的月份：待续放在下面一行 -->
    <button v-if="lead < 2" class="todo wide" @click="emit('plans')">
      <b>待续</b>
      <span v-for="p in todo" :key="p.id" class="ln" :class="{ done: p.doneAt }">{{ p.text }}</span>
      <span v-if="!plans.length" class="ln ph">写点接下来想做的 +</span>
    </button>
  </section>
</template>

<style scoped>
.cal {
  --paper-line: #cdc3b3; --paper-hi: rgba(255, 255, 255, .75); --ink-cal: #3d3a35;
  padding: 18px 16px 6px; font-family: Georgia, "Times New Roman", "Songti SC", serif;
}
:root[data-theme="dark"] .cal { --paper-line: #12151b; --paper-hi: rgba(255, 255, 255, .07); --ink-cal: #d6d9e0; }
.head { display: flex; align-items: center; justify-content: space-between; color: var(--ink-cal); }
.ttl { display: flex; align-items: baseline; gap: 14px; }
.yr { font-size: 1.3rem; letter-spacing: 1px; }
.mo { font-size: 1.55rem; letter-spacing: .5px; }
.nav { border: 0; background: none; font-size: 1.7rem; line-height: 1; color: var(--text-2); width: 40px; height: 36px; font-family: inherit; }
.sub-ttl { display: flex; justify-content: center; align-items: center; gap: 10px; margin: -2px 0 10px; font-size: .72rem; letter-spacing: .4em; text-indent: .4em; color: var(--text-3); font-family: var(--font); }
.back-today { border: 0; background: none; color: var(--accent); font-size: .74rem; letter-spacing: 0; text-indent: 0; padding: 2px 6px; }
.grid { display: grid; grid-template-columns: repeat(7, 1fr); }
.wk { position: relative; text-align: center; font-size: .6rem; letter-spacing: .5px; padding: 0 0 5px; color: var(--ink-cal); }
.wk::after { content: ""; position: absolute; left: 14%; right: 14%; bottom: 0; height: 1.5px; background: var(--paper-line); box-shadow: 0 1px 0 var(--paper-hi); }
.cell, .blank, .todo { position: relative; min-height: 62px; }
/* 每格只有左边一竖和底下一横：比底色深一点的同色，旁边一道亮边，像压在纸上的印子 */
.cell::before, .todo::before { content: ""; position: absolute; left: 0; top: 7px; bottom: 5px; width: 1.5px; background: var(--paper-line); box-shadow: 1px 0 0 var(--paper-hi); border-radius: 1px; }
.cell::after, .todo::after { content: ""; position: absolute; left: 7px; right: 7px; bottom: 0; height: 1.5px; background: var(--paper-line); box-shadow: 0 1px 0 var(--paper-hi); border-radius: 1px; }
.cell { border: 0; background: none; padding: 5px 0 0; color: var(--ink-cal); text-align: left; font-family: inherit; }
.cell .d { position: absolute; left: 7px; top: 5px; font-size: .72rem; line-height: 1; }
.cell.today .d { display: grid; place-items: center; width: 17px; height: 17px; left: 4px; top: 2px; border-radius: 50%; background: #4a6086; color: #fff; font-size: .66rem; }
:root[data-theme="dark"] .cell.today .d { background: #a9c1e2; color: #1b1e25; }
.cell.sel { background: rgba(106, 163, 232, .13); border-radius: 6px; }
.cell.future .d { opacity: .55; }
.dot { position: absolute; right: 7px; top: 6px; width: 5px; height: 5px; border-radius: 50%; background: #6f8fb8; opacity: .8; }
.ms { position: absolute; left: 0; right: 0; bottom: 5px; display: flex; justify-content: center; align-items: flex-end; padding: 0 3px; }
.ms img { display: block; flex: none; width: 34px; height: 34px; object-fit: contain; pointer-events: none; }
.ms.n2 img { width: 25px; height: 25px; }
.ms.n3 img { width: 20px; height: 20px; }
.ms.n2 img + img { margin-left: -2px; }
.ms.n3 img + img { margin-left: -3px; }
/* 待续：月初空格里的一张小贴纸 */
.todo { border: 0; background: none; padding: 8px 8px 8px 10px; text-align: left; display: flex; flex-direction: column; gap: 1px; font-family: var(--font); color: var(--ink-cal); min-width: 0; }
.todo b { font-family: Georgia, "Times New Roman", serif; font-size: .74rem; font-weight: 700; letter-spacing: .5px; }
.todo .ln { font-size: .66rem; line-height: 1.35; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.todo .ln.done { text-decoration: line-through; opacity: .6; }
.todo .ln.ph { color: var(--text-3); }
.todo.wide { width: 100%; margin-top: 4px; min-height: 0; padding: 8px 10px 10px; flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
.todo.wide .ln { max-width: 40%; }
</style>
