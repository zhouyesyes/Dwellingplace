<script setup>
// 一张信纸：上段 + 带横线的中段 + 下段；信长过一页，中段下面用干净的一行横线一行行往下续（不再整页重复）。
// 续的时候中段的下沿、下段的上沿都淡开，花边不会被一刀切断。字的行高正好等于横线间距，写在线上
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import "@fontsource/long-cang/400.css";

const props = defineProps({ paper: Object });
const u = n => `${(n / 6.4).toFixed(3)}cqw`; // 素材按 640 宽量的，换成纸宽的百分比
const g = computed(() => props.paper.g);
const style = computed(() => {
  const p = props.paper;
  return {
    "--ink": p.ink,
    "--line": u(g.value.line),
    backgroundImage: `url(${p.top}), url(${p.line})`,
    backgroundPosition: `0 0, 0 ${u(g.value.top)}`,
    backgroundSize: `100% auto, 100% ${u(g.value.line)}`,
    minHeight: u(g.value.h),
    padding: `${u(g.value.top)} ${u(g.value.w - g.value.rx)} ${u(g.value.bot)} ${u(g.value.lx)}`,
  };
});
const midStyle = computed(() => ({ backgroundImage: `url(${props.paper.mid})`, top: u(g.value.top), height: u(g.value.h - g.value.top - g.value.bot) }));
const botStyle = computed(() => ({ backgroundImage: `url(${props.paper.bot})`, height: u(g.value.bot) }));

// 比一页长了没有
const el = ref(null);
const long = ref(false);
let ro = null;
onMounted(() => {
  ro = new ResizeObserver(() => {
    const e = el.value;
    if (e) long.value = e.offsetHeight > (e.offsetWidth * g.value.h) / g.value.w + 4;
  });
  ro.observe(el.value);
});
onBeforeUnmount(() => ro?.disconnect());
</script>

<template>
  <div class="lp-wrap">
    <div ref="el" class="lp" :class="{ long }" :style="style">
      <i class="bg mid" :style="midStyle" />
      <i class="bg bot" :style="botStyle" />
      <slot />
    </div>
  </div>
</template>

<style scoped>
.lp-wrap { container-type: inline-size; width: 100%; }
.lp {
  position: relative; box-sizing: border-box; width: 100%;
  background-repeat: no-repeat, repeat-y;
  /* 信纸里是手写的龙藏体（页面别处都是全局字体） */
  color: var(--ink); font-family: "Long Cang", var(--font); font-weight: 400; letter-spacing: .02em;
  line-height: var(--line); font-size: calc(var(--line) * .62);
  box-shadow: 0 18px 44px rgba(40, 30, 20, .22);
}
.bg { position: absolute; left: 0; right: 0; background-size: 100% 100%; background-repeat: no-repeat; pointer-events: none; }
.bot { bottom: 0; }
.long .mid { -webkit-mask-image: linear-gradient(#000 78%, transparent); mask-image: linear-gradient(#000 78%, transparent); }
.long .bot { -webkit-mask-image: linear-gradient(transparent, #000 35%); mask-image: linear-gradient(transparent, #000 35%); }
/* 里面的东西都按「一行」排，才能一直压在横线上 */
.lp :deep(*) { line-height: var(--line); margin: 0; }
/* 字往下挪一点，像是压在横线上写的，而不是飘在两条线中间 */
.lp > :deep(:not(.bg)) { position: relative; top: calc(var(--line) * .16); }
</style>
