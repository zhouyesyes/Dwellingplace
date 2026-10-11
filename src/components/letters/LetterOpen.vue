<script setup>
// 拆信：信封在中间 → 封口翻开 → 信纸抽出来 → 展开成一整张纸（手写字）
import { ref, watch, computed } from "vue";
import "@fontsource/long-cang/400.css";
import "@fontsource/ma-shan-zheng/400.css";

const props = defineProps({ letter: Object });
const emit = defineEmits(["close", "lock", "remove"]);
const phase = ref("env"); // env → open → out → paper
let timers = [];
watch(() => props.letter, l => {
  timers.forEach(clearTimeout);
  timers = [];
  if (!l) return;
  phase.value = "env";
  timers.push(setTimeout(() => (phase.value = "open"), 350));
  timers.push(setTimeout(() => (phase.value = "out"), 1050));
  timers.push(setTimeout(() => (phase.value = "paper"), 1750));
}, { immediate: true });
const his = computed(() => props.letter?.from !== "me");
const dateText = d => { const [y, m, dd] = String(d || "").split("-"); return y ? `${y} 年 ${Number(m)} 月 ${Number(dd)} 日` : ""; };
</script>

<template>
  <Teleport to="body">
    <div v-if="letter" class="lo-mask" @click="emit('close')">
      <div class="stage" :class="[phase, his ? 'his' : 'mine']" @click.stop>
        <!-- 信封 -->
        <div v-if="phase !== 'paper'" class="envelope">
          <div class="back" />
          <div class="sheet" />
          <div class="front" />
          <div class="flap" />
          <div class="stamp">{{ his ? "✦" : "♡" }}</div>
        </div>
        <!-- 信纸 -->
        <article v-else class="paper">
          <button class="x" aria-label="收起" @click="emit('close')">×</button>
          <h2>{{ letter.title || "无题" }}</h2>
          <div class="body">{{ letter.body }}</div>
          <div class="sign">{{ letter.sign }}</div>
          <div class="date">{{ dateText(letter.date) }}</div>
          <div v-if="!his" class="meta">
            <span v-if="letter.locked">🔒 上着锁，他还读不到</span>
            <span v-else-if="letter.readAt">他读过了</span>
            <span v-else>他下次聊天时会读到</span>
            <button @click="emit('lock', letter)">{{ letter.locked ? "开锁" : "上锁" }}</button>
            <button class="del" @click="emit('remove', letter)">撕掉</button>
          </div>
        </article>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.lo-mask { position: fixed; inset: 0; z-index: 950; background: rgba(20, 20, 28, .45); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); display: grid; place-items: center; padding: 20px; }
.stage { width: min(100%, 460px); perspective: 1000px; }

/* ---------- 信封 ---------- */
.envelope { position: relative; width: 300px; height: 190px; margin: 0 auto; animation: drop .35s ease-out; }
@keyframes drop { from { transform: translateY(30px) scale(.9); opacity: 0; } }
.back, .front, .flap, .sheet { position: absolute; left: 0; right: 0; }
.back { top: 0; bottom: 0; border-radius: 6px; }
.front { bottom: 0; height: 100%; clip-path: polygon(0 35%, 50% 72%, 100% 35%, 100% 100%, 0 100%); border-radius: 0 0 6px 6px; z-index: 3; }
.flap { top: 0; height: 62%; clip-path: polygon(0 0, 100% 0, 50% 100%); transform-origin: 50% 0; transition: transform .6s ease-in-out; z-index: 4; }
.sheet { left: 14px; right: 14px; top: 12px; height: 160px; border-radius: 3px; z-index: 2; transition: transform .7s cubic-bezier(.3, .7, .3, 1); }
.stamp { position: absolute; right: 14px; bottom: 12px; z-index: 5; font-size: 1.1rem; }
.mine .back { background: #ece5d6; } .mine .front { background: #f6f1e6; box-shadow: inset 0 1px 0 rgba(0,0,0,.04); } .mine .flap { background: #efe8da; } .mine .sheet { background: #fffdf8; } .mine .stamp { color: #d36b7d; }
.his .back { background: #0c1322; } .his .front { background: #17213a; } .his .flap { background: #1f2b46; } .his .sheet { background: #121a2c; box-shadow: inset 0 0 0 1px rgba(201,167,92,.5); } .his .stamp { color: #c9a75c; }
.his .front, .his .flap { box-shadow: inset 0 0 0 1px rgba(201, 167, 92, .35); }
.open .flap, .out .flap { transform: rotateX(180deg); z-index: 1; }
.out .sheet { transform: translateY(-120px); }
.out .envelope { animation: none; }

/* ---------- 信纸 ---------- */
.paper {
  position: relative; max-height: 82vh; overflow-y: auto; border-radius: 6px; padding: 30px 26px 22px;
  animation: unfold .55s cubic-bezier(.2, .8, .2, 1);
  transform-origin: 50% 30%;
}
@keyframes unfold { from { transform: scaleY(.25) translateY(-40px); opacity: .3; } }
.mine .paper {
  background: #fffdf8; color: #2f2b28; font-family: "Long Cang", cursive;
  background-image: repeating-linear-gradient(transparent 0 37px, rgba(120, 140, 170, .22) 37px 38px);
  background-position: 0 92px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, .25);
}
.his .paper {
  background: #111a2b; color: #cfae66; font-family: "Ma Shan Zheng", cursive;
  background-image: repeating-linear-gradient(transparent 0 37px, rgba(201, 167, 92, .16) 37px 38px);
  background-position: 0 92px;
  box-shadow: inset 0 0 0 1px rgba(201, 167, 92, .5), inset 0 0 0 6px #111a2b, inset 0 0 0 7px rgba(201, 167, 92, .25), 0 20px 50px rgba(0, 0, 0, .4);
}
.paper h2 { margin: 0 0 18px; font-size: 1.9rem; font-weight: 400; text-align: center; line-height: 1.3; }
.body { font-size: 1.45rem; line-height: 38px; white-space: pre-wrap; overflow-wrap: anywhere; min-height: 190px; }
.sign { text-align: right; font-size: 1.5rem; margin-top: 22px; }
.date { text-align: right; font-size: 1.15rem; opacity: .8; }
.x { position: absolute; right: 10px; top: 6px; border: 0; background: none; font-size: 1.6rem; color: inherit; opacity: .6; }
.meta { display: flex; align-items: center; gap: 10px; margin-top: 18px; padding-top: 10px; border-top: 1px dashed rgba(0, 0, 0, .15); font-family: -apple-system, "PingFang SC", sans-serif; font-size: 0.8rem; color: #8a8580; }
.meta span { flex: 1; }
.meta button { border: 0; border-radius: 999px; padding: 5px 12px; background: #f0ebe1; color: #4a443e; font-size: 0.8rem; }
.meta .del { color: #b4545e; }
@media (prefers-reduced-motion: reduce) { .flap, .sheet, .paper, .envelope { transition: none; animation: none; } }
</style>
