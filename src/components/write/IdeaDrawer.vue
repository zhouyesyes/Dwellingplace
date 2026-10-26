<script setup>
// 灵感抽屉的「抽屉」：从右边滑出半边。上面按标签筛；杂乱的灵感一张张；以前的书一本一组（点开是那本的卡片，没有资料夹）
import { ref, computed, watch } from "vue";
import { cardsOf, notesOfCard, cardBg, addGroup, removeGroup, allTags, tagsOf } from "../../lib/writing.js";
import Icon from "../Icon.vue";
import AttList from "./AttList.vue";

const props = defineProps({ open: Boolean, box: Object, him: String, wf: { type: Number, default: 1 } });
const emit = defineEmits(["close", "card", "new", "import"]);
const group = ref(null); // 打开的以前的书
const tag = ref(""); // 正在筛的标签
watch(() => props.open, o => { if (!o) group.value = null; });
const all = computed(() => (props.box ? cardsOf(props.box.id) : []));
const tags = computed(() => (props.box ? allTags(props.box) : []));
const has = (x, t) => !t || (x.tags || []).includes(t);
const loose = computed(() => all.value.filter(c => !c.groupId && has(c, tag.value)).reverse()); // 新的在前
const groups = computed(() => (props.box?.groups || []).filter(g => has(g, tag.value) || all.value.some(c => c.groupId === g.id && has(c, tag.value))));
const inGroup = computed(() => (group.value ? all.value.filter(c => c.groupId === group.value.id) : []));
const countOf = g => all.value.filter(c => c.groupId === g.id).length;
function newGroup() {
  const t = prompt("以前的哪本书？（书名）");
  if (t?.trim()) group.value = addGroup(props.box, t);
}
function editGroupTags() {
  const t = prompt("这本书的标签（空格隔开）", (group.value.tags || []).join(" "));
  if (t != null) group.value.tags = tagsOf(t);
}
function renameGroup() {
  const t = prompt("书名", group.value.title);
  if (t?.trim()) group.value.title = t.trim().slice(0, 60);
}
function dropGroup() {
  if (!confirm(`把《${group.value.title}》这一组拿掉？里面的卡片会留着，变回杂乱的灵感。`)) return;
  removeGroup(props.box, group.value);
  group.value = null;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sp">
      <div v-if="open && box" class="sp-mask" @click="emit('close')">
        <aside class="sp" :style="{ '--wf': wf }" @click.stop>
          <div class="sp-head">
            <button v-if="group" class="x" aria-label="回抽屉" @click="group = null"><Icon name="back" :size="18" /></button>
            <h2 class="script">{{ group ? `《${group.title}》` : "灵感抽屉" }}</h2>
            <button class="x" aria-label="关上" @click="emit('close')"><Icon name="close" :size="18" /></button>
          </div>

          <template v-if="!group">
            <div v-if="tags.length" class="tags">
              <button :class="{ on: !tag }" @click="tag = ''">全部</button>
              <button v-for="x in tags" :key="x.t" :class="{ on: tag === x.t }" @click="tag = tag === x.t ? '' : x.t"># {{ x.t }}<small>{{ x.k }}</small></button>
            </div>

            <p class="sec">杂乱的灵感<small>　想到什么就丢进来</small></p>
            <div class="f-acts">
              <button class="btn small" @click="emit('new', { tags: tag ? [tag] : [] })"><Icon name="edit" :size="15" /> 写一张</button>
              <button class="btn soft small" @click="emit('import', {})"><Icon name="upload" :size="15" /> 导入图片、文件</button>
            </div>
            <div class="cards">
              <div v-for="c in loose" :key="c.id" class="card" role="button" tabindex="0" :style="{ background: cardBg(c) }" @click="emit('card', c)">
                <b>{{ c.title || "无题" }}</b>
                <p v-if="c.content">{{ c.content }}</p>
                <AttList v-if="c.atts?.length" :atts="c.atts.slice(0, 3)" small />
                <div class="foot"><span class="ctags"><i v-for="t in c.tags || []" :key="t">#{{ t }}</i></span><small>{{ c.from === "ai" ? `${him} 放的` : "" }}</small>
                  <span v-if="notesOfCard(c.id).length" class="stk" :class="{ fresh: notesOfCard(c.id).some(n => n.from === 'ai' && !n.seen) }">{{ notesOfCard(c.id).length }}</span></div>
              </div>
            </div>
            <p v-if="!loose.length" class="hint">{{ tag ? `没有带 #${tag} 的灵感` : "还没有灵感卡片。写一张，或者让他放一张。" }}</p>

            <p class="sec">以前的书<small>　一本一组：复盘、留下的设定和片段</small></p>
            <div class="groups">
              <button v-for="g in groups" :key="g.id" class="grp" @click="group = g">
                <b>《{{ g.title }}》</b>
                <span class="ctags"><i v-for="t in g.tags || []" :key="t">#{{ t }}</i></span>
                <em>{{ countOf(g) }}</em>
              </button>
              <button class="grp add" @click="newGroup"><b>＋ 放一本以前的书</b></button>
            </div>
          </template>

          <template v-else>
            <div class="g-meta">
              <button class="ctags big" @click="editGroupTags"><i v-for="t in group.tags || []" :key="t">#{{ t }}</i><span v-if="!(group.tags || []).length">加标签</span><Icon name="edit" :size="13" /></button>
              <span class="grow" />
              <button class="mini" @click="renameGroup">改名</button>
              <button class="mini danger" @click="dropGroup">拿掉</button>
            </div>
            <div class="f-acts">
              <button class="btn small" @click="emit('new', { groupId: group.id })"><Icon name="edit" :size="15" /> 写一张</button>
              <button class="btn soft small" @click="emit('import', { groupId: group.id })"><Icon name="upload" :size="15" /> 导入图片、文件</button>
            </div>
            <div class="cards">
              <div v-for="c in inGroup" :key="c.id" class="card" role="button" tabindex="0" :style="{ background: cardBg(c) }" @click="emit('card', c)">
                <b>{{ c.title || "无题" }}</b>
                <p v-if="c.content">{{ c.content }}</p>
                <AttList v-if="c.atts?.length" :atts="c.atts.slice(0, 3)" small />
                <div class="foot"><span class="ctags"><i v-for="t in c.tags || []" :key="t">#{{ t }}</i></span>
                  <span v-if="notesOfCard(c.id).length" class="stk">{{ notesOfCard(c.id).length }}</span></div>
              </div>
            </div>
            <p v-if="!inGroup.length" class="hint">这本书还没有卡片。写写复盘：哪里写得好、哪里没写好、想带走什么。</p>
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
  background: rgba(var(--glass-rgb), .9); -webkit-backdrop-filter: blur(22px) saturate(1.2); backdrop-filter: blur(22px) saturate(1.2);
  overflow-x: hidden; border-radius: 26px 0 0 26px; box-shadow: -10px 0 40px rgba(30, 30, 40, .12);
}
.sp-head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.script { flex: 1; margin: 0; font-size: 1.15rem; font-weight: 600; letter-spacing: .06em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.x { border: 0; background: rgba(var(--glass-rgb), .8); width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: var(--text-2); flex: none; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tags button { border: 0; background: var(--card); padding: 5px 11px; border-radius: 999px; font-size: calc(.78rem * var(--wf, 1)); color: var(--text-2); box-shadow: 0 1px 4px rgba(40, 40, 60, .06); }
.tags button small { margin-left: 4px; color: var(--text-3); font-size: .68rem; }
.tags button.on { background: var(--ink); color: var(--on-ink); }
.tags button.on small { color: rgba(var(--glass-rgb), .7); }
.sec { margin: 22px 4px 10px; font-size: calc(.85rem * var(--wf, 1)); font-weight: 600; color: var(--text-2); }
.sec small { font-weight: 400; color: var(--text-3); font-size: .72rem; }
.f-acts { display: flex; gap: 8px; margin-bottom: 12px; }
.f-acts .btn { display: inline-flex; align-items: center; gap: 4px; }
.cards { display: flex; flex-direction: column; gap: 10px; }
.card { cursor: pointer; border-radius: 16px; padding: 13px 14px 10px; box-shadow: var(--shadow-soft); display: flex; flex-direction: column; gap: 6px; }
.card b { font-size: calc(1rem * var(--wf, 1)); font-weight: 700; }
.card p { margin: 0; font-size: calc(.84rem * var(--wf, 1)); line-height: 1.65; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
.foot { display: flex; align-items: center; gap: 8px; }
.foot small { font-size: .68rem; color: var(--text-3); margin-left: auto; }
.ctags { display: flex; flex-wrap: wrap; gap: 4px; }
.ctags i { font-style: normal; font-size: .7rem; color: #8a6d3b; background: color-mix(in srgb, #f6edd8 var(--pastel), var(--card)); padding: 1px 7px; border-radius: 999px; }
.ctags.big { border: 0; background: none; padding: 0; align-items: center; color: var(--text-3); font-size: .78rem; gap: 6px; }
.stk { min-width: 20px; height: 20px; padding: 0 5px; border-radius: 3px; background: color-mix(in srgb, #f4e7a8 var(--pastel), var(--card)); font-size: .7rem; display: grid; place-items: center; transform: rotate(4deg); margin-left: auto; }
.stk.fresh { background: #cfe0f2; }
.groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.grp { position: relative; border: 0; text-align: left; background: var(--card); border-radius: 6px 14px 14px 6px; padding: 12px 12px 10px 16px; min-height: 76px; min-width: 0; box-shadow: 0 3px 12px rgba(40, 40, 60, .07); display: flex; flex-direction: column; gap: 6px; border-left: 5px solid #c9b8a6; }
.grp b { font-size: calc(.92rem * var(--wf, 1)); min-width: 0; padding-right: 22px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.grp em { position: absolute; right: 12px; bottom: 8px; font-style: normal; font-size: 1.05rem; font-weight: 300; color: var(--text-3); }
.grp.add { background: none; box-shadow: inset 0 0 0 1.5px var(--line); border-left: 0; align-items: center; justify-content: center; color: var(--text-2); }
.g-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.grow { flex: 1; }
.mini { border: 0; background: var(--card); border-radius: 999px; padding: 4px 10px; font-size: .74rem; color: var(--text-2); }
.mini.danger { color: var(--danger); }
.hint { text-align: center; color: var(--text-3); font-size: .8rem; line-height: 1.7; margin: 14px 8px; }
.sp-enter-active, .sp-leave-active { transition: opacity .25s; }
.sp-enter-active .sp, .sp-leave-active .sp { transition: transform .3s cubic-bezier(.2, .8, .2, 1); }
.sp-enter-from, .sp-leave-to { opacity: 0; }
.sp-enter-from .sp, .sp-leave-to .sp { transform: translateX(100%); }
</style>
