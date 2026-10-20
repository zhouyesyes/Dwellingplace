<script setup>
// 拾贝（今日小报）：一台小打印机，点一下打印那一天的小票，小票从机身底部的出纸口一行一行往下吐，把下面的内容往下推。
// 像素字（缝合像素）只在小票印出来的时候才用，没打印的时候页面不会下载字体；内容每次按当天的数据现生成，只记「这天打印过」（store.meanwhile.shells）。打印过的日子直接显示印好的，不重播；「再打一张」才重播
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from "vue";
import printerImg from "../../assets/meanwhile/printer.webp";
import { todayYmd } from "../../lib/dates.js";
import { shellOf, markShell, shellData } from "../../lib/meanwhile.js";
import { pixelate } from "../../lib/pixelate.js";
import "../../assets/fonts/pixel/pixel.css";

const props = defineProps({ date: String });
const printed = computed(() => !!shellOf(props.date));
const isToday = computed(() => props.date === todayYmd());

const data = ref(null);
const photo = ref("");
const playing = ref(false);
const busy = ref(false);
const reveal = ref(0);
const paper = ref(null);
let alive = true;

const MAX_LINES = 8;
const WEEK = ["日", "一", "二", "三", "四", "五", "六"], WEEK_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const dow = computed(() => { const [y, m, d] = props.date.split("-").map(Number); return new Date(y, m - 1, d).getDay(); });
const dateBig = computed(() => props.date.replace(/-/g, "."));
const dateNo = computed(() => props.date.replace(/-/g, ""));
const shown = computed(() => data.value?.lines.slice(0, MAX_LINES) || []);
const hidden = computed(() => Math.max(0, (data.value?.lines.length || 0) - MAX_LINES));
const anyTemp = computed(() => data.value?.temps.some(t => t.mood));
const quietLine = computed(() => (isToday.value ? "今天的海很安静" : "这一天的海很安静"));

// 条形码：用 EAN 那套 7 格一位的码样，两头加护栏，纯装饰但是真能数
const CODES = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const bars = computed(() => {
  const bits = "101" + [...dateNo.value].map(c => CODES[Number(c)] || CODES[0]).join("") + "101";
  const out = [];
  for (let i = 0; i < bits.length; i++) if (bits[i] === "1") { const s = i; while (bits[i + 1] === "1") i++; out.push([s, i - s + 1]); }
  return { list: out, n: bits.length };
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

async function build() {
  const d = shellData(props.date);
  const anchors = d.temps.map(t => t.color);
  photo.value = "";
  if (d.photo) {
    const c = await pixelate(d.photo, anchors).catch(() => null);
    if (c) photo.value = c.toDataURL("image/png");
  }
  // 先把用到的像素字块下载好，再排版，免得量好高度以后字又换了
  const text = [d.label, d.quiet ? "今天的海很安静这一天的" : "", ...d.temps.map(t => t.name + (t.text || "还没选")), ...d.lines.map(l => l.text), ...d.plans.map(p => p.text), "拾贝小票水温潮间带待续合计条✓周一二三四五六日年月号"].join("");
  try { await Promise.race([document.fonts.load('10px "Pixel"', text), sleep(1500)]); } catch { /* 字体没下来就先用备用字 */ }
  data.value = d;
}

// 小票从下面一点一点吐出来：出纸口下面的那一截（clip）高度慢慢长高，下面的内容自然被往下推
async function play(again = false) {
  if (busy.value) return;
  busy.value = true;
  try {
    await build();
    if (!alive) return;
    if (reduced()) { if (!printed.value || again) markShell(props.date); return; }
    playing.value = true; reveal.value = 0;
    await nextTick();
    const el = paper.value;
    const lns = [...el.querySelectorAll("[data-ln]")];
    const ends = lns.map(l => l.offsetTop + l.offsetHeight);
    const full = el.offsetHeight;
    markShell(props.date);
    for (let i = 0; i < lns.length && alive; i++) { reveal.value = ends[i]; await sleep(lns[i].dataset.ln === "photo" ? 460 : 210); }
    reveal.value = full;
    await sleep(240);
  } finally { playing.value = false; busy.value = false; }
}

onMounted(() => { if (printed.value) build(); });
onBeforeUnmount(() => { alive = false; });
const moodIcon = t => t.mood?.img;
</script>

<template>
  <section class="shell" :class="{ printing: playing, printed }" aria-label="拾贝">
    <button class="mach" :disabled="busy || printed" :aria-label="isToday ? '打印今天的拾贝' : '补打这一天的拾贝'" @click="play(false)">
      <img :src="printerImg" alt="" draggable="false" />
      <i class="led" />
    </button>

    <div v-if="printed || playing" class="hang">
      <div class="clip" :class="{ live: playing }" :style="playing ? { height: reveal + 'px' } : null">
        <div v-if="data && (printed || playing)" ref="paper" class="paper">
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
                  <span class="dot" :style="{ background: l.color }" /><small>{{ l.time }}</small><em>{{ l.text }}</em>
                </div>
                <div v-if="hidden" data-ln class="ln more">…另有 {{ hidden }} 条</div>
              </template>
              <div v-if="photo" data-ln="photo" class="ln photo"><img :src="photo" alt="" draggable="false" /></div>
              <template v-if="data.plans.length">
                <div data-ln class="ln tag"><span>待续</span></div>
                <div v-for="p in data.plans" :key="p.id" data-ln class="ln plan" :class="{ done: p.done }">
                  <span class="box">{{ p.done ? "✓" : "" }}</span><em>{{ p.text }}</em>
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
      </div>
    </div>

    <div v-if="!printed && !busy" class="tip">{{ isToday ? "点一下，打印今天的拾贝" : "点一下，补打这一天的拾贝" }}</div>
    <button v-if="printed && !busy" class="again" @click="play(true)">再打一张</button>
  </section>
</template>

<style scoped>
.shell { --mw: 300px; position: relative; isolation: isolate; margin: 14px 16px 6px; display: flex; flex-direction: column; align-items: center; }

/* 打印机：透明底的图，直接躺在页面上；纸口在机身下沿往上一点（约 84% 高） */
.mach { position: relative; z-index: 1; width: var(--mw); aspect-ratio: 720 / 226; padding: 0; border: 0; background: none; -webkit-tap-highlight-color: transparent; cursor: pointer; display: block; }
.mach:disabled { cursor: default; }
.mach img { display: block; width: 100%; height: 100%; }
.mach:not(:disabled):active img { transform: translateY(1px); }
.led { position: absolute; left: 94.5%; top: 17.4%; width: 3.4%; aspect-ratio: 1; margin: -1.7% 0 0 -1.7%; border-radius: 50%; background: #f4a3b6; box-shadow: 0 0 6px 1px rgba(244, 163, 182, .8); opacity: 0; }
.printing .led { animation: blink .5s steps(2) infinite; }
@keyframes blink { 0% { opacity: 1; } 50% { opacity: .15; } }

/* 小票挂在打印机下面：顶边落在出纸口中线，比打印机窄一点、居中 */
.hang { position: relative; z-index: 2; width: calc(var(--mw) * .76); margin-top: calc(var(--mw) * -0.0515); filter: drop-shadow(0 0 .5px rgba(90, 70, 50, .45)) drop-shadow(0 1px 3px rgba(90, 70, 50, .2)); } /* 页面底也是奶油色，纸边加一道淡影子才分得开；影子跟着锯齿走 */
.clip.live { overflow: hidden; transition: height .2s steps(5); }
.paper { position: relative; }
.paper::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 5px; z-index: 1; background: linear-gradient(rgba(52, 51, 49, .45), transparent); pointer-events: none; }

.tip { margin-top: 10px; font-size: .7rem; line-height: 1.2; color: var(--text-3); opacity: .75; }
.again { margin-top: 6px; border: 0; background: none; color: var(--text-3); opacity: .6; font-size: .68rem; padding: 2px 10px; }

/* 小票：素净一点，颜色只留水滴图标和发布人的小圆点 */
.sheet {
  /* 字号都取像素字格子的整数倍（--u 是字体原本的一格），不然缩放后边缘会糊、笔画显得粗；纸是淡淡的暖白（热敏纸），深色模式也一样，所以字色不跟主题走 */
  --u: 10px; --ink: #5c504a; --ink-line: rgba(92, 80, 74, .38); --paper: #fdfbf6;
  display: flow-root; background: var(--paper); color: var(--ink); padding: 14px 16px 0;
  font: var(--u)/calc(var(--u) * 1.6) "Pixel", "PingFang SC", sans-serif; -webkit-font-smoothing: none; font-smooth: never;
}
.ln { display: block; min-width: 0; }
.head { text-align: center; font-size: calc(var(--u) * 2); line-height: calc(var(--u) * 2.4); letter-spacing: 1px; }
.sub { text-align: center; letter-spacing: 3px; margin: 1px 0 12px; }
.date { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.date b { font-weight: 400; letter-spacing: 1px; }
.dash { height: 0; margin: 12px 0 8px; border-top: 1px dashed var(--ink-line); }
.tag { display: flex; align-items: center; gap: 8px; margin: 10px 0 4px; letter-spacing: 2px; }
.tag::before, .tag::after { content: ""; flex: 1; border-top: 1px dashed var(--ink-line); }
.temp { display: flex; align-items: center; gap: 6px; line-height: 21px; }
.temp img { width: 18px; height: 18px; object-fit: contain; flex: none; }
.temp .drop { width: 12px; height: 12px; margin: 0 3px; border: 1px dashed var(--ink-line); border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%; flex: none; box-sizing: border-box; }
.temp b { font-weight: 400; flex: none; }
.temp em, .tide em, .plan em { font-style: normal; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.temp.off b, .temp.off em { opacity: .5; }
.tide { display: flex; align-items: center; gap: 6px; }
.tide .dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.tide small { flex: none; }
.more { opacity: .6; padding-left: 12px; }
.photo { margin: 8px 0 4px; padding: 4px; background: #fff; box-shadow: 0 0 0 1px var(--ink-line); }
.photo img { display: block; width: 100%; height: auto; image-rendering: pixelated; }
.plan { display: flex; align-items: center; gap: 7px; }
.plan .box { width: 11px; height: 11px; border: 1px solid var(--ink-line); box-sizing: border-box; border-radius: 2px; flex: none; font-size: 9px; line-height: 9px; text-align: center; }
.plan.done em { opacity: .55; }
.quiet { text-align: center; padding: 10px 0 2px; }
.wave { text-align: center; letter-spacing: 2px; opacity: .5; }
.sum { display: flex; justify-content: space-between; align-items: baseline; }
.sum b { font-weight: 400; }
.code { margin: 12px auto 4px; width: 62%; height: 26px; opacity: .5; }
.code svg { display: block; width: 100%; height: 100%; }
.no { text-align: center; letter-spacing: 4px; opacity: .6; }
.keep { text-align: center; opacity: .55; margin: 8px 0 16px; letter-spacing: .5px; }
.tear { height: 8px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M0 0H12L6 8Z' fill='%23fdfbf6'/%3E%3C/svg%3E") 0 0 / 12px 8px repeat-x; }
@media (prefers-reduced-motion: reduce) { .printing .led { animation: none; opacity: 1; } .clip.live { transition: none; } }
</style>
