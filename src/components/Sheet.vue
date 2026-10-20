<script setup>
// 从底部弹出的面板
import { ref, computed, watch, onBeforeUnmount } from "vue";
const props = defineProps({ open: Boolean, title: String, z: Number });
const emit = defineEmits(["close"]);

// iPhone：键盘弹起时，面板整个待在键盘上面看得见的那块里（跟着 visualViewport 走），内容多了在面板里滚；
// 键盘收起（屏幕高度恢复）就复位，不留错位
const kb = ref(null); // { top, height }，键盘没开是 null
function fit() {
  const vv = window.visualViewport;
  if (vv && vv.height < window.innerHeight * 0.8) {
    kb.value = { top: Math.round(vv.offsetTop), height: Math.round(vv.height) };
    // 正在输入的框滚到看得见的地方
    setTimeout(() => document.activeElement?.scrollIntoView?.({ block: "nearest" }), 50);
  } else kb.value = null;
}
watch(() => props.open, on => {
  const vv = window.visualViewport;
  if (!vv) return;
  if (on) { vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); fit(); }
  else { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); kb.value = null; }
}, { immediate: true });
onBeforeUnmount(() => { window.visualViewport?.removeEventListener("resize", fit); window.visualViewport?.removeEventListener("scroll", fit); });
const backdropStyle = computed(() => ({
  ...(props.z ? { zIndex: props.z } : null),
  ...(kb.value ? { top: `${kb.value.top}px`, height: `${kb.value.height}px`, bottom: "auto" } : null),
}));
const sheetStyle = computed(() => (kb.value ? { maxHeight: `${kb.value.height - 12}px`, paddingBottom: "20px" } : null));
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="backdrop" :style="backdropStyle" @click.self="emit('close')">
        <div class="sheet" :style="sheetStyle">
          <div class="grip" />
          <button class="close" aria-label="关闭" @click="emit('close')">×</button>
          <h3 v-if="title">{{ title }}</h3>
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(30, 30, 40, .22);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.sheet {
  width: 100%;
  max-width: 560px;
  max-height: 82dvh;
  overflow-y: auto;
  background: var(--card);
  border-radius: 28px 28px 0 0;
  padding: 10px 18px calc(var(--safe-bottom) + 20px);
  box-shadow: 0 -10px 40px rgba(40, 40, 60, .12);
}
.sheet { position: relative; }
.close { position: absolute; top: 10px; right: 12px; width: 32px; height: 32px; border: 0; border-radius: 50%; background: var(--bg); color: var(--text-2); font-size: 1.25rem; line-height: 1; display: grid; place-items: center; z-index: 1; }
.grip { width: 38px; height: 5px; border-radius: 3px; background: var(--line); margin: 0 auto 12px; }
h3 { margin: 0 44px 12px 4px; font-size: 1.07rem; font-weight: 600; }
.sheet-enter-active, .sheet-leave-active { transition: opacity .22s; }
.sheet-enter-active .sheet, .sheet-leave-active .sheet { transition: transform .26s cubic-bezier(.2, .8, .2, 1); }
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
.sheet-enter-from .sheet, .sheet-leave-to .sheet { transform: translateY(100%); }
</style>
