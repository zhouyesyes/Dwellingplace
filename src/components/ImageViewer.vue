<script setup>
// 看图：全屏，左右滑动切换，上面显示「第几张 / 一共几张」
import { ref, watch, nextTick, defineComponent, h } from "vue";
import { useImage } from "../lib/images.js";
import Icon from "./Icon.vue";

const props = defineProps({
  images: { type: Array, default: () => [] }, // 图片 id
  start: { type: Number, default: 0 },
  open: Boolean,
});
const emit = defineEmits(["close", "more"]);

const track = ref(null);
const index = ref(0);
watch(() => props.open, async v => {
  if (!v) return;
  index.value = props.start;
  await nextTick();
  if (track.value) track.value.scrollLeft = props.start * track.value.clientWidth;
});
const onScroll = () => { const el = track.value; if (el) index.value = Math.round(el.scrollLeft / el.clientWidth); };
const go = d => track.value?.scrollTo({ left: (index.value + d) * track.value.clientWidth, behavior: "smooth" });

// 一张图：自己去取图片地址
const Slide = defineComponent({
  props: { id: String },
  setup(p) {
    const url = useImage(() => p.id);
    return () => h("div", { class: "slide" }, url.value ? h("img", { src: url.value, alt: "" }) : h("span", { class: "loading" }));
  },
});
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="viewer" @click.self="emit('close')">
        <header>
          <span class="count">{{ images.length > 1 ? `${index + 1} / ${images.length}` : "" }}</span>
          <button class="ic" aria-label="更多操作" @click="emit('more')"><Icon name="more" :size="22" /></button>
          <button class="ic" aria-label="关闭" @click="emit('close')"><Icon name="close" :size="22" /></button>
        </header>
        <div ref="track" class="track" @scroll.passive="onScroll">
          <Slide v-for="(id, i) in images" :key="i" :id="id" @click.self="emit('close')" />
        </div>
        <button v-if="index > 0" class="nav l" aria-label="上一张" @click="go(-1)">‹</button>
        <button v-if="index < images.length - 1" class="nav r" aria-label="下一张" @click="go(1)">›</button>
        <div v-if="images.length > 1" class="dots"><i v-for="(_, i) in images" :key="i" :class="{ on: i === index }" /></div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.viewer { position: fixed; inset: 0; z-index: 80; background: #111114; display: flex; flex-direction: column; }
header { display: flex; align-items: center; gap: 6px; padding: calc(var(--safe-top) + 10px) 12px 6px; color: #fff; }
.count { flex: 1; font-size: 0.95rem; padding-left: 8px; font-variant-numeric: tabular-nums; }
.ic { width: 42px; height: 42px; border: 0; border-radius: 50%; background: rgba(255, 255, 255, .12); color: #fff; display: grid; place-items: center; }
.track { flex: 1; display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; overscroll-behavior-x: contain; }
.track::-webkit-scrollbar { display: none; }
.track :deep(.slide) { flex: 0 0 100%; scroll-snap-align: center; scroll-snap-stop: always; display: grid; place-items: center; padding: 8px 10px; }
.track :deep(.slide img) { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; }
.track :deep(.loading) { width: 40px; height: 40px; border-radius: 50%; border: 3px solid #fff3; border-top-color: #fff; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.nav { position: absolute; top: 50%; transform: translateY(-50%); width: 40px; height: 64px; border: 0; background: rgba(255, 255, 255, .08); color: #fff; font-size: 2rem; border-radius: 12px; }
.nav.l { left: 6px; }
.nav.r { right: 6px; }
.dots { display: flex; justify-content: center; gap: 6px; padding: 10px 0 calc(var(--safe-bottom) + 16px); }
.dots i { width: 6px; height: 6px; border-radius: 50%; background: #fff4; }
.dots i.on { background: #fff; }
.fade-enter-active, .fade-leave-active { transition: opacity .18s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
@media (hover: none) { .nav { display: none; } }
</style>
