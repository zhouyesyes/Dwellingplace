<script setup>
// 共写讨论的搜索 / 收藏：和小世界一样只占右边半边。收藏只留在这本书里，不进聊天的收藏
import { ref, computed } from "vue";
import { snippet } from "../../lib/recall.js";
import Icon from "../Icon.vue";

const props = defineProps({ open: Boolean, msgs: Array, me: String, him: String });
const emit = defineEmits(["close", "go", "fav"]);
const view = ref("search"); // search：搜讨论；favs：收藏
const q = ref("");
const openHit = ref({});
const words = computed(() => q.value.trim().toLowerCase().split(/\s+/).filter(Boolean));
const hits = computed(() => (words.value.length ? (props.msgs || []).filter(m => words.value.every(w => (m.text || "").toLowerCase().includes(w))) : []).slice().reverse());
const favs = computed(() => (props.msgs || []).filter(m => m.fav).reverse());
const when = ts => new Date(ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const who = m => (m.from === "me" ? props.me : props.him);
</script>

<template>
  <Teleport to="body">
    <Transition name="sp">
      <div v-if="open" class="sp-mask" @click="emit('close')">
        <aside class="sp" @click.stop>
          <div class="sp-head">
            <div class="tabs">
              <button :class="{ on: view === 'search' }" @click="view = 'search'">搜讨论</button>
              <button :class="{ on: view === 'favs' }" @click="view = 'favs'">收藏<template v-if="favs.length"> {{ favs.length }}</template></button>
            </div>
            <button class="x" aria-label="关上" @click="emit('close')"><Icon name="close" :size="18" /></button>
          </div>

          <template v-if="view === 'search'">
            <div class="search">
              <Icon name="search" :size="17" />
              <input v-model="q" placeholder="搜这本书里聊过的话" />
            </div>
          </template>
          <div class="hits">
            <article v-for="m in view === 'search' ? hits : favs" :key="m.id" class="hit" :class="{ mine: m.from === 'me' }" @click="openHit[m.id] = !openHit[m.id]">
              <div class="meta"><span>{{ when(m.ts) }} · {{ who(m) }}</span>
                <button class="star" :class="{ on: m.fav }" :aria-label="m.fav ? '取消收藏' : '收藏'" @click.stop="emit('fav', m)"><Icon name="star" :size="17" /></button></div>
              <p :class="{ clamp: !openHit[m.id] }">{{ openHit[m.id] || view === 'favs' ? m.text : snippet(m.text, q) }}</p>
              <button v-if="openHit[m.id]" class="btn soft small" @click.stop="emit('go', m.id)">回到这一句</button>
            </article>
          </div>
          <p v-if="view === 'search' && q.trim() && !hits.length" class="hint">没有找到，换个词试试</p>
          <p v-else-if="view === 'search' && !q.trim()" class="hint">输入一个词，在这本书的讨论里找（空格隔开：都要有）。</p>
          <p v-else-if="view === 'favs' && !favs.length" class="hint">还没有收藏。点讨论里的一句，选「收藏」；收藏只留在这本书里。</p>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sp-mask { position: fixed; inset: 0; z-index: 810; background: rgba(30, 30, 40, .18); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.sp {
  position: absolute; top: 0; right: 0; bottom: 0; width: min(86vw, 420px); overflow-y: auto;
  padding: calc(var(--safe-top) + 16px) 14px calc(var(--safe-bottom) + 24px);
  background: rgba(246, 246, 248, .9); -webkit-backdrop-filter: blur(22px); backdrop-filter: blur(22px);
  border-radius: 26px 0 0 26px; box-shadow: -10px 0 40px rgba(30, 30, 50, .14);
}
.sp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.tabs { display: flex; gap: 6px; background: rgba(255, 255, 255, .7); padding: 4px; border-radius: 999px; }
.tabs button { border: 0; background: none; padding: 6px 14px; border-radius: 999px; font-size: .85rem; color: var(--text-2); }
.tabs button.on { background: var(--ink); color: #fff; font-weight: 600; }
.x { border: 0; background: rgba(255, 255, 255, .8); width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: var(--text-2); }
.search { display: flex; align-items: center; gap: 8px; background: #fff; border-radius: 999px; padding: 9px 14px; margin-bottom: 12px; color: var(--text-3); box-shadow: var(--shadow-soft); }
.search input { flex: 1; border: 0; outline: none; background: none; font-size: .9rem; color: var(--text); min-width: 0; }
.hits { display: flex; flex-direction: column; gap: 10px; }
.hit { background: #fff; border-radius: 16px; padding: 11px 13px; box-shadow: var(--shadow-soft); cursor: pointer; border-left: 4px solid var(--blue); }
.hit.mine { border-left-color: var(--pink); }
.meta { display: flex; justify-content: space-between; align-items: center; font-size: .72rem; color: var(--text-3); }
.hit p { margin: 4px 0 0; font-size: .88rem; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.hit p.clamp { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.hit .btn { margin-top: 8px; }
.star { border: 0; background: none; color: var(--text-3); padding: 2px; }
.star.on { color: #e0a53a; }
.star.on :deep(path) { fill: currentColor; }
.hint { text-align: center; color: var(--text-3); font-size: .82rem; margin: 24px 8px; }
.sp-enter-active, .sp-leave-active { transition: opacity .25s; }
.sp-enter-active .sp, .sp-leave-active .sp { transition: transform .3s cubic-bezier(.2, .8, .2, 1); }
.sp-enter-from, .sp-leave-to { opacity: 0; }
.sp-enter-from .sp, .sp-leave-to .sp { transform: translateX(100%); }
</style>
