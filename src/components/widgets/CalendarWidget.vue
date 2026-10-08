<script setup>
// 日历：你和 AI 们一起记的小事，日期下面用各自的颜色标小圆点
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { store, uid, authorInfo, PALETTE } from "../../store/index.js";
import { hasXinchao, dashToken, loadMemoryMap, xcCache, starDate } from "../../lib/xinchao.js";
import { ymd, todayYmd, MONTHS_EN } from "../../lib/dates.js";
import Sheet from "../Sheet.vue";
import Icon from "../Icon.vue";
import ColorSwatches from "../ColorSwatches.vue";

const props = defineProps({ editing: Boolean });

const now = new Date();
const year = ref(now.getFullYear());
const month = ref(now.getMonth()); // 0-11
const today = todayYmd();
// 和记忆一样：只看某一天的（默认今天），整个月的一长串太长了
const selected = ref(today); // "YYYY-MM-DD"

function shift(n) {
  const d = new Date(year.value, month.value + n, 1);
  year.value = d.getFullYear();
  month.value = d.getMonth();
  selected.value = today.startsWith(monthPrefix.value) ? today : null;
}

const cells = computed(() => {
  const first = new Date(year.value, month.value, 1).getDay();
  const days = new Date(year.value, month.value + 1, 0).getDate();
  const out = Array.from({ length: first }, () => null);
  for (let d = 1; d <= days; d++) out.push(ymd(new Date(year.value, month.value, d)));
  return out;
});

const byDate = computed(() => {
  const m = {};
  for (const e of store.events) (m[e.date] ??= []).push(e);
  return m;
});
// 接了心潮的 AI：这一天 TA 记住了什么（日期右上角一颗小星星）
const router = useRouter();
const xcRoles = computed(() => store.roles.filter(r => hasXinchao(r) && dashToken(r)));
onMounted(() => xcRoles.value.forEach(r => loadMemoryMap(r)));
const memByDate = computed(() => {
  const m = {};
  for (const r of xcRoles.value) {
    for (const s of xcCache[r.id]?.map?.stars || []) {
      const d = starDate(s);
      if (d) (m[ymd(d)] ??= []).push({ ...s, role: r });
    }
  }
  return m;
});
const starsOf = date => [...new Set((memByDate.value[date] || []).map(s => s.role.color))].slice(0, 3);
const shownMems = computed(() => {
  if (!selected.value) return [];
  return (memByDate.value[selected.value] || []).slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.importance || 0) - (a.importance || 0));
});
function openMem(s) {
  if (props.editing) return;
  router.push({ path: "/memory", query: { role: s.role.id, open: s.id } });
}
const dotsOf = date => [...new Set((byDate.value[date] || []).map(e => e.author))].slice(0, 4).map(a => authorInfo(a).color);

const monthPrefix = computed(() => `${year.value}-${String(month.value + 1).padStart(2, "0")}`);
const shown = computed(() =>
  store.events
    .filter(e => e.date === selected.value)
    .sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts),
);
const md = date => date.slice(5).replace("-", ".");

function tapDay(date) {
  if (props.editing || !date) return;
  selected.value = date;
}

// ---------- 记一笔 / 编辑 ----------
const draft = ref(null);
function newEvent() {
  if (props.editing) return;
  draft.value = { id: uid(), date: selected.value || today, text: "", author: "me", ts: Date.now(), _isNew: true };
}
function editEvent(e) {
  if (props.editing) return;
  draft.value = { ...e, _isNew: false };
}
function saveEvent() {
  const { _isNew, ...e } = draft.value;
  e.text = e.text.trim();
  if (!e.text || !e.date) return;
  const i = store.events.findIndex(x => x.id === e.id);
  if (i >= 0) store.events[i] = e;
  else store.events.push(e);
  draft.value = null;
}
function removeEvent() {
  if (!confirm("删除这条记录？")) return;
  store.events.splice(store.events.findIndex(x => x.id === draft.value.id), 1);
  draft.value = null;
}

// ---------- 颜色 ----------
const colorsOpen = ref(false);
</script>

<template>
  <div class="cal-w">
    <div class="head">
      <button class="nav" aria-label="上个月" @click.stop="shift(-1)"><Icon name="back" :size="16" /></button>
      <b>{{ MONTHS_EN[month] }}</b>
      <button class="nav" aria-label="下个月" @click.stop="shift(1)"><Icon name="right" :size="16" /></button>
      <span class="spacer" />
      <span class="year">{{ year }}</span>
      <button class="nav" aria-label="颜色" @click.stop="!editing && (colorsOpen = true)"><Icon name="palette" :size="17" /></button>
    </div>

    <div class="grid week"><span v-for="w in '日一二三四五六'" :key="w">{{ w }}</span></div>
    <div class="grid days">
      <button v-for="(d, i) in cells" :key="i" class="day" :class="{ blank: !d, today: d === today, sel: d && d === selected }" :disabled="!d" @click.stop="tapDay(d)">
        <template v-if="d">
          <span class="num">{{ Number(d.slice(8)) }}</span>
          <span v-if="starsOf(d).length" class="mem-stars"><i v-for="(c, j) in starsOf(d)" :key="j" :style="{ color: c }">✦</i></span>
          <span class="dots"><i v-for="(c, j) in dotsOf(d)" :key="j" :style="{ background: c }" /></span>
        </template>
      </button>
    </div>

    <div class="events">
      <div v-for="e in shown" :key="e.id" class="ev" @click.stop="editEvent(e)">
        <span class="date">{{ md(e.date) }}</span>
        <span class="text">{{ e.text }}</span>
        <i class="who" :style="{ background: authorInfo(e.author).color }" :title="authorInfo(e.author).name" />
      </div>
      <template v-if="shownMems.length">
        <div class="mem-head">这一天 TA 们记住的</div>
        <div v-for="s in shownMems" :key="s.role.id + s.id" class="ev mem" @click.stop="openMem(s)">
          <i class="spark" :style="{ color: s.role.color }">✦</i>
          <span class="text">{{ s.title }}</span>
          <span class="whoname">{{ s.role.name }}</span>
        </div>
      </template>
      <p v-if="!selected" class="none">点一个日期，看那天的记录</p>
      <p v-else-if="!shown.length && !shownMems.length" class="none">{{ selected === today ? "今天" : md(selected) }}还没有记录</p>
      <button class="add" @click.stop="newEvent"><Icon name="plus" :size="15" /> {{ selected ? `在 ${md(selected)} 记一笔` : "记一笔" }}</button>
    </div>
  </div>

  <Sheet :open="!!draft" :title="draft?._isNew ? '记一笔' : '编辑记录'" @close="draft = null">
    <template v-if="draft">
      <label class="field"><span>日期</span><input v-model="draft.date" class="input" type="date" /></label>
      <label class="field"><span>发生了什么</span><input v-model="draft.text" class="input" placeholder="例如：给小鸡起了名字" @keydown.enter="saveEvent" /></label>
      <label class="field">
        <span>谁记的</span>
        <select v-model="draft.author" class="input">
          <option value="me">{{ authorInfo("me").name }}</option>
          <option v-for="r in store.roles" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </label>
      <div class="edit-actions">
        <button v-if="!draft._isNew" class="btn danger" @click="removeEvent">删除</button>
        <span class="spacer" />
        <button class="btn" :disabled="!draft.text.trim()" @click="saveEvent">保存</button>
      </div>
    </template>
  </Sheet>

  <Sheet :open="colorsOpen" title="每个人的颜色" @close="colorsOpen = false">
    <div class="color-row">
      <div class="who-name"><i :style="{ background: store.profile.color }" />{{ authorInfo("me").name }}</div>
      <ColorSwatches v-model="store.profile.color" :colors="PALETTE" />
    </div>
    <div v-for="r in store.roles" :key="r.id" class="color-row">
      <div class="who-name"><i :style="{ background: r.color }" />{{ r.name }}</div>
      <ColorSwatches v-model="r.color" :colors="PALETTE" />
    </div>
    <p class="tip">这个颜色也会用在头像底色和纪念日上。</p>
  </Sheet>
</template>

<style scoped>
.cal-w { padding: 16px 14px 12px; }
.head { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; padding: 0 2px; }
.head b { font-size: 1.07rem; font-weight: 700; min-width: 84px; text-align: center; }
.year { color: var(--text-3); font-size: 0.93rem; margin-right: 4px; }
.spacer { flex: 1; }
.nav { border: 0; background: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: var(--text-2); padding: 0; }
.nav:active { background: var(--bg); }

.grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.week span { text-align: center; font-size: 0.73rem; color: var(--text-3); padding-bottom: 2px; }
.day {
  position: relative;
  aspect-ratio: 1;
  max-height: 46px;
  border: 0;
  border-radius: 50%;
  background: #f5f5f7;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0 auto;
  width: 100%;
  max-width: 46px;
  font-size: 0.87rem;
  color: var(--text);
}
.day.blank { background: none; }
.day.today { background: var(--pink); color: #b4475f; font-weight: 700; }
.day.sel { box-shadow: 0 0 0 2px var(--ink); }
.dots { position: absolute; bottom: 5px; display: flex; gap: 2px; }
.dots i { width: 4px; height: 4px; border-radius: 50%; }

.events { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.ev { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 14px; background: var(--card-2); box-shadow: 0 0 0 1px var(--line); cursor: pointer; }
.ev .date { color: var(--accent); font-weight: 700; font-size: 0.93rem; flex: none; }
.ev .text { flex: 1; min-width: 0; font-size: 0.93rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ev .who { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.mem-stars { position: absolute; top: 2px; right: 3px; display: flex; font-size: 8px; line-height: 1; }
.mem-stars i { font-style: normal; text-shadow: 0 0 1px #fff; }
.mem-head { font-size: 0.75rem; color: var(--text-3); margin: 6px 4px 0; }
.ev.mem { background: #f7f6fb; }
.spark { font-style: normal; font-size: 0.8rem; flex: none; }
.whoname { font-size: 0.75rem; color: var(--text-3); flex: none; }
.none { margin: 4px 0 0; text-align: center; font-size: 0.8rem; color: var(--text-3); }
.add { align-self: center; border: 0; background: none; color: var(--text-2); font-size: 0.87rem; display: flex; align-items: center; gap: 4px; padding: 6px 10px; }

.edit-actions { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.color-row { padding: 10px 2px; border-bottom: 1px solid var(--line); }
.color-row:last-of-type { border-bottom: 0; }
.who-name { display: flex; align-items: center; gap: 8px; font-size: 0.93rem; margin: 0 4px 8px; }
.who-name i { width: 10px; height: 10px; border-radius: 50%; }
.tip { font-size: 0.8rem; color: var(--text-3); text-align: center; margin: 12px 0 0; }
</style>
