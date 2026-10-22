<script setup>
// 拾贝小票本身（挂在打印机下面的小票，和点开放大的小票是同一张；big 是放大版：全文不截断、字号取 2 倍）
import { computed } from "vue";
import { todayYmd } from "../../lib/dates.js";

const props = defineProps({ data: Object, photo: String, big: Boolean });
const MAX_LINES = 8;
const WEEK = ["日", "一", "二", "三", "四", "五", "六"], WEEK_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const date = computed(() => props.data.date);
const dow = computed(() => { const [y, m, d] = date.value.split("-").map(Number); return new Date(y, m - 1, d).getDay(); });
const dateBig = computed(() => date.value.replace(/-/g, "."));
const dateNo = computed(() => date.value.replace(/-/g, ""));
const shown = computed(() => (props.big ? props.data.lines : props.data.lines.slice(0, MAX_LINES)));
const hidden = computed(() => Math.max(0, props.data.lines.length - MAX_LINES));
const anyTemp = computed(() => props.data.temps.some(t => t.mood));
const quietLine = computed(() => (date.value === todayYmd() ? "今天的海很安静" : "这一天的海很安静"));
const moodIcon = t => t.mood?.img;

// 条形码：用 EAN 那套 7 格一位的码样，两头加护栏，纯装饰但是真能数
const CODES = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const bars = computed(() => {
  const bits = "101" + [...dateNo.value].map(c => CODES[Number(c)] || CODES[0]).join("") + "101";
  const out = [];
  for (let i = 0; i < bits.length; i++) if (bits[i] === "1") { const s = i; while (bits[i + 1] === "1") i++; out.push([s, i - s + 1]); }
  return { list: out, n: bits.length };
});
</script>

<template>
<div class="paper" :class="{ big }">
    <div class="sheet">
      <div data-ln class="ln head">MEANWHILE</div>
      <div data-ln class="ln sub">拾贝小票</div>
      <div data-ln class="ln date"><b>{{ dateBig }}</b><span>周{{ WEEK[dow] }} {{ WEEK_EN[dow] }}</span></div>

      <template v-if="data.quiet">
        <div data-ln class="ln quiet">{{ quietLine }}</div>
        <div data-ln class="ln wave">~ ~ ~ ~ ~ ~ ~</div>
      </template>
      <template v-else>
        <template v-if="anyTemp">
          <div data-ln class="ln tag"><span>水温</span></div>
          <div v-for="t in data.temps" :key="t.who" data-ln class="ln temp" :class="{ off: !t.mood }">
            <img v-if="t.mood" :src="moodIcon(t)" alt="" draggable="false" />
            <span v-else class="drop" />
            <b>{{ t.name }}</b>
            <em>{{ t.mood ? (t.text || t.mood.name) : "还没选" }}</em>
          </div>
        </template>
        <template v-if="data.lines.length">
          <div data-ln class="ln tag"><span>潮间带</span></div>
          <div v-for="l in shown" :key="l.id" data-ln class="ln tide">
            <span class="dot" :style="{ background: l.color }" /><small>{{ l.time }}</small><em>{{ big ? l.full : l.text }}</em>
          </div>
          <div v-if="hidden && !big" data-ln class="ln more">…另有 {{ hidden }} 条</div>
        </template>
        <div v-if="photo" data-ln="photo" class="ln photo"><img :src="photo" alt="" draggable="false" /></div>
        <template v-if="data.plans.length">
          <div data-ln class="ln tag"><span>待续</span></div>
          <div v-for="p in data.plans" :key="p.id" data-ln class="ln plan" :class="{ done: p.done }">
            <span class="box">{{ p.done ? "✓" : "" }}</span><em>{{ big ? p.full : p.text }}</em><small v-if="p.label" class="cyc">{{ p.label }}</small>
          </div>
        </template>
      </template>

      <div data-ln class="ln dash" />
      <div data-ln class="ln sum"><span>合计</span><b>{{ data.total }} 条</b></div>
      <div data-ln class="ln code">
        <svg :viewBox="`0 0 ${bars.n} 1`" preserveAspectRatio="none" shape-rendering="crispEdges"><rect v-for="b in bars.list" :key="b[0]" :x="b[0]" y="0" :width="b[1] * .6" height="1" fill="#3d3347" /></svg>
      </div>
      <div data-ln class="ln no">{{ dateNo }}</div>
      <div data-ln class="ln keep">KEEP THIS SHELL<br>FOR OUR MEMORY</div>
    </div>
    <div class="tear" />
  </div>

</template>

<style scoped>
.paper { position: relative; }
.paper.big .sheet { --u: 20px; }
.paper::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 5px; z-index: 1; background: linear-gradient(rgba(52, 51, 49, .45), transparent); pointer-events: none; }
/* 小票：素净一点，颜色只留水滴图标和发布人的小圆点 */
.sheet {
  /* 字号都取像素字格子的整数倍（--u 是字体原本的一格），不然缩放后边缘会糊、笔画显得粗；纸是淡淡的暖白（热敏纸），深色模式也一样，所以字色不跟主题走 */
  --u: 10px; --ink: #5c504a; --ink-line: rgba(92, 80, 74, .38); --paper: #fdfbf6;
  display: flow-root; background: var(--paper); color: var(--ink); padding: calc(var(--u) * 1.4) calc(var(--u) * 1.6) 0;
  font: var(--u)/calc(var(--u) * 1.6) "Pixel", "PingFang SC", sans-serif; -webkit-font-smoothing: none; font-smooth: never;
}
.ln { display: block; min-width: 0; }
.head { text-align: center; font-size: calc(var(--u) * 2); line-height: calc(var(--u) * 2.4); letter-spacing: 1px; }
.sub { text-align: center; letter-spacing: 3px; margin: 1px 0 calc(var(--u) * 1.2); }
.date { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: calc(var(--u) * .6); }
.date b { font-weight: 400; letter-spacing: 1px; }
.dash { height: 0; margin: calc(var(--u) * 1.2) 0 calc(var(--u) * .8); border-top: 1px dashed var(--ink-line); }
.tag { display: flex; align-items: center; gap: calc(var(--u) * .8); margin: var(--u) 0 calc(var(--u) * .4); letter-spacing: 2px; }
.tag::before, .tag::after { content: ""; flex: 1; border-top: 1px dashed var(--ink-line); }
.temp { display: flex; align-items: center; gap: calc(var(--u) * .6); line-height: calc(var(--u) * 2.1); }
.temp img { width: calc(var(--u) * 1.8); height: calc(var(--u) * 1.8); object-fit: contain; flex: none; }
.temp .drop { width: calc(var(--u) * 1.2); height: calc(var(--u) * 1.2); margin: 0 calc(var(--u) * .3); border: 1px dashed var(--ink-line); border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%; flex: none; box-sizing: border-box; }
.temp b { font-weight: 400; flex: none; }
.temp em, .tide em, .plan em { font-style: normal; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.temp.off b, .temp.off em { opacity: .5; }
.tide { display: flex; align-items: center; gap: calc(var(--u) * .6); }
.big .tide { align-items: flex-start; }
.big .tide .dot { margin-top: calc(var(--u) * .5); }
.big .temp, .big .plan { align-items: flex-start; }
.big .temp em, .big .tide em, .big .plan em { overflow: visible; text-overflow: clip; white-space: normal; overflow-wrap: anywhere; }
.tide .dot { width: calc(var(--u) * .6); height: calc(var(--u) * .6); border-radius: 50%; flex: none; }
.tide small { flex: none; }
.more { opacity: .6; padding-left: calc(var(--u) * 1.2); }
.photo { margin: calc(var(--u) * .8) 0 calc(var(--u) * .4); padding: calc(var(--u) * .4); background: #fff; box-shadow: 0 0 0 1px var(--ink-line); }
.photo img { display: block; width: 100%; height: auto; image-rendering: pixelated; }
.plan { display: flex; align-items: center; gap: calc(var(--u) * .7); }
.plan .box { width: calc(var(--u) * 1.1); height: calc(var(--u) * 1.1); border: 1px solid var(--ink-line); box-sizing: border-box; border-radius: 2px; flex: none; font-size: calc(var(--u) * .9); line-height: calc(var(--u) * .9); text-align: center; }
.plan.done em { opacity: .55; }
.plan .cyc { flex: none; font-size: calc(var(--u) * .8); opacity: .6; }
.quiet { text-align: center; padding: var(--u) 0 calc(var(--u) * .2); }
.wave { text-align: center; letter-spacing: 2px; opacity: .5; }
.sum { display: flex; justify-content: space-between; align-items: baseline; }
.sum b { font-weight: 400; }
.code { margin: calc(var(--u) * 1.2) auto calc(var(--u) * .4); width: 62%; height: calc(var(--u) * 2.6); opacity: .5; }
.code svg { display: block; width: 100%; height: 100%; }
.no { text-align: center; letter-spacing: 4px; opacity: .6; }
.keep { text-align: center; opacity: .55; margin: calc(var(--u) * .8) 0 calc(var(--u) * 1.6); letter-spacing: .5px; }
.tear { height: calc(var(--u) * .8); background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M0 0H12L6 8Z' fill='%23fdfbf6'/%3E%3C/svg%3E") 0 0 / auto 100% repeat-x; }
</style>
