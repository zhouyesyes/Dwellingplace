<script setup>
// 从底部弹出的面板
defineProps({ open: Boolean, title: String });
const emit = defineEmits(["close"]);
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="backdrop" @click.self="emit('close')">
        <div class="sheet">
          <div class="grip" />
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
  background: rgba(74, 63, 54, .22);
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
  box-shadow: 0 -10px 40px rgba(120, 90, 60, .12);
}
.grip { width: 38px; height: 5px; border-radius: 3px; background: var(--line); margin: 0 auto 12px; }
h3 { margin: 0 4px 12px; font-size: 16px; font-weight: 600; }
.sheet-enter-active, .sheet-leave-active { transition: opacity .22s; }
.sheet-enter-active .sheet, .sheet-leave-active .sheet { transition: transform .26s cubic-bezier(.2, .8, .2, 1); }
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
.sheet-enter-from .sheet, .sheet-leave-to .sheet { transform: translateY(100%); }
</style>
