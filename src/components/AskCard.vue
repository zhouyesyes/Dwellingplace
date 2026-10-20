<script setup>
// 提问选项卡：AI 回复底下的一张卡，几道题、每题 2～4 个选项（单选或多选）、最后一个「其他…」；全答完「好了」才亮
// 答完发出后 ask.done 记下选了什么，卡片变淡、选中的留颜色、不能再点（见 lib/ask.js）
import { reactive, computed, ref, watch, nextTick, onMounted } from "vue";

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

// 一题一张卡，同一时间只露一张：左右滑（触摸滚动吸附）或点两侧小箭头、底下小圆点
const n = props.ask.qs.length;
const cur = ref(0);
const track = ref(null);
const slides = ref([]);
const boxH = ref(0);
const goTo = j => {
  const el = track.value;
  if (!el || j < 0 || j >= n) return;
  cur.value = j;
  el.scrollTo({ left: j * el.clientWidth, behavior: "smooth" });
};
let tick = 0;
const onScroll = () => {
  cancelAnimationFrame(tick);
  tick = requestAnimationFrame(() => {
    const el = track.value;
    if (el && el.clientWidth) cur.value = Math.max(0, Math.min(n - 1, Math.round(el.scrollLeft / el.clientWidth)));
  });
};
// 卡片高低不一，外框高度跟着当前这张走
const measure = async () => {
  await nextTick();
  const s = slides.value[cur.value];
  if (s) boxH.value = s.offsetHeight;
};
onMounted(measure);
watch([cur, otherOn, picks, done], measure, { deep: true });

function tap(i, k) {
  if (done.value) return;
  const q = props.ask.qs[i];
  const at = picks[i].indexOf(k);
  if (q.multi) { if (at >= 0) picks[i].splice(at, 1); else picks[i].push(k); return; } // 多选不自动翻
  picks[i] = at >= 0 ? [] : [k]; // 单选：选这个、取消其他项
  otherOn[i] = false;
  if (picks[i].length && i < n - 1) setTimeout(() => goTo(i + 1), 220); // 单选点完自动翻下一张
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
  <div class="ask" :class="{ done, one: n === 1 }">
    <div class="row">
      <button v-if="n > 1" type="button" class="arr" :class="{ off: cur === 0 }" aria-label="上一题" @click="goTo(cur - 1)">‹</button>
      <div ref="track" class="track" :class="{ lock: n === 1 }" :style="boxH ? { height: boxH + 'px' } : null" @scroll.passive="onScroll">
        <section v-for="(q, i) in ask.qs" :key="i" :ref="el => (slides[i] = el)" class="q">
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
          <button v-if="i === n - 1 && !done" type="button" class="ok" :disabled="!ready || disabled" @click="submit">好了</button>
        </section>
      </div>
      <button v-if="n > 1" type="button" class="arr" :class="{ off: cur === n - 1 }" aria-label="下一题" @click="goTo(cur + 1)">›</button>
    </div>
    <div v-if="n > 1" class="dots">
      <button v-for="(_, i) in ask.qs" :key="i" type="button" class="pip" :class="{ at: i === cur, hollow: !done && !answered(i) }" :aria-label="`第 ${i + 1} 题`" @click="goTo(i)" />
    </div>
  </div>
</template>

<style scoped>
.ask { width: min(340px, 100%); padding: 8px 6px 10px; border-radius: 18px; background: var(--ask-bg); border: 1px solid var(--ask-line); color: var(--text); transition: opacity .3s; box-sizing: border-box; }
.ask.one { padding: 8px 14px 14px; }
.ask.done { opacity: .6; }
.row { display: flex; align-items: center; gap: 2px; }
.track { flex: 1; min-width: 0; display: flex; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory; scrollbar-width: none; align-items: flex-start; transition: height .2s; }
.track::-webkit-scrollbar { display: none; }
.track.lock { overflow-x: hidden; }
.q { flex: none; width: 100%; box-sizing: border-box; padding: 4px 6px 2px; scroll-snap-align: start; scroll-snap-stop: always; display: flex; flex-direction: column; gap: 6px; }
.one .q { padding: 4px 0 0; }
.arr { flex: none; width: 22px; height: 44px; padding: 0; border: 0; background: transparent; color: var(--ask-mute); font-size: 1.6rem; line-height: 1; cursor: pointer; }
.arr.off { visibility: hidden; }
.qt { margin: 0 0 2px; font-size: .95rem; font-weight: 600; line-height: 1.5; }
.qt small { margin-left: 8px; font-size: .68rem; font-weight: 400; color: var(--ask-mute); }
.opt { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 8px 10px; border: 1px solid var(--ask-line); border-radius: 12px; background: var(--ask-opt); color: inherit; text-align: left; font: inherit; cursor: pointer; }
.opt.on { background: var(--ask-sel); border-color: var(--ask-sel); color: var(--ask-sel-tx); }
.opt:disabled { cursor: default; }
.dot { flex: none; width: 15px; height: 15px; margin-top: 3px; border: 1.5px solid var(--ask-mute); border-radius: 50%; position: relative; }
.dot.box { border-radius: 4px; }
.opt.on .dot { background: var(--ask-sel-tx); border-color: var(--ask-sel-tx); }
.opt.on .dot::after { content: ""; position: absolute; inset: 3px; border-radius: inherit; background: var(--ask-sel); }
.tx { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tx b { font-size: .92rem; font-weight: 600; overflow-wrap: anywhere; }
.tx em { font-style: normal; font-size: .76rem; line-height: 1.45; color: var(--ask-mute); overflow-wrap: anywhere; }
.opt.on .tx em { color: var(--ask-sel-tx); opacity: .75; }
.other { width: 100%; box-sizing: border-box; padding: 8px 12px; border: 1px solid var(--ask-line); border-radius: 12px; background: var(--ask-opt); color: var(--text); font: inherit; font-size: .9rem; outline: none; }
.other::placeholder { color: var(--ask-mute); }
.other:focus { border-color: var(--ask-mute); }
.ok { display: block; margin: 10px 0 0 auto; padding: 8px 26px; border: 0; border-radius: 999px; background: var(--ink); color: var(--on-ink); font: inherit; font-weight: 600; cursor: pointer; }
.ok:disabled { opacity: .3; cursor: default; }
.dots { display: flex; justify-content: center; gap: 4px; margin-top: 6px; }
.pip { box-sizing: border-box; width: 22px; height: 22px; padding: 0; border: 0; background: transparent; position: relative; cursor: pointer; }
.pip::after { content: ""; position: absolute; left: 50%; top: 50%; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; border-radius: 50%; background: var(--ask-dot); border: 1.5px solid var(--ask-dot); box-sizing: border-box; }
.pip.at::after { background: var(--ask-dot-on); border-color: var(--ask-dot-on); }
.pip.hollow::after { background: transparent; }
</style>
