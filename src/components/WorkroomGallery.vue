<script setup>
import { ref, computed, onBeforeUnmount, nextTick } from 'vue';
import { attachmentUrl } from '../lib/workroom.js';
const props = defineProps({ files:Array, task:String });
const images = computed(() => props.files.filter(a => a.type.startsWith('image/')));
const index = ref(-1), dialog = ref(null), scale = ref(1), x = ref(0), y = ref(0);
let opener, start, pinch, moved = false, multi = false, scrollPositions = [];
const src = a => attachmentUrl(props.task, a.id);
function reset() { scale.value = 1; x.value = y.value = 0; }
function step(n) { index.value = Math.max(0, Math.min(images.value.length - 1, index.value + n)); reset(); }
async function open(i, e) {
  opener = e.currentTarget; scrollPositions = [];
  for (let el = opener.parentElement; el; el = el.parentElement) scrollPositions.push([el, el.scrollTop, el.scrollLeft]);
  index.value = i; reset(); await nextTick(); dialog.value.focus({ preventScroll:true });
}
function close() {
  index.value = -1; opener?.focus({ preventScroll:true });
  for (const [el, top, left] of scrollPositions) { el.scrollTop = top; el.scrollLeft = left; }
}
function key(e) {
  if (e.key === 'Escape') close();
  if (['ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1); }
  if (e.key === 'Tab') {
    const nodes = [...dialog.value.querySelectorAll('button:not(:disabled), summary, a[href]')].filter(el => el.getClientRects().length);
    const i = nodes.indexOf(document.activeElement);
    e.preventDefault(); nodes[(i + (e.shiftKey ? -1 : 1) + nodes.length) % nodes.length]?.focus();
  }
}
const distance = t => Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
function down(e) {
  moved = false; multi = e.touches.length > 1;
  start = { x:e.touches[0].clientX, y:e.touches[0].clientY, panX:x.value, panY:y.value, scale:scale.value };
  pinch = multi ? { distance:distance(e.touches), scale:scale.value } : null;
}
function move(e) {
  e.preventDefault(); moved = true;
  if (e.touches.length > 1) {
    multi = true;
    if (!pinch) pinch = { distance:distance(e.touches), scale:scale.value };
    scale.value = Math.max(1, Math.min(5, pinch.scale * distance(e.touches)/pinch.distance));
    if (scale.value === 1) x.value = y.value = 0;
  } else if (start && scale.value > 1) {
    x.value = start.panX + e.touches[0].clientX-start.x;
    y.value = start.panY + e.touches[0].clientY-start.y;
  }
}
function up(e) {
  if (e.touches.length) return;
  if (start && !multi && start.scale === 1 && scale.value === 1) {
    const dx = e.changedTouches[0].clientX-start.x, dy = e.changedTouches[0].clientY-start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)*1.5) step(dx < 0 ? 1 : -1);
  }
  start = null;
}
// 遮罩仅桌面鼠标点击关闭，触屏拖动或轻点图片都不会误退出。
function backdrop(e) {
  if (e.target.tagName === 'IMG' && e.pointerType === 'mouse' && scale.value === 1) {
    const img = e.target, r = img.getBoundingClientRect();
    const ratio = Math.min(r.width/img.naturalWidth, r.height/img.naturalHeight);
    const w = img.naturalWidth*ratio, h = img.naturalHeight*ratio;
    if (Math.abs(e.clientX-(r.left+r.width/2)) > w/2 || Math.abs(e.clientY-(r.top+r.height/2)) > h/2) close();
    return;
  }
  if (e.pointerType === 'mouse' && e.target === e.currentTarget && !moved) close();
  moved = false;
}
onBeforeUnmount(() => { start = null; });
</script>
<template>
  <div class="preview-grid" aria-label="任务效果图">
    <button v-for="(a,i) in images" :key="a.id" :aria-label="`查看效果图 ${i+1}`" @click="open(i,$event)"><img :src="src(a)" alt="效果图" loading="lazy" /></button>
  </div>
  <Teleport to="body">
    <div v-if="index >= 0" ref="dialog" class="gallery" role="dialog" aria-modal="true" aria-label="效果图查看器" tabindex="-1" @keydown="key" @wheel.prevent @pointerup="backdrop">
      <div class="gallery-top"><span aria-live="polite">{{ index+1 }} / {{ images.length }}</span><details><summary aria-label="更多操作">•••</summary><a :href="src(images[index])+'?download=1'" download>下载原图</a><button @click="reset">恢复原比例</button></details><button class="gallery-close" aria-label="关闭大图" @click="close">✕</button></div>
      <div class="gallery-stage" @touchstart="down" @touchmove="move" @touchend="up" @touchcancel="start = null" @pointerup.stop="backdrop">
        <img :key="images[index].id" :src="src(images[index])" alt="效果图" draggable="false" :style="{ transform:`translate(${x}px,${y}px) scale(${scale})` }" @dblclick="reset" />
      </div>
      <button class="gallery-prev" aria-label="上一张" :disabled="index === 0" @click="step(-1)">‹</button>
      <button class="gallery-next" aria-label="下一张" :disabled="index === images.length-1" @click="step(1)">›</button>
    </div>
  </Teleport>
</template>
<style scoped>
.preview-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:8px; max-width:620px; margin:8px 0; }
.preview-grid button { padding:0; border:1px solid var(--line); border-radius:10px; background:var(--bg); overflow:hidden; cursor:zoom-in; }
.preview-grid img { display:block; width:100%; height:160px; object-fit:contain; }
.gallery { position:fixed; inset:0; z-index:5000; background:var(--bg); color:var(--text); overscroll-behavior:none; touch-action:none; outline:none; }
.gallery-top { position:absolute; z-index:2; top:0; left:0; right:0; display:flex; gap:12px; align-items:center; padding: max(12px,env(safe-area-inset-top)) 16px 12px; background:var(--bg); }
.gallery-top span { margin-right:auto; }
.gallery button,.gallery summary,.gallery a { color:var(--text); background:var(--bg); border:1px solid var(--line); border-radius:10px; min-width:44px; min-height:44px; padding:10px; cursor:pointer; font:inherit; }
.gallery details { position:relative; }
.gallery summary { list-style:none; box-sizing:border-box; }
.gallery details a,.gallery details button { display:block; white-space:nowrap; }
.gallery-stage { position:absolute; inset:calc(76px + env(safe-area-inset-top)) 0 calc(16px + env(safe-area-inset-bottom)); overflow:hidden; display:flex; align-items:center; justify-content:center; }
.gallery-stage img { width:100%; height:100%; object-fit:contain; user-select:none; -webkit-user-select:none; }
.gallery-prev,.gallery-next { position:absolute; top:50%; z-index:2; opacity:.85; }
.gallery-prev { left:12px; }.gallery-next { right:12px; }.gallery button:disabled { opacity:.25; }
@media (pointer:coarse) { .gallery-prev,.gallery-next { top:auto; bottom:max(20px,env(safe-area-inset-bottom)); } }
</style>
