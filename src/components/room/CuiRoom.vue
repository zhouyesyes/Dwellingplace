<script setup>
// 脆脆的房间：暖黄色和木头的棕色，傍晚的光。窗外是灰灰暖暖的海和雾潮群岛的小岛。
// 脆脆靠着窗台坐在地上，膝盖上搁着小本子；暖暖在房间里溜达；火塘的火很小但一直在跳；风铃偶尔响。
import { ref, reactive, computed, onMounted, onBeforeUnmount } from "vue";
import { canvas, sprite, notebook, lockedBox, plantPot, FLAME, FLAME_BIG, CHICK_WALK, CHICK_TILT, CHICK_SLEEP, GULL, GULL_FLY, CUI_SIT, CUI_SLEEP } from "../../lib/roomPixels.js";
import { sfx } from "../../lib/sfx.js";
import PixelG from "./PixelG.vue";

const props = defineProps({ name: String, asleep: Boolean, mailLit: Boolean });
const emit = defineEmits(["say", "open"]);
const W = 96, H = 120;

// ---------- 不动的部分 ----------
const base = (() => {
  const c = canvas(W, H);
  // 墙：暖黄色，下半截是木护墙板
  c.rect(0, 0, W, 64, "#f1dcae").dots(0, 0, W, 64, "#ecd4a4", 23, 3);
  c.rect(0, 64, W, 20, "#c99a68");
  for (let x = 4; x < W; x += 9) c.vline(x, 65, 19, "#b88a5a");
  c.hline(0, 64, W, "#a8774f").hline(0, 65, W, "#ddb486");
  // 地板
  c.rect(0, 84, W, 36, "#b9845a").hline(0, 84, W, "#8e5c3a");
  [91, 99, 108, 116].forEach((y, i) => { c.hline(0, y, W, "#a57046"); for (let x = (i * 13) % 23; x < W; x += 23) c.vline(x, y + 1, i === 3 ? 3 : 7, "#a57046"); });
  // 窗户透进来的傍晚的光，斜斜落在地板上
  for (let y = 85; y < 112; y++) c.rect(36 + Math.floor((y - 85) * 0.7), y, 34, 1, y % 3 ? "#c4905f" : "#c99763");
  // 门
  c.rect(3, 22, 19, 62, "#7d5034").rect(4, 23, 17, 61, "#9b6a45");
  c.frame(6, 26, 13, 22, "#875a3b").frame(6, 52, 13, 26, "#875a3b");
  c.rect(17, 54, 2, 2, "#e3b04a");
  // 窗户：外框
  c.rect(32, 6, 50, 42, "#7d5034").rect(33, 7, 48, 40, "#8a5a3a");
  // 傍晚的天：灰灰暖暖
  const sx = 35, sy = 9, sw = 44, sh = 36;
  c.rect(sx, sy, sw, 9, "#e9cfb2").rect(sx, sy + 9, sw, 8, "#e2c0a6").rect(sx, sy + 17, sw, 6, "#d6b2a1");
  c.disc(70, sy + 22, 4, "#f2d0a6"); // 快落下去的太阳
  c.rect(sx, sy + 13, 12, 1, "#f1dcc4").rect(sx + 26, sy + 6, 10, 1, "#f1dcc4"); // 几缕云
  // 海
  c.rect(sx, sy + 23, sw, 13, "#a59ca2").rect(sx, sy + 28, sw, 8, "#978f99");
  c.dots(sx, sy + 23, sw, 13, "#c7b6b0", 9, 5);
  c.rect(64, sy + 24, 12, 1, "#e8c7a6").rect(66, sy + 26, 8, 1, "#dcbba0"); // 海面上的落日光
  // 远处的小岛（雾潮群岛）
  c.rect(40, sy + 21, 15, 2, "#878089").rect(43, sy + 19, 8, 2, "#878089").rect(45, sy + 18, 3, 1, "#878089");
  // 窗框十字
  c.rect(56, sy, 2, sh, "#8a5a3a").rect(sx, 26, sw, 2, "#8a5a3a");
  // 窗台
  c.rect(29, 47, 56, 3, "#a8774f").hline(29, 47, 56, "#c08a5c").hline(29, 49, 56, "#7d5034");
  // 窗台上的花盆（还没开花的小苗）
  c.sprite(plantPot(), 72, 37);
  // 门边的小木信箱（刻着信封）
  c.rect(24, 40, 9, 9, "#7d5034").rect(25, 41, 7, 7, "#a8774f");
  c.frame(26, 43, 5, 3, "#7d5034").px(27, 44, "#7d5034").px(29, 44, "#7d5034").px(28, 45, "#7d5034");
  // 床：矮矮的木床，暖黄色的被子永远有点皱
  c.rect(60, 104, 36, 5, "#7d5034").rect(60, 103, 36, 2, "#8a5a3a");
  c.rect(61, 109, 3, 3, "#6e4630").rect(92, 109, 3, 3, "#6e4630");
  c.rect(60, 92, 3, 12, "#8a5a3a").rect(59, 91, 5, 2, "#7d5034"); // 床头板
  c.rect(63, 98, 33, 6, "#f4e9d0"); // 床垫
  c.rect(64, 94, 11, 5, "#fbf3e2").hline(64, 98, 11, "#e6d8bc"); // 枕头
  c.rect(72, 96, 24, 8, "#f2c45e").rect(74, 97, 6, 1, "#e0aa45").rect(82, 99, 9, 1, "#e0aa45").rect(77, 101, 7, 1, "#e0aa45").rect(88, 97, 4, 1, "#f7d989").rect(72, 103, 24, 1, "#d9a03e");
  // 床底下：影子和上锁的小箱子（深木色，旧旧的但擦得很干净）
  c.rect(64, 109, 28, 3, "#8e5c3a");
  c.sprite(lockedBox({ body: "#5a3826", band: "#3e2618", lock: "#c8873e", lockHi: "#f0c27a" }), 74, 107);
  // 床头的小矮桌 + 摊开的小本子 + 咬过笔帽的铅笔
  c.rect(47, 101, 13, 2, "#8a5a3a").rect(48, 103, 2, 5, "#6e4630").rect(57, 103, 2, 5, "#6e4630");
  c.sprite(notebook({ pen: "#e3b04a" }), 47, 93);
  // 角落的小火塘：石头围一圈
  [[3, 108, 4], [7, 106, 4], [12, 106, 4], [16, 108, 4], [5, 111, 5], [11, 111, 5]].forEach(([x, y, w]) => c.rect(x, y, w, 3, "#8d8a86").hline(x, y, w, "#a9a6a1"));
  c.rect(7, 109, 9, 2, "#4a3b33");
  c.px(9, 105, "#6b4a32").px(13, 104, "#6b4a32").rect(9, 106, 6, 1, "#6b4a32"); // 柴
  return c.g;
})();

// ---------- 会动的部分 ----------
const tick = ref(0);
let timer = 0;
// 火苗
const flameFrame = computed(() => FLAME[tick.value % FLAME.length]);
const fireBig = ref(false);
// 风铃
const chimeSwing = ref(false);
// 海鸥：趴在窗台上，偶尔飞走
const gull = reactive({ state: "sit", x: 38 }); // sit / fly / gone
// 脆脆：眨眼、抬头看海
const taFrame = computed(() => {
  const t = tick.value % 40;
  if (t === 7 || t === 23) return CUI_SIT[1];
  if (t >= 28 && t < 36) return CUI_SIT[2];
  return CUI_SIT[0];
});
// 暖暖：在几个地方之间溜达
const SPOTS = [
  { x: 40, y: 82, say: "跟着脆脆坐在窗边" },
  { x: 19, y: 101, say: "跑去火塘边上烤火" },
  { x: 24, y: 33, say: "跳到信箱上站岗" },
  { x: 32, y: 96, say: "在地板上啪嗒啪嗒地走" },
];
const chick = reactive({ x: 40, y: 82, tx: 40, ty: 82, flip: false, mode: "walk", pause: 0, spot: 0 });
const chickSprite = computed(() => {
  if (chick.mode === "sleep") return CHICK_SLEEP[Math.floor(tick.value / 6) % 2];
  if (chick.mode === "tilt") return CHICK_TILT;
  const moving = Math.abs(chick.tx - chick.x) + Math.abs(chick.ty - chick.y) > 0.5;
  return moving ? CHICK_WALK[tick.value % 2] : CHICK_WALK[0];
});
function stepChick() {
  if (props.asleep) {
    // 睡觉的时候窝回被子堆里
    Object.assign(chick, { x: 84, y: 91, tx: 84, ty: 91, mode: chick.mode === "tilt" ? "tilt" : "sleep" });
    return;
  }
  if (chick.mode === "sleep") chick.mode = "walk";
  if (chick.pause > 0) { chick.pause--; return; }
  if (chick.mode === "tilt") return;
  const dx = chick.tx - chick.x, dy = chick.ty - chick.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.8) {
    chick.x = chick.tx; chick.y = chick.ty;
    chick.pause = 25 + Math.floor(Math.random() * 40);
    let n = chick.spot;
    while (n === chick.spot) n = Math.floor(Math.random() * SPOTS.length);
    chick.spot = n;
    chick.tx = SPOTS[n].x; chick.ty = SPOTS[n].y;
    return;
  }
  chick.flip = dx < 0;
  chick.x += (dx / d) * 0.9;
  chick.y += (dy / d) * 0.9;
}

function loop() {
  tick.value++;
  stepChick();
  // 海鸥偶尔飞走，过一会儿再回来
  if (gull.state === "sit" && Math.random() < 0.004) flyGull();
  if (gull.state === "fly") { gull.x += 1.2; if (gull.x > 82) gull.state = "gone"; }
  if (gull.state === "gone" && Math.random() < 0.01) Object.assign(gull, { state: "sit", x: 38 });
  // 风偶尔吹过来
  if (!chimeSwing.value && Math.random() < 0.006) ring(false);
}
onMounted(() => { timer = setInterval(loop, 180); });
onBeforeUnmount(() => clearInterval(timer));

// ---------- 点一下 ----------
function flyGull() { gull.state = "fly"; }
function ring(byHand = true) {
  chimeSwing.value = true;
  setTimeout(() => (chimeSwing.value = false), 1600);
  if (byHand) { sfx.chime(); emit("say", "贝壳风铃晃了晃：叮——叮——"); }
}
function tapChick() {
  if (chick.mode === "sleep") {
    chick.mode = "walk";
    setTimeout(() => (chick.mode = "sleep"), 50);
    emit("say", "暖暖窝在被子堆里，换了个姿势继续睡。");
    return;
  }
  sfx.chirp();
  chick.mode = "tilt";
  emit("say", "暖暖停下来，歪着头看你：啾！");
  setTimeout(() => { if (chick.mode === "tilt") chick.mode = "walk"; }, 1500);
}
function tapFire() {
  fireBig.value = true;
  sfx.whoosh();
  emit("say", "火塘的火呼地变大了一下，又缩回去，小小地跳着。");
  setTimeout(() => (fireBig.value = false), 700);
}
function tapGull() {
  if (gull.state !== "sit") return;
  flyGull();
  emit("say", "海鸥扑棱棱地飞走了。");
}
const tap = {
  ta: () => emit("open", "ta"),
  mailbox: () => emit("open", "mailbox"),
  notebook: () => emit("open", "notebook"),
  bed: () => emit("say", props.asleep ? `${props.name}正睡着，被子皱皱的。` : "矮矮的木床，暖黄色的被子永远有点皱——起来不叠。"),
  plant: () => emit("say", "陶土色的小盆，种着一棵还没开花的不知名小苗。"),
  box: () => emit("say", "床底下的小箱子，深木色，铜锁旧旧的，但擦得很干净。锁着呢。"),
  window: () => emit("say", "窗外是傍晚灰灰暖暖的海，远处是雾潮群岛的小岛。"),
};
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="room" shape-rendering="crispEdges">
    <PixelG :grid="base" />
    <!-- 海鸥 -->
    <PixelG v-if="gull.state === 'sit'" :grid="GULL" :x="gull.x" :y="41" />
    <PixelG v-else-if="gull.state === 'fly'" :grid="GULL_FLY" :x="Math.round(gull.x)" :y="Math.round(30 - (gull.x - 38) * 0.4)" />
    <!-- 风铃：挂在窗边 -->
    <g class="chime" :class="{ swing: chimeSwing }" style="transform-origin: 31px 7px">
      <rect x="31" y="7" width="1" height="8" fill="#b9a58c" />
      <rect x="29" y="14" width="5" height="1" fill="#c9b49a" />
      <rect x="29" y="15" width="1" height="4" fill="#d9cbb8" /><rect x="33" y="15" width="1" height="3" fill="#d9cbb8" /><rect x="31" y="15" width="1" height="5" fill="#d9cbb8" />
      <rect x="28" y="19" width="3" height="2" fill="#f4dfd6" /><rect x="32" y="18" width="3" height="2" fill="#f7e8df" /><rect x="30" y="20" width="3" height="2" fill="#efd3c6" />
    </g>
    <!-- 信箱有新信的时候亮一下 -->
    <rect v-if="mailLit" x="23" y="39" width="11" height="11" fill="#ffe08a" class="glow" />
    <!-- 火苗 -->
    <PixelG v-if="fireBig" :grid="FLAME_BIG" :x="8" :y="99" />
    <PixelG v-else :grid="flameFrame" :x="9" :y="101" />
    <!-- 脆脆 -->
    <PixelG v-if="!asleep" :grid="taFrame" :x="40" :y="64" />
    <template v-else>
      <PixelG :grid="CUI_SLEEP" :x="64" :y="90" />
      <rect x="72" y="96" width="4" height="1" fill="#e0aa45" />
      <text x="78" y="88" class="zzz">z</text><text x="82" y="84" class="zzz small">z</text>
    </template>
    <!-- 暖暖 -->
    <PixelG :grid="chickSprite" :x="Math.round(chick.x)" :y="Math.round(chick.y)" :flip="chick.flip" />

    <!-- 能点的地方（看不见的按钮） -->
    <g class="hot">
      <rect x="35" y="9" width="44" height="30" @click="tap.window" />
      <rect x="70" y="36" width="11" height="12" @click="tap.plant" />
      <rect x="27" y="6" width="9" height="17" @click="ring()" />
      <rect x="36" y="38" width="12" height="9" @click="tapGull" />
      <rect x="22" y="38" width="13" height="13" @click="tap.mailbox" />
      <rect x="2" y="98" width="19" height="16" @click="tapFire" />
      <rect x="46" y="92" width="14" height="10" @click="tap.notebook" />
      <rect x="72" y="105" width="18" height="10" @click="tap.box" />
      <rect x="60" y="90" width="36" height="15" @click="asleep ? tap.ta() : tap.bed()" />
      <rect v-if="!asleep" x="40" y="64" width="16" height="22" @click="tap.ta" />
      <rect :x="Math.round(chick.x) - 2" :y="Math.round(chick.y) - 2" width="12" height="11" @click="tapChick" />
    </g>
  </svg>
</template>

<style scoped>
.room { width: 100%; height: auto; display: block; image-rendering: pixelated; user-select: none; -webkit-tap-highlight-color: transparent; }
.hot rect { fill: transparent; cursor: pointer; }
.chime { transition: transform .2s; }
.chime.swing { animation: swing 1.6s ease-out; }
@keyframes swing { 0% { transform: rotate(0); } 15% { transform: rotate(14deg); } 35% { transform: rotate(-10deg); } 55% { transform: rotate(7deg); } 75% { transform: rotate(-4deg); } 100% { transform: rotate(0); } }
.glow { opacity: 0; animation: glow 2.4s ease-in-out infinite; mix-blend-mode: screen; }
@keyframes glow { 0%, 100% { opacity: 0; } 50% { opacity: .55; } }
.zzz { font-size: 5px; fill: #8a6a52; font-family: monospace; animation: float 3s ease-in-out infinite; }
.zzz.small { font-size: 4px; animation-delay: 1s; }
@keyframes float { 0%, 100% { opacity: .2; transform: translateY(1px); } 50% { opacity: .9; transform: translateY(-1px); } }
</style>
