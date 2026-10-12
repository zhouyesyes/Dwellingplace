<script setup>
// 一本书的封面：有封面图用图，没有就用纯色书皮，书名一个字一行竖着排；左边一道书脊的阴影
import { useImage } from "../../lib/images.js";
import { toneOf } from "../../lib/books.js";

const props = defineProps({ book: Object });
const img = useImage(() => props.book.cover);
</script>

<template>
  <div class="cover" :style="{ '--tone': toneOf(book) }">
    <img v-if="img" :src="img" alt="" />
    <div v-else class="plain"><span>{{ [...book.title].slice(0, 9).join("\n") }}</span></div>
    <i class="spine" />
  </div>
</template>

<style scoped>
.cover { position: relative; aspect-ratio: 2 / 3; container-type: inline-size; border-radius: 2px 5px 5px 2px; overflow: hidden; background: var(--tone); box-shadow: 0 6px 12px rgba(40, 30, 20, .22), inset 0 0 0 1px rgba(0, 0, 0, .05); }
.cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.plain { position: absolute; inset: 0; padding: 12% 0; overflow: hidden; display: flex; justify-content: center; background: linear-gradient(160deg, rgba(255, 255, 255, .25), rgba(0, 0, 0, .08)), var(--tone); }
.plain span { white-space: pre; text-align: center; color: #fff; font-weight: 600; font-size: clamp(9px, 16cqw, 18px); line-height: 1.25; text-shadow: 0 1px 2px rgba(0, 0, 0, .2); }
.spine { position: absolute; left: 0; top: 0; bottom: 0; width: 7%; background: linear-gradient(90deg, rgba(0, 0, 0, .22), rgba(255, 255, 255, .18) 60%, transparent); }
</style>
