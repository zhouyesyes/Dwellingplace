<script setup>
// 共写一本书的「资料」：和小世界一样从右边滑出半边。
// 最上面是这本书：封面、书名、书脊颜色、一句话定位、简介；下面是资料夹（人物、设定、大纲……一类一个），点开看里面的卡片
import { ref, computed, watch } from "vue";
import { cardsOf, notesOfCard, CARD_TYPES, SPINES, cardBg } from "../../lib/writing.js";
import Icon from "../Icon.vue";
import AttList from "./AttList.vue";
import WriteCover from "./WriteCover.vue";

const props = defineProps({ open: Boolean, book: Object, him: String });
const emit = defineEmits(["close", "cover", "card", "new", "import"]);
const folder = ref(null); // 打开的资料夹（类型）
watch(() => props.open, o => { if (!o) folder.value = null; });
const all = computed(() => (props.book ? cardsOf(props.book.id) : []));
const inFolder = computed(() => all.value.filter(c => c.type === folder.value).sort((a, b) => b.ts - a.ts));
const count = k => all.value.filter(c => c.type === k).length;
const fresh = k => all.value.some(c => c.type === k && notesOfCard(c.id).some(n => n.from === "ai" && !n.seen));
const peek = k => all.value.filter(c => c.type === k).slice(-2).map(c => c.title || "无题").join("、");
</script>

<template>
  <Teleport to="body">
    <Transition name="sp">
      <div v-if="open && book" class="sp-mask" @click="emit('close')">
        <aside class="sp" @click.stop>
          <div class="sp-head">
            <button v-if="folder" class="x" aria-label="回资料夹" @click="folder = null"><Icon name="back" :size="18" /></button>
            <h2 class="script">{{ folder ? CARD_TYPES[folder].label : "这本书" }}</h2>
            <button class="x" aria-label="关上" @click="emit('close')"><Icon name="close" :size="18" /></button>
          </div>

          <template v-if="!folder">
            <div class="me">
              <button class="cv" aria-label="换封面" @click="emit('cover')"><WriteCover :book="book" /><small>换封面</small></button>
              <div class="grow">
                <input v-model.lazy="book.title" class="t-in" maxlength="60" placeholder="书名" />
                <div class="spines"><button v-for="(c, i) in SPINES" :key="i" :style="{ background: c }" :class="{ on: book.color === i }" :aria-label="'书脊颜色 ' + (i + 1)" @click="book.color = i" /></div>
                <input v-model="book.pitch" class="pitch" maxlength="80" placeholder="一句话定位（比如：雾城里的悬疑爱情）" />
              </div>
            </div>
            <label class="syn">
              <span>简介</span>
              <textarea v-model="book.synopsis" rows="4" :placeholder="`这本书讲什么、想写成什么样。${him}讨论时会看着它`" />
            </label>

            <p class="sec">资料夹</p>
            <div class="folders">
              <button v-for="(t, k) in CARD_TYPES" :key="k" class="folder" :class="{ empty: !count(k) }" @click="folder = k">
                <i class="tab" />
                <b>{{ t.label }}</b>
                <small>{{ count(k) ? peek(k) : "空的" }}</small>
                <em>{{ count(k) }}<i v-if="fresh(k)" class="dot" /></em>
              </button>
            </div>
          </template>

          <template v-else>
            <div class="f-acts">
              <button class="btn small" @click="emit('new', folder)"><Icon name="edit" :size="15" /> 写一张</button>
              <button class="btn soft small" @click="emit('import', folder)"><Icon name="upload" :size="15" /> 导入图片、文件</button>
            </div>
            <div class="cards">
              <div v-for="c in inFolder" :key="c.id" class="card" role="button" tabindex="0" :style="{ background: cardBg(c) }" @click="emit('card', c)">
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
.me { display: flex; gap: 14px; align-items: flex-start; }
.cv { width: 92px; flex: none; border: 0; padding: 0; background: none; display: flex; flex-direction: column; gap: 6px; align-items: center; font-size: .62rem; }
.cv .wcover { width: 100%; font-size: 15px; }
.cv small { color: var(--text-3); }
.grow { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.t-in { border: 0; background: none; font-size: 1.25rem; font-weight: 700; padding: 2px 0; outline: none; border-bottom: 1px dashed transparent; }
.t-in:focus { border-bottom-color: var(--line); }
.spines { display: flex; gap: 6px; flex-wrap: wrap; }
.spines button { width: 14px; height: 24px; border: 0; border-radius: 2px; padding: 0; }
.spines button.on { box-shadow: 0 0 0 2px #fff, 0 0 0 3.5px var(--ink); }
.pitch { border: 0; background: rgba(255, 255, 255, .7); border-radius: 10px; padding: 8px 10px; font-size: .82rem; outline: none; }
.syn { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; }
.syn span { font-size: .78rem; font-weight: 600; color: var(--text-2); padding-left: 2px; }
.syn textarea { border: 0; background: rgba(255, 255, 255, .7); border-radius: 14px; padding: 10px 12px; font-size: .86rem; line-height: 1.7; resize: none; outline: none; field-sizing: content; min-height: 90px; }
.sec { margin: 20px 4px 10px; font-size: .85rem; font-weight: 600; }
.folders { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 10px; }
.folder {
  position: relative; border: 0; text-align: left; padding: 14px 12px 10px; min-height: 86px; border-radius: 4px 14px 14px 14px;
  background: linear-gradient(#ffe9a8, #fbdc85); box-shadow: 0 4px 12px rgba(120, 90, 30, .12); display: flex; flex-direction: column; gap: 3px; margin-top: 8px;
}
.folder:nth-child(7n+2) { background: linear-gradient(#ffd9e3, #fcc5d4); }
.folder:nth-child(7n+3) { background: linear-gradient(#d6efff, #bfe2fb); }
.folder:nth-child(7n+4) { background: linear-gradient(#dcf5d8, #c4ebbf); }
.folder:nth-child(7n+5) { background: linear-gradient(#e7ddff, #d6c8fb); }
.folder:nth-child(7n+6) { background: linear-gradient(#ffe2d1, #fdcdb3); }
.folder:nth-child(7n+7) { background: linear-gradient(#eeeae4, #e0dad1); }
.folder .tab { position: absolute; top: -8px; left: 0; width: 44%; height: 12px; border-radius: 6px 10px 0 0; background: inherit; filter: brightness(.97); }
.folder.empty { opacity: .62; }
.folder b { font-size: .95rem; }
.folder small { font-size: .7rem; color: rgba(40, 32, 30, .6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.folder em { position: absolute; right: 10px; bottom: 8px; font-style: normal; font-size: 1.2rem; font-weight: 300; color: rgba(40, 32, 30, .55); }
.dot { position: absolute; top: 0; right: -8px; width: 7px; height: 7px; border-radius: 50%; background: #6aa7e0; }
.f-acts { display: flex; gap: 8px; margin-bottom: 12px; }
.f-acts .btn { display: inline-flex; align-items: center; gap: 4px; }
.cards { display: flex; flex-direction: column; gap: 10px; }
.card { cursor: pointer; border-radius: 16px; padding: 13px 14px 10px; box-shadow: var(--shadow-soft); display: flex; flex-direction: column; gap: 6px; }
.card b { font-size: 1rem; font-weight: 700; }
.card p { margin: 0; font-size: .82rem; line-height: 1.65; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
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
