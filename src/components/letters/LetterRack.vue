<script setup>
// 信架：照着草图——一个竖着的框，里面一层层斜口的格子，每格插一封信，信封口露在外面、时不时翻一下。
// 仰着看上去（离得近的下面宽、上面往里收）。half：只露上半截（小世界抽屉里用）
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
  <div class="rack-wrap" :class="{ half }">
    <div class="rack">
      <div v-for="(l, i) in slots" :key="l?.id || 'e' + i" class="slot" :style="{ '--i': i }">
        <button v-if="l" class="env" :class="[l.from === 'me' ? 'mine' : 'his', { locked: l.locked, unread: l.from !== 'me' && !l.readAt }]" :style="{ animationDelay: delay(i) }" @click.stop="emit('open', l)">
          <span class="flap" />
          <span class="label">{{ l.title || "无题" }}</span>
          <span v-if="l.locked" class="seal lock">🔒</span>
          <span v-else-if="l.from !== 'me' && !l.readAt" class="seal">●</span>
        </button>
        <span class="lip" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.rack-wrap { perspective: 900px; perspective-origin: 50% 120%; padding: 6px 4px 0; }
.rack-wrap.half { max-height: 210px; overflow: hidden; -webkit-mask-image: linear-gradient(#000 70%, transparent); mask-image: linear-gradient(#000 70%, transparent); }
/* 仰视：下面离你近、上面往后倒 */
.rack {
  transform: rotateX(14deg);
  transform-origin: 50% 100%;
  border: 2px solid rgba(70, 60, 50, .55);
  border-radius: 10px 10px 6px 6px;
  padding: 10px 12px 14px;
  background: linear-gradient(180deg, rgba(255, 255, 255, .5), rgba(240, 236, 228, .6));
  box-shadow: inset 0 0 0 4px rgba(255, 255, 255, .35), 0 12px 30px rgba(40, 30, 20, .12);
  display: flex; flex-direction: column; gap: 6px;
}
.half .rack { transform: rotateX(-16deg); transform-origin: 50% 0; } /* 只露上半截：绕上沿转，上面不空出一块 */
/* 一格：上口宽、下口窄的斜口（草图里的样子） */
.slot { position: relative; height: 54px; }
.slot::before {
  content: ""; position: absolute; inset: 14px 0 0;
  clip-path: polygon(0 0, 100% 0, 92% 100%, 8% 100%);
  background: linear-gradient(180deg, rgba(120, 100, 80, .18), rgba(120, 100, 80, .06));
}
.lip { position: absolute; left: 0; right: 0; top: 14px; height: 2px; background: rgba(70, 60, 50, .45); border-radius: 2px; z-index: 3; }
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
.env.mine { background: #fbf8f1; color: #3a3530; }
.env.his { background: linear-gradient(160deg, #1b2538, #0f1726); color: #c9a75c; box-shadow: inset 0 0 0 1px rgba(201, 167, 92, .45), 0 4px 10px rgba(10, 15, 30, .3); }
.env:nth-child(odd) { left: 10%; right: 14%; }
.flap { position: absolute; left: 0; right: 0; top: 0; height: 18px; clip-path: polygon(0 0, 100% 0, 50% 100%); opacity: .9; }
.mine .flap { background: #efe9dc; }
.his .flap { background: #26324a; border-bottom: 1px solid rgba(201, 167, 92, .5); }
.label { position: relative; font-family: "Long Cang", "Ma Shan Zheng", cursive; font-size: 1rem; max-width: 80%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 6px; }
.his .label { font-family: "Ma Shan Zheng", cursive; }
.seal { position: absolute; right: 8px; top: 4px; font-size: 0.7rem; color: #c0392b; }
.his .seal { color: #d4b16a; }
.seal.lock { font-size: 0.75rem; }
.env.unread { animation-duration: 3.2s; }
@keyframes flip {
  0%, 80%, 100% { transform: rotateX(0); }
  86% { transform: rotateX(-28deg); }
  92% { transform: rotateX(6deg); }
}
@media (prefers-reduced-motion: reduce) { .env { animation: none; } }
</style>
