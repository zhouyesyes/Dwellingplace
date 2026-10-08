<script setup>
// 记忆星图：每条记忆一颗星。同一主题的聚在一起，有关联的连线。
// 越重要的星越大越暖，核心记忆是金色的四角星。
// 小图：一根手指拖动，两根手指缩放。全屏：变成立体的星空，一根手指转，两根手指缩放，没人碰的时候自己慢慢转。
// 点一下星星看名字，连点两下打开
import { ref, computed, reactive, onBeforeUnmount, nextTick } from "vue";

const props = defineProps({ stars: { type: Array, default: () => [] }, edges: { type: Array, default: () => [] }, query: String });
const emit = defineEmits(["pick"]);

const W = 340, H = 420;
// 稳定的伪随机：同一条记忆每次都在同一个位置
const hash = s => {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  // 再搅一搅，免得相邻的编号排成一条线
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
};

// ---------- 星星的样子 ----------
// 重要度 1 → 很小的冷白点，10 → 大而暖；核心更大，金色
function look(s) {
  const imp = Math.max(1, Math.min(10, Number(s.importance) || 4));
  const t = (imp - 1) / 9;
  if (s.pinned) return { r: 5.4, fill: "#ffe39a", glow: 1, halo: 4.2 };
  const cold = [196, 208, 255], warm = [255, 244, 222];
  const c = cold.map((x, i) => Math.round(x + (warm[i] - x) * t));
  return { r: 0.8 + Math.pow(t, 1.5) * 3.8, fill: `rgb(${c.join(",")})`, glow: 0.35 + t * 0.45 + Math.min(1, Number(s.weight) || 0.3) * 0.2, halo: 2.4 + t * 1.4 };
}
// 四角星（核心记忆）
const sparkle = (x, y, r) => {
  const a = r * 2.6, b = r * 0.5;
  return `M${x} ${y - a}L${x + b} ${y - b}L${x + a} ${y}L${x + b} ${y + b}L${x} ${y + a}L${x - b} ${y + b}L${x - a} ${y}L${x - b} ${y - b}Z`;
};

// 按主题分组，大的组排前面
const groups = computed(() => {
  const m = new Map();
  for (const s of props.stars) {
    const k = s.domains?.[0] || "其他";
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s);
  }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
});

// ---------- 平面 ----------
const layout = computed(() => {
  const out = [];
  const labels = [];
  const keys = groups.value;
  keys.forEach(([k, list], gi) => {
    const a = (gi / keys.length) * Math.PI * 2 + 0.4;
    const R = keys.length === 1 ? 0 : 70 + (gi % 2) * 40;
    const cx = W / 2 + Math.cos(a) * R, cy = H / 2 + Math.sin(a) * R * 1.15;
    labels.push({ k, x: cx, y: cy - 8 - Math.sqrt(list.length) * 9 });
    list.forEach((s, i) => {
      const r = 9 * Math.sqrt(i + 0.5) + hash(s.id) * 6;
      const t = i * 2.39996 + hash(s.id + "t") * 0.6;
      out.push({ ...s, ...look(s), x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r });
    });
  });
  return { stars: out, labels };
});

// ---------- 立体（全屏） ----------
const R3 = 150;
const space = computed(() => {
  const pts = [];
  const centers = [];
  const G = groups.value.length;
  groups.value.forEach(([k, list], gi) => {
    // 每个主题在一个球面上占一块地方
    const y = G === 1 ? 0 : 1 - (2 * (gi + 0.5)) / G;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = gi * 2.39996;
    const c = G === 1 ? [0, 0, 0] : [Math.cos(th) * rr * R3, y * R3 * 0.9, Math.sin(th) * rr * R3];
    centers.push({ k, p: c, n: list.length });
    list.forEach((s, i) => {
      const d = (s.pinned ? 8 : 18) + Math.sqrt(i + 1) * 13 + hash(s.id) * 14;
      const u = hash(s.id + "u") * Math.PI * 2, v = Math.acos(2 * hash(s.id + "v") - 1);
      pts.push({ ...s, ...look(s), p: [c[0] + d * Math.sin(v) * Math.cos(u), c[1] + d * Math.cos(v), c[2] + d * Math.sin(v) * Math.sin(u)] });
    });
  });
  return { pts, centers };
});
// 远处的星尘也是立体的
const dust3 = Array.from({ length: 160 }, (_, i) => {
  const u = hash("du" + i) * Math.PI * 2, v = Math.acos(2 * hash("dv" + i) - 1), d = 260 + hash("dd" + i) * 260;
  return { p: [d * Math.sin(v) * Math.cos(u), d * Math.cos(v), d * Math.sin(v) * Math.sin(u)], r: 0.3 + hash("dr" + i) * 0.8 };
});

const rot = reactive({ yaw: 0.4, pitch: -0.25, k: 1 });
const vp = reactive({ w: 390, h: 760 });
const FOCAL = 560;
function project(p) {
  const cy = Math.cos(rot.yaw), sy = Math.sin(rot.yaw), cp = Math.cos(rot.pitch), sp = Math.sin(rot.pitch);
  const x1 = p[0] * cy - p[2] * sy, z1 = p[0] * sy + p[2] * cy;
  const y2 = p[1] * cp - z1 * sp, z2 = p[1] * sp + z1 * cp;
  // 让整团星星大约占满屏幕短边
  const fit = (Math.min(vp.w, vp.h) / (2 * R3)) * 0.82 * rot.k;
  const z = z2 * fit;
  const s = FOCAL / Math.max(80, FOCAL + z);
  return { x: vp.w / 2 + x1 * fit * s, y: vp.h / 2 + y2 * fit * s, z, s };
}
const scene = computed(() => {
  const near = R3 * (Math.min(vp.w, vp.h) / (2 * R3)) * 0.82 * rot.k;
  const stars = space.value.pts.map(st => {
    const q = project(st.p);
    const depth = Math.max(0, Math.min(1, (q.z + near) / (2 * near))); // 0 近 1 远
    return { ...st, x: q.x, y: q.y, z: q.z, sz: st.r * q.s * Math.sqrt(rot.k), fade: 1 - depth * 0.65 };
  }).sort((a, b) => b.z - a.z);
  const byId = Object.fromEntries(stars.map(s => [s.id, s]));
  const lines = props.edges.map(e => [byId[e.source], byId[e.target], e.similarity]).filter(([a, b]) => a && b);
  const labels = space.value.centers.map(c => { const q = project([c.p[0], c.p[1] - 26 - Math.sqrt(c.n) * 5, c.p[2]]); return { k: c.k, x: q.x, y: q.y, fade: Math.max(0.15, Math.min(0.75, 0.75 - q.z / (3 * R3))) }; });
  const dust = dust3.map(d => { const q = project(d.p); return { x: q.x, y: q.y, r: d.r * q.s, o: 0.12 + 0.3 * q.s }; });
  return { stars, lines, labels, dust };
});

const byId = computed(() => Object.fromEntries(layout.value.stars.map(s => [s.id, s])));
const lines = computed(() => props.edges.map(e => [byId.value[e.source], byId.value[e.target], e.similarity]).filter(([a, b]) => a && b));
const hit = computed(() => {
  const q = (props.query || "").trim().toLowerCase();
  if (!q) return null;
  return new Set(props.stars.filter(s => [s.title, ...(s.tags || []), ...(s.domains || [])].join(" ").toLowerCase().includes(q)).map(s => s.id));
});
const dust = Array.from({ length: 70 }, (_, i) => ({ x: hash("x" + i) * W, y: hash("y" + i) * H, r: 0.3 + hash("r" + i) * 0.7, o: 0.15 + hash("o" + i) * 0.35 }));

// ---------- 手势 ----------
const view = reactive({ x: 0, y: 0, k: 1 });
const pts = new Map();
let start = null, moved = false;
const svg = ref(null);
// 屏幕坐标 → 图上的坐标（用 SVG 自己的换算）
const toLocal = e => {
  const m = svg.value?.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
};
const selected = ref(null);
let lastTap = 0;
const full = ref(false);
let idleUntil = 0;
function down(e) {
  pts.set(e.pointerId, toLocal(e));
  moved = false;
  start = { view: { ...view }, rot: { ...rot }, pts: new Map(pts) };
  idleUntil = Date.now() + 4000;
}
function move(e) {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, toLocal(e));
  idleUntil = Date.now() + 4000;
  const now = [...pts.values()], was = [...start.pts.values()];
  if (now.length === 1 && was.length >= 1) {
    const dx = now[0].x - was[0].x, dy = now[0].y - was[0].y;
    if (Math.hypot(dx, dy) > 4) moved = true;
    if (full.value) {
      rot.yaw = start.rot.yaw + dx * 0.008;
      rot.pitch = Math.max(-1.35, Math.min(1.35, start.rot.pitch - dy * 0.008));
    } else {
      view.x = start.view.x + dx;
      view.y = start.view.y + dy;
    }
  } else if (now.length >= 2 && was.length >= 2) {
    moved = true;
    const d0 = Math.hypot(was[0].x - was[1].x, was[0].y - was[1].y) || 1;
    const d1 = Math.hypot(now[0].x - now[1].x, now[0].y - now[1].y);
    if (full.value) {
      rot.k = Math.max(0.5, Math.min(4, start.rot.k * (d1 / d0)));
      return;
    }
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
    let best = null;
    if (full.value) {
      let bd = 22;
      for (const s of [...scene.value.stars].reverse()) { // 近的优先
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d < bd) { bd = d; best = s; }
      }
    } else {
      const wx = (p.x - view.x) / view.k, wy = (p.y - view.y) / view.k;
      let bd = 16 / view.k;
      for (const s of layout.value.stars) {
        const d = Math.hypot(s.x - wx, s.y - wy);
        if (d < bd) { bd = d; best = s; }
      }
    }
    // 点一下：亮出名字；同一颗星再点一下（双击）：打开
    if (best && selected.value === best.id && Date.now() - lastTap < 450) emit("pick", best);
    else selected.value = best ? best.id : null;
    lastTap = Date.now();
  }
  pts.delete(e.pointerId);
  start = { view: { ...view }, rot: { ...rot }, pts: new Map(pts) };
}
function wheel(e) {
  idleUntil = Date.now() + 4000;
  if (full.value) {
    rot.k = Math.max(0.5, Math.min(4, rot.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    return;
  }
  const p = toLocal(e);
  const k = Math.max(0.6, Math.min(5, view.k * (e.deltaY < 0 ? 1.15 : 0.87)));
  view.x = p.x - ((p.x - view.x) * k) / view.k;
  view.y = p.y - ((p.y - view.y) * k) / view.k;
  view.k = k;
}
const selectedStar = computed(() => props.stars.find(s => s.id === selected.value) || null);
function reset() {
  Object.assign(view, { x: 0, y: 0, k: 1 });
  Object.assign(rot, { yaw: 0.4, pitch: -0.25, k: 1 });
}
const moved2d = computed(() => view.k !== 1 || view.x || view.y);

// 全屏：量一下屏幕，开始慢慢转
let raf = 0;
function spin() {
  if (!full.value) return;
  if (Date.now() > idleUntil) rot.yaw += 0.0025;
  raf = requestAnimationFrame(spin);
}
// 按真正铺开的大小来画（手机上 innerWidth 和实际可见的宽高不一定一样）
function measure() {
  const r = svg.value?.getBoundingClientRect();
  vp.w = Math.round(r?.width || window.innerWidth);
  vp.h = Math.round(r?.height || window.innerHeight);
}
const onResize = () => full.value && measure();
window.addEventListener("resize", onResize);
onBeforeUnmount(() => window.removeEventListener("resize", onResize));
async function toggleFull() {
  full.value = !full.value;
  selected.value = null;
  cancelAnimationFrame(raf);
  if (full.value) {
    await nextTick();
    measure();
    idleUntil = 0;
    raf = requestAnimationFrame(spin);
  }
}
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <!-- 立体星空搬到最外层：放在抽屉里时，抽屉的变形会让 fixed 只铺满抽屉那么宽 -->
  <Teleport to="body" :disabled="!full">
  <div class="map" :class="{ full }">
    <svg ref="svg" :viewBox="full ? `0 0 ${vp.w} ${vp.h}` : `0 0 ${W} ${H}`" class="sky" :preserveAspectRatio="full ? 'xMidYMid slice' : 'xMidYMid meet'" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @wheel.prevent="wheel">
      <defs>
        <radialGradient id="nebula" cx="30%" cy="25%" r="80%">
          <stop offset="0" stop-color="#6a6a8e" /><stop offset=".55" stop-color="#3b4166" /><stop offset="1" stop-color="#2a3050" />
        </radialGradient>
        <radialGradient id="glow"><stop offset="0" stop-color="#fff" stop-opacity=".9" /><stop offset="1" stop-color="#fff" stop-opacity="0" /></radialGradient>
        <radialGradient id="glow-gold"><stop offset="0" stop-color="#ffe7a8" stop-opacity=".95" /><stop offset="1" stop-color="#ffd27a" stop-opacity="0" /></radialGradient>
      </defs>

      <!-- 平面 -->
      <template v-if="!full">
        <rect :width="W" :height="H" fill="url(#nebula)" />
        <circle v-for="(d, i) in dust" :key="'d' + i" :cx="d.x" :cy="d.y" :r="d.r" fill="#fff" :opacity="d.o" />
        <g :transform="`translate(${view.x} ${view.y}) scale(${view.k})`">
          <line v-for="([a, b, sim], i) in lines" :key="i" :x1="a.x" :y1="a.y" :x2="b.x" :y2="b.y" stroke="#cdd4ff" :stroke-opacity="0.12 + (sim || 0) * 0.3" :stroke-width="0.6 / Math.sqrt(view.k)" />
          <text v-for="l in layout.labels" :key="l.k" :x="l.x" :y="l.y" text-anchor="middle" class="group" :font-size="9 / Math.sqrt(view.k)">{{ l.k }}</text>
          <g v-for="s in layout.stars" :key="s.id" class="star" :opacity="hit && !hit.has(s.id) ? 0.18 : 1">
            <circle :cx="s.x" :cy="s.y" :r="s.r * s.halo" :fill="s.pinned ? 'url(#glow-gold)' : 'url(#glow)'" :opacity="s.glow * 0.55" />
            <path v-if="s.pinned" :d="sparkle(s.x, s.y, s.r * 0.75)" fill="#fff4cf" opacity=".9" />
            <circle :cx="s.x" :cy="s.y" :r="s.r" :fill="s.fill" :opacity="Math.min(1, s.glow + 0.2)" />
            <circle v-if="selected === s.id" :cx="s.x" :cy="s.y" :r="s.r + 4" fill="none" stroke="#ffe9a8" stroke-width="0.8" />
            <text v-if="s.pinned || view.k > 1.8 || selected === s.id || (hit && hit.has(s.id))" :x="s.x" :y="s.y + s.r + 8 / Math.sqrt(view.k)" text-anchor="middle" class="title" :font-size="7.5 / Math.sqrt(view.k)">{{ s.title.slice(0, 12) }}</text>
          </g>
        </g>
      </template>

      <!-- 立体 -->
      <template v-else>
        <rect x="-20" y="-20" :width="vp.w + 40" :height="vp.h + 40" fill="url(#nebula)" />
        <circle v-for="(d, i) in scene.dust" :key="'d' + i" :cx="d.x" :cy="d.y" :r="d.r" fill="#fff" :opacity="d.o" />
        <line v-for="([a, b, sim], i) in scene.lines" :key="'l' + i" :x1="a.x" :y1="a.y" :x2="b.x" :y2="b.y" stroke="#cdd4ff" :stroke-opacity="(0.08 + (sim || 0) * 0.25) * Math.min(a.fade, b.fade)" stroke-width="0.7" />
        <text v-for="l in scene.labels" :key="l.k" :x="l.x" :y="l.y" text-anchor="middle" class="group" font-size="12" :opacity="l.fade">{{ l.k }}</text>
        <g v-for="s in scene.stars" :key="s.id" :opacity="(hit && !hit.has(s.id) ? 0.18 : 1) * s.fade">
          <circle :cx="s.x" :cy="s.y" :r="s.sz * (s.pinned ? 3.6 : 2.2)" :fill="s.pinned ? 'url(#glow-gold)' : 'url(#glow)'" :opacity="s.glow * 0.5" />
          <path v-if="s.pinned" :d="sparkle(s.x, s.y, s.sz)" fill="#fff4cf" opacity=".9" />
          <circle :cx="s.x" :cy="s.y" :r="s.sz * 1.3" :fill="s.fill" />
          <circle v-if="selected === s.id" :cx="s.x" :cy="s.y" :r="s.sz * 1.3 + 6" fill="none" stroke="#ffe9a8" stroke-width="1.2" />
          <text v-if="(s.pinned && s.fade > 0.6) || selected === s.id || (hit && hit.has(s.id))" :x="s.x" :y="s.y + s.sz * 1.3 + 13" text-anchor="middle" class="title" font-size="11">{{ s.title.slice(0, 14) }}</text>
        </g>
      </template>
    </svg>
    <div class="btns">
      <button v-if="full ? rot.k !== 1 : moved2d" @click="reset">回到中间</button>
      <button @click="toggleFull">{{ full ? "退出" : "立体星空" }}</button>
    </div>
    <div v-if="!full" class="legend">
      <span><i class="dot core" />核心</span><span><i class="dot big" />很重要</span><span><i class="dot mid" />一般</span><span><i class="dot small" />小事</span>
    </div>
    <p v-if="selectedStar" class="sel-card" @click="emit('pick', selectedStar)">{{ selectedStar.title }}<small>{{ selectedStar.pinned ? "核心记忆" : `重要度 ${selectedStar.importance || "—"}` }} · 再点一下这颗星，或点这里打开</small></p>
    <p v-if="!full" class="tip">拖动看看，两根手指可以放大。越重要的星越大越暖，金色的四角星是核心记忆。点一下看名字，连点两下打开。</p>
  </div>
  </Teleport>
</template>

<style scoped>
.map { position: relative; }
.sky { width: 100%; height: auto; display: block; border-radius: 22px; touch-action: none; user-select: none; }
.star { cursor: pointer; }
.group { fill: #c9cdea; opacity: .55; letter-spacing: 1px; }
.title { fill: #e9ebff; opacity: .85; }
.btns { position: absolute; right: 12px; top: 12px; display: flex; gap: 6px; z-index: 2; }
.btns button { border: 0; border-radius: 999px; padding: 5px 12px; font-size: 0.78rem; background: rgba(255, 255, 255, .85); }
.full { position: fixed; inset: 0; z-index: 45; background: #2a3050; }
.full .sky { width: 100%; height: 100%; border-radius: 0; }
.full .btns { top: calc(var(--safe-top) + 12px); }
.legend { position: absolute; left: 12px; top: 14px; display: flex; gap: 9px; font-size: 0.68rem; color: #d6daf3; pointer-events: none; }
.legend span { display: flex; align-items: center; gap: 4px; }
.dot { display: inline-block; border-radius: 50%; background: #fff; }
.dot.core { width: 9px; height: 9px; background: #ffe39a; box-shadow: 0 0 6px #ffd27a; }
.dot.big { width: 7px; height: 7px; background: #fff4de; }
.dot.mid { width: 5px; height: 5px; background: #e2e3f7; }
.dot.small { width: 3px; height: 3px; background: #c4d0ff; }
.sel-card { position: absolute; left: 12px; right: 12px; bottom: 44px; margin: 0; background: rgba(255, 255, 255, .92); border-radius: 14px; padding: 8px 12px; font-size: 0.9rem; cursor: pointer; }
.full .sel-card { bottom: calc(var(--safe-bottom) + 20px); }
.sel-card small { display: block; font-size: 0.72rem; color: var(--text-3); }
.tip { font-size: 0.75rem; color: var(--text-3); margin: 8px 4px 0; line-height: 1.6; }
</style>
