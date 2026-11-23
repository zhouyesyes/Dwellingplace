<script setup>
import { onBeforeUnmount, ref, watch } from "vue";

// 一排色块 + 最后一个「自定义」
const props = defineProps({ colors: Array, compact: Boolean, removable: Array, manage: Boolean });
const emit = defineEmits(["custom", "remove"]);
const model = defineModel({ type: String });

const managing = ref(false);
let pressTimer;
let pressStart;
let heldColor;

function cancelPress() {
  clearTimeout(pressTimer);
  pressStart = null;
}
function startPress(event, color) {
  cancelPress();
  heldColor = null;
  if (event.pointerType === "mouse" || !props.removable?.includes(color)) return;
  pressStart = [event.clientX, event.clientY];
  pressTimer = setTimeout(() => requestRemove(color), 550);
}
function movePress(event) {
  if (pressStart && Math.hypot(event.clientX - pressStart[0], event.clientY - pressStart[1]) > 8) cancelPress();
}
function requestRemove(color) {
  cancelPress();
  if (!props.removable?.includes(color) || heldColor === color) return;
  heldColor = color;
  emit("remove", color);
}
function selectColor(event, color) {
  if (event.detail === 0 || heldColor !== color) model.value = color;
  heldColor = null;
}
watch(() => props.removable?.length, count => {
  if (!count) managing.value = false;
});
onBeforeUnmount(cancelPress);
</script>

<template>
  <button v-if="manage && removable?.length" type="button" class="manage" :aria-expanded="managing"
    @click="managing = !managing">{{ managing ? "完成" : "管理自定义颜色" }}</button>
  <div v-if="managing && removable?.length" class="swatches compact no-select" @selectstart.prevent @contextmenu.prevent>
    <button v-for="c in removable" :key="c" type="button" class="sw remove" :style="{ background: c }"
      :aria-label="'删除颜色 ' + c" @click="emit('remove', c)">×</button>
  </div>
  <div v-else class="swatches" :class="{ compact, 'no-select': removable?.length }" @selectstart.prevent>
    <button v-for="c in colors" :key="c" type="button" class="sw"
      :aria-label="'颜色 ' + c + (removable?.includes(c) ? '，长按或按删除键移除' : '')"
      :aria-pressed="model === c" :class="{ on: model === c }" :style="{ background: c }"
      @pointerdown="startPress($event, c)" @pointermove="movePress" @pointerup="cancelPress"
      @pointercancel="cancelPress" @pointerleave="cancelPress"
      @contextmenu.prevent="requestRemove(c)" @keydown.delete.prevent="heldColor = null; requestRemove(c)"
      @click="selectColor($event, c)" />
    <label class="sw custom" :class="{ on: model && !colors.includes(model) }">
      <span :style="{ background: !model || colors.includes(model) ? 'transparent' : model }" />
      <input v-model="model" type="color" aria-label="自定义颜色" @change="emit('custom', $event.target.value)" />
    </label>
  </div>
</template>

<style scoped>
.no-select, .no-select .sw { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.no-select .sw { touch-action: manipulation; }
.manage { justify-self: start; padding: 4px 0; border: 0; background: none; color: var(--text-2); cursor: pointer; }
.sw.remove { color: var(--text); font: 700 13px/1 system-ui, sans-serif; text-shadow: 0 0 3px var(--card), 0 0 3px var(--card); }
.swatches { display: flex; gap: 10px; flex-wrap: wrap; padding: 2px 4px; }
.sw { position: relative; width: 30px; height: 30px; border-radius: 50%; border: 3px solid transparent; box-shadow: 0 0 0 1px var(--line); padding: 0; cursor: pointer; }
.compact { gap: 8px; }
.compact .sw { width: 20px; height: 20px; flex: none; }
.sw.on { border-color: var(--card); box-shadow: 0 0 0 2px var(--ink); }
.custom { overflow: hidden; background: conic-gradient(#f5a3b5, #f5d36e, #86d1b0, #8cc1f2, #b9a2ef, #f5a3b5); }
.custom span { position: absolute; inset: 4px; border-radius: 50%; }
.custom input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
</style>
