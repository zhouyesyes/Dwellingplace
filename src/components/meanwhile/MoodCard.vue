<script setup>
// 水温小卡：点水温卡片、或日历格子里的小水滴弹出来，大图标 + 谁 + 心情名 + 那句话；点外面关掉
import { computed } from "vue";
import { whoInfo, dayLabel } from "../../lib/meanwhile.js";
import { todayYmd } from "../../lib/dates.js";

const props = defineProps({ card: Object, me: String, canEdit: Boolean });
const emit = defineEmits(["close", "edit"]);
const info = computed(() => props.card && whoInfo(props.card.who));
const dayText = computed(() => (props.card && props.card.date !== todayYmd() ? dayLabel(props.card.date) : "今天"));
</script>

<template>
  <Teleport to="body">
    <Transition name="mc">
      <div v-if="card" class="mc-back" @click.self="emit('close')">
        <div class="mc" :style="{ '--c': info.color }" role="dialog" :aria-label="`${info.name}的水温`">
          <button class="x" aria-label="关闭" @click="emit('close')">×</button>
          <img :src="card.mood.img" :alt="card.mood.name" draggable="false" />
          <p class="who"><i />{{ info.name }}<small>{{ dayText }}</small></p>
          <p class="nm">{{ card.mood.name }}<small>{{ card.mood.feel }}</small></p>
          <p class="say" :class="{ none: !card.text }">{{ card.text || "没有写话" }}</p>
          <button v-if="card.who === me && canEdit" class="edit" @click="emit('edit')">改一改</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mc-back { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 24px; background: rgba(20, 24, 34, .38); font-family: "Poppins", var(--font); }
.mc { position: relative; width: min(300px, 100%); padding: 22px 22px 20px; border-radius: 26px; text-align: center; color: var(--text); background: color-mix(in srgb, var(--c) 10%, var(--card)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 30%, transparent), 0 18px 44px rgba(30, 40, 60, .28); }
.mc img { display: block; width: 132px; height: 132px; margin: 4px auto 6px; object-fit: contain; }
.who { margin: 0; display: flex; justify-content: center; align-items: center; gap: 6px; font-size: .86rem; font-weight: 600; }
.who i { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
.who small, .nm small { font-size: .72rem; font-weight: 400; color: var(--text-3); }
.nm { margin: 6px 0 0; font-size: 1.5rem; font-weight: 600; display: flex; justify-content: center; align-items: baseline; gap: 8px; }
.say { margin: 12px 0 0; padding: 10px 12px; border-radius: 14px; background: rgba(var(--tint-rgb), .05); font-size: .95rem; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.say.none { color: var(--text-3); font-size: .82rem; }
.x { position: absolute; top: 8px; right: 10px; width: 30px; height: 30px; border: 0; border-radius: 50%; background: none; color: var(--text-3); font-size: 1.3rem; line-height: 1; }
.edit { margin-top: 12px; border: 0; border-radius: 999px; padding: 6px 18px; background: color-mix(in srgb, var(--accent) 16%, var(--card)); color: var(--text); font-size: .8rem; }
.mc-enter-active, .mc-leave-active { transition: opacity .18s; }
.mc-enter-active .mc, .mc-leave-active .mc { transition: transform .22s cubic-bezier(.2, .9, .3, 1.2); }
.mc-enter-from, .mc-leave-to { opacity: 0; }
.mc-enter-from .mc, .mc-leave-to .mc { transform: scale(.88) translateY(8px); }
</style>
