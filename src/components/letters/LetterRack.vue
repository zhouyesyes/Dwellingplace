<script setup>
// 信架：照着草图——一个竖着的框，里面一层层斜口的格子，每格插一封信，信封口露在外面、时不时翻一下。
// 仰着看上去（离得近的下面宽、上面往里收）。
// half：小世界抽屉里用——信架横着放，信封竖着插成一排，只露出上半截，多了可以左右划
import { computed } from "vue";

const props = defineProps({ letters: { type: Array, default: () => [] }, half: Boolean });
const emit = defineEmits(["open"]);
// 新的在最上面；至少 6 格，信多了格子跟着多
const slots = computed(() => {
  const list = [...props.letters].sort((a, b) => b.ts - a.ts);
  const n = Math.max(6, list.length + 1);
  return Array.from({ length: n }, (_, i) => list[i] || null);
});
const delay = i => `${(i * 1.7) % 6.3}s`; // 每封信翻动的时间错开
</script>

<template>
  <div v-if="half" class="shelf">
    <div class="row">
      <button v-for="(l, i) in slots" :key="l?.id || 'e' + i" class="card" :class="l ? [l.from === 'me' ? 'mine' : 'his', { unread: l.from !== 'me' && !l.readAt }] : 'blank'" :style="{ animationDelay: delay(i) }" :tabindex="l ? 0 : -1" @click.stop="l && emit('open', l)">
        <template v-if="l">
          <span class="flap" />
          <span class="label">{{ l.title || "无题" }}</span>
          <span v-if="l.locked" class="seal lock">🔒</span>
          <span v-else-if="l.from !== 'me'" class="wax" :class="{ fresh: !l.readAt }" />
        </template>
      </button>
    </div>
    <div class="front"><span class="plate">LETTERS</span></div>
  </div>
  <div v-else class="rack-wrap">
    <div class="rack">
      <div v-for="(l, i) in slots" :key="l?.id || 'e' + i" class="slot" :style="{ '--i': i }">
        <button v-if="l" class="env" :class="[l.from === 'me' ? 'mine' : 'his', { locked: l.locked, unread: l.from !== 'me' && !l.readAt }]" :style="{ animationDelay: delay(i) }" @click.stop="emit('open', l)">
          <span class="flap" />
          <span class="label">{{ l.title || "无题" }}</span>
          <span v-if="l.locked" class="seal lock">🔒</span>
          <span v-else-if="l.from !== 'me'" class="wax" :class="{ fresh: !l.readAt }" />
        </button>
        <span class="lip" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.rack-wrap { perspective: 900px; perspective-origin: 50% 120%; padding: 6px 4px 0; }
/* 仰视：下面离你近、上面往后倒 */
.rack {
  transform: rotateX(14deg);
  transform-origin: 50% 100%;
  border: 6px solid #8a6446;
  border-image: linear-gradient(180deg, #9b7352, #6f4e35) 1;
  padding: 10px 12px 14px;
  background:
    repeating-linear-gradient(90deg, rgba(255, 255, 255, .025) 0 3px, rgba(0, 0, 0, .025) 3px 7px),
    linear-gradient(180deg, #f3ebdd, #e6dac6);
  box-shadow: inset 0 2px 8px rgba(60, 40, 20, .25), 0 14px 30px rgba(60, 40, 20, .18);
  display: flex; flex-direction: column; gap: 6px;
}
/* 一格：上口宽、下口窄的斜口（草图里的样子） */
.slot { position: relative; height: 54px; }
.slot::before {
  content: ""; position: absolute; inset: 14px 0 0;
  clip-path: polygon(0 0, 100% 0, 92% 100%, 8% 100%);
  background: linear-gradient(180deg, rgba(110, 80, 50, .22), rgba(110, 80, 50, .06));
}
.lip { position: absolute; left: 0; right: 0; top: 14px; height: 4px; background: linear-gradient(#a37a57, #7a5639); border-radius: 2px; z-index: 3; box-shadow: 0 1px 2px rgba(50, 30, 15, .3); }
/* 信封：从格子里露出上半截，时不时往前翻一下 */
.env {
  position: absolute; left: 12%; right: 12%; top: 0; height: 46px; z-index: 2;
  border: 0; padding: 0; border-radius: 4px 4px 2px 2px; cursor: pointer;
  transform-origin: 50% 100%;
  animation: flip 6.3s ease-in-out infinite;
  box-shadow: 0 -1px 0 rgba(0, 0, 0, .05), 0 4px 10px rgba(30, 30, 40, .12);
  display: flex; align-items: flex-start; justify-content: center; padding-top: 8px;
  overflow: hidden;
}
.env.mine, .card.mine { background: linear-gradient(170deg, #fffdf8, #f4eee2); color: #3a3530; }
.env.his, .card.his { background: linear-gradient(160deg, #1d2840, #0f1726); color: #d2b06a; box-shadow: inset 0 0 0 1px rgba(201, 167, 92, .5), inset 0 0 0 3px #131c2e, inset 0 0 0 4px rgba(201, 167, 92, .25), 0 4px 10px rgba(10, 15, 30, .3); }
.env:nth-child(odd) { left: 10%; right: 14%; }
.flap { position: absolute; left: 0; right: 0; top: 0; height: 18px; clip-path: polygon(0 0, 100% 0, 50% 100%); opacity: .9; }
.mine .flap { background: linear-gradient(#f1eadb, #e8dfcc); }
.his .flap { background: linear-gradient(#2a3753, #212c43); }
/* 他的信：一枚暗金火漆；没拆的亮一点、轻轻发光 */
.wax {
  position: absolute; width: 14px; height: 14px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #f0d798, #b8903f 55%, #7d5e22);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .45), inset 0 0 0 2px rgba(125, 94, 34, .35);
  left: 50%; top: 11px; transform: translateX(-50%); z-index: 1;
}
.wax.fresh { animation: glow 2.4s ease-in-out infinite; }
@keyframes glow { 50% { box-shadow: 0 0 8px 2px rgba(240, 210, 140, .7), inset 0 0 0 2px rgba(125, 94, 34, .35); } }
.env .label { position: relative; font-family: "Long Cang", "Ma Shan Zheng", cursive; font-size: 1rem; max-width: 80%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 6px; }
.env.his .label { font-family: "Ma Shan Zheng", cursive; }
.seal { position: absolute; right: 8px; top: 4px; font-size: 0.7rem; color: #c0392b; }
.his .seal { color: #d4b16a; }
.seal.lock { font-size: 0.75rem; }
.env.unread { animation-duration: 3.2s; }
@keyframes flip {
  0%, 80%, 100% { transform: rotateX(0); }
  86% { transform: rotateX(-28deg); }
  92% { transform: rotateX(6deg); }
}

/* ——— 横放的半截信架 ——— */
.shelf { position: relative; padding-top: 6px; }
.row {
  display: flex; gap: 0; overflow-x: auto; scrollbar-width: none;
  padding: 8px 14px 0; height: 128px; align-items: flex-end;
  scroll-snap-type: x proximity;
}
.row::-webkit-scrollbar { display: none; }
/* 竖着插的信封：上半截露在架子外面，下半截藏在挡板后面 */
.card {
  position: relative; flex: 0 0 58px; height: 136px; margin-right: -10px; margin-bottom: -26px;
  border: 0; padding: 0; border-radius: 4px 4px 0 0; cursor: pointer; scroll-snap-align: start;
  transform-origin: 50% 100%; animation: lean 6.3s ease-in-out infinite;
  box-shadow: -3px 0 6px rgba(40, 30, 20, .14);
  overflow: hidden;
}
.card:nth-child(odd) { height: 128px; }
.card:nth-child(3n) { height: 140px; }
.card.blank { background: linear-gradient(170deg, rgba(255, 255, 255, .28), rgba(255, 255, 255, .1)); box-shadow: inset 0 0 0 1px rgba(120, 100, 80, .12); animation: none; cursor: default; }
.card .flap { height: 22px; clip-path: polygon(0 0, 100% 0, 50% 100%); }
.card .label {
  position: absolute; top: 28px; left: 50%; transform: translateX(-50%); writing-mode: vertical-rl; line-height: 1; text-align: start; font-family: "Long Cang", "Ma Shan Zheng", cursive; font-size: .9rem; letter-spacing: .08em;
  height: 66px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.card.his .label { font-family: "Ma Shan Zheng", cursive; }
.card .wax { top: 13px; }
.env .wax { left: auto; right: 10px; top: 6px; transform: none; width: 12px; height: 12px; }
.card .seal { left: 6px; right: auto; top: 24px; }
.card.unread { animation-duration: 3.2s; }
@keyframes lean {
  0%, 78%, 100% { transform: translateY(0) rotate(0); }
  85% { transform: translateY(-8px) rotate(-3deg); }
  92% { transform: translateY(-2px) rotate(1deg); }
}
/* 挡板：木头的，带一块小铭牌 */
.front {
  position: relative; z-index: 5; height: 34px; border-radius: 4px 4px 10px 10px;
  background:
    repeating-linear-gradient(92deg, rgba(255, 255, 255, .04) 0 2px, rgba(0, 0, 0, .05) 2px 6px),
    linear-gradient(180deg, #a27a57, #7d5a3e);
  box-shadow: inset 0 2px 0 rgba(255, 255, 255, .25), inset 0 -3px 6px rgba(40, 25, 10, .35), 0 8px 16px rgba(60, 40, 20, .2);
  display: flex; align-items: center; justify-content: center;
}
.plate {
  font: 600 .58rem/1 Georgia, "Times New Roman", serif; letter-spacing: .3em; color: #6b4c2c;
  padding: 4px 8px 4px 10px; border-radius: 2px;
  background: linear-gradient(180deg, #f1dca4, #c9a75c); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .4), 0 1px 2px rgba(0, 0, 0, .3);
}
@media (prefers-reduced-motion: reduce) { .env, .card, .wax.fresh { animation: none; } }
</style>
