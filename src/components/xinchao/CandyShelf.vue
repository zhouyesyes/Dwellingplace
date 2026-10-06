<script setup>
// 窗台上的一排像素糖罐：每股驱力一个罐子，糖越多越强。可以左右滑，点罐子看它最近的动静
import { computed } from "vue";
import { jarGrid, STRONG_AT, RIBBONS, leavesGrid } from "../../lib/pixel.js";
import PixelArt from "../PixelArt.vue";

const props = defineProps({ drives: { type: Array, default: () => [] }, selected: String, asleep: Boolean });
const emit = defineEmits(["select"]);

// 窗外的天色跟着时间走
// 清晨 5–8 点、白天、夕阳 17–19 点半、夜里（TA 睡着了也是夜里）
const now = new Date();
const hm = now.getHours() + now.getMinutes() / 60;
const sky = props.asleep || hm < 5 || hm >= 19.5 ? "night" : hm < 8 ? "dawn" : hm >= 17 ? "dusk" : "day";
const low = sky === "dawn" || sky === "dusk"; // 太阳贴着地平线

const blank = (w, h) => Array.from({ length: h }, () => Array(w).fill(null));
function disc(r, color, cut) {
  const s = r * 2;
  const g = blank(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const inside = Math.hypot(x + 0.5 - r, y + 0.5 - r) <= r - 0.2;
    const bitten = cut && Math.hypot(x + 0.5 - r - cut, y + 0.5 - r + cut * 0.6) <= r - 0.6;
    if (inside && !bitten) g[y][x] = color;
  }
  return g;
}
const sun = disc(low ? 7 : 5, sky === "dusk" ? "#f59a6b" : sky === "dawn" ? "#ffd9a0" : "#ffd36e");
const moon = disc(5, "#fdf1c7", 3);
const cloud = (() => {
  const rows = ["....oooo......", "..oooooooo.oo.", ".oooooooooooooo", "oooooooooooooo", ".oooooooooooo."];
  const color = sky === "dusk" ? "#fbd3c6" : sky === "dawn" ? "#fde8ef" : "#ffffff";
  return rows.map(r => [...r].map(c => (c === "o" ? color : null)));
})();

// 糖多的排前面
// 每个罐子系的东西固定跟着驱力走，不会因为排序换来换去
const ribbonOf = key => RIBBONS[[...String(key)].reduce((a, c) => a + c.charCodeAt(0), 0) % RIBBONS.length];
const jars = computed(() => [...props.drives].sort((a, b) => b.value - a.value).map(d => ({ ...d, grid: jarGrid(d.value, ribbonOf(d.key)), strong: d.value >= STRONG_AT })));
const leaves = leavesGrid(sky === "night");
</script>

<template>
  <div class="scene" :class="'sky-' + sky">
    <!-- 窗户 -->
    <div class="window">
      <div class="pane">
        <PixelArt v-if="sky !== 'night'" :grid="sun" :size="low ? 46 : 34" class="sun" :class="{ low }" />
        <template v-else>
          <PixelArt :grid="moon" :size="30" class="moon" />
          <i v-for="n in 7" :key="n" class="star" :style="{ left: (n * 13 + (n % 3) * 5) % 92 + '%', top: (n * 17) % 60 + 8 + '%' }"></i>
        </template>
        <PixelArt v-if="sky !== 'night'" :grid="cloud" :size="56" class="cloud c1" />
        <PixelArt v-if="sky !== 'night'" :grid="cloud" :size="40" class="cloud c2" />
        <i v-if="sky === 'dawn'" class="mist"></i>
        <PixelArt :grid="leaves" :size="120" class="leaves" />
      </div>
      <div class="mullion v"></div>
      <div class="mullion h"></div>
    </div>
    <!-- 窗台和罐子 -->
    <div class="jars">
      <button v-for="j in jars" :key="j.key" class="jar" :class="{ on: selected === j.key }" @click="emit('select', j)">
        <PixelArt :grid="j.grid" :size="40" />
        <span class="name" :class="{ strong: j.strong }">{{ j.short || j.label }}</span>
      </button>
    </div>
    <div class="sill"><i class="dapple d1"></i><i class="dapple d2"></i><i class="dapple d3"></i></div>
  </div>
</template>

<style scoped>
.scene { position: relative; height: 178px; margin: 0 -18px; overflow: hidden; }
.scene::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 30px; background: linear-gradient(to bottom, rgba(255, 255, 255, 0), var(--card)); pointer-events: none; }
.window { position: absolute; left: 22px; right: 22px; top: 6px; height: 120px; border: 8px solid #f3ebe1; border-bottom-width: 0; border-radius: 4px 4px 0 0; box-shadow: inset 0 0 0 2px #e6d8c6; overflow: hidden; }
.pane { position: absolute; inset: 0; }
/* 像素风的天：几段平涂的色带 */
.sky-day .pane { background: linear-gradient(#bfe2f6 0 40%, #d3ecf9 40% 75%, #e5f4fb 75%); }
.sky-dawn .pane { background: linear-gradient(#c9cdeb 0 28%, #e6d3ea 28% 52%, #f8dbe0 52% 76%, #fdebd3 76%); }
.sky-dusk .pane { background: linear-gradient(#8f8fc2 0 22%, #d99fb8 22% 46%, #f4ad9b 46% 72%, #fbcf95 72%); }
.sky-night .pane { background: linear-gradient(#36406b 0 45%, #46507c 45% 80%, #57618b 80%); }
.sun { position: absolute; right: 16%; top: 16px; }
.sun.low { top: 22px; right: 18%; }
.sky-dawn .sun.low { right: 58%; top: 26px; }
.sky-dusk .cloud, .sky-dawn .cloud { opacity: .8; }
.mist { position: absolute; left: 0; right: 0; bottom: 8px; height: 6px; background: rgba(255, 255, 255, .45); box-shadow: 0 -10px 0 -1px rgba(255, 255, 255, .25); }
.moon { position: absolute; right: 14%; top: 14px; }
.star { position: absolute; width: 3px; height: 3px; background: #fdf3cf; box-shadow: 0 0 3px #fff6; }
.cloud { position: absolute; opacity: .95; }
.c1 { left: 10%; top: 22px; }
.c2 { left: 52%; top: 58px; }
.leaves { position: absolute; left: -6px; top: -4px; }
.dapple { position: absolute; top: 3px; height: 8px; background: rgba(120, 150, 110, .18); }
.d1 { left: 8%; width: 18px; } .d2 { left: 14%; width: 8px; top: 6px; } .d3 { left: 27%; width: 12px; }
.mullion { position: absolute; background: #f3ebe1; box-shadow: 0 0 0 1px #e6d8c6; }
.mullion.v { left: 50%; top: 0; bottom: 0; width: 6px; transform: translateX(-50%); }
.mullion.h { left: 0; right: 0; top: 46%; height: 6px; }
.sill { position: absolute; left: 6px; right: 6px; top: 126px; height: 16px; background: linear-gradient(#f7ecdc 0 3px, #ead8bf 3px 12px, #d8c09f 12px); border-radius: 2px; }
.jars { position: absolute; left: 0; right: 0; top: 53px; display: flex; gap: 16px; padding: 0 30px; overflow-x: auto; scrollbar-width: none; z-index: 1; height: 125px; align-items: flex-start; }
.jars::-webkit-scrollbar { display: none; }
.jar { flex: none; border: 0; background: none; padding: 0; display: flex; flex-direction: column; align-items: center; margin-top: 13px; transition: transform .15s; }
.jar.on { transform: translateY(-6px); }
.jar.on :deep(svg) { filter: drop-shadow(0 3px 0 rgba(244, 163, 189, .35)); }
.name { margin-top: 21px; font-size: 0.72rem; color: var(--text-3); white-space: nowrap; }
.name.strong { color: #c4718f; }
.jar.on .name { color: var(--ink); font-weight: 600; }
</style>
