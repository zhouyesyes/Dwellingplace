<script setup>
// 内在张力：两股互相拉扯的驱力放在天平两头，哪边重就往哪边沉
import { computed } from "vue";

const props = defineProps({ drives: { type: Array, default: () => [] } });
const PAIRS = [["possess", "duty"], ["share", "reflection"], ["libido", "monitor"]];
const rows = computed(() => {
  const by = Object.fromEntries(props.drives.map(d => [d.key, d]));
  return PAIRS.filter(([a, b]) => by[a] && by[b]).map(([a, b]) => {
    const L = by[a], R = by[b];
    const sum = (L.value || 0) + (R.value || 0) || 1;
    const lp = Math.round(((L.value || 0) / sum) * 100);
    return { L, R, lp, rp: 100 - lp, tilt: ((L.value - R.value) / sum) * 14 };
  });
});
const name = d => d.short || d.label;
</script>

<template>
  <div class="scales">
    <div v-for="r in rows" :key="r.L.key" class="row">
      <div class="side"><b>{{ name(r.L) }}</b><span class="lp">{{ r.lp }}%</span></div>
      <svg viewBox="0 0 200 74" class="scale">
        <ellipse cx="100" cy="68" rx="26" ry="4" fill="#ece8f0" />
        <rect x="98" y="22" width="4" height="46" rx="2" fill="#c3cde0" />
        <g :transform="`rotate(${-r.tilt} 100 20)`">
          <rect x="18" y="17" width="164" height="6" rx="3" fill="url(#beam)" />
          <line x1="34" y1="22" x2="34" y2="44" stroke="#c9c4cc" />
          <line x1="166" y1="22" x2="166" y2="44" stroke="#c9c4cc" />
          <path d="M 22 44 Q 34 58 46 44 Z" fill="#fbe8ee" stroke="#ecbccb" />
          <path d="M 154 44 Q 166 58 178 44 Z" fill="#e7f2f8" stroke="#b9d7e6" />
        </g>
        <circle cx="100" cy="20" r="5" fill="#9fb1d1" stroke="#fff" stroke-width="2" />
        <defs>
          <linearGradient id="beam" x1="0" x2="1">
            <stop offset="0" stop-color="#f0bccb" /><stop offset="1" stop-color="#b9d7e6" />
          </linearGradient>
        </defs>
      </svg>
      <div class="side right"><b>{{ name(r.R) }}</b><span class="rp">{{ r.rp }}%</span></div>
    </div>
  </div>
</template>

<style scoped>
.row { display: grid; grid-template-columns: 3.6em minmax(0, 1fr) 3.6em; align-items: center; gap: 6px; padding: 6px 0; }
.row + .row { border-top: 1px solid var(--line); }
.side { display: flex; flex-direction: column; font-size: 0.8rem; }
.side.right { text-align: right; }
.lp { color: #c4718f; font-size: 0.85rem; }
.rp { color: #6f9fb9; font-size: 0.85rem; }
.scale { width: 100%; height: auto; display: block; }
</style>
