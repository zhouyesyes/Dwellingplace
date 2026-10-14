<script setup>
// 主页的小书架（共读）：大封面一本挨一本斜靠着，左右划的时候书跟着转；架子是素色的（白 / 灰 / 黑，点右上角的小圆点换）
import { computed, ref, onMounted, nextTick, watch } from "vue";
import { useRouter } from "vue-router";
import { store } from "../../store/index.js";
import BookCover from "../books/BookCover.vue";
import shelf from "../../assets/books/shelf.webp";

const props = defineProps({ size: String, editing: Boolean });
const router = useRouter();
const books = computed(() => [...(store.books || [])].sort((a, b) => (b.readAt || b.addedAt) - (a.readAt || a.addedAt)));
const fresh = computed(() => (store.bookNotes || []).filter(n => n.from === "ai" && !n.seen).length);
const tone = computed(() => store.settings.shelfTone || "light");

// 每本书离中间多远 → 转多少、往后退多少
const track = ref(null);
const d = ref([]);
function layout() {
  const el = track.value;
  if (!el) return;
  const mid = el.scrollLeft + el.clientWidth * 0.32;
  d.value = [...el.querySelectorAll(".bk")].map(x => (x.offsetLeft + x.offsetWidth / 2 - mid) / x.offsetWidth);
}
const styleOf = i => {
  const v = Math.max(-2.5, Math.min(2.5, d.value[i] ?? i));
  return { transform: `rotateY(${(-v * 11).toFixed(1)}deg) rotateZ(${(-5 + v * 1.8).toFixed(1)}deg) translateZ(${(-Math.abs(v) * 16).toFixed(0)}px)`, zIndex: 100 - Math.round(Math.abs(v) * 10) };
};
onMounted(() => nextTick(() => { if (track.value) track.value.scrollLeft = 0; layout(); }));
watch(() => books.value.length, () => nextTick(layout));

// 点哪本就直接打开哪本（以前不在中间的要先点一下挪到中间，要点好几次才进得去）
function open(b) {
  if (props.editing) return;
  router.push(`/read/${b.id}`);
}
// 右上角的小圆点：白 → 灰 → 黑 轮着换架子颜色
const TONES = ["light", "grey", "dark"];
const nextTone = () => { store.settings.shelfTone = TONES[(TONES.indexOf(tone.value) + 1) % TONES.length]; };
const go = () => { if (!props.editing) router.push("/books"); };
</script>

<template>
  <div class="bw" @click="go">
    <div class="head"><b>Bookshelf</b><span v-if="fresh" class="dot">{{ fresh }} 张新便利贴</span><span v-else class="sub">{{ books.length ? `${books.length} 本` : "放一本书进来" }}</span>
      <button class="room" aria-label="进共读室" @click.stop="go">共读室 ›</button>
      <button class="tone" :class="tone" aria-label="换书架颜色" @click.stop="nextTone"><i /></button></div>
    <div class="stage">
      <div ref="track" class="track" @scroll.passive="layout">
        <button v-for="(b, i) in books" :key="b.id" class="bk" :style="styleOf(i)" :aria-label="b.title" @click.stop="open(b)"><BookCover :book="b" /></button>
        <button class="bk add" :style="styleOf(books.length)" aria-label="放一本书" @click.stop="go"><span>＋</span></button>
        <i class="tail" />
      </div>
      <img :src="shelf" alt="" class="plank" :class="tone" />
    </div>
  </div>
</template>

<style scoped>
.bw { position: absolute; inset: 0; border-radius: inherit; padding: 12px 0 10px; background: var(--card); cursor: pointer; display: flex; flex-direction: column; }
.head { display: flex; align-items: baseline; padding: 0 18px 2px; }
.head b { font-weight: 300; letter-spacing: .14em; font-size: 1.05rem; color: var(--text); }
.head .sub, .head .dot { margin-left: auto; }
.tone { margin-left: 8px; width: 22px; height: 22px; border: 0; padding: 0; border-radius: 50%; background: none; display: grid; place-items: center; align-self: center; }
.tone i { width: 13px; height: 13px; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0, 0, 0, .14), 0 0 0 3px var(--card), 0 0 0 4px var(--line); }
.tone.light i { background: color-mix(in srgb, #f4f1ec var(--pastel), var(--card)); }
.tone.grey i { background: #a9a9ad; }
.tone.dark i { background: #3a3a40; }
.sub { font-size: .72rem; color: var(--text-3); }
/* 进共读室：标题行右边一个明显的入口（以前只能点书架空白处，常常点到书或者滑走） */
.room { margin-left: 8px; border: 0; background: var(--bg-deep); color: var(--text-2); font-size: .72rem; padding: 4px 10px; border-radius: 999px; align-self: center; }
.dot { font-size: .7rem; color: var(--text-2); background: var(--bg-deep); padding: 2px 9px; border-radius: 999px; }
.stage { position: relative; perspective: 700px; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.track { flex: 1; min-height: 0; display: flex; align-items: flex-end; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; padding: 8px 18px 0; }
.track::-webkit-scrollbar { display: none; }
.bk { flex: none; height: 100%; aspect-ratio: 2 / 3; margin-right: -5%; border: 0; padding: 0; background: none; transform-origin: 50% 100%; transition: transform .12s linear; position: relative; }
.bk.add { margin-right: 0; border-radius: 4px; border: 1.5px dashed var(--line); color: var(--text-3); font-size: 1.4rem; display: grid; place-items: center; background: var(--card-2); }
.tail { flex: 0 0 45%; }
.plank { display: block; width: calc(100% - 20px); margin: -6px 10px 0; height: auto; position: relative; z-index: 200; }
/* 木板染成素色 */
.plank.light { filter: grayscale(1) brightness(1.32) contrast(.85) drop-shadow(0 6px 8px rgba(40, 40, 60, .1)); }
.plank.grey { filter: grayscale(1) brightness(.92) drop-shadow(0 6px 8px rgba(40, 40, 60, .12)); }
.plank.dark { filter: grayscale(1) brightness(.32) contrast(1.15) drop-shadow(0 6px 8px rgba(0, 0, 0, .2)); }
</style>
