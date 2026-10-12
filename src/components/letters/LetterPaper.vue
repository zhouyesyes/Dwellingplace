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
  const side = p.side ? [`url(${p.side})`, `0 ${u(g.value.top)}`, `100% ${u(p.sideH)}`] : null;
  return {
    "--ink": p.ink,
    "--line": u(g.value.line),
    backgroundImage: [`url(${p.top})`, side?.[0], `url(${p.line})`].filter(Boolean).join(", "),
    backgroundPosition: [`0 0`, side?.[1], `0 ${u(g.value.top)}`].filter(Boolean).join(", "),
    backgroundSize: [`100% auto`, side?.[2], `100% ${u(g.value.line)}`].filter(Boolean).join(", "),
    backgroundRepeat: side ? "no-repeat, repeat-y, repeat-y" : "no-repeat, repeat-y",
    minHeight: u(g.value.h),
    padding: `${u(g.value.top)} ${u(g.value.w - g.value.rx)} ${u(g.value.bot)} ${u(g.value.lx)}`,
  };
});
// 信长过一页时，中段的下沿、下段的上沿要和续上的横线接起来：
// 写字的那一块在横线之间一刀切开（不然两套横线叠在一起，一条变两条），只有两边的花边慢慢淡开
const svgMask = (h, cut, fade) => {
  const { lx, rx, w } = g.value;
  const a = Math.max(lx - 8, 0), b = Math.min(rx + 8, w);
  const [[o0, a0], [o1, a1]] = fade; // 花边的淡开：[位置 0~1, 不透明度] 两个点
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">` +
    `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="${o0}" stop-color="#fff" stop-opacity="${a0}"/><stop offset="${o1}" stop-color="#fff" stop-opacity="${a1}"/></linearGradient></defs>` +
    `<rect x="${a}" y="${cut[0]}" width="${b - a}" height="${cut[1] - cut[0]}" fill="#fff"/>` +
    `<rect x="0" y="0" width="${a}" height="${h}" fill="url(#f)"/><rect x="${b}" y="0" width="${w - b}" height="${h}" fill="url(#f)"/></svg>`;
  const m = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return { WebkitMaskImage: m, maskImage: m, WebkitMaskSize: "100% 100%", maskSize: "100% 100%" };
};
const midStyle = computed(() => {
  const { top, h, bot, line } = g.value;
  const mh = h - top - bot;
  const cut = (Math.floor((mh * 0.78) / line) + 0.5) * line;
  return { backgroundImage: `url(${props.paper.mid})`, top: u(top), height: u(mh), ...(long.value ? svgMask(mh, [0, cut], [[0.78, 1], [1, 0]]) : {}) };
});
const botStyle = computed(() => {
  const { bot } = g.value;
  return { backgroundImage: `url(${props.paper.bot})`, height: u(bot), ...(long.value ? svgMask(bot, [0, bot], [[0, 0], [0.35, 1]]) : {}) };
});

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
  /* 信纸里是手写的龙藏体（页面别处都是全局字体） */
  color: var(--ink); font-family: "Long Cang", var(--font); font-weight: 400; letter-spacing: .02em;
  line-height: var(--line); font-size: calc(var(--line) * .62);
  box-shadow: 0 18px 44px rgba(40, 30, 20, .22);
}
.bg { position: absolute; left: 0; right: 0; background-size: 100% 100%; background-repeat: no-repeat; pointer-events: none; }
.bot { bottom: 0; }
/* 里面的东西都按「一行」排，才能一直压在横线上 */
.lp :deep(*) { line-height: var(--line); margin: 0; }
/* 字往下挪一点，像是压在横线上写的，而不是飘在两条线中间 */
.lp > :deep(:not(.bg)) { position: relative; top: calc(var(--line) * .16); }
</style>
