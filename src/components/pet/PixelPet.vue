<script setup>
// 播一个像素动作：帧条（public/pet/<动作>.png）按每帧的时长一格一格往后挪；once 的播完告诉外面
import { ref, reactive, watch, computed, onBeforeUnmount } from "vue";
import { PET_FRAMES, PET_W, PET_H } from "../../lib/petFrames.js";
import { CRAB_FRAMES, CRAB_VER } from "../../lib/crabFrames.js";
import { PET_MOOD_FRAMES } from "../../lib/petMoodFrames.js";

const props = defineProps({ state: { type: String, default: "idle" }, scale: { type: Number, default: 3 }, kind: { type: String, default: "octopus" } }); // kind：octopus 小章鱼 / crab 小螃蟹
const emit = defineEmits(["done"]);
const BASE = import.meta.env.BASE_URL;
// 先把所有帧条都加载好，换动作时不闪
const FRAMES = props.kind === "crab" ? CRAB_FRAMES : { ...PET_FRAMES, ...PET_MOOD_FRAMES }; // 小章鱼：原来的动作 + 跟水温变的几个（m-*）
const DIR = props.kind === "crab" ? "pet/crab/" : "pet/";
const VER = props.kind === "crab" ? `?v=${CRAB_VER}` : ""; // 小螃蟹重画过好几次、文件名没变：带上版本号，手机里的旧图就不会被拿来用
const url = k => `${BASE}${DIR}${k}.png${VER}`;
// 每条图实际有几格（按图片宽度算）：万一拿到的图和这里记的格数对不上，也按图来切，不会一格里挤两只
const cells = reactive({});
for (const k of Object.keys(FRAMES)) { const im = new Image(); im.onload = () => { cells[k] = Math.max(1, Math.round(im.naturalWidth / PET_W)); }; im.src = url(k); }

const i = ref(0);
let timer = null;
const frames = computed(() => FRAMES[props.state] || FRAMES.idle);
function tick() {
  clearTimeout(timer);
  const f = frames.value;
  timer = setTimeout(() => {
    if (i.value + 1 < f.durs.length) i.value++;
    else if (f.once) return emit("done");
    else i.value = 0;
    tick();
  }, f.durs[i.value] || 300);
}
watch(() => props.state, () => { i.value = 0; tick(); }, { immediate: true });
onBeforeUnmount(() => clearTimeout(timer));
const style = computed(() => {
  const s = props.scale, k = FRAMES[props.state] ? props.state : "idle";
  const n = cells[k] || frames.value.durs.length;
  return {
    width: `${PET_W * s}px`, height: `${PET_H * s}px`,
    backgroundImage: `url(${url(k)})`,
    backgroundSize: `${PET_W * s * n}px ${PET_H * s}px`,
    backgroundPosition: `${-(i.value % n) * PET_W * s}px 0`,
  };
});
</script>

<template>
  <div class="pixel-pet" :style="style" />
</template>

<style scoped>
.pixel-pet { image-rendering: pixelated; image-rendering: crisp-edges; background-repeat: no-repeat; }
</style>
