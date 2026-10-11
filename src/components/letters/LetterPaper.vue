<script setup>
// 一张信纸：上段 + 带横线的中段（信长了就一页页往下接）+ 下段。字的行高正好等于横线间距，写在线上
import { computed } from "vue";
import "@fontsource/long-cang/400.css";

const props = defineProps({ paper: Object });
const u = n => `${(n / 6.4).toFixed(3)}cqw`; // 素材按 640 宽量的，换成纸宽的百分比
const style = computed(() => {
  const p = props.paper, g = p.g;
  return {
    "--ink": p.ink,
    "--line": u(g.line),
    backgroundImage: `url(${p.top}), url(${p.bot}), url(${p.mid})`,
    backgroundPosition: `0 0, 0 100%, 0 ${u(g.top)}`,
    minHeight: u(g.h),
    padding: `${u(g.top)} ${u(g.w - g.rx)} ${u(g.bot)} ${u(g.lx)}`,
  };
});
</script>

<template>
  <div class="lp-wrap">
    <div class="lp" :style="style"><slot /></div>
  </div>
</template>

<style scoped>
.lp-wrap { container-type: inline-size; width: 100%; }
.lp {
  box-sizing: border-box; width: 100%;
  background-repeat: no-repeat, no-repeat, repeat-y;
  background-size: 100% auto, 100% auto, 100% auto;
  color: var(--ink); font-family: "Long Cang", cursive;
  line-height: var(--line); font-size: calc(var(--line) * .62);
  box-shadow: 0 18px 44px rgba(40, 30, 20, .22);
}
/* 里面的东西都按「一行」排，才能一直压在横线上 */
.lp :deep(*) { line-height: var(--line); margin: 0; }
</style>
