<script setup>
// 记忆星图：每条记忆一颗星。同一主题的聚在一起，有关联的连线；核心记忆最亮。
// 一根手指拖动，两根手指缩放，点一颗星打开它
import { ref, computed, reactive } from "vue";

const props = defineProps({ stars: { type: Array, default: () => [] }, edges: { type: Array, default: () => [] }, query: String });
const emit = defineEmits(["pick"]);

const W = 340, H = 420;
// 稳定的伪随机：同一条记忆每次都在同一个位置
const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };

const layout = computed(() => {
  const groups = new Map();
  for (const s of props.stars) {
    const k = s.domains?.[0] || "其他";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const keys = [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length);
  const out = [];
  const labels = [];
  keys.forEach((k, gi) => {
    const a = (gi / keys.length) * Math.PI * 2 + 0.4;
    const R = keys.length === 1 ? 0 : 70 + (gi % 2) * 40;
    const cx = W / 2 + Math.cos(a) * R, cy = H / 2 + Math.sin(a) * R * 1.15;
    labels.push({ k, x: cx, y: cy - 8 - Math.sqrt(groups.get(k).length) * 9 });
    groups.get(k).forEach((s, i) => {
      const r = 9 * Math.sqrt(i + 0.5) + hash(s.id) * 6;
      const t = i * 2.39996 + hash(s.id + "t") * 0.6;
      const size = s.pinned ? 4.6 : 1.4 + Math.min(10, Number(s.importance) || 4) * 0.22;
      out.push({ ...s, x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r, size, glow: s.pinned ? 1 : 0.45 + Math.min(1, Number(s.weight) || 0.3) * 0.5 });
    });
  });
  return { stars: out, labels };
});
// 背景里的小星星（只是装饰）
const dust = Array.from({ length: 70 }, (_, i) => ({ x: hash("x" + i) * W, y: hash("y" + i) * H, r: 0.3 + hash("r" + i) * 0.7, o: 0.15 + hash("o" + i) * 0.35 }));
const byId = computed(() => Object.fromEntries(layout.value.stars.map(s => [s.id, s])));
const lines = computed(() => props.edges.map(e => [byId.value[e.source], byId.value[e.target], e.similarity]).filter(([a, b]) => a && b));
const hit = computed(() => {
  const q = (props.query || "").trim().toLowerCase();
  if (!q) return null;
  return new Set(layout.value.stars.filter(s => [s.title, ...(s.tags || []), ...(s.domains || [])].join(" ").toLowerCase().includes(q)).map(s => s.id));
});

// ---------- 拖动、缩放 ----------
const view = reactive({ x: 0, y: 0, k: 1 });
const pts = new Map();
let start = null, moved = false;
const svg = ref(null);
// 屏幕坐标 → 星图坐标（全屏时有留边，用 SVG 自己的换算）
const toLocal = e => {
  const m = svg.value.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
};
const selected = ref(null);
let lastTap = 0;
const full = ref(false);
function down(e) {
  pts.set(e.pointerId, toLocal(e));
  moved = false;
  start = { view: { ...view }, pts: new Map(pts) };
}
function move(e) {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, toLocal(e));
  const now = [...pts.values()], was = [...start.pts.values()];
  if (now.length === 1 && was.length >= 1) {
    const dx = now[0].x - was[0].x, dy = now[0].y - was[0].y;
    if (Math.hypot(dx, dy) > 4) moved = true;
    view.x = start.view.x + dx;
    view.y = start.view.y + dy;
  } else if (now.length >= 2 && was.length >= 2) {
    moved = true;
    const d0 = Math.hypot(was[0].x - was[1].x, was[0].y - was[1].y) || 1;
    const d1 = Math.hypot(now[0].x - now[1].x, now[0].y - now[1].y);
    const k = Math.max(0.6, Math.min(5, start.view.k * (d1 / d0)));
    const c = { x: (was[0].x + was[1].x) / 2, y: (was[0].y + was[1].y) / 2 };
    view.x = c.x - ((c.x - start.view.x) * k) / start.view.k;
    view.y = c.y - ((c.y - start.view.y) * k) / start.view.k;
    view.k = k;
  }
}
function up(e) {
  const single = pts.size === 1 && pts.has(e.pointerId);
  if (single && !moved) {
    // 轻点：找离手指最近的那颗星
    const p = toLocal(e);
    const wx = (p.x - view.x) / view.k, wy = (p.y - view.y) / view.k;
    let best = null, bd = 16 / view.k;
    for (const s of layout.value.stars) {
      const d = Math.hypot(s.x - wx, s.y - wy);
      if (d < bd) { bd = d; best = s; }
    }
    // 点一下：亮出名字；同一颗星再点一下（双击）：打开
    if (best && selected.value === best.id && Date.now() - lastTap < 450) emit("pick", best);
    else selected.value = best ? best.id : null;
    lastTap = Date.now();
  }
  pts.delete(e.pointerId);
  start = { view: { ...view }, pts: new Map(pts) };
}
function wheel(e) {
  const p = toLocal(e);
  const k = Math.max(0.6, Math.min(5, view.k * (e.deltaY < 0 ? 1.15 : 0.87)));
  view.x = p.x - ((p.x - view.x) * k) / view.k;
  view.y = p.y - ((p.y - view.y) * k) / view.k;
  view.k = k;
}
const selectedStar = computed(() => layout.value.stars.find(s => s.id === selected.value) || null);
function reset() { Object.assign(view, { x: 0, y: 0, k: 1 }); }
</script>

<template>
  <div class="map" :class="{ full }">
    <svg ref="svg" :viewBox="`0 0 ${W} ${H}`" class="sky" preserveAspectRatio="xMidYMid meet" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @wheel.prevent="wheel">
      <defs>
        <radialGradient id="nebula" cx="30%" cy="25%" r="80%">
          <stop offset="0" stop-color="#6a6a8e" /><stop offset=".55" stop-color="#3b4166" /><stop offset="1" stop-color="#2a3050" />
        </radialGradient>
        <radialGradient id="glow"><stop offset="0" stop-color="#fff" stop-opacity=".9" /><stop offset="1" stop-color="#fff" stop-opacity="0" /></radialGradient>
      </defs>
      <rect :width="W" :height="H" fill="url(#nebula)" />
      <circle v-for="(d, i) in dust" :key="'d' + i" :cx="d.x" :cy="d.y" :r="d.r" fill="#fff" :opacity="d.o" />
      <g :transform="`translate(${view.x} ${view.y}) scale(${view.k})`">
        <line v-for="([a, b, sim], i) in lines" :key="i" :x1="a.x" :y1="a.y" :x2="b.x" :y2="b.y" stroke="#cdd4ff" :stroke-opacity="0.12 + (sim || 0) * 0.3" :stroke-width="0.6 / Math.sqrt(view.k)" />
        <text v-for="l in layout.labels" :key="l.k" :x="l.x" :y="l.y" text-anchor="middle" class="group" :font-size="9 / Math.sqrt(view.k)">{{ l.k }}</text>
        <g v-for="s in layout.stars" :key="s.id" class="star" :opacity="hit && !hit.has(s.id) ? 0.18 : 1">
          <circle :cx="s.x" :cy="s.y" :r="s.size * 3.2" fill="url(#glow)" :opacity="s.glow * 0.55" />
          <circle :cx="s.x" :cy="s.y" :r="s.size" :fill="s.pinned ? '#fff6d8' : '#ffffff'" :opacity="s.glow" />
          <circle v-if="selected === s.id" :cx="s.x" :cy="s.y" :r="s.size + 4" fill="none" stroke="#ffe9a8" stroke-width="0.8" />
          <text v-if="s.pinned || view.k > 1.8 || selected === s.id || (hit && hit.has(s.id))" :x="s.x" :y="s.y + s.size + 8 / Math.sqrt(view.k)" text-anchor="middle" class="title" :font-size="7.5 / Math.sqrt(view.k)">{{ s.title.slice(0, 12) }}</text>
        </g>
      </g>
    </svg>
    <div class="btns">
      <button v-if="view.k !== 1 || view.x || view.y" @click="reset">回到中间</button>
      <button @click="full = !full">{{ full ? "退出全屏" : "全屏" }}</button>
    </div>
    <p v-if="selectedStar" class="sel-card" @click="emit('pick', selectedStar)">{{ selectedStar.title }}<small>再点一下这颗星，或点这里打开</small></p>
    <p v-if="!full" class="tip">拖动看看，两根手指可以放大。亮黄色的是核心记忆。点一下星星看名字，连点两下打开。</p>
  </div>
</template>

<style scoped>
.map { position: relative; }
.sky { width: 100%; height: auto; display: block; border-radius: 22px; touch-action: none; user-select: none; }
.star { cursor: pointer; }
.group { fill: #c9cdea; opacity: .55; letter-spacing: 1px; }
.title { fill: #e9ebff; opacity: .85; }
.btns { position: absolute; right: 12px; top: 12px; display: flex; gap: 6px; z-index: 2; }
.btns button { border: 0; border-radius: 999px; padding: 5px 12px; font-size: 0.78rem; background: rgba(255, 255, 255, .85); }
.full { position: fixed; inset: 0; z-index: 45; background: #2a3050; display: flex; align-items: center; }
.full .sky { width: 100%; height: 100%; border-radius: 0; }
.full .btns { top: calc(var(--safe-top) + 12px); }
.sel-card { position: absolute; left: 12px; right: 12px; bottom: 44px; margin: 0; background: rgba(255, 255, 255, .92); border-radius: 14px; padding: 8px 12px; font-size: 0.9rem; cursor: pointer; }
.full .sel-card { bottom: calc(var(--safe-bottom) + 20px); }
.sel-card small { display: block; font-size: 0.72rem; color: var(--text-3); }
.tip { font-size: 0.75rem; color: var(--text-3); margin: 8px 4px 0; line-height: 1.6; }
</style>
