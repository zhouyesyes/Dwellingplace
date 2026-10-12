<script setup>
// 信箱：一个纸盒子，信封一封封竖着插在里面。
//   half（小世界抽屉里）：从正面看，盒子挡板挡住下半截，信封露出上面一截，后面的高一点。
//     平时收在右边只露一大半；active：整个往左抽出来，最近的信从新到旧轮流冒出来，上面写着标题
//   完整（信箱页）：从上往下看进盒子，一封叠一封只露出上沿，最新的在最前面、整封露出来；点哪封拆哪封
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { paperOf, asset } from "../../lib/stationery.js";

const props = defineProps({ letters: { type: Array, default: () => [] }, half: Boolean, active: Boolean });
const emit = defineEmits(["open"]);
const list = computed(() => [...props.letters].sort((a, b) => a.ts - b.ts).map(l => ({ l, p: paperOf(l) })));
// 抽屉里最多露 7 封（最新的几封），最新的在最前面
const peek = computed(() => list.value.slice(-7));
// 轮流冒头：从最新的一封开始，往旧的轮
const up = ref(-1);
let timer = null;
watch(() => props.active, a => {
  clearInterval(timer);
  if (!a || !peek.value.length) { up.value = -1; return; }
  up.value = peek.value.length - 1;
  timer = setInterval(() => { up.value = (up.value - 1 + peek.value.length) % peek.value.length; }, 2400);
}, { immediate: true });
onBeforeUnmount(() => clearInterval(timer));
const upLetter = computed(() => peek.value[up.value]?.l);
const front = asset("box-front");
const boxIn = asset("box-in");
const unread = l => l.from !== "me" && !l.readAt;
const md = d => { const [, m, dd] = String(d || "").split("-"); return m ? `${Number(m)}.${Number(dd)}` : ""; };
</script>

<template>
  <!-- 抽屉里：正面看 -->
  <div v-if="half" class="shelf" :class="{ active }" :style="{ '--k': peek.length }">
    <Transition name="tag">
      <div v-if="upLetter" :key="upLetter.id" class="up-tag">
        <span class="t">{{ upLetter.title || "无题" }}</span>
        <span class="m">{{ upLetter.from === "me" ? "我" : "他" }} · {{ md(upLetter.date) }}</span>
        <span v-if="upLetter.locked">🔒</span><span v-else-if="unread(upLetter)" class="new" />
      </div>
    </Transition>
    <div class="envs">
      <img
        v-for="({ l, p }, i) in peek" :key="l.id" :src="p.env[0]" alt="" class="pe" :class="{ unread: unread(l), up: i === up }"
        :style="{ '--d': peek.length - 1 - i, '--x': `${((i * 37) % 9) - 4}px`, '--r': `${((i * 53) % 5) - 2}deg` }"
      />
    </div>
    <img :src="front" alt="" class="front" />
  </div>

  <!-- 信箱页：从上往下看进盒子 -->
  <div v-else class="box" :style="{ borderImageSource: `url(${boxIn})` }">
    <div class="inner">
      <button
        v-for="({ l, p }, i) in list" :key="l.id" class="strip" :class="{ last: i === list.length - 1 }"
        :style="{ '--eh': p.g.frames[0].h, '--ink': p.ink }" @click="emit('open', l)"
      >
        <img :src="p.env[0]" alt="" />
        <span class="tag">
          <span class="t">{{ l.title || "无题" }}</span>
          <span class="m">{{ l.from === "me" ? "我" : "他" }} · {{ md(l.date) }}</span>
          <span v-if="l.locked" class="lock">🔒</span>
          <span v-else-if="unread(l)" class="new" />
        </span>
      </button>
      <p v-if="!list.length" class="empty">空空的盒子</p>
    </div>
  </div>
</template>

<style scoped>
/* ---------- 抽屉里：正面 ---------- */
.shelf { position: relative; overflow: hidden; padding-top: calc(var(--k) * 15px + 46px); container-type: inline-size; transition: padding-top .45s cubic-bezier(.3, .7, .3, 1), transform .45s cubic-bezier(.3, .7, .3, 1); }
/* 点一下：盒子往左探出来，上面空出地方给冒头的信 */
/* 平时：盒子收在右边、只露一大半，信封也往里沉一点；点一下：整个抽出来摆正，上面空出地方给冒头的信 */
.shelf:not(.active) { padding-top: calc(var(--k) * 15px + 26px); transform: translateX(30%); }
.shelf:not(.active) .envs { top: 6px; }
.shelf.active { padding-top: calc(var(--k) * 15px + 46px + 64px); transform: rotate(-1deg); }
.shelf.active .envs { top: 64px; }
.envs { transition: top .45s cubic-bezier(.3, .7, .3, 1); }
.pe { transition: translate .5s cubic-bezier(.3, .7, .3, 1); translate: 0 0; }
.pe.up { animation: none; translate: 0 -60px; filter: drop-shadow(0 6px 10px rgba(60, 40, 20, .25)); }
.up-tag {
  position: absolute; z-index: 3; left: 8%; top: 4px; display: flex; align-items: baseline; gap: 8px; max-width: 84%;
  padding: 3px 12px 4px; border-radius: 4px; background: rgba(255, 252, 245, .95); box-shadow: 0 2px 6px rgba(60, 40, 20, .2);
  transform: rotate(-1.5deg); color: #4a3e38;
}
.tag-enter-active, .tag-leave-active { transition: opacity .3s, translate .3s; }
.tag-enter-from { opacity: 0; translate: 0 6px; }
.tag-leave-to { opacity: 0; translate: 0 -6px; }
.envs { position: absolute; inset: 0; }
.pe {
  position: absolute; left: 9%; width: 82%;
  top: calc((var(--k) - 1 - var(--d)) * 15px + 6px);
  transform: translateX(var(--x)) rotate(var(--r)) scale(calc(1 - var(--d) * .025));
  transform-origin: 50% 100%;
  filter: drop-shadow(0 -2px 3px rgba(60, 40, 20, .12)) brightness(calc(1 - var(--d) * .035));
  animation: nudge 7s ease-in-out infinite; animation-delay: calc(var(--d) * 1.3s);
}
.pe.unread { animation-duration: 3.4s; filter: drop-shadow(0 0 6px rgba(240, 205, 120, .9)); }
@keyframes nudge { 0%, 84%, 100% { translate: 0 0; } 90% { translate: 0 -6px; } 95% { translate: 0 -1px; } }
.front { position: relative; z-index: 2; display: block; width: 100%; filter: drop-shadow(0 8px 12px rgba(60, 40, 20, .18)); }

/* ---------- 信箱页：从上往下看 ---------- */
.box { border: 34px solid transparent; border-image-slice: 72 fill; border-image-width: 34px; border-image-repeat: stretch; filter: drop-shadow(0 16px 30px rgba(60, 40, 20, .18)); }
.inner { container-type: inline-size; padding: 6px 2px 4px; min-height: 160px; }
.strip { position: relative; display: block; width: 100%; height: 19cqw; border: 0; padding: 0; background: none; cursor: pointer; text-align: left; transition: transform .2s; }
.strip.last { height: calc(var(--eh) * 100cqw); }
.strip img { position: absolute; left: 0; top: 0; width: 100%; filter: drop-shadow(0 -3px 4px rgba(60, 40, 20, .16)); }
.strip:active { transform: translateY(-6px); }
.tag {
  position: absolute; left: 5%; top: 3cqw; display: flex; align-items: baseline; gap: 8px; max-width: 80%;
  padding: 2px 10px 3px; border-radius: 3px; background: rgba(255, 252, 245, .9); box-shadow: 0 1px 3px rgba(60, 40, 20, .2);
  transform: rotate(-1.5deg); color: var(--ink);
}
.t { font-weight: 600; font-size: .95rem; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.m { font-size: .68rem; opacity: .7; white-space: nowrap; }
.lock { font-size: .75rem; }
.new { width: 8px; height: 8px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #f6dc9c, #c39a45); box-shadow: 0 0 6px 2px rgba(240, 205, 120, .8); align-self: center; animation: glow 2s ease-in-out infinite; }
@keyframes glow { 50% { box-shadow: 0 0 2px 1px rgba(240, 205, 120, .5); } }
.empty { text-align: center; color: #a08a70; font-size: 1rem; margin: 50px 0; }
@media (prefers-reduced-motion: reduce) { .pe, .new { animation: none; } }
</style>
