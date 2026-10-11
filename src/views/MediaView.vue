<script setup>
// 语音和画画：三样各自一个开关和接口（OpenAI 兼容格式），还没选好哪家就先关着
import { ref } from "vue";
import { store } from "../store/index.js";
import { speak, drawImage, transcribe, startRecording } from "../lib/media.js";
import { imageURL } from "../lib/images.js";
import SubHeader from "../components/SubHeader.vue";

const SECTIONS = [
  { k: "stt", title: "语音转文字", sub: "你发的语音转成文字，他才听得懂。不开的话，会试试浏览器自带的听写（不一定有、也不一定准）", model: "例如 whisper-1、gpt-4o-mini-transcribe、FunAudioLLM/SenseVoiceSmall" },
  { k: "tts", title: "他的声音", sub: "他写 [语音:…] 会变成语音消息；点他的消息也能「朗读」", model: "例如 gpt-4o-mini-tts、tts-1、FunAudioLLM/CosyVoice2-0.5B", extra: { key: "voice", label: "声音（voice）", ph: "例如 alloy、nova、onyx；硅基流动是 模型:声音名" } },
  { k: "image", title: "画画", sub: "他写 [画:…] 会画一张图发给你（按张收费，看服务商）", model: "例如 gpt-image-1、dall-e-3、Kwai-Kolors/Kolors", extra: { key: "size", label: "尺寸", ph: "例如 1024x1024；不填用默认" } },
];
const state = ref({}); // k -> { busy, ok, text, url }
async function test(k) {
  state.value[k] = { busy: true };
  try {
    if (k === "tts") {
      const url = await speak("你好呀，这是我的声音。");
      new Audio(url).play().catch(() => {});
      state.value[k] = { ok: true, text: "生成好了，正在播放" };
    } else if (k === "image") {
      const id = await drawImage("一只趴在窗台上晒太阳的橘猫，柔和的水彩风格");
      state.value[k] = { ok: true, text: "画好了", url: await imageURL(id) };
    } else {
      state.value[k] = { busy: true, text: "录 3 秒，随便说句话…" };
      const ctl = await startRecording();
      await new Promise(r => setTimeout(r, 3000));
      const { blob } = await ctl.stop();
      const text = await transcribe(blob);
      state.value[k] = { ok: true, text: text ? `听到的是：「${text}」` : "接口通了，但没听出文字" };
    }
  } catch (e) {
    state.value[k] = { ok: false, text: e?.message || String(e) };
  }
}
</script>

<template>
  <div class="page">
    <SubHeader title="语音和画画" />
    <p class="lead">三样都按「OpenAI 兼容」的格式接：OpenAI、硅基流动、很多中转平台都是这个格式。还没选好哪家就先关着，栖所照常能用；选好了把地址、Key、模型填进来、点测试。</p>

    <template v-for="s in SECTIONS" :key="s.k">
      <div class="section-label">{{ s.title }}</div>
      <div class="card body">
        <label class="switch-row"><span>开启<small class="sub-note">{{ s.sub }}</small></span><input v-model="store.media[s.k].enabled" type="checkbox" /></label>
        <template v-if="store.media[s.k].enabled">
          <label class="field"><span>接口地址</span><input v-model.trim="store.media[s.k].baseUrl" class="input" inputmode="url" autocapitalize="off" placeholder="https://api.openai.com/v1" /></label>
          <label class="field"><span>Key</span><input v-model.trim="store.media[s.k].key" class="input" type="password" autocomplete="off" /></label>
          <label class="field"><span>模型</span><input v-model.trim="store.media[s.k].model" class="input" autocapitalize="off" :placeholder="s.model" /></label>
          <label v-if="s.extra" class="field"><span>{{ s.extra.label }}</span><input v-model.trim="store.media[s.k][s.extra.key]" class="input" autocapitalize="off" :placeholder="s.extra.ph" /></label>
          <button class="btn soft wide" :disabled="state[s.k]?.busy" @click="test(s.k)">{{ state[s.k]?.busy ? (state[s.k].text || "试试中…") : "测试" }}</button>
          <p v-if="state[s.k] && !state[s.k].busy" class="result" :class="{ bad: !state[s.k].ok }">{{ state[s.k].text }}</p>
          <img v-if="state[s.k]?.url" :src="state[s.k].url" alt="" class="preview" />
        </template>
      </div>
    </template>
    <p class="note">Key 存在你的设备里，会跟着同步到你的服务器，不会发给别人。服务商不允许浏览器直接访问的话，地址可以换成你服务器的转发（比如 OpenAI 用 …/p/口令/openai/v1）。</p>
  </div>
</template>

<style scoped>
.lead { margin: -6px 6px 6px; font-size: 0.85rem; color: var(--text-2); line-height: 1.7; }
.body { padding: 14px 16px; }
.switch-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 2px 0 10px; font-size: 0.93rem; }
.switch-row input { width: 20px; height: 20px; accent-color: var(--ink); flex: none; }
.sub-note { display: block; font-size: 0.78rem; color: var(--text-3); line-height: 1.6; margin-top: 2px; }
.wide { width: 100%; }
.result { margin: 10px 2px 0; font-size: 0.85rem; color: #3f8f63; line-height: 1.6; word-break: break-all; }
.result.bad { color: var(--danger); }
.preview { display: block; width: 100%; max-width: 320px; margin: 10px auto 0; border-radius: 14px; }
.note { font-size: 0.8rem; color: var(--text-3); line-height: 1.7; margin: 12px 8px 0; }
</style>
