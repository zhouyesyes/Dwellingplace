<script setup>
// 搜聊天 / 收藏：从小世界点进来，和小世界一样只占右边半边
import { ref, computed, watch } from "vue";
import { store, roleById } from "../store/index.js";
import { searchChats, snippet, isFav, toggleFav, whoName } from "../lib/recall.js";
import { meName } from "../lib/chat.js";
import Icon from "./Icon.vue";

const props = defineProps({ open: Boolean, roleId: String });
const emit = defineEmits(["close", "go"]);
const role = computed(() => roleById(props.roleId));
const me = computed(() => (role.value ? meName(role.value) : "我"));

const view = ref("chats"); // chats：搜聊天；favs：收藏
const q = ref("");
const hits = ref([]);
const searching = ref(false);
const openHit = ref({});
let timer = 0;
watch([q, () => props.roleId], () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!q.value.trim() || !props.roleId) { hits.value = []; return; }
    searching.value = true;
    try { hits.value = await searchChats(props.roleId, q.value, { limit: 100 }); } finally { searching.value = false; }
  }, 300);
});
const favs = computed(() => (store.favorites || []).filter(f => f.roleId === props.roleId));
const unfav = f => store.favorites.splice(store.favorites.indexOf(f), 1);
const when = ts => new Date(ts).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
</script>

<template>
  <Teleport to="body">
    <Transition name="sp">
      <div v-if="open && role" class="sp-mask" @click="emit('close')">
        <aside class="sp" @click.stop>
          <div class="sp-head">
            <div class="tabs">
              <button :class="{ on: view === 'chats' }" @click="view = 'chats'">搜聊天</button>
              <button :class="{ on: view === 'favs' }" @click="view = 'favs'">收藏<template v-if="favs.length"> {{ favs.length }}</template></button>
            </div>
            <button class="x" aria-label="关上" @click="emit('close')"><Icon name="close" :size="18" /></button>
          </div>

          <template v-if="view === 'chats'">
            <div class="search">
              <Icon name="search" :size="17" />
              <input v-model="q" placeholder="搜你们说过的话（空格隔开：都要有）" />
            </div>
            <div class="hits">
              <article v-for="h in hits" :key="h.m.id" class="hit" :class="{ mine: h.m.from === 'user' }" @click="openHit[h.m.id] = !openHit[h.m.id]">
                <div class="meta"><span>{{ when(h.m.ts) }} · {{ h.m.from === "user" ? me : role.name }}</span>
                  <button class="star" :class="{ on: isFav(h.m) }" :aria-label="isFav(h.m) ? '取消收藏' : '收藏'" @click.stop="toggleFav(h.thread, h.m)"><Icon name="star" :size="17" /></button></div>
                <p>{{ openHit[h.m.id] ? h.text : snippet(h.text, q) }}</p>
                <button v-if="openHit[h.m.id]" class="btn soft small" @click.stop="emit('go', h.thread.id)">去这段对话</button>
              </article>
            </div>
            <p v-if="searching" class="hint">在找……</p>
            <p v-else-if="q.trim() && !hits.length" class="hint">没有找到，换个词试试</p>
            <p v-else-if="!q.trim()" class="hint">输入一个词，在你们所有的聊天里找。点一条看全文，点 ☆ 收藏。</p>
          </template>

          <template v-else>
            <div class="hits">
              <article v-for="f in favs" :key="f.id" class="hit" :class="{ mine: f.from === 'user' }" @click="openHit[f.id] = !openHit[f.id]">
                <div class="meta"><span>{{ when(f.ts) }} · {{ whoName(f, me) }}</span>
                  <button class="star on" aria-label="取消收藏" @click.stop="unfav(f)"><Icon name="star" :size="17" /></button></div>
                <p :class="{ clamp: !openHit[f.id] }">{{ f.text }}</p>
                <button v-if="openHit[f.id] && store.threads.some(t => t.id === f.threadId)" class="btn soft small" @click.stop="emit('go', f.threadId)">去这段对话</button>
              </article>
            </div>
            <p v-if="!favs.length" class="hint">还没有收藏。在聊天里长按一条消息点「收藏」，或者搜到以后点 ☆。</p>
          </template>
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
