<script setup>
// 播一个像素动作：帧条（public/pet/<动作>.png）按每帧的时长一格一格往后挪；once 的播完告诉外面
import { ref, watch, computed, onBeforeUnmount } from "vue";
import { PET_FRAMES, PET_W, PET_H } from "../../lib/petFrames.js";

const props = defineProps({ state: { type: String, default: "idle" }, scale: { type: Number, default: 3 } });
const emit = defineEmits(["done"]);
const BASE = import.meta.env.BASE_URL;
// 先把所有帧条都加载好，换动作时不闪
for (const k of Object.keys(PET_FRAMES)) { const im = new Image(); im.src = `${BASE}pet/${k}.png`; }

const i = ref(0);
let timer = null;
const frames = computed(() => PET_FRAMES[props.state] || PET_FRAMES.idle);
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
  const s = props.scale, n = frames.value.durs.length;
  return {
    width: `${PET_W * s}px`, height: `${PET_H * s}px`,
    backgroundImage: `url(${BASE}pet/${PET_FRAMES[props.state] ? props.state : "idle"}.png)`,
    backgroundSize: `${PET_W * s * n}px ${PET_H * s}px`,
    backgroundPosition: `${-i.value * PET_W * s}px 0`,
  };
});
</script>

<template>
  <div class="pixel-pet" :style="style" />
</template>

<style scoped>
.pixel-pet { image-rendering: pixelated; image-rendering: crisp-edges; background-repeat: no-repeat; }
</style>
