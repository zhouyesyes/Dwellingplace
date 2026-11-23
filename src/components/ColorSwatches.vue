<script setup>
// 一排色块 + 最后一个「自定义」
defineProps({ colors: Array, compact: Boolean });
const emit = defineEmits(["custom"]);
const model = defineModel({ type: String });
</script>

<template>
  <div class="swatches" :class="{ compact }">
    <button v-for="c in colors" :key="c" type="button" class="sw" :aria-label="'颜色 ' + c" :aria-pressed="model === c" :class="{ on: model === c }" :style="{ background: c }" @click="model = c" />
    <label class="sw custom" :class="{ on: model && !colors.includes(model) }">
      <span :style="{ background: !model || colors.includes(model) ? 'transparent' : model }" />
      <input v-model="model" type="color" aria-label="自定义颜色" @change="emit('custom', $event.target.value)" />
    </label>
  </div>
</template>

<style scoped>
.swatches { display: flex; gap: 10px; flex-wrap: wrap; padding: 2px 4px; }
.sw { position: relative; width: 30px; height: 30px; border-radius: 50%; border: 3px solid transparent; box-shadow: 0 0 0 1px var(--line); padding: 0; cursor: pointer; }
.compact { gap: 8px; }
.compact .sw { width: 20px; height: 20px; flex: none; }
.sw.on { border-color: var(--card); box-shadow: 0 0 0 2px var(--ink); }
.custom { overflow: hidden; background: conic-gradient(#f5a3b5, #f5d36e, #86d1b0, #8cc1f2, #b9a2ef, #f5a3b5); }
.custom span { position: absolute; inset: 4px; border-radius: 50%; }
.custom input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
</style>
