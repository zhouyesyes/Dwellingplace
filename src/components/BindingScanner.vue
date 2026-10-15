<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { createQrCamera, decodeQrFile } from '../lib/qrScanner.js';
import { parseBindingPayload } from '../lib/bindingQr.js';
const emit = defineEmits(['result', 'close']);
const video = ref(null), closeButton = ref(null), error = ref(''), working = ref(false), active = ref(false);
let camera, generation = 0, previousFocus;
const stop = () => { generation++; camera?.stop(); active.value = false; };
function found(text) {
  stop();
  try { emit('result', parseBindingPayload(text)); }
  catch (e) { error.value = e.message; }
}
async function start() {
  error.value = '';
  if (!navigator.mediaDevices?.getUserMedia) { error.value = '当前浏览器没有可用摄像头，请使用图片识别或手工输入'; return; }
  active.value = true;
  await camera.start();
}
async function choose(event) {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  stop(); const run = generation; working.value = true; error.value = '';
  try { const text = await decodeQrFile(file); if (generation === run) found(text); }
  catch (e) { if (generation === run) error.value = e.message; }
  finally { working.value = false; }
}
function key(event) {
  if (event.key === 'Escape') emit('close');
  if (event.key !== 'Tab') return;
  const nodes = closeButton.value.closest('[role=dialog]').querySelectorAll('button:not(:disabled),input:not(:disabled)');
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
  else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
}
const visibility = () => { if (document.visibilityState !== 'visible') stop(); };
onMounted(async () => {
  previousFocus = document.activeElement;
  camera = createQrCamera({ video: video.value, onResult: found, onError: message => { active.value = false; error.value = message; } });
  window.addEventListener('pagehide', stop); document.addEventListener('visibilitychange', visibility);
  await nextTick(); closeButton.value.focus();
});
onBeforeUnmount(() => { stop(); window.removeEventListener('pagehide', stop); document.removeEventListener('visibilitychange', visibility); previousFocus?.focus?.(); });
</script>

<template>
  <Teleport to="body">
    <div class="scan-backdrop" @click.self="emit('close')">
      <section role="dialog" aria-modal="true" aria-labelledby="scanner-title" class="scanner" @keydown="key">
        <button ref="closeButton" class="btn soft" aria-label="关闭扫码界面" @click="emit('close')">关闭</button>
        <h2 id="scanner-title">扫描栖所绑定二维码</h2>
        <p>相机和图片仅在本机识别。识别后会先显示服务器地址，由你确认后再绑定。</p>
        <video ref="video" autoplay muted playsinline aria-label="摄像头扫码预览" />
        <button class="btn" :disabled="working" @click="active ? stop() : start()">{{ active ? '停止摄像头' : '开启摄像头' }}</button>
        <label class="file-label">从本地图片识别<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" :disabled="working" aria-label="选择二维码图片" @change="choose" /></label>
        <p role="status">{{ working ? '正在本机识别图片…' : active ? '把二维码放进画面中' : '也可以关闭这里，手工输入绑定码' }}</p>
        <p v-if="error" role="alert" class="error">{{ error }}</p>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.scan-backdrop { position: fixed; inset: 0; z-index: 1000; padding: 20px; display: grid; place-items: center; background: rgba(0,0,0,.5); }
.scanner { background: var(--card); color: var(--text); padding: 20px; border-radius: 20px; max-width: 500px; width: 100%; max-height: 90dvh; overflow: auto; }
h2 { font-size: 1.1rem; }
p { color: var(--text-2); font-size: .9rem; overflow-wrap: anywhere; }
video { display: block; width: 100%; max-height: 32dvh; min-height: 60px; background: #111; margin: 12px 0; border-radius: 10px; }
.btn:not(.soft) { color: var(--on-ink); }
.file-label { display: block; margin-top: 16px; }
input { display: block; width: 100%; margin-top: 8px; }
.error { color: var(--danger); }
</style>
