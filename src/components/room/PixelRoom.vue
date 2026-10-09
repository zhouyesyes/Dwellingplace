<script setup>
// 新的像素小屋：等距的一整间屋，放大 2 倍，左右拖着看。TA 会在屋里走来走去，点人、点东西都有反应
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { Scene } from "../../lib/pixelroom/scene.js";
import { W, H } from "../../lib/pixelroom/iso.js";
import { sfx } from "../../lib/sfx.js";

const props = defineProps({
  kind: { type: String, default: "cui" }, // cui | rowan
  name: { type: String, default: "TA" },
  asleep: Boolean,
  mood: { type: String, default: "" },
  mailLit: Boolean,
});
const emit = defineEmits(["say", "open", "tap-me", "doing"]);

const S = 2, TOP = 20; // 放大 2 倍；屋子上面空的那一条不要
const canvas = ref(null);
const scroller = ref(null);
const ready = ref(false);
let scene = null, timer = 0;

// 点东西：说一句话，或者开关一样东西
const TALK = {
  cui: {
    window: "推开半扇的木格窗，外面是傍晚的海，太阳快落进海里了，远处有一只小帆船。",
    chart: "手绘的海图，红线是她想去的航路。",
    note: "便签上歪歪扭扭写着「记得喝水」。",
    shells: "三格贝壳标本：扇贝、海螺、还有一只小扇贝，都是在海边捡的。",
    plant: "一大盆叶子很精神的绿植，浇水全靠想起来。",
    hat: "草帽挂在小凳的靠背上，帽檐有一圈红边。",
    cushion: "靛蓝色的坐垫，坐上去软软的。",
    kettle: "铁壶吊在地炉上，咕嘟咕嘟地冒着热气。",
    cabinet: "矮柜上放着老收音机、赭色陶罐，还有一个盖子歪着的腌菜坛。",
    bag: "暖暖的粮袋，袋子上印着一束谷穗，口子没扎紧，撒出来几粒小米。",
    deck: "抬高一格的木地台，上面铺着暖暖的格子毯。",
    sill: "宽宽的窗台，坐在上面刚好看海。",
    jars: "四个许愿瓶：沙子、碎贝壳、干花瓣、海盐。",
    pothos: "窗台上的绿萝，藤一路垂下来。",
    bed: n => `矮矮的床，被子乱乱的，上面扣着一本看到一半的书。`,
    table: "矮桌上一壶茶、半杯没喝完的茶，还有摊开的本子。",
    net: "一团渔网堆在地台边，几个橙色的浮子露在外面。",
    nest: "暖暖的草窝，里面铺着软布，旁边一碟小米、一碟水。",
    geta: "一双木屐，一只正一只歪。",
    blackbox: n => `床尾的深木小箱子，铜包角、铜锁。这是 ${n} 自己的黑匣子。`,
  },
  rowan: {
    window: "横着的观星窗，外面是夜海和月亮，远处的灯塔一闪一闪。",
    starchart: "一大张星图，几颗星星用金线连成了星座。",
    manuscripts: "一排用夹子夹着的手稿，其中一张画着一艘船。",
    board: "软木告示板，钉着几张纸条。",
    compass: "开着盖的黄铜罗盘，指针稳稳地指着北边。",
    sill: "深深的窗台，放着罗盘和一只杯子。",
    daybed: "塞在窗下墙角的观星榻台，躺着就能看到星星。",
    desk: "贴着墙的书桌，上面一层架子放着常翻的书。",
    notebook: "摊开的本子，写到一半的航海日志，字很工整。",
    chair: "书桌前的椅子，拉出来一点。",
    bookshelf: "书架没放满，有常翻的几本、一个罗盘盒、还有半杯没喝完的。",
    map: "摊在地上的海图，红色的虚线是一条航线。",
    papers: "地上散着几张报纸。",
    telescope: "架在三脚架上的黄铜望远镜，镜筒对着窗外。",
    food: "一排吃的：面包、果酱、罐头、一碗苹果，墙上还有一排玻璃罐。",
    plant: "窗前一盆叶子大大的植物。",
    rug: "暗蓝色的地毯，上面绣着星星和一条航线。",
    blackbox: n => `榻台边的黄铜包边铁皮箱，挂着一把看起来很沉的锁。是 ${n} 的黑匣子。`,
  },
};

// 气泡上的小标题
const TITLE = {
  window: "窗", chart: "海图", note: "便签", shells: "贝壳标本", plant: "绿植", hat: "草帽", cushion: "坐垫", kettle: "铁壶", cabinet: "矮柜", bag: "暖暖的粮袋",
  deck: "地台", sill: "窗台", jars: "许愿瓶", pothos: "绿萝", bed: "床", table: "矮桌", net: "渔网", nest: "暖暖的窝", geta: "木屐", blackbox: "黑匣子",
  starchart: "星图", manuscripts: "手稿", board: "告示板", compass: "罗盘", daybed: "观星榻台", desk: "书桌", notebook: "本子", chair: "椅子", bookshelf: "书架",
  map: "海图", papers: "报纸", telescope: "望远镜", food: "吃的柜子", rug: "地毯", mailbox: "信箱", door: "门", fire: "地炉", lamp: "台灯", pet: "暖暖",
};
const say = (what, text, action) => emit("say", { title: TITLE[what] || "", text, action });
function tap(e) {
  if (!scene) return;
  const r = canvas.value.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
  let what = scene.hit(x, y);
  if (!what) return;
  if ((what === "bed" || what === "daybed") && scene.state.bed) what = "me"; // 躺在床上时点床就是点 TA
  if (what === "me") { scene.tapMe(performance.now()); emit("tap-me", scene.doing()); return; }
  if (what === "pet") { say("pet", props.asleep ? "暖暖缩在被子边上，睡得圆滚滚的。" : "暖暖抬起头，「啾」了一声。"); sfx.chirp(); return; }
  if (what === "mailbox") { sfx.paper(); return say("mailbox", props.mailLit ? `小旗竖着呢，有 ${props.name} 写给你的信。「打开邮箱」是 ${props.name} 自己的邮箱和笔友；「书信」是你们俩的信。` : `${props.name} 的信箱。「打开邮箱」看 TA 的笔友来信；「书信」是你们俩的信。`, "mailbox"); }
  if (what === "blackbox") return say("blackbox", TALK[props.kind].blackbox(props.name), "blackbox");
  if (what === "door") return toggle("door", on => (on ? "门推开了，走廊的光漏进来一条。" : "门关上了，屋里安静下来。"));
  if (what === "fire" || (what === "kettle" && props.kind === "cui")) return toggle("fire", on => (on ? "往地炉里添了根柴，火又旺起来了。" : "把地炉的火压小了，只剩一点暗红的炭。"));
  if (what === "lamp") return toggle("lamp", on => (on ? "台灯「咔哒」亮了，桌上暖暖的一圈。" : "台灯关了，只剩月光照在桌上。"));
  const t = TALK[props.kind][what];
  if (t) say(what, typeof t === "function" ? t(props.name) : t);
}
function toggle(key, text) {
  const on = scene.state[key] === false;
  (key === "door" ? sfx.creak : sfx.pop)();
  say(key, text(on));
  setTimeout(() => { scene.set({ [key]: on }); emit("doing", scene.doing()); }, 0); // 重画底图要一小会儿，先让字出来
}

function loop() {
  scene?.tick(performance.now());
  timer = setTimeout(() => requestAnimationFrame(loop), 90);
}
function start() {
  stop();
  scene = new Scene(props.kind, canvas.value, { onDoing: t => emit("doing", t) });
  canvas.value.__scene = scene; // 方便调试
  scene.state.mail = props.mailLit;
  scene.setMind({ mood: props.mood, asleep: props.asleep });
  ready.value = false;
  setTimeout(() => {
    scene.render();
    ready.value = true;
    emit("doing", scene.doing());
    loop();
    nextTick(center);
  }, 30);
}
function stop() { clearTimeout(timer); timer = 0; }
function center() { // 默认停在中间
  const el = scroller.value;
  if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
}
function onVis() { if (document.hidden) stop(); else if (scene && !timer) loop(); }

onMounted(() => { start(); document.addEventListener("visibilitychange", onVis); });
onBeforeUnmount(() => { stop(); document.removeEventListener("visibilitychange", onVis); });
watch(() => props.kind, start);
watch(() => [props.mood, props.asleep], () => scene?.setMind({ mood: props.mood, asleep: props.asleep }));
watch(() => props.mailLit, v => scene?.set({ mail: v }));
</script>

<template>
  <div ref="scroller" class="scroller" :class="kind">
    <canvas ref="canvas" :width="W" :height="H" class="room" :style="{ width: W * S + 'px', height: H * S + 'px', marginTop: -TOP * S + 'px' }" @click="tap" />
    <p v-if="!ready" class="loading">小屋在亮灯…</p>
  </div>
</template>

<style scoped>
.scroller { position: relative; overflow-x: auto; overflow-y: hidden; height: 580px; max-height: 72vh; -webkit-overflow-scrolling: touch; scrollbar-width: none; overscroll-behavior-x: contain; }
.scroller::-webkit-scrollbar { display: none; }
.scroller.cui { background: #4a3d35; }
.scroller.rowan { background: #141a22; }
.room { display: block; image-rendering: pixelated; image-rendering: crisp-edges; }
.loading { position: absolute; inset: 0; margin: auto; height: 1.5em; text-align: center; color: #ffffff99; font-size: 0.85rem; }
</style>
