<script setup>
// 拆信：信封合着 → 封口打开 → 信在里面 → 信抽出来 → 展开成一整张信纸（四帧素材交叉淡入）
import { ref, watch, computed } from "vue";
import { paperOf } from "../../lib/stationery.js";
import LetterPaper from "./LetterPaper.vue";

const props = defineProps({ letter: Object });
const emit = defineEmits(["close", "lock", "remove"]);
const step = ref(0); // 0~3：信封的四帧；4：信纸
let timers = [];
watch(() => props.letter, l => {
  timers.forEach(clearTimeout);
  timers = [];
  if (!l) return;
  step.value = 0;
  [700, 1200, 1700, 2300].forEach((t, i) => timers.push(setTimeout(() => (step.value = i + 1), t)));
}, { immediate: true });
const paper = computed(() => props.letter && paperOf(props.letter));
const his = computed(() => props.letter?.from !== "me");
// 每一帧相对合上时信封宽度的大小，底边对齐
const frames = computed(() => {
  const f = paper.value?.g.frames || [];
  const hmax = Math.max(...f.map(x => x.h), 0.1);
  return { hmax, list: f.map((x, i) => ({ src: paper.value.env[i], w: x.w, h: x.h })) };
});
const dateText = d => { const [y, m, dd] = String(d || "").split("-"); return y ? `${y} 年 ${Number(m)} 月 ${Number(dd)} 日` : ""; };
</script>

<template>
  <Teleport to="body">
    <div v-if="letter" class="lo-mask" @click="emit('close')">
      <div class="stage" @click.stop>
        <div v-if="step < 4" class="env" :style="{ aspectRatio: `1 / ${frames.hmax}` }">
          <img v-for="(f, i) in frames.list" :key="i" :src="f.src" alt="" :class="{ on: i === step }" :style="{ width: `${f.w * 100}%` }" />
        </div>
        <div v-else class="sheet">
          <button class="x" aria-label="收起" @click="emit('close')">×</button>
          <LetterPaper :paper="paper">
            <h2>{{ letter.title || "无题" }}</h2>
            <div class="body">{{ letter.body }}</div>
            <div class="sign">{{ letter.sign }}</div>
            <div class="date">{{ dateText(letter.date) }}</div>
          </LetterPaper>
          <div v-if="!his" class="meta">
            <span v-if="letter.locked">🔒 上着锁，他还读不到</span>
            <span v-else-if="letter.readAt">他读过了</span>
            <span v-else>他下次聊天时会读到</span>
            <button @click="emit('lock', letter)">{{ letter.locked ? "开锁" : "上锁" }}</button>
            <button class="del" @click="emit('remove', letter)">撕掉</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.lo-mask { position: fixed; inset: 0; z-index: 950; background: rgba(20, 20, 28, .45); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); display: grid; place-items: center; padding: 16px; }
.stage { width: min(100%, 440px); }

/* ---------- 信封 ---------- */
.env { position: relative; width: 82%; margin: 0 auto; animation: drop .45s ease-out; }
@keyframes drop { from { transform: translateY(30px) scale(.9); opacity: 0; } }
.env img { position: absolute; left: 50%; bottom: 0; transform: translateX(-50%); opacity: 0; transition: opacity .35s ease; filter: drop-shadow(0 14px 22px rgba(0, 0, 0, .25)); }
.env img.on { opacity: 1; }

/* ---------- 信纸 ---------- */
.sheet { position: relative; max-height: 88vh; overflow-y: auto; border-radius: 4px; animation: unfold .6s cubic-bezier(.2, .8, .2, 1); transform-origin: 50% 20%; scrollbar-width: none; }
.sheet::-webkit-scrollbar { display: none; }
@keyframes unfold { from { transform: translateY(40px) scale(.7); opacity: 0; } }
h2 { font-size: 1.5em; font-weight: 400; text-align: center; padding-bottom: var(--line); }
.body { white-space: pre-wrap; overflow-wrap: anywhere; min-height: calc(var(--line) * 4); }
.sign { text-align: right; font-size: 1.15em; padding-top: var(--line); }
.date { text-align: right; font-size: .85em; opacity: .85; }
.x { position: absolute; right: 6px; top: 2px; z-index: 2; border: 0; background: none; font-size: 1.6rem; color: rgba(60, 50, 40, .6); }
.meta { display: flex; align-items: center; gap: 10px; margin-top: 10px; padding: 10px 12px; border-radius: 14px; background: rgba(255, 255, 255, .9); font-family: -apple-system, "PingFang SC", sans-serif; font-size: 0.8rem; color: #8a8580; }
.meta span { flex: 1; }
.meta button { border: 0; border-radius: 999px; padding: 5px 12px; background: #f0ebe1; color: #4a443e; font-size: 0.8rem; }
.meta .del { color: #b4545e; }
@media (prefers-reduced-motion: reduce) { .env, .sheet { animation: none; } .env img { transition: none; } }
</style>
