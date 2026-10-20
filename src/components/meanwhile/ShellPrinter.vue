<script setup>
// 拾贝（今日小报）：一台小打印机，点一下打印那一天的小票，小票从机顶出纸口一行一行冒出来。
// 像素字（缝合像素）只在小票印出来的时候才用，没打印的时候页面不会下载字体；内容每次按当天的数据现生成，只记「这天打印过」（store.meanwhile.shells）。打印过的日子直接显示印好的，不重播；「再打一张」才重播
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from "vue";
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
const total = ref(0);
const paper = ref(null);
const win = ref(null);
let alive = true;

const MAX_LINES = 8;
const WEEK = ["日", "一", "二", "三", "四", "五", "六"], WEEK_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const dow = computed(() => { const [y, m, d] = props.date.split("-").map(Number); return new Date(y, m - 1, d).getDay(); });
const dateBig = computed(() => props.date.replace(/-/g, "."));
const dateNo = computed(() => props.date.replace(/-/g, ""));
const letters = [..."MEANWHILE"].map((c, i) => ({ c, color: ["#e8789a", "#f08a3c", "#4f8fd6"][i % 3] }));
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

// 机身上贴的扇贝贴纸：几瓣弧边 + 放射的纹路
const shell = (() => {
  const n = 5, a0 = -66, a1 = 66, r = 22, rb = 28, step = (a1 - a0) / n;
  const pt = (a, rr) => [Math.sin(a * Math.PI / 180) * rr, -Math.cos(a * Math.PI / 180) * rr + 8];
  const f = v => v.toFixed(1);
  let d = `M0,8 L${pt(a0, r).map(f).join(",")}`;
  for (let i = 0; i < n; i++) d += ` Q${pt(a0 + step * (i + .5), rb).map(f).join(",")} ${pt(a0 + step * (i + 1), r).map(f).join(",")}`;
  d += " Z";
  const ridges = Array.from({ length: n + 1 }, (_, i) => `M0,8 L${pt(a0 + step * i, r - 1).map(f).join(",")}`).join(" ");
  return { d, ridges };
})();

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
  try { await Promise.race([document.fonts.load('12px "Pixel"', text), sleep(1500)]); } catch { /* 字体没下来就先用备用字 */ }
  data.value = d;
}

// 打印后纸往上长，页面往下多出一截：把页面也往下滚同样多，机器看起来待在原地
function keepPlace(delta) {
  if (delta <= 0) return;
  let el = win.value?.parentElement;
  while (el && el !== document.body) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) { el.scrollTop += delta; return; }
    el = el.parentElement;
  }
  window.scrollBy(0, delta);
}

async function play(again = false) {
  if (busy.value) return;
  busy.value = true;
  try {
    const before = win.value?.offsetHeight || 0;
    await build();
    if (!alive) return;
    if (reduced()) { if (!printed.value || again) markShell(props.date); return; }
    playing.value = true; reveal.value = 0;
    await nextTick();
    const el = paper.value;
    const lns = [...el.querySelectorAll("[data-ln]")];
    const ends = lns.map(l => l.offsetTop + l.offsetHeight);
    const full = el.offsetHeight;
    total.value = full;
    await nextTick();
    keepPlace(full - before);
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
    <div ref="win" class="win" :style="playing ? { height: total + 'px' } : null">
      <div class="clip" :class="{ live: playing }" :style="playing ? { height: reveal + 'px' } : null">
        <div v-if="data && (printed || playing)" ref="paper" class="paper">
          <div class="sheet">
          <div data-ln class="ln stripe" />
          <div data-ln class="ln head"><span v-for="(l, i) in letters" :key="i" :style="{ color: l.color }">{{ l.c }}</span></div>
          <div data-ln class="ln sub">拾贝小票</div>
          <div data-ln class="ln dash" />
          <div data-ln class="ln date"><b>{{ dateBig }}</b><span>周{{ WEEK[dow] }} {{ WEEK_EN[dow] }}</span></div>
          <div data-ln class="ln dash" />

          <template v-if="data.quiet">
            <div data-ln class="ln quiet">{{ quietLine }}</div>
            <div data-ln class="ln wave">~ ~ ~ ~ ~ ~ ~</div>
          </template>
          <template v-else>
            <template v-if="anyTemp">
              <div data-ln class="ln tag"><i style="background:#8ec8ec">水温 WATER</i></div>
              <div v-for="t in data.temps" :key="t.who" data-ln class="ln temp" :class="{ off: !t.mood }">
                <img v-if="t.mood" :src="moodIcon(t)" alt="" draggable="false" />
                <span v-else class="drop" :style="{ borderColor: t.color }" />
                <b :style="{ color: t.color }">{{ t.name }}</b>
                <em>{{ t.mood ? (t.text || t.mood.name) : "还没选" }}</em>
              </div>
            </template>
            <template v-if="data.lines.length">
              <div data-ln class="ln tag"><i style="background:#f6b3c8">潮间带 TIDE</i></div>
              <div v-for="l in shown" :key="l.id" data-ln class="ln tide">
                <span class="dot" :style="{ background: l.color }" /><small>{{ l.time }}</small><em>{{ l.text }}</em>
              </div>
              <div v-if="hidden" data-ln class="ln more">…另有 {{ hidden }} 条</div>
            </template>
            <div v-if="photo" data-ln="photo" class="ln photo"><img :src="photo" alt="" draggable="false" /></div>
            <template v-if="data.plans.length">
              <div data-ln class="ln tag"><i style="background:#f7d77c">待续 TO BE CONT.</i></div>
              <div v-for="p in data.plans" :key="p.id" data-ln class="ln plan" :class="{ done: p.done }">
                <span class="box" :style="p.done ? { background: p.color, borderColor: p.color } : { borderColor: p.color }">{{ p.done ? "✓" : "" }}</span><em>{{ p.text }}</em>
              </div>
            </template>
          </template>

          <div data-ln class="ln dash" />
          <div data-ln class="ln sum"><span>合计 TOTAL</span><b>{{ data.total }} 条</b></div>
          <div data-ln class="ln code">
            <svg :viewBox="`0 0 ${bars.n} 1`" preserveAspectRatio="none" shape-rendering="crispEdges"><rect v-for="b in bars.list" :key="b[0]" :x="b[0]" y="0" :width="b[1]" height="1" fill="#3d3347" /></svg>
          </div>
          <div data-ln class="ln no">{{ dateNo }}</div>
          <div data-ln class="ln keep">KEEP THIS SHELL<br>FOR OUR MEMORY</div>
        </div>
          <div class="tear" />
          <div class="gap" />
        </div>
      </div>
    </div>

    <div v-if="!printed && !busy" class="tip"><span>{{ isToday ? "点一下，打印今天的拾贝" : "点一下，补打这一天的拾贝" }}</span></div>

    <div class="mach" :class="{ pull: printed || playing }">
      <svg class="back" viewBox="0 0 260 112" aria-hidden="true">
        <rect x="16" y="9" width="228" height="12" rx="6" fill="#4a3f55" />
      </svg>
      <button class="front" :disabled="busy || printed" :aria-label="isToday ? '打印今天的拾贝' : '补打这一天的拾贝'" @click="play(false)">
        <svg viewBox="0 0 260 112" aria-hidden="true">
          <rect x="4" y="18" width="252" height="90" rx="18" fill="#a6d5ee" stroke="#4a3f55" stroke-width="3" />
          <path d="M4 36 a18 18 0 0 1 18 -18 h216 a18 18 0 0 1 18 18 v6 h-252z" fill="#d3ecf8" stroke="#4a3f55" stroke-width="3" />
          <rect x="22" y="24" width="216" height="5" rx="2.5" fill="#4a3f55" opacity=".28" />
          <rect x="30" y="100" width="34" height="8" rx="3" fill="#4a3f55" />
          <rect x="196" y="100" width="34" height="8" rx="3" fill="#4a3f55" />
          <!-- 贝壳贴纸 -->
          <g transform="translate(62 72) rotate(-9)">
            <path :d="shell.d" fill="#fff" stroke="#fff" stroke-width="9" stroke-linejoin="round" />
            <rect x="-9" y="6" width="18" height="9" rx="3" fill="#fff" stroke="#fff" stroke-width="7" stroke-linejoin="round" />
            <rect x="-6" y="8" width="12" height="6" rx="2.5" fill="#f4a58e" stroke="#4a3f55" stroke-width="1.6" />
            <path :d="shell.d" fill="#ffc8b8" stroke="#4a3f55" stroke-width="1.8" stroke-linejoin="round" />
            <path :d="shell.ridges" fill="none" stroke="#e8806e" stroke-width="1.5" stroke-linecap="round" />
          </g>
          <!-- 灯和按钮 -->
          <circle class="led" cx="206" cy="62" r="5" fill="#7bd88f" stroke="#4a3f55" stroke-width="2" />
          <circle cx="226" cy="62" r="5" fill="#f6b3c8" stroke="#4a3f55" stroke-width="2" />
          <circle cx="206" cy="82" r="5" fill="#f7d77c" stroke="#4a3f55" stroke-width="2" />
          <rect x="120" y="58" width="52" height="5" rx="2.5" fill="#4a3f55" opacity=".35" />
          <rect x="120" y="70" width="40" height="5" rx="2.5" fill="#4a3f55" opacity=".35" />
          <rect x="120" y="82" width="46" height="5" rx="2.5" fill="#4a3f55" opacity=".35" />
        </svg>
      </button>
    </div>

    <button v-if="printed && !busy" class="again" @click="play(true)">再打一张</button>
  </section>
</template>

<style scoped>
.shell { position: relative; isolation: isolate; margin: 14px 16px 6px; display: flex; flex-direction: column; align-items: center; }
.win { position: relative; z-index: 1; width: 216px; }
.clip.live { position: absolute; left: 0; right: 0; bottom: 0; overflow: hidden; transition: height .2s steps(5); }

.mach { position: relative; width: 260px; height: 112px; margin-top: 0; }
.mach.pull { margin-top: -18px; }
.mach .back, .mach .front, .mach .front svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.mach .back { z-index: 0; }
.mach .front { z-index: 2; padding: 0; border: 0; background: none; -webkit-tap-highlight-color: transparent; cursor: pointer; }
.mach .front:disabled { cursor: default; }
.mach .front:not(:disabled):active svg { transform: translateY(2px); }
.printing .mach .front svg { animation: jig .16s steps(2) infinite; }
.printing .led { animation: blink .4s steps(2) infinite; }
@keyframes jig { 50% { transform: translateY(1px); } }
@keyframes blink { 50% { opacity: .25; } }

.tip { margin-bottom: 8px; position: relative; font: 600 .76rem/1.2 var(--font); color: #5a4a66; background: #fff7e6; padding: 6px 10px; border-radius: 4px; box-shadow: 0 0 0 2px #4a3f55, 3px 3px 0 2px rgba(74, 63, 85, .25); animation: bob 1.6s steps(2) infinite; }
.tip::after { content: ""; position: absolute; left: 50%; bottom: -9px; margin-left: -5px; border: 5px solid transparent; border-top-color: #4a3f55; }
@keyframes bob { 50% { transform: translateY(2px); } }
.again { margin-top: 8px; border: 0; background: none; color: var(--text-3); font-size: .74rem; padding: 4px 12px; border-radius: 999px; box-shadow: 0 0 0 1px var(--line); }

/* 小票 */
.paper { position: relative; }
.sheet {
  display: flow-root; background: #fff7e6; color: #3d3347; padding: 0 12px;
  font: 12px/18px "Pixel", "PingFang SC", sans-serif; -webkit-font-smoothing: none; font-smooth: never;
  box-shadow: inset 1px 0 0 rgba(170, 140, 100, .22), inset -1px 0 0 rgba(170, 140, 100, .22);
}
.ln { display: block; min-width: 0; }
.stripe { height: 8px; margin: 0 -12px 10px; background: repeating-linear-gradient(90deg, #f6b3c8 0 12px, #fbc590 12px 24px, #a6d0f0 24px 36px); }
.head { text-align: center; font-size: 24px; line-height: 30px; letter-spacing: 1px; }
.head span { text-shadow: 2px 2px 0 rgba(74, 63, 85, .16); }
.sub { text-align: center; font-size: 14px; letter-spacing: 3px; margin-top: 2px; }
.dash { height: 0; margin: 9px 0; border-top: 2px dashed rgba(74, 63, 85, .38); }
.date { display: flex; justify-content: space-between; align-items: baseline; }
.date b { font-size: 16px; letter-spacing: 1px; }
.date span { font-size: 12px; color: #7a6a86; }
.tag { margin: 2px 0 4px; }
.tag i { font-style: normal; display: inline-block; padding: 0 7px; line-height: 17px; font-size: 12px; box-shadow: 0 0 0 1.5px #4a3f55; border-radius: 2px; }
.temp { display: flex; align-items: center; gap: 6px; line-height: 22px; }
.temp img { width: 20px; height: 20px; object-fit: contain; flex: none; }
.temp .drop { width: 14px; height: 14px; margin: 0 3px; border: 2px dashed; border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%; flex: none; box-sizing: border-box; }
.temp b { font-weight: 400; flex: none; }
.temp em, .tide em, .plan em { font-style: normal; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.temp em { color: #6a5a76; }
.temp.off b, .temp.off em { opacity: .5; }
.tide { display: flex; align-items: center; gap: 6px; }
.tide .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.tide small { font-size: 12px; color: #8a7a96; flex: none; }
.more { color: #8a7a96; padding-left: 13px; }
.photo { margin: 8px 0 4px; padding: 5px; background: #fff; box-shadow: 0 0 0 1.5px #4a3f55; }
.photo img { display: block; width: 100%; height: auto; image-rendering: pixelated; }
.plan { display: flex; align-items: center; gap: 7px; }
.plan .box { width: 12px; height: 12px; border: 2px solid; box-sizing: border-box; border-radius: 2px; flex: none; color: #fff; font-size: 10px; line-height: 8px; text-align: center; }
.plan.done em { color: #9a8aa6; }
.quiet { text-align: center; color: #6a5a76; padding: 6px 0 2px; }
.wave { text-align: center; color: #a6d0f0; letter-spacing: 2px; }
.sum { display: flex; justify-content: space-between; align-items: baseline; font-size: 14px; }
.sum b { font-weight: 400; font-size: 16px; color: #e8789a; }
.code { margin: 8px 0 2px; height: 34px; }
.code svg { display: block; width: 100%; height: 100%; }
.no { text-align: center; letter-spacing: 4px; font-size: 12px; }
.keep { text-align: center; font-size: 12px; line-height: 16px; color: #7a6a86; margin: 6px 0 10px; letter-spacing: .5px; }
.gap { height: 14px; }
.tear { height: 8px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M0 0H12L6 8Z' fill='%23fff7e6'/%3E%3C/svg%3E") 0 0 / 12px 8px repeat-x; }
@media (prefers-reduced-motion: reduce) { .tip, .printing .mach .front svg, .printing .led { animation: none; } .clip.live { transition: none; } }
</style>
