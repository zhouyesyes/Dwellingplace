<script setup>
// 站在一个东西上面的小章鱼（放在那个东西里面，绝对定位贴着它的上沿）。决定现在做哪个动作：
//   报错 ＞ 一次性的小反应（开心、害羞、做成了、收到信、泡泡）＞ 半夜催睡觉 ＞ 用工具 ＞ 四条敲 ＞ 两条敲 ＞ 在想 ＞ 共读 / 共写 ＞ 困了 / 等待 ＞ 待机（偶尔走两步、吐泡泡）
// work：外面告诉它正在干什么（think / type2 / type4 / tool / error）；base：在共读、共写里（read / write）；roam：能不能左右走
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { pet, petOnce } from "../../lib/pet.js";
import { PET_W, PET_H, PET_FEET } from "../../lib/petFrames.js";
import PixelPet from "./PixelPet.vue";

const props = defineProps({ work: { type: String, default: null }, base: { type: String, default: null }, roam: { type: Boolean, default: true }, scale: { type: Number, default: 3 } });
const root = ref(null);
const now = ref(Date.now());
let clock = null, wander = null;

// 一次性的小反应：播一次就回去
const once = ref(null);
watch(() => pet.at, () => { if (pet.once) once.value = pet.once; });
const done = () => (once.value = null);

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
  if (!props.roam || props.work || props.base || once.value || idleMs.value > 3 * 60_000) return;
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

const state = computed(() => {
  if (props.work === "error") return "error";
  if (once.value) return once.value;
  if (bedtime.value && !props.work) return "bedtime";
  if (props.work) return props.work;
  if (walking.value) return "walk";
  if (props.base) return props.base;
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
});
onBeforeUnmount(() => { clearInterval(clock); clearInterval(wander); });

const style = computed(() => ({
  right: "14px",
  bottom: `calc(100% - ${(PET_H - PET_FEET) * props.scale}px)`,
  transform: `translateX(${x.value}px)`,
  transition: `transform ${walkMs.value}ms linear`,
}));
</script>

<template>
  <div ref="root" class="pet-dock" :style="style">
    <PixelPet :state="state" :scale="scale" @done="done" />
    <!-- 只有身体那一块点得到，旁边透明的地方不挡着聊天 -->
    <i class="hit" :style="{ left: 12 * scale + 'px', width: 19 * scale + 'px', height: PET_FEET * scale + 'px' }" @click.stop="tap" />
  </div>
</template>

<style scoped>
.pet-dock { position: absolute; z-index: 2; pointer-events: none; user-select: none; -webkit-user-select: none; }
.hit { position: absolute; top: 0; pointer-events: auto; cursor: pointer; -webkit-tap-highlight-color: transparent; }
</style>
