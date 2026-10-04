<script setup>
// 小鸡：点一下换一个状态（发呆 / 开心 / 睡觉 / 啄米）
import { computed } from "vue";
import { store } from "../../store/index.js";

const props = defineProps({ size: String, editing: Boolean });
const STATES = [
  { key: "idle", label: "发呆中…" },
  { key: "happy", label: "好开心！" },
  { key: "sleep", label: "呼呼大睡" },
  { key: "peck", label: "认真啄米" },
];
const state = computed(() => store.chick.state || "idle");
const label = computed(() => STATES.find(s => s.key === state.value)?.label);

function poke() {
  if (props.editing) return;
  const i = STATES.findIndex(s => s.key === state.value);
  store.chick.state = STATES[(i + 1) % STATES.length].key;
}
</script>

<template>
  <div class="chick-w" :class="[state, size]" @click="poke">
    <svg viewBox="0 0 120 120" class="chick" aria-label="小鸡">
      <!-- 地上的米粒 -->
      <g v-if="state === 'peck'" class="grains" fill="#e8c58a">
        <ellipse cx="30" cy="108" rx="2.6" ry="1.6" /><ellipse cx="40" cy="111" rx="2.6" ry="1.6" />
        <ellipse cx="86" cy="110" rx="2.6" ry="1.6" /><ellipse cx="22" cy="112" rx="2.2" ry="1.4" />
      </g>
      <ellipse cx="60" cy="108" rx="30" ry="4" fill="rgba(40,40,60,.07)" />
      <!-- 脚 -->
      <g stroke="#f2a65a" stroke-width="3" stroke-linecap="round">
        <path d="M52 96v8M48 104h8" /><path d="M68 96v8M64 104h8" />
      </g>
      <g class="body">
        <!-- 呆毛 -->
        <path d="M58 30c-2-8 4-12 8-8M60 30c2-7 9-8 10-3" fill="none" stroke="#f5c84b" stroke-width="3" stroke-linecap="round" />
        <!-- 身体 -->
        <ellipse cx="60" cy="66" rx="35" ry="34" fill="#ffe17d" />
        <ellipse cx="60" cy="74" rx="22" ry="18" fill="#fff0b3" opacity=".7" />
        <!-- 翅膀 -->
        <path class="wing l" d="M27 70c-8 2-10 12-4 16 4 2 9-2 10-6" fill="#ffd45e" />
        <path class="wing r" d="M93 70c8 2 10 12 4 16-4 2-9-2-10-6" fill="#ffd45e" />
        <!-- 腮红 -->
        <circle cx="42" cy="66" r="5.5" fill="#ffaab8" opacity=".65" />
        <circle cx="78" cy="66" r="5.5" fill="#ffaab8" opacity=".65" />
        <!-- 眼睛 -->
        <g v-if="state === 'happy'" fill="none" stroke="#3b3b43" stroke-width="3" stroke-linecap="round">
          <path d="M44 58q5-6 10 0" /><path d="M66 58q5-6 10 0" />
        </g>
        <g v-else-if="state === 'sleep'" fill="none" stroke="#3b3b43" stroke-width="2.6" stroke-linecap="round">
          <path d="M44 57q5 4 10 0" /><path d="M66 57q5 4 10 0" />
        </g>
        <g v-else class="eyes" fill="#3b3b43">
          <circle cx="49" cy="56" r="4" /><circle cx="71" cy="56" r="4" />
          <circle cx="50.3" cy="54.6" r="1.3" fill="#fff" /><circle cx="72.3" cy="54.6" r="1.3" fill="#fff" />
        </g>
        <!-- 嘴 -->
        <path v-if="state === 'happy'" d="M54 63h12l-6 8z" fill="#f2a65a" />
        <path v-else d="M55 63h10l-5 6z" fill="#f2a65a" />
      </g>
      <!-- 开心：爱心 -->
      <g v-if="state === 'happy'" class="hearts" fill="#ff8fa6">
        <path class="h1" d="M96 30c-2-4-8-3-8 1 0 4 8 8 8 8s8-4 8-8c0-4-6-5-8-1z" />
        <path class="h2" d="M22 36c-1.5-3-6-2.3-6 .8 0 3 6 6 6 6s6-3 6-6c0-3.1-4.5-3.8-6-.8z" />
      </g>
      <!-- 睡觉：z -->
      <g v-if="state === 'sleep'" class="zzz" fill="#8cc1f2" font-family="Georgia, serif" font-weight="700">
        <text class="z1" x="86" y="34" font-size="14">z</text>
        <text class="z2" x="96" y="22" font-size="11">z</text>
      </g>
    </svg>
    <div class="label">{{ label }}</div>
  </div>
</template>

<style scoped>
.chick-w {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(160deg, #fffbe8, #fff3f5);
  cursor: pointer;
  user-select: none;
}
.chick { width: 72%; max-width: 150px; overflow: visible; }
.large .chick { width: 40%; }
.label { font-size: 0.8rem; color: var(--text-2); margin-top: 2px; }

.body { transform-origin: 60px 100px; }
.idle .body { animation: breathe 3s ease-in-out infinite; }
.idle .eyes { animation: blink 4s infinite; transform-origin: 60px 56px; }
.happy .body { animation: hop .7s ease-in-out infinite; }
.happy .wing.l { animation: flapL .35s ease-in-out infinite alternate; transform-origin: 33px 72px; }
.happy .wing.r { animation: flapR .35s ease-in-out infinite alternate; transform-origin: 87px 72px; }
.sleep .body { animation: breathe 4s ease-in-out infinite; }
.peck .body { animation: peck 1.1s ease-in-out infinite; }

.hearts .h1 { animation: float 1.6s ease-out infinite; }
.hearts .h2 { animation: float 1.6s .6s ease-out infinite; }
.zzz .z1 { animation: float 2.4s ease-out infinite; }
.zzz .z2 { animation: float 2.4s 1.2s ease-out infinite; }

@keyframes breathe { 50% { transform: scale(1.025, .975); } }
@keyframes blink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
@keyframes hop { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-9px); } 60% { transform: translateY(-9px) scale(1.02, .98); } }
@keyframes flapL { to { transform: rotate(-22deg); } }
@keyframes flapR { to { transform: rotate(22deg); } }
@keyframes peck { 0%, 45%, 100% { transform: rotate(0); } 60% { transform: rotate(14deg) translateY(4px); } 70% { transform: rotate(4deg); } 80% { transform: rotate(14deg) translateY(4px); } }
@keyframes float { 0% { opacity: 0; transform: translateY(6px); } 30% { opacity: 1; } 100% { opacity: 0; transform: translateY(-14px); } }
</style>
