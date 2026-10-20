<script setup>
// 拾贝（今日小报）：一台小打印机，点一下打印那一天的小票，小票从机身底部的出纸口一行一行往下吐，把下面的内容往下推。
// 像素字（缝合像素）只在小票印出来的时候才用，没打印的时候页面不会下载字体；内容每次按当天的数据现生成，只记「这天打印过」（store.meanwhile.shells）。打印过的日子直接显示印好的，不重播；「再打一张」才重播
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from "vue";
import printerImg from "../../assets/meanwhile/printer.webp";
import { todayYmd } from "../../lib/dates.js";
import { shellOf, markShell, shellData } from "../../lib/meanwhile.js";
import ShellSheet from "./ShellSheet.vue";
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
const zoomOpen = ref(false);
const cut = ref(false); // 挂着的小票上有没有内容被截掉（条数超了、句子太长）

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
  const text = [d.label, d.quiet ? "今天的海很安静这一天的" : "", ...d.temps.map(t => t.name + (t.text || "还没选")), ...d.lines.map(l => l.full), ...d.plans.map(p => p.full), "拾贝小票水温潮间带待续合计条✓周一二三四五六日年月号"].join("");
  try { await Promise.race([document.fonts.load('10px "Pixel"', text), sleep(1500)]); } catch { /* 字体没下来就先用备用字 */ }
  data.value = d;
  measureCut();
}

async function measureCut() {
  const d = data.value;
  cut.value = d.lines.length > MAX_LINES || d.lines.some(l => l.full !== l.text) || d.plans.some(p => p.full !== p.text);
  if (cut.value) return;
  await nextTick();
  const el = paper.value?.$el;
  cut.value = !!el && [...el.querySelectorAll("em")].some(e => e.scrollWidth > e.clientWidth + 1);
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
    const el = paper.value.$el;
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
const canZoom = computed(() => printed.value && !playing.value && !busy.value && !!data.value);
const openZoom = () => { if (canZoom.value) zoomOpen.value = true; };
const onKey = e => { if (e.key === "Escape") zoomOpen.value = false; };
watch(zoomOpen, on => { if (on) addEventListener("keydown", onKey); else removeEventListener("keydown", onKey); });
onBeforeUnmount(() => removeEventListener("keydown", onKey));
</script>

<template>
  <section class="shell" :class="{ printing: playing, printed }" aria-label="拾贝">
    <button class="mach" :disabled="busy || printed" :aria-label="isToday ? '打印今天的拾贝' : '补打这一天的拾贝'" @click="play(false)">
      <img :src="printerImg" alt="" draggable="false" />
      <i class="led" />
    </button>

    <div v-if="printed || playing" class="hang" :class="{ zoomable: canZoom }" @click="openZoom">
      <div class="clip" :class="{ live: playing }" :style="playing ? { height: reveal + 'px' } : null">
        <ShellSheet v-if="data && (printed || playing)" ref="paper" :data="data" :photo="photo" />
      </div>
    </div>

    <div v-if="canZoom && cut" class="tip zoom-tip">点开看全部</div>

    <Teleport to="body">
      <div v-if="zoomOpen && data" class="zoom" role="dialog" aria-label="放大的小票" @click="zoomOpen = false">
        <button class="zoom-x" aria-label="关闭" @click.stop="zoomOpen = false">×</button>
        <div class="zoom-paper" @click.stop><ShellSheet big :data="data" :photo="photo" /></div>
      </div>
    </Teleport>

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
.hang.zoomable { cursor: zoom-in; -webkit-tap-highlight-color: transparent; }
.zoom-tip { margin-top: 4px; font-size: .62rem; opacity: .55; }

/* 放大层：铺满屏幕，背景暗一点；小票用 2 倍字号完整显示，太长就在层里上下滚。纸一直是白的，所以字色、纸色在 ShellSheet 里写死，深色模式不受影响 */
.zoom { position: fixed; inset: 0; z-index: 200; background: rgba(20, 16, 14, .6); overflow-y: auto; overscroll-behavior: contain; display: flex; justify-content: center; align-items: flex-start; padding: 48px 12px calc(32px + env(safe-area-inset-bottom)); }
.zoom-x { position: fixed; top: calc(10px + env(safe-area-inset-top)); right: 12px; width: 30px; height: 30px; border: 0; border-radius: 50%; background: rgba(255, 255, 255, .85); color: #5c504a; font-size: 1.1rem; line-height: 1; display: grid; place-items: center; padding: 0 0 2px; z-index: 1; }
.zoom-paper { width: min(100%, 456px); margin: auto 0; filter: drop-shadow(0 2px 8px rgba(0, 0, 0, .35)); }
.clip.live { overflow: hidden; transition: height .2s steps(5); }

.tip { margin-top: 10px; font-size: .7rem; line-height: 1.2; color: var(--text-3); opacity: .75; }
.again { margin-top: 6px; border: 0; background: none; color: var(--text-3); opacity: .6; font-size: .68rem; padding: 2px 10px; }

@media (prefers-reduced-motion: reduce) { .printing .led { animation: none; opacity: 1; } .clip.live { transition: none; } }
</style>
