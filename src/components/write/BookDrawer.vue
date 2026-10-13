<script setup>
// 共写一本书的「资料」：和小世界一样从右边滑出半边。
// 最上面是这本书：封面、书名、书脊颜色、一句话定位、简介；下面是资料夹（人物、设定、大纲……一类一个），点开看里面的卡片。
// 长按资料夹、卡片，拖着排顺序——发给他的时候就按这个顺序
import { ref, computed, watch } from "vue";
import { cardsOf, notesOfCard, CARD_TYPES, SPINES, cardBg, folderOrder, placeFolder, placeCard } from "../../lib/writing.js";
import Icon from "../Icon.vue";
import AttList from "./AttList.vue";
import WriteCover from "./WriteCover.vue";
import { vAutoGrow } from "../../lib/autogrow.js";

const props = defineProps({ open: Boolean, book: Object, him: String, wf: { type: Number, default: 1 } });
const emit = defineEmits(["close", "cover", "card", "new", "import"]);
const folder = ref(null); // 打开的资料夹（类型）
watch(() => props.open, o => { if (!o) { folder.value = null; endDrag(); } });

// ---------- 长按拖动排顺序 ----------
// 按住不动 0.35 秒 → 拿起来（轻轻一震）；拖到别的上面就换过去；松手放下。拖的时候页面不滚
const drag = ref(null); // { kind: "folder" | "card", key }
let press = null, justDragged = false;
function onDown(e, kind, key) {
  press = { x: e.clientX, y: e.clientY, t: setTimeout(() => { drag.value = { kind, key }; navigator.vibrate?.(12); }, 350) };
}
function onMove(e) {
  if (press && !drag.value && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.t); press = null; }
  if (!drag.value) return;
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-k]");
  if (!el || el.dataset.k === drag.value.key) return;
  if (drag.value.kind === "folder") placeFolder(props.book, drag.value.key, folders.value.indexOf(el.dataset.k));
  else { const c = inFolder.value.find(x => x.id === drag.value.key); if (c) placeCard(c, inFolder.value.findIndex(x => x.id === el.dataset.k)); }
}
function endDrag() {
  if (press) clearTimeout(press.t);
  press = null;
  if (drag.value) { justDragged = true; setTimeout(() => (justDragged = false), 50); }
  drag.value = null;
}
// 拖着的时候别让页面跟着滚（iPhone 上要在 touchmove 里拦）
const stopScroll = e => { if (drag.value) e.preventDefault(); };
const aside = ref(null);
watch(aside, (el, old) => { old?.removeEventListener("touchmove", stopScroll); el?.addEventListener("touchmove", stopScroll, { passive: false }); });
const tapFolder = k => { if (!justDragged) folder.value = k; };
const tapCard = c => { if (!justDragged) emit("card", c); };
const folders = computed(() => (props.book ? folderOrder(props.book) : []));
const all = computed(() => (props.book ? cardsOf(props.book.id) : []));
const inFolder = computed(() => all.value.filter(c => c.type === folder.value));
const count = k => all.value.filter(c => c.type === k).length;
const fresh = k => all.value.some(c => c.type === k && notesOfCard(c.id).some(n => n.from === "ai" && !n.seen));
const peek = k => all.value.filter(c => c.type === k).slice(-2).map(c => c.title || "无题").join("、");
</script>

<template>
  <Teleport to="body">
    <Transition name="sp">
      <div v-if="open && book" class="sp-mask" @click="emit('close')">
        <aside ref="aside" class="sp" :class="{ dragging: drag }" :style="{ '--wf': wf }" @click.stop @pointermove="onMove" @pointerup="endDrag" @pointercancel="endDrag">
          <div class="sp-head">
            <button v-if="folder" class="x" aria-label="回资料夹" @click="folder = null"><Icon name="back" :size="18" /></button>
            <h2 class="script">{{ folder ? CARD_TYPES[folder].label : "这本书" }}</h2>
            <button class="x" aria-label="关上" @click="emit('close')"><Icon name="close" :size="18" /></button>
          </div>

          <template v-if="!folder">
            <!-- 这本书：封面在中间，下面书名、一句话定位、书脊颜色、简介（都是点一下就能改） -->
            <div class="me">
              <button class="cv" aria-label="换封面" @click="emit('cover')"><WriteCover :book="book" /></button>
              <input :value="book.title" class="t-in" maxlength="60" placeholder="书名" @change="e => e.target.value.trim() && (book.title = e.target.value.trim())" />
              <input v-model="book.pitch" class="pitch" maxlength="80" placeholder="一句话定位（点这里写）" />
              <div class="spines"><button v-for="(c, i) in SPINES" :key="i" :style="{ '--c': c }" :class="{ on: book.color === i }" :aria-label="'书脊颜色 ' + (i + 1)" @click="book.color = i" /></div>
              <textarea v-model="book.synopsis" v-auto-grow class="syn" rows="3" :placeholder="`写一段简介：这本书讲什么、想写成什么样。${him}讨论时会看着它`" />
            </div>

            <p class="sec">资料夹<small>　长按拖动排顺序，{{ him }}看资料就按这个顺序</small></p>
            <div class="folders">
              <div v-for="k in folders" :key="k" :data-k="k" class="folder" :class="['c' + (Object.keys(CARD_TYPES).indexOf(k) % 7), { empty: !count(k), lifted: drag?.key === k }]" role="button" tabindex="0" @pointerdown="onDown($event, 'folder', k)" @click="tapFolder(k)" @contextmenu.prevent>
                <i class="tab" />
                <b><i class="mark" />{{ CARD_TYPES[k].label }}</b>
                <small>{{ count(k) ? peek(k) : "空的" }}</small>
                <em>{{ count(k) }}<i v-if="fresh(k)" class="dot" /></em>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="f-acts">
              <button class="btn small" @click="emit('new', folder)"><Icon name="edit" :size="15" /> 写一张</button>
              <button class="btn soft small" @click="emit('import', folder)"><Icon name="upload" :size="15" /> 导入图片、文件</button>
            </div>
            <div class="cards">
              <div v-for="c in inFolder" :key="c.id" :data-k="c.id" class="card" :class="{ lifted: drag?.key === c.id }" role="button" tabindex="0" :style="{ background: cardBg(c) }" @pointerdown="onDown($event, 'card', c.id)" @click="tapCard(c)" @contextmenu.prevent>
                <b>{{ c.title || "无题" }}</b>
                <p v-if="c.content">{{ c.content }}</p>
                <AttList v-if="c.atts?.length" :atts="c.atts.slice(0, 3)" small />
                <div class="foot"><small>{{ c.from === "ai" ? `${him} 提的` : "" }}</small>
                  <span v-if="notesOfCard(c.id).length" class="stk" :class="{ fresh: notesOfCard(c.id).some(n => n.from === 'ai' && !n.seen) }">{{ notesOfCard(c.id).length }}</span></div>
              </div>
            </div>
            <p v-if="!inFolder.length" class="hint">这个资料夹还是空的。写一张，或者导入图片、文件（每个文件一张卡片）。</p>
          </template>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sp-mask { position: fixed; inset: 0; z-index: 810; background: rgba(30, 30, 40, .18); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.sp {
  position: absolute; top: 0; right: 0; bottom: 0; width: min(88vw, 440px); overflow-y: auto;
  padding: calc(var(--safe-top) + 14px) 16px calc(var(--safe-bottom) + 24px);
  background: rgba(248, 247, 245, .9); -webkit-backdrop-filter: blur(22px) saturate(1.2); backdrop-filter: blur(22px) saturate(1.2);
  border-radius: 26px 0 0 26px; box-shadow: -10px 0 40px rgba(30, 30, 40, .12);
}
.sp-head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.script { flex: 1; margin: 0; font-size: 1.15rem; font-weight: 600; letter-spacing: .06em; }
.x { border: 0; background: rgba(255, 255, 255, .8); width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: var(--text-2); flex: none; }
.me { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 6px 4px 0; }
.cv { width: 48%; max-width: 190px; border: 0; padding: 0; background: none; }
.cv .wcover { width: 100%; font-size: 26px; border-radius: 2px 6px 6px 2px; }
.t-in, .pitch, .syn { width: 100%; border: 0; background: none; text-align: center; outline: none; border-radius: 10px; padding: 4px 8px; }
.t-in:focus, .pitch:focus, .syn:focus { background: rgba(255, 255, 255, .8); }
.t-in { margin-top: 8px; font-size: calc(1.6rem * var(--wf, 1)); font-weight: 700; letter-spacing: .08em; }
.pitch { font-size: calc(.82rem * var(--wf, 1)); color: var(--text-2); margin-top: -6px; }
.spines { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; padding: 4px 0; }
.spines button { width: 16px; height: 16px; border: 0; border-radius: 50%; padding: 0; background: var(--c); }
.spines button.on { box-shadow: 0 0 0 2px #fff, 0 0 0 3.5px var(--c); }
.syn { font-size: calc(.92rem * var(--wf, 1)); line-height: 1.75; color: var(--text); resize: none; field-sizing: content; min-height: 3.5em; }
.syn::placeholder, .pitch::placeholder { color: var(--text-3); }
.sec { margin: 26px 4px 10px; font-size: calc(.85rem * var(--wf, 1)); font-weight: 600; color: var(--text-2); }
.folders { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 10px; }
/* 资料夹是白的，只有标题前一个小色点 */
.folder {
  position: relative; border: 0; text-align: left; cursor: pointer; padding: 14px 12px 10px; min-height: 84px; border-radius: 4px 14px 14px 14px; margin-top: 8px;
  background: #fff; box-shadow: 0 3px 12px rgba(40, 40, 60, .07); display: flex; flex-direction: column; gap: 3px;
}
.folder .tab { position: absolute; top: -8px; left: 0; width: 42%; height: 12px; border-radius: 6px 10px 0 0; background: #ebebef; }
.folder.empty { background: #f6f6f8; box-shadow: none; }
.folder.empty .tab { background: #e6e6ea; }
.folder b { font-size: calc(.95rem * var(--wf, 1)); display: flex; align-items: center; gap: 7px; }
.mark { width: 7px; height: 7px; border-radius: 50%; background: #ffadc6; flex: none; }
.c1 .mark { background: #ffcb85; } .c2 .mark { background: #8fd3f4; } .c3 .mark { background: #a6e3a1; }
.c4 .mark { background: #bfa8f6; } .c5 .mark { background: #ffa494; } .c6 .mark { background: #c9c3ba; }
.sec small { font-weight: 400; color: var(--text-3); font-size: .72rem; }
.folder, .card { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; transition: transform .15s, box-shadow .15s; }
.lifted { transform: scale(1.05); box-shadow: 0 14px 30px rgba(40, 40, 60, .2) !important; z-index: 2; }
.dragging .folder:not(.lifted), .dragging .card:not(.lifted) { opacity: .75; }
.card { position: relative; }
.folder small { font-size: calc(.7rem * var(--wf, 1)); color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.folder em { position: absolute; right: 12px; bottom: 8px; font-style: normal; font-size: 1.15rem; font-weight: 300; color: var(--text-3); }
.dot { position: absolute; top: 0; right: -8px; width: 7px; height: 7px; border-radius: 50%; background: #6aa7e0; }
.f-acts { display: flex; gap: 8px; margin-bottom: 12px; }
.f-acts .btn { display: inline-flex; align-items: center; gap: 4px; }
.cards { display: flex; flex-direction: column; gap: 10px; }
.card { cursor: pointer; border-radius: 16px; padding: 13px 14px 10px; box-shadow: var(--shadow-soft); display: flex; flex-direction: column; gap: 6px; }
.card b { font-size: calc(1rem * var(--wf, 1)); font-weight: 700; }
.card p { margin: 0; font-size: calc(.84rem * var(--wf, 1)); line-height: 1.65; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
.foot { display: flex; justify-content: space-between; align-items: center; }
.foot small { font-size: .68rem; color: var(--text-3); }
.stk { min-width: 20px; height: 20px; padding: 0 5px; border-radius: 3px; background: #f4e7a8; font-size: .7rem; display: grid; place-items: center; transform: rotate(4deg); }
.stk.fresh { background: #cfe0f2; }
.hint { text-align: center; color: var(--text-3); font-size: .8rem; line-height: 1.7; margin: 20px 8px; }
.sp-enter-active, .sp-leave-active { transition: opacity .25s; }
.sp-enter-active .sp, .sp-leave-active .sp { transition: transform .3s cubic-bezier(.2, .8, .2, 1); }
.sp-enter-from, .sp-leave-to { opacity: 0; }
.sp-enter-from .sp, .sp-leave-to .sp { transform: translateX(100%); }
</style>
