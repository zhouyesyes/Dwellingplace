<script setup>
// 站在一个东西上面的小章鱼 / 小螃蟹（放在那个东西里面，绝对定位贴着它的上沿）。决定现在做哪个动作：
//   水温（今天选了漂流瓶 / 夜潮 / 退潮 / 晴水 / 下雨）排在待机、困了、等待前面，其他动作都比它优先
//   夜潮、退潮一直缩着 / 趴着；晴水、漂流瓶、下雨平时是普通待机，隔 20 到 40 秒才露一下水温，几秒后回去
//   报错 ＞ 一次性的小反应（开心、害羞、做成了、收到信、泡泡）＞ 半夜催睡觉 ＞ 用工具 ＞ 四条敲 ＞ 两条敲 ＞ 在想 ＞ 共读 / 共写 ＞ 困了 / 等待 ＞ 待机（偶尔走两步、吐泡泡）
// kind="crab"：小螃蟹（cc），和小章鱼一样站在右边，动作和触发条件一模一样（只是画成螃蟹的样子）
// work：外面告诉它正在干什么（think / type2 / type4 / tool / error）；base：在共读、共写里（read / write）；roam：能不能左右走
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { pet, petOnce } from "../../lib/pet.js";
import { PET_W, PET_H, PET_FEET } from "../../lib/petFrames.js";
import { moodOf } from "../../lib/meanwhile.js";
import { todayYmd } from "../../lib/dates.js";
import { MAIN, CRAB } from "../../store/index.js";
import PixelPet from "./PixelPet.vue";

const props = defineProps({ work: { type: String, default: null }, base: { type: String, default: null }, roam: { type: Boolean, default: true }, scale: { type: Number, default: 3 }, kind: { type: String, default: "octopus" } });
const crab = props.kind === "crab";
const root = ref(null);
const now = ref(Date.now());
let clock = null, wander = null;

// 跟自己今天的水温变：漂流瓶抱小瓶子、夜潮打盹、退潮趴着、晴水晃手、下雨头顶小云；其他水温和没选，就是普通待机
const MOOD_STATE = { bottle: "m-bottle", night: "m-night", ebb: "m-ebb", sunny: "m-sunny", rain: "m-rain" };
const moodKey = computed(() => { void now.value; return moodOf(crab ? CRAB : MAIN, todayYmd())?.key || null; });
const STEADY = ["night", "ebb"]; // 这两种一直保持，不走动
const peek = ref(false); // 偶尔露一下水温的那几秒
const moodState = computed(() => {
  const k = moodKey.value;
  if (!MOOD_STATE[k]) return null;
  return STEADY.includes(k) || peek.value ? MOOD_STATE[k] : null;
});
const steady = computed(() => STEADY.includes(moodKey.value));
let peekT = null, peekEnd = null;
function schedulePeek() {
  clearTimeout(peekT);
  peekT = setTimeout(() => {
    if (MOOD_STATE[moodKey.value] && !steady.value) {
      peek.value = true;
      clearTimeout(peekEnd);
      peekEnd = setTimeout(() => (peek.value = false), 4000 + Math.random() * 2000);
    }
    schedulePeek();
  }, 20_000 + Math.random() * 20_000);
}

// 一次性的小反应：播一次就回去
const once = ref(null);
watch(() => pet.at, () => { if (pet.once) once.value = pet.once; });
const done = () => { once.value = null; };

// 很久没动静：缩成一团 / 困了；半夜还在聊：举牌子
const idleMs = computed(() => now.value - pet.lastActive);
const night = computed(() => { const h = new Date(now.value).getHours(); return h >= 23 || h < 6; });
const bedtime = computed(() => { const h = new Date(now.value).getHours(); return h >= 1 && h < 5 && idleMs.value < 10 * 60_000 && now.value > pet.bedtimeOff; });

// 左右走：平时多待在右边（x = 0 是最右，往左是负的）
const x = ref(0);
const walking = ref(false);
const walkMs = ref(0);
function maxLeft() {
  const w = root.value?.parentElement?.clientWidth || 300;
  return Math.max(0, w - PET_W * props.scale - 20);
}
function stroll() {
  if (!props.roam || props.work || props.base || once.value || steady.value || peek.value || idleMs.value > 3 * 60_000) return;
  const r = Math.random();
  if (r < 0.15) return petOnce("bubble");
  const target = x.value < -10 && r < 0.75 ? 0 : -Math.round(Math.random() * Math.min(maxLeft(), 180)); // 走出去一点，大多还会走回右边
  const dist = Math.abs(target - x.value);
  if (dist < 12) return;
  walkMs.value = Math.round(dist * 28);
  walking.value = true;
  x.value = target;
  setTimeout(() => (walking.value = false), walkMs.value);
}
// 开始干活了：走回右边
watch(() => props.work, w => { if (w && x.value !== 0) { walkMs.value = 400; x.value = 0; } });

// 用工具：至少让人看清 1 秒。工具 1 秒内就做完了，也接着指着终端到满 1 秒；超过 1 秒就一直指到做完。
// 做完（没出错）再小小地开心 0.45 秒，然后回到敲键盘或待机。只是动画自己计时，消息该出来就出来，不等它
const toolHold = ref(false);
const toolOk = ref(false);
let toolT0 = 0, holdTimer = null, okTimer = null;
watch(() => props.work, (w, old) => {
  if (w === "tool") {
    if (!toolHold.value) toolT0 = Date.now();
    toolHold.value = true;
    clearTimeout(holdTimer);
    return;
  }
  if (old !== "tool" && !toolHold.value) return;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    toolHold.value = false;
    if (w === "error") return;
    toolOk.value = true;
    clearTimeout(okTimer);
    okTimer = setTimeout(() => (toolOk.value = false), 450);
  }, Math.max(0, 1000 - (Date.now() - toolT0)));
});

const state = computed(() => {
  if (props.work === "error") return "error";
  if (once.value) return once.value;
  if (toolHold.value) return "tool";
  if (toolOk.value) return "success";
  if (bedtime.value && !props.work) return "bedtime";
  if (props.work) return props.work;
  if (walking.value) return "walk";
  if (props.base) return props.base;
  if (moodState.value) return moodState.value;
  if (idleMs.value > 30 * 60_000 || (night.value && idleMs.value > 5 * 60_000)) return "sleepy";
  if (idleMs.value > 3 * 60_000) return "wait";
  return "idle";
});

// 点一下：开心或者吐个泡泡；举着牌子时点一下就放下（一小时内不再举）
function tap() {
  if (state.value === "bedtime") { pet.bedtimeOff = Date.now() + 3600_000; return; }
  if (props.work) return;
  petOnce(Math.random() < 0.6 ? "happy" : "bubble");
}

onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 5000);
  wander = setInterval(stroll, 9000 + Math.random() * 6000);
  schedulePeek();
});
onBeforeUnmount(() => { clearInterval(clock); clearInterval(wander); clearTimeout(holdTimer); clearTimeout(okTimer); clearTimeout(peekT); clearTimeout(peekEnd); });

const style = computed(() => ({
  right: "14px",
  bottom: `calc(100% - ${(PET_H - PET_FEET) * props.scale}px)`,
  transform: `translateX(${x.value}px)`,
  transition: `transform ${walkMs.value}ms linear`,
}));
</script>

<template>
  <div ref="root" class="pet-dock" :style="style">
    <PixelPet :kind="kind" :state="state" :scale="scale" @done="done" />
    <!-- 只有身体那一块点得到，旁边透明的地方不挡着聊天 -->
    <i class="hit" :style="{ left: 12 * scale + 'px', width: 19 * scale + 'px', height: PET_FEET * scale + 'px' }" @click.stop="tap" />
  </div>
</template>

<style scoped>
.pet-dock { position: absolute; z-index: 2; pointer-events: none; user-select: none; -webkit-user-select: none; }
.hit { position: absolute; top: 0; pointer-events: auto; cursor: pointer; -webkit-tap-highlight-color: transparent; }
</style>
