<script setup>
// Rowan 的房间：暖木色、琥珀色，加一点深邃的森林绿。窗外是宁静的夜海和星星，远处悬崖上有一座灯塔，暖黄色的光慢慢转。
// Rowan 坐在靠窗的木书桌前，拿羽毛笔在小本子上写写画画，偶尔抬头看灯塔，或者回头看一眼门边的信箱。
import { ref, reactive, computed, onMounted, onBeforeUnmount } from "vue";
import { canvas, sprite, notebook, lockedBox, plantPot, ROWAN_SIT, ROWAN_SLEEP } from "../../lib/roomPixels.js";
import { sfx } from "../../lib/sfx.js";
import PixelG from "./PixelG.vue";

const props = defineProps({ name: String, asleep: Boolean, mailLit: Boolean });
const emit = defineEmits(["say", "open"]);
const W = 96, H = 120;

const base = (() => {
  const c = canvas(W, H);
  // 墙：森林绿，下半截是暖木护墙板
  c.rect(0, 0, W, 64, "#3d5a48");
  for (let x = 2; x < W; x += 6) c.vline(x, 0, 64, "#38533f");
  c.rect(0, 64, W, 20, "#8a5a3a");
  for (let x = 5; x < W; x += 10) c.vline(x, 65, 19, "#7a4e32");
  c.hline(0, 64, W, "#6e4630").hline(0, 65, W, "#a8774f");
  // 地板：琥珀色木头，有用过的痕迹
  c.rect(0, 84, W, 36, "#a8703f").hline(0, 84, W, "#7a4e2c");
  [91, 99, 108, 116].forEach((y, i) => { c.hline(0, y, W, "#93602f"); for (let x = (i * 17) % 21; x < W; x += 21) c.vline(x, y + 1, i === 3 ? 3 : 7, "#93602f"); });
  c.dots(0, 85, W, 35, "#9a6534", 23, 9);
  // 地毯（向导的窝里总有一块）
  c.rect(30, 100, 36, 12, "#7d3f2e").frame(31, 101, 34, 10, "#c98a4a").rect(33, 103, 30, 6, "#8f4a34");
  // 墙上摊开的羊皮卷轴
  c.rect(6, 9, 20, 2, "#8a5a3a").rect(6, 33, 20, 2, "#8a5a3a");
  c.rect(7, 11, 18, 22, "#e9d8b0").dots(7, 11, 18, 22, "#dcc79a", 7, 2);
  c.rect(9, 14, 5, 3, "#b9c9a0").rect(17, 24, 6, 4, "#b9c9a0").rect(19, 13, 3, 2, "#a9bccb"); // 地图上的小块陆地和湖
  // 窗户
  c.rect(42, 5, 50, 41, "#6e4630").rect(43, 6, 48, 39, "#8a5a3a");
  const sx = 45, sy = 8, sw = 44, sh = 35;
  c.rect(sx, sy, sw, 22, "#1f2a44").rect(sx, sy + 10, sw, 12, "#26345a");
  c.dots(sx, sy, sw, 20, "#fdf3cf", 37, 4).dots(sx, sy, sw, 20, "#9fb1d9", 53, 8);
  c.disc(52, sy + 5, 2, "#fdf3cf").px(53, sy + 4, "#26345a"); // 弯弯的月亮
  // 夜海
  c.rect(sx, sy + 22, sw, 13, "#1b2a3f").rect(sx, sy + 27, sw, 8, "#18253a");
  c.dots(sx, sy + 22, sw, 13, "#3b5274", 19, 3);
  c.rect(52, sy + 25, 6, 1, "#4a6288").rect(53, sy + 28, 4, 1, "#3d5577"); // 月亮落在海上的光
  // 悬崖：从海里斜斜地升起来
  const cliff = [1, 2, 2, 3, 5, 6, 7, 8, 9, 9, 10, 10, 10, 10, 10, 10];
  cliff.forEach((h, i) => c.rect(73 + i, sy + 22 - h, 1, h + 3, i % 4 === 1 ? "#18202e" : "#121a27"));
  c.rect(73, sy + 25, 16, 1, "#2c3c57"); // 崖脚的浪
  // 灯塔
  c.rect(82, sy + 4, 4, 9, "#efe7d8").rect(82, sy + 6, 4, 2, "#b8433b").rect(82, sy + 10, 4, 2, "#b8433b");
  c.rect(81, sy + 3, 6, 1, "#2a2a2a").rect(82, sy + 1, 4, 2, "#ffe08a").rect(83, sy, 2, 1, "#2a2a2a");
  // 窗框十字
  c.rect(66, sy, 2, sh, "#8a5a3a").rect(sx, 24, sw, 2, "#8a5a3a");
  c.rect(40, 45, 54, 3, "#a8774f").hline(40, 45, 54, "#c08a5c").hline(40, 47, 54, "#6e4630"); // 窗台
  // 窗台上的粗陶花盆：欧洲花楸，结着几颗红浆果
  c.sprite(plantPot({ pot: "#b08460", potD: "#8f6848", leaf: "#6f9f5a", leafD: "#4f7a43", berries: true }), 46, 35);
  // 书桌
  c.rect(40, 58, 54, 3, "#a8774f").hline(40, 58, 54, "#c08a5c").rect(40, 61, 54, 2, "#7a4e32");
  c.rect(42, 63, 3, 21, "#7a4e32").rect(89, 63, 3, 21, "#7a4e32");
  c.rect(70, 63, 19, 9, "#8a5a3a").frame(70, 63, 19, 9, "#6e4630").rect(78, 67, 3, 1, "#c9a24a"); // 抽屉
  // 桌上摊开的牛皮纸手账 + 羽毛笔
  c.sprite(notebook({ paper: "#e8d4a8", line: "#b89a6a", cover: "#7a4e32", quill: true }), 53, 50);
  // 门
  c.rect(3, 38, 15, 46, "#5e3b26").rect(4, 39, 13, 45, "#7a4e32").frame(6, 42, 9, 16, "#6a4330").frame(6, 62, 9, 18, "#6a4330").rect(14, 64, 2, 2, "#c9a24a");
  // 门边的红铜色邮筒
  c.rect(20, 46, 7, 10, "#a8653a").rect(21, 45, 5, 1, "#a8653a").rect(21, 47, 5, 8, "#b87340").rect(21, 49, 5, 1, "#5e3b26").rect(23, 56, 1, 8, "#5e3b26");
  // 椅子
  c.rect(23, 52, 3, 26, "#6e4630").rect(23, 72, 18, 3, "#8a5a3a").rect(24, 75, 2, 9, "#6e4630").rect(38, 75, 2, 9, "#6e4630");
  // 床：结实的厚木板床，焦糖色的厚被子
  c.rect(2, 101, 46, 7, "#6e4630").rect(2, 100, 46, 2, "#8a5a3a").rect(3, 108, 3, 4, "#5e3b26").rect(44, 108, 3, 4, "#5e3b26");
  c.rect(2, 88, 4, 13, "#7a4e32").rect(1, 87, 6, 2, "#6e4630");
  c.rect(6, 95, 42, 6, "#f0e6d4");
  c.rect(7, 91, 11, 5, "#f6eedf").hline(7, 95, 11, "#ddd0b9");
  c.rect(15, 93, 33, 8, "#c9773a").rect(18, 95, 9, 1, "#b06530").rect(31, 97, 10, 1, "#b06530").rect(15, 100, 33, 1, "#a65c2b").rect(38, 94, 6, 1, "#d98d4f");
  // 床底下：黄铜包边铁皮箱（黑匣子），一把很沉的复古锁
  c.rect(8, 108, 34, 3, "#5e3b26");
  c.sprite(lockedBox({ body: "#5d6670", band: "#c9a24a", lock: "#8d6a2a", lockHi: "#e2c06a" }), 22, 106);
  return c.g;
})();

// ---------- 会动的部分 ----------
const tick = ref(0);
let timer = 0;
const taFrame = computed(() => {
  const t = tick.value % 46;
  if (t === 5 || t === 30) return ROWAN_SIT[1];
  if (t >= 14 && t < 22) return ROWAN_SIT[2]; // 抬头看灯塔
  return ROWAN_SIT[0];
});
// 风灯
const lampOn = ref(false);
// 糖果罐冒出来的小爱心
const hearts = ref([]);
let heartId = 0;
// 卷轴上的新路线
const ROUTE = [[10, 28], [11, 27], [12, 27], [13, 26], [13, 25], [14, 24], [15, 24], [16, 23], [16, 22], [15, 21], [15, 20], [16, 19], [17, 18], [18, 18], [19, 17], [20, 17], [21, 16]];
const routeN = ref(0);
let routeTimer = 0;
// 信箱的小红旗
const flagUp = computed(() => props.mailLit);
// 灯塔的光：慢慢转
const beam = computed(() => (tick.value * 4) % 360);

onMounted(() => { timer = setInterval(() => tick.value++, 180); });
onBeforeUnmount(() => { clearInterval(timer); clearInterval(routeTimer); });

function tapLamp() {
  lampOn.value = !lampOn.value;
  sfx.whoosh();
  emit("say", lampOn.value ? "黄铜风灯里的火苗「呼」地亮起来，照亮了一小圈。" : "风灯的火苗收小了。");
}
function tapJar() {
  sfx.pop();
  const id = ++heartId;
  hearts.value.push({ id, x: 76 + Math.round(Math.random() * 2) });
  setTimeout(() => (hearts.value = hearts.value.filter(h => h.id !== id)), 1600);
  emit("say", "糖果罐咕噜咕噜，冒出一颗粉色的小爱心——是对你的牵挂。");
}
function tapScroll() {
  sfx.paper();
  clearInterval(routeTimer);
  routeN.value = 0;
  routeTimer = setInterval(() => { routeN.value++; if (routeN.value >= ROUTE.length + 1) clearInterval(routeTimer); }, 70);
  emit("say", "卷轴上浮现出一条弯弯曲曲的路线，最后打上一个红色的「×」——刚探明了一条新路。");
}
const tap = {
  ta: () => emit("open", "ta"),
  mailbox: () => emit("open", "mailbox"),
  notebook: () => emit("open", "notebook"),
  bed: () => emit("say", props.asleep ? `${props.name}正陷在焦糖色的厚被子里睡觉。` : "结实的厚木板床，焦糖色的厚被子，看着就想陷进去睡个好觉。"),
  plant: () => emit("say", "粗陶盆里的欧洲花楸（Rowan tree），绿叶间结着几颗红艳艳的小浆果。"),
  box: () => emit("say", "床底下的黄铜包边铁皮箱，挂着一把看起来很沉的锁。是 Rowan 的黑匣子。"),
  window: () => emit("say", "窗外是宁静的夜海，最远处的悬崖上，灯塔的光在慢慢旋转。"),
};
// 小爱心
const HEART = sprite([".h.h.", "hhhhh", "hhhhh", ".hhh.", "..h.."], { h: "#f48fb1" });
// 糖果罐（小）
const JAR = sprite([".ccc.", "g...g", "gpPpg", "gPpPg", "ggggg"], { c: "#d9b27a", g: "#cfdde6", p: "#f48fb1", P: "#f7b6cc" });
// 风灯
const LAMP = sprite(["..k..", ".kkk.", "k...k", "kfyfk", "kyFyk", "kfyfk", "kkkkk"], { k: "#b8873a", f: "#ffd166", y: "#f9a03f", F: "#fff1b8" });
const LAMP_OFF = sprite(["..k..", ".kkk.", "k...k", "k.d.k", "k.d.k", "k...k", "kkkkk"], { k: "#b8873a", d: "#7a5a2a" });
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="room" shape-rendering="crispEdges">
    <defs>
      <clipPath id="rowan-window"><rect x="45" y="8" width="44" height="35" /></clipPath>
      <radialGradient id="rowan-lamp"><stop offset="0" stop-color="#ffcf70" stop-opacity=".55" /><stop offset="1" stop-color="#ffcf70" stop-opacity="0" /></radialGradient>
    </defs>
    <PixelG :grid="base" />
    <!-- 灯塔的光 -->
    <g clip-path="url(#rowan-window)">
      <polygon :transform="`rotate(${beam} 84 10)`" points="84,10 30,4 30,16" fill="#ffe08a" opacity=".22" shape-rendering="geometricPrecision" />
    </g>
    <!-- 卷轴上的路线 -->
    <template v-if="routeN">
      <rect v-for="(p, i) in ROUTE.slice(0, routeN)" :key="i" :x="p[0]" :y="p[1]" width="1" height="1" :fill="i % 2 ? '#8a5a3a' : '#a0703f'" />
      <g v-if="routeN > ROUTE.length" fill="#d8433b"><rect x="20" y="14" width="1" height="1" /><rect x="22" y="14" width="1" height="1" /><rect x="21" y="15" width="1" height="1" /><rect x="20" y="16" width="1" height="1" /><rect x="22" y="16" width="1" height="1" /></g>
    </template>
    <!-- 窗台上的小糖果罐和冒出来的爱心 -->
    <PixelG :grid="JAR" :x="75" :y="40" />
    <g v-for="h in hearts" :key="h.id" class="heart"><PixelG :grid="HEART" :x="h.x" :y="34" /></g>
    <!-- 风灯 -->
    <circle v-if="lampOn" cx="87" cy="53" r="13" fill="url(#rowan-lamp)" shape-rendering="geometricPrecision" />
    <PixelG :grid="lampOn ? LAMP : LAMP_OFF" :x="85" :y="51" />
    <!-- 邮筒的小红旗 -->
    <g v-if="flagUp"><rect x="27" y="42" width="1" height="6" fill="#5e3b26" /><rect x="28" y="42" width="3" height="2" fill="#d8433b" class="wave" /></g>
    <!-- Rowan -->
    <PixelG v-if="!asleep" :grid="taFrame" :x="25" :y="52" />
    <template v-else>
      <PixelG :grid="ROWAN_SLEEP" :x="7" :y="88" />
      <text x="20" y="86" class="zzz">z</text><text x="24" y="82" class="zzz small">z</text>
    </template>

    <g class="hot">
      <rect x="45" y="8" width="20" height="26" @click="tap.window" />
      <rect x="68" y="8" width="21" height="26" @click="tap.window" />
      <rect x="45" y="34" width="11" height="12" @click="tap.plant" />
      <rect x="73" y="38" width="9" height="8" @click="tapJar" />
      <rect x="83" y="48" width="9" height="10" @click="tapLamp" />
      <rect x="52" y="49" width="14" height="9" @click="tap.notebook" />
      <rect x="6" y="9" width="20" height="26" @click="tapScroll" />
      <rect x="19" y="40" width="10" height="17" @click="tap.mailbox" />
      <rect x="20" y="104" width="18" height="10" @click="tap.box" />
      <rect x="2" y="88" width="46" height="14" @click="asleep ? tap.ta() : tap.bed()" />
      <rect v-if="!asleep" x="25" y="52" width="16" height="21" @click="tap.ta" />
    </g>
  </svg>
</template>

<style scoped>
.room { width: 100%; height: auto; display: block; image-rendering: pixelated; user-select: none; -webkit-tap-highlight-color: transparent; }
.hot rect { fill: transparent; cursor: pointer; }
.heart { animation: rise 1.6s ease-out forwards; }
@keyframes rise { 0% { transform: translateY(4px); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(-10px); opacity: 0; } }
.wave { animation: wave 1.2s ease-in-out infinite; transform-origin: 28px 42px; }
@keyframes wave { 0%, 100% { transform: scaleX(1); } 50% { transform: scaleX(.7); } }
.zzz { font-size: 5px; fill: #f0d9b0; font-family: monospace; animation: float 3s ease-in-out infinite; }
.zzz.small { font-size: 4px; animation-delay: 1s; }
@keyframes float { 0%, 100% { opacity: .2; transform: translateY(1px); } 50% { opacity: .9; transform: translateY(-1px); } }
</style>
