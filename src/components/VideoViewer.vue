<script setup>
// 看视频：全屏播放，点空白处关掉
import { ref, watch, onBeforeUnmount } from "vue";
import { get } from "../lib/kv.js";
import Icon from "./Icon.vue";

const props = defineProps({ file: String, mime: String, open: Boolean });
const emit = defineEmits(["close"]);
const url = ref("");
const missing = ref(false);
const revoke = () => { if (url.value) URL.revokeObjectURL(url.value); url.value = ""; };
watch(() => [props.open, props.file], async ([o, f]) => {
  revoke(); missing.value = false;
  if (!o || !f) return;
  const blob = await get("file:" + f);
  if (!blob) { missing.value = true; return; }
  url.value = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: props.mime || "video/mp4" }));
});
onBeforeUnmount(revoke);
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="vviewer" @click.self="emit('close')">
        <button class="close" aria-label="关闭" @click="emit('close')"><Icon name="close" :size="22" /></button>
        <video v-if="url" :src="url" controls autoplay playsinline />
        <p v-else-if="missing" class="tip">这段视频还没同步过来</p>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.vviewer { position: fixed; inset: 0; z-index: 300; background: rgba(0, 0, 0, 0.92); display: grid; place-items: center; }
.vviewer video { max-width: 100%; max-height: 100%; }
.close { position: absolute; top: calc(env(safe-area-inset-top) + 12px); right: 12px; width: 40px; height: 40px; border-radius: 50%; border: 0; background: rgba(255, 255, 255, 0.18); color: #fff; display: grid; place-items: center; padding: 0; z-index: 1; }
.tip { color: #fff; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
