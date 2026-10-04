<script setup>
import { ref, reactive, watch, nextTick } from "vue";
import { cropState, finishCrop } from "../lib/crop.js";

const img = ref(null);
const frameEl = ref(null);
const v = reactive({ w: 0, h: 0, fw: 0, fh: 0, s: 1, min: 1, tx: 0, ty: 0, ready: false });

function layout() {
  const el = img.value;
  if (!el?.naturalWidth) return;
  v.w = el.naturalWidth;
  v.h = el.naturalHeight;
  const maxW = Math.min(innerWidth - 40, 560);
  const maxH = innerHeight - 240;
  let fw = maxW, fh = fw / cropState.aspect;
  if (fh > maxH) { fh = maxH; fw = fh * cropState.aspect; }
  v.fw = fw; v.fh = fh;
  v.min = v.s = Math.max(fw / v.w, fh / v.h);
  v.tx = (fw - v.w * v.s) / 2;
  v.ty = (fh - v.h * v.s) / 2;
  v.ready = true;
}

watch(() => cropState.open, open => { if (open) { v.ready = false; nextTick(() => img.value?.complete && layout()); } });

function clamp() {
  v.tx = Math.min(0, Math.max(v.fw - v.w * v.s, v.tx));
  v.ty = Math.min(0, Math.max(v.fh - v.h * v.s, v.ty));
}

// 以 (px, py)（相对裁剪框）为中心缩放
function zoomAt(ns, px, py) {
  ns = Math.min(v.min * 8, Math.max(v.min, ns));
  v.tx = px - (px - v.tx) * (ns / v.s);
  v.ty = py - (py - v.ty) * (ns / v.s);
  v.s = ns;
  clamp();
}

const pts = new Map();
let pinch = null;
function local(e) {
  const r = frameEl.value.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function down(e) {
  e.currentTarget.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, local(e));
  pinch = null;
}
function move(e) {
  if (!pts.has(e.pointerId)) return;
  const p = local(e);
  const prev = pts.get(e.pointerId);
  pts.set(e.pointerId, p);
  if (pts.size === 1) {
    v.tx += p.x - prev.x;
    v.ty += p.y - prev.y;
    clamp();
  } else if (pts.size === 2) {
    const [a, b] = [...pts.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (pinch) {
      v.tx += mid.x - pinch.mid.x;
      v.ty += mid.y - pinch.mid.y;
      zoomAt(v.s * (dist / pinch.dist), mid.x, mid.y);
    }
    pinch = { dist, mid };
  }
}
function up(e) {
  pts.delete(e.pointerId);
  pinch = null;
}
function wheel(e) {
  const p = local(e);
  zoomAt(v.s * (e.deltaY < 0 ? 1.08 : 1 / 1.08), p.x, p.y);
}

async function confirm() {
  const sw = v.fw / v.s, sh = v.fh / v.s;
  const scale = Math.min(1, 1800 / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img.value, -v.tx / v.s, -v.ty / v.s, sw, sh, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
  finishCrop(blob);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="cropState.open" class="crop">
        <div class="title">{{ cropState.title }}</div>
        <div class="stage" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @wheel.prevent="wheel">
          <div ref="frameEl" class="frame" :class="{ round: cropState.round }" :style="{ width: v.fw + 'px', height: v.fh + 'px' }">
            <img ref="img" :src="cropState.url" alt="" draggable="false" @load="layout"
              :style="{ width: v.w + 'px', height: v.h + 'px', transform: `translate(${v.tx}px, ${v.ty}px) scale(${v.s})`, opacity: v.ready ? 1 : 0 }" />
            <div class="mask" />
          </div>
        </div>
        <div class="hint">拖动调整位置，双指缩放</div>
        <div class="actions">
          <button class="btn soft" @click="finishCrop(null)">取消</button>
          <button class="btn" :disabled="!v.ready" @click="confirm">完成</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.crop {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: #17171b;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: calc(var(--safe-top) + 14px) 0 calc(var(--safe-bottom) + 20px);
  color: #fff;
}
.title { font-size: 1rem; font-weight: 600; margin-bottom: 12px; }
.stage { flex: 1; width: 100%; display: grid; place-items: center; touch-action: none; overflow: hidden; cursor: grab; }
.frame { position: relative; }
.frame img { position: absolute; left: 0; top: 0; transform-origin: 0 0; max-width: none; user-select: none; -webkit-user-drag: none; pointer-events: none; }
.mask { position: absolute; inset: 0; box-shadow: 0 0 0 9999px rgba(23, 23, 27, .62); outline: 1.5px solid rgba(255, 255, 255, .8); pointer-events: none; }
.round .mask { border-radius: 50%; }
.hint { font-size: 0.8rem; color: rgba(255, 255, 255, .55); margin: 12px 0; }
.actions { display: flex; gap: 14px; }
.actions .btn { min-width: 110px; }
.actions .btn.soft { background: rgba(255, 255, 255, .14); color: #fff; }
.actions .btn:not(.soft) { background: #fff; color: #17171b; }
</style>
