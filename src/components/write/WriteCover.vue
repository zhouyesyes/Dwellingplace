<script setup>
// 共写一本书的封面：自己换过图就用图，没换就是书脊色的一本小书，上面印着书名
import { computed } from "vue";
import { useImage } from "../../lib/images.js";
import { SPINES } from "../../lib/writing.js";

const props = defineProps({ book: Object });
const img = useImage(() => props.book?.cover);
const c = computed(() => SPINES[(props.book?.color || 0) % SPINES.length]);
</script>

<template>
  <div class="wcover" :class="{ img }" :style="{ '--c': c, backgroundImage: img ? `url(${img})` : null }">
    <template v-if="!img"><i class="band" /><b>{{ book?.title }}</b></template>
  </div>
</template>

<style scoped>
.wcover {
  position: relative; aspect-ratio: 2 / 3; border-radius: 3px 8px 8px 3px; overflow: hidden;
  background: linear-gradient(160deg, color-mix(in srgb, var(--c) 70%, #fff), var(--c)); background-size: cover; background-position: center;
  box-shadow: 0 8px 18px rgba(40, 40, 60, .16), inset 0 0 0 1px rgba(255, 255, 255, .35);
  display: flex; align-items: flex-start; justify-content: center; padding: 22% 12% 0 18%;
}
.band { position: absolute; left: 0; top: 0; bottom: 0; width: 9%; background: color-mix(in srgb, var(--c) 78%, #000); opacity: .35; }
.wcover:not(.img)::after { content: ""; position: absolute; left: 9%; top: 0; bottom: 0; width: 2px; background: rgba(255, 255, 255, .45); }
b { position: relative; font-size: .78em; font-weight: 700; line-height: 1.35; color: rgba(40, 32, 30, .78); text-align: center; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
</style>
