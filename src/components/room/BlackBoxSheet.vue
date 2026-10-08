<script setup>
// TA 的黑匣子：现在还打不开，先放一个上着锁的页面，以后再往里放东西
import Sheet from "../Sheet.vue";
defineProps({ role: { type: Object, required: true }, open: Boolean });
const emit = defineEmits(["close"]);
</script>

<template>
  <Sheet :open="open" title="黑匣子" @close="emit('close')">
    <div class="box">
      <div class="lock">🔒</div>
      <p class="t">{{ role.name }} 的黑匣子还上着锁。</p>
      <p class="s">这是 TA 自己的箱子，只有 TA 能打开。<br />里面会放什么，以后再说～</p>
    </div>
  </Sheet>
</template>

<style scoped>
.box { text-align: center; padding: 18px 8px 26px; }
.lock { font-size: 2.6rem; margin-bottom: 10px; }
.t { margin: 0 0 6px; font-size: 1rem; font-weight: 600; }
.s { margin: 0; color: var(--text-3); font-size: 0.87rem; line-height: 1.8; }
</style>
