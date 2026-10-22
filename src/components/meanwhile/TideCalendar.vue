<script setup>
// 潮汐表（日历）：日式，每格只有左边一竖、底下一横，像纸上压出来的印子。
// 每格：日期、当天挂待续的人（每人一个小圆点）、三个人的水温小图标、有没有记录（右上一个小点）。月初的空格放当月的「待续」
import { computed } from "vue";
import { todayYmd, MONTHS_EN } from "../../lib/dates.js";
import { moodByKey, moodsOn, postsOf, monthPlansOf, planItemsOn, whoList, whoInfo } from "../../lib/meanwhile.js";
import { useDayMemories } from "../../lib/dayMemories.js";

const props = defineProps({ month: String, selected: String });
const emit = defineEmits(["select", "shift", "today", "plans", "mood"]);
const { starsOf } = useDayMemories({ load: true });

const WEEK = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]; // 周一开头
const today = todayYmd();
const y = computed(() => Number(props.month.slice(0, 4)));
const m = computed(() => Number(props.month.slice(5, 7)));
const lead = computed(() => (new Date(y.value, m.value - 1, 1).getDay() + 6) % 7);
const dayCount = computed(() => new Date(y.value, m.value, 0).getDate());
const pad = n => String(n).padStart(2, "0");

const recorded = computed(() => {
  const s = new Set();
  for (const p of postsOf()) if (p.date.startsWith(props.month)) s.add(p.date);
  return s;
});
// 当天挂了待续的人，每人一个小圆点（按页面里的顺序，颜色是各自的标识色；这个人挂的全做完了就淡一点）
const planDots = date => {
  const ps = planItemsOn(date), order = whoList();
  return order.filter(w => ps.some(p => p.who === w)).map(w => ({ who: w, color: whoInfo(w).color, done: ps.filter(p => p.who === w).every(p => p.doneAt) }));
};
const cells = computed(() => Array.from({ length: dayCount.value }, (_, i) => {
  const d = i + 1, date = `${props.month}-${pad(d)}`;
  const order = whoList();
  const moods = moodsOn(date).sort((a, b) => order.indexOf(a.who) - order.indexOf(b.who)).map(x => ({ ...x, mood: moodByKey(x.key) })).filter(x => x.mood);
  return { d, date, moods, has: recorded.value.has(date), today: date === today, future: date > today, pdots: planDots(date), last: (lead.value + i + 1) % 7 === 0 };
}));
// 月末补满最后一周的空格，也画线，整张表四边都收口
const tail = computed(() => Array.from({ length: (7 - (lead.value + dayCount.value) % 7) % 7 }, (_, i) => i));
const tailLast = i => i === tail.value.length - 1;
const plans = computed(() => monthPlansOf(props.month));
const todo = computed(() => plans.value.slice(0, 3));
const monthEn = computed(() => MONTHS_EN[m.value - 1]);
const isThisMonth = computed(() => props.month === today.slice(0, 7));
const nameOf = who => whoInfo(who).name;
const label = c => `${m.value} 月 ${c.d} 日${c.pdots.length ? "，待续：" + c.pdots.map(x => nameOf(x.who)).join("、") : ""}${c.moods.length ? "，水温：" + c.moods.map(x => `${nameOf(x.who)}${x.mood.name}`).join("、") : ""}${c.has ? "，有记录" : ""}`;
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
      <button v-for="c in cells" :key="c.date" class="cell" :class="{ today: c.today, sel: c.date === selected, future: c.future, last: c.last }" :aria-label="label(c)" @click="emit('select', c.date)">
        <span class="d">{{ c.d }}</span>
        <i v-if="c.has" class="dot" />
        <span v-if="c.pdots.length" class="pdots"><i v-for="x in c.pdots" :key="x.who" :class="{ done: x.done }" :style="{ background: x.color }" /></span>
        <span v-if="starsOf(c.date).length" class="stars"><i v-for="(col, j) in starsOf(c.date)" :key="j" :style="{ color: col }">✦</i></span>
        <span v-if="c.moods.length" class="ms" :class="`n${c.moods.length}`">
          <img v-for="x in c.moods" :key="x.id" :src="x.mood.img" :alt="`${nameOf(x.who)}：${x.mood.name}`" draggable="false" role="button" @click.stop="emit('mood', x)" />
        </span>
      </button>
      <div v-for="i in tail" :key="'t' + i" class="blank" :class="{ last: tailLast(i) }" />
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
  padding: 18px 16px 6px; font-family: "Poppins", var(--font);
}
:root[data-theme="dark"] .cal { --paper-line: #12151b; --paper-hi: rgba(255, 255, 255, .07); --ink-cal: #d6d9e0; }
.head { display: flex; align-items: center; justify-content: space-between; color: var(--ink-cal); }
.ttl { display: flex; align-items: baseline; gap: 14px; }
.yr { font-size: 1.3rem; letter-spacing: 1px; }
.mo { font-size: 1.55rem; letter-spacing: .5px; }
.nav { border: 0; background: none; font-size: 1.7rem; line-height: 1; color: var(--text-2); width: 40px; height: 36px; font-family: inherit; }
.sub-ttl { display: flex; justify-content: center; align-items: center; gap: 10px; margin: -2px 0 10px; font-size: .72rem; letter-spacing: .4em; text-indent: .4em; color: var(--text-3); }
.back-today { border: 0; background: none; color: var(--accent); font-size: .74rem; letter-spacing: 0; text-indent: 0; padding: 2px 6px; }
.grid { display: grid; grid-template-columns: repeat(7, 1fr); }
.wk { position: relative; text-align: center; font-size: .6rem; letter-spacing: .5px; padding: 0 0 5px; color: var(--ink-cal); }
.wk::after { content: ""; position: absolute; left: 14%; right: 14%; bottom: 0; height: 1.5px; background: var(--paper-line); box-shadow: 0 1px 0 var(--paper-hi); }
.cell, .blank, .todo { position: relative; min-height: 62px; }
.cell::before, .blank::before, .todo::before, .cell::after, .blank::after, .todo::after { content: ""; position: absolute; background: var(--paper-line); border-radius: 1px; }
/* 每格有左边一竖和底下一横（月初月末的空格也一样），最右一列再收一竖口：比底色深一点的同色，旁边一道亮边，像压在纸上的印子 */
.cell::before, .blank::before, .todo::before { left: 0; top: 7px; bottom: 5px; width: 1.5px; box-shadow: 1px 0 0 var(--paper-hi); }
.cell::after, .blank::after, .todo::after { left: 0; right: 0; bottom: 0; height: 1.5px; box-shadow: 0 1px 0 var(--paper-hi); }
.cell.last, .blank.last, .todo.wide { background-image: linear-gradient(var(--paper-line), var(--paper-line)); background-size: 1.5px calc(100% - 12px); background-position: right 0 top 7px; background-repeat: no-repeat; }
.cell { border: 0; background-color: transparent; padding: 5px 0 0; color: var(--ink-cal); text-align: left; font-family: inherit; }
.cell .d { position: absolute; left: 7px; top: 5px; font-size: .72rem; line-height: 1; }
.cell.today .d { display: grid; place-items: center; width: 17px; height: 17px; left: 4px; top: 2px; border-radius: 50%; background: #4a6086; color: #fff; font-size: .66rem; }
:root[data-theme="dark"] .cell.today .d { background: #a9c1e2; color: #1b1e25; }
.cell.sel { background-color: rgba(106, 163, 232, .13); border-radius: 6px; }
.cell.future .d { opacity: .55; }
.pdots { position: absolute; left: 7px; top: 22px; display: flex; gap: 2px; }
.pdots i { width: 6px; height: 6px; border-radius: 50%; box-shadow: 0 0 0 .5px rgba(60, 50, 40, .18); }
.pdots i.done { opacity: .45; }
.dot { position: absolute; right: 7px; top: 6px; width: 5px; height: 5px; border-radius: 50%; background: #6f8fb8; opacity: .8; }
/* 一个人、两个人、三个人，水滴一样大：按三颗刚好并排放得下的尺寸定，少于三颗就居中 */
.ms { position: absolute; left: 0; right: 0; bottom: 5px; display: flex; justify-content: center; align-items: flex-end; padding: 0 3px; }
.ms img { display: block; flex: none; width: calc((100% - 6px) / 3); max-width: 22px; aspect-ratio: 1; object-fit: contain; }
.stars { position: absolute; right: 6px; top: 13px; display: flex; font-size: 7px; line-height: 1; }
.stars i { font-style: normal; }
/* 待续：月初空格里的一张小贴纸 */
.todo { border: 0; background-color: transparent; padding: 8px 8px 8px 10px; text-align: left; display: flex; flex-direction: column; gap: 1px; color: var(--ink-cal); min-width: 0; }
.todo b { font-size: .74rem; font-weight: 700; letter-spacing: .5px; }
.todo .ln { font-size: .66rem; line-height: 1.35; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.todo .ln.done { text-decoration: line-through; opacity: .6; }
.todo .ln.ph { color: var(--text-3); }
.todo.wide { width: 100%; margin-top: 4px; min-height: 0; padding: 8px 10px 10px; flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
.todo.wide .ln { max-width: 40%; }
</style>
