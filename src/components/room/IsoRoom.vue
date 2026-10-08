<script setup>
// 新版小屋：等距像素房间，放大 2 倍，比手机宽，左右拖动看不同的地方
// 现在只有骨架和光（墙、地板、窗、门），家具和人物之后一件件加
import { ref, onMounted, onBeforeUnmount, watch, computed } from "vue";
import { makeCanvas, drawRoom, W, H } from "../../lib/iso/engine.js";
import { ISO_ROOMS } from "../../lib/iso/rooms.js";

const props = defineProps({ room: { type: String, default: "cui" } });
const SCALE = 2;
const CROP_TOP = 12; // 最上面那一小条是空的，不显示

const def = computed(() => ISO_ROOMS[props.room] || ISO_ROOMS.cui);
const canvas = ref(null);
const view = ref(null);
const x = ref(0); // 镜头往右挪了多少（屏幕像素）
const maxX = ref(0);

function paint() {
  const cv = makeCanvas();
  drawRoom(cv, def.value, { light: true });
  const el = canvas.value;
  if (!el) return;
  el.width = W; el.height = H;
  el.getContext("2d").putImageData(new ImageData(cv.buf, W, H), 0, 0);
}
function measure(center = false) {
  const vw = view.value?.clientWidth || 360;
  maxX.value = Math.max(0, W * SCALE - vw);
  x.value = center ? maxX.value / 2 : Math.min(maxX.value, Math.max(0, x.value));
}

// ---------- 拖动：手指动的是镜头；拖过头会有一点阻力，松手弹回去 ----------
let start = null, raf = 0, vel = 0, lastX = 0, lastT = 0;
const rubber = d => d > 0 ? Math.min(40, d * 0.35) : 0;
const shown = computed(() => {
  const v = x.value;
  if (v < 0) return -rubber(-v);
  if (v > maxX.value) return maxX.value + rubber(v - maxX.value);
  return v;
});
function down(e) {
  cancelAnimationFrame(raf);
  start = { px: e.clientX, x: x.value };
  lastX = e.clientX; lastT = performance.now(); vel = 0;
  e.currentTarget.setPointerCapture?.(e.pointerId);
}
function move(e) {
  if (!start) return;
  x.value = start.x - (e.clientX - start.px);
  const t = performance.now();
  vel = (lastX - e.clientX) / Math.max(1, t - lastT) * 16; // 每帧挪多少
  lastX = e.clientX; lastT = t;
}
function up() {
  if (!start) return;
  start = null;
  // 松手后再滑一小段，慢慢停下；越界的弹回来
  const step = () => {
    if (x.value < 0 || x.value > maxX.value) {
      const target = x.value < 0 ? 0 : maxX.value;
      x.value += (target - x.value) * 0.25;
      if (Math.abs(target - x.value) < 0.5) { x.value = target; return; }
    } else {
      x.value += vel;
      vel *= 0.92;
      if (Math.abs(vel) < 0.3) return;
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

const onResize = () => measure();
onMounted(() => { paint(); measure(true); window.addEventListener("resize", onResize); });
onBeforeUnmount(() => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); });
watch(() => props.room, () => { paint(); measure(true); });
</script>

<template>
  <div ref="view" class="iso-view" :style="{ background: def.bg, height: (H - CROP_TOP) * SCALE + 'px' }"
    @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
    <canvas ref="canvas" class="iso-room" :style="{ width: W * SCALE + 'px', height: H * SCALE + 'px', transform: `translate(${-shown}px, ${-CROP_TOP * SCALE}px)` }" />
    <div v-if="maxX > 0" class="scrub"><i :style="{ left: (Math.min(1, Math.max(0, x / maxX)) * 70) + '%' }" /></div>
  </div>
</template>

<style scoped>
.iso-view { position: relative; overflow: hidden; touch-action: pan-y; user-select: none; -webkit-user-select: none; cursor: grab; max-height: 72vh; }
.iso-view:active { cursor: grabbing; }
.iso-room { display: block; image-rendering: pixelated; image-rendering: crisp-edges; will-change: transform; }
.scrub { position: absolute; left: 30%; right: 30%; bottom: 12px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, .25); pointer-events: none; }
.scrub i { position: absolute; width: 30%; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, .8); }
</style>
