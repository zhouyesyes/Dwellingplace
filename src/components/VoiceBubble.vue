<script setup>
// 语音消息：你的录音（file），或者他的 [语音:…]（text，点了才用「他的声音」生成）
import { ref, computed, onBeforeUnmount } from "vue";
import { voiceBlob, speak, ttsReady } from "../lib/media.js";
import { toast } from "../lib/toast.js";

const props = defineProps({
  file: String, // 你的录音
  text: String, // 他要说的话
  dur: Number,
  transcript: String, // 你的录音转出来的文字
  mine: Boolean,
});
const playing = ref(false);
const loading = ref(false);
const showText = ref(false);
let audio = null;
let url = null;

const secs = computed(() => props.dur || (props.text ? Math.max(1, Math.round([...props.text].length / 4)) : 0));
const width = computed(() => Math.min(220, 84 + secs.value * 4) + "px");
const words = computed(() => props.transcript || props.text || "");

async function toggle() {
  if (playing.value) { audio?.pause(); playing.value = false; return; }
  if (!audio) {
    loading.value = true;
    try {
      if (props.file) {
        const blob = await voiceBlob(props.file);
        if (!blob) throw new Error("这段录音还没同步过来");
        url = URL.createObjectURL(blob);
      } else {
        if (!ttsReady()) { showText.value = true; return toast("还没设置「他的声音」，先看文字吧（设置 → 语音和画画）", 3500); }
        url = await speak(props.text);
      }
      audio = new Audio(url);
      audio.onended = () => (playing.value = false);
    } catch (e) {
      showText.value = true;
      return toast((e?.message || String(e)).slice(0, 120), 4000);
    } finally {
      loading.value = false;
    }
  }
  audio.currentTime = 0;
  await audio.play().catch(e => toast("放不出来：" + e.message));
  playing.value = true;
}
onBeforeUnmount(() => { audio?.pause(); if (props.file && url) URL.revokeObjectURL(url); });
</script>

<template>
  <div class="voice-wrap" :class="{ mine }">
    <button class="voice" :style="{ width }" @click.stop="toggle">
      <span class="ico" :class="{ playing, loading }"><i /><i /><i /></span>
      <span class="len">{{ secs }}″</span>
    </button>
    <button v-if="words" class="to-text" @click.stop="showText = !showText">{{ showText ? "收起" : "转文字" }}</button>
    <p v-if="showText && words" class="words">{{ words }}</p>
  </div>
</template>

<style scoped>
.voice-wrap { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; max-width: 100%; }
.voice-wrap.mine { align-items: flex-end; }
.voice { display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 0; border-radius: 18px; padding: 10px 14px; background: var(--card); box-shadow: 0 1px 2px rgba(40, 40, 60, .06); color: var(--text); font-size: 0.9rem; }
.mine .voice { flex-direction: row-reverse; }
.ico { display: flex; align-items: center; gap: 3px; height: 16px; }
.ico i { width: 3px; border-radius: 2px; background: currentColor; opacity: .7; }
.ico i:nth-child(1) { height: 6px; } .ico i:nth-child(2) { height: 11px; } .ico i:nth-child(3) { height: 16px; }
.ico.playing i { animation: wave .9s ease-in-out infinite; }
.ico.playing i:nth-child(2) { animation-delay: .15s; } .ico.playing i:nth-child(3) { animation-delay: .3s; }
.ico.loading { opacity: .4; }
@keyframes wave { 50% { transform: scaleY(.4); } }
.len { color: var(--text-2); font-variant-numeric: tabular-nums; }
.to-text { border: 0; background: none; padding: 0 6px; font-size: 0.72rem; color: var(--text-3); }
.words { margin: 0; max-width: 260px; padding: 8px 12px; border-radius: 14px; background: rgba(255, 255, 255, .7); font-size: 0.85rem; line-height: 1.6; color: var(--text-2); white-space: pre-wrap; }
</style>
