<script setup>
// 一本书的卡片：读到哪（我、他）、便利贴几张、读了多久；读完的评分和读后感（我写、请他写）；他的读书笔记；换封面改名拿下来
import { ref, computed } from "vue";
import { store, MAIN, roleById } from "../../store/index.js";
import { progressOf, fmtDur, notesOf, removeBook } from "../../lib/books.js";
import { readingMemsOf, hisReview } from "../../lib/reading.js";
import { bookImpression, rereadBook, roundOf, IMPRESSION_MAX } from "../../lib/board.js";
import { pickAndCrop, deleteImage } from "../../lib/images.js";
import { describeError } from "../../lib/chat.js";
import { toast } from "../../lib/toast.js";
import Sheet from "../Sheet.vue";
import BookCover from "./BookCover.vue";

const props = defineProps({ book: Object });
const emit = defineEmits(["close", "read"]);
const role = computed(() => roleById(MAIN));
const b = computed(() => props.book);
const pct = p => `${Math.round(p * 100)}%`;
const chName = pos => (pos ? b.value.chapters[pos.ch]?.title || "" : "");
const notes = computed(() => (b.value ? notesOf(b.value.id) : []));
const mems = computed(() => (b.value ? readingMemsOf(b.value.id) : []));

// 我的评分和读后感
const draft = ref(null);
const startReview = () => (draft.value = { stars: b.value.mine?.stars || 0, text: b.value.mine?.text || "" });
function saveReview() {
  if (!draft.value.stars) return toast("先点几颗星");
  b.value.mine = { stars: draft.value.stars, text: draft.value.text.trim(), at: Date.now(), seen: false };
  draft.value = null;
  if (role.value) bookImpression(role.value, b.value).catch(e => console.warn("读完的印象没整理成", e)); // 板块记忆里的一句印象
}
const asking = ref(false);
async function askReview() {
  asking.value = true;
  try { await hisReview(role.value, b.value); } catch (e) { toast(describeError(e), 4000); } finally { asking.value = false; }
}

async function changeCover() {
  const id = await pickAndCrop({ aspect: 2 / 3, title: "书的封面", maxSize: 600 });
  if (!id) return;
  if (b.value.cover) deleteImage(b.value.cover);
  b.value.cover = id;
}
function rename() {
  const t = prompt("书名", b.value.title);
  if (t?.trim()) b.value.title = t.trim().slice(0, 80);
}
async function takeDown() {
  if (!confirm(`把《${b.value.title}》拿下来？里面的便利贴也会一起没有（他的读书笔记还留在记忆库里）。`)) return;
  const x = b.value;
  emit("close");
  await removeBook(x);
}
function editImpression() {
  const t = prompt(`读完的印象（${IMPRESSION_MAX} 字以内，他一直记着）`, b.value.impression?.text || "");
  if (t == null) return;
  if (t.trim()) b.value.impression = { text: t.trim().slice(0, IMPRESSION_MAX), at: Date.now(), by: "me" };
  else delete b.value.impression;
}
function reread() {
  if (!confirm(`再读一遍《${b.value.title}》？这一遍的读后感和印象会收好留着，从头开始读第 ${roundOf(b.value) + 1} 遍。`)) return;
  rereadBook(b.value);
  toast(`第 ${roundOf(b.value)} 遍，从头开始`);
}
const stars = n => "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
</script>

<template>
  <Sheet :open="!!book" @close="emit('close'); draft = null">
    <div v-if="b" class="info">
      <div class="top">
        <div class="cv"><BookCover :book="b" /></div>
        <div class="meta">
          <h3>{{ b.title }}<small v-if="roundOf(b) > 1" class="round">第 {{ roundOf(b) }} 遍</small></h3>
          <p v-if="b.author" class="au">{{ b.author }}</p>
          <button class="btn small" @click="emit('read', b)">{{ b.pos?.p || b.pos?.ch ? "接着读" : "开始读" }}</button>
        </div>
      </div>

      <div class="stats">
        <div><b>{{ pct(progressOf(b)) }}</b><span>我读到 {{ chName(b.pos) }}</span></div>
        <div><b>{{ b.hisPos ? pct(progressOf(b, b.hisPos)) : "—" }}</b><span>{{ role?.name || "他" }}{{ b.hisPos ? `读到 ${chName(b.hisPos)}` : "还没读" }}</span></div>
        <div><b>{{ notes.length }}</b><span>张便利贴（{{ role?.name || "他" }} {{ notes.filter(n => n.from === 'ai').length }}）</span></div>
        <div><b>{{ fmtDur(b.readSecs) }}</b><span>我读了</span></div>
      </div>

      <section>
        <h4>读后感</h4>
        <div v-if="draft" class="review-edit">
          <div class="pick-stars"><button v-for="n in 5" :key="n" :class="{ on: n <= draft.stars }" @click="draft.stars = n">★</button></div>
          <textarea v-model="draft.text" class="input" rows="5" placeholder="读完以后想说的话" />
          <div class="row"><button class="btn soft small" @click="draft = null">先不写</button><button class="btn small" @click="saveReview">存好</button></div>
        </div>
        <template v-else>
          <article v-if="b.mine" class="rv mine" @click="startReview"><span class="st">{{ stars(b.mine.stars) }}</span><p>{{ b.mine.text || "（只打了星）" }}</p><small>— 我</small></article>
          <button v-else class="btn soft small" @click="startReview">读完了，打个分</button>
          <article v-if="b.his" class="rv his"><span class="st">{{ stars(b.his.stars) }}</span><p>{{ b.his.text }}</p><small>— {{ role?.name }}</small></article>
          <button v-if="role" class="btn soft small" :disabled="asking" @click="askReview">{{ asking ? "他在写……" : b.his ? "请他重写一篇" : `请${role.name}也写一篇` }}</button>
          <article v-if="b.mine || b.impression" class="mem" @click="editImpression"><b>{{ role?.name }}记着的印象<template v-if="roundOf(b) > 1">（第 {{ roundOf(b) }} 遍）</template></b><p>{{ b.impression?.text || "读完以后会自己整理一句，点这里也能自己写" }}</p></article>
          <button v-if="b.mine" class="btn soft small" @click="reread">再读一遍</button>
        </template>
      </section>

      <section v-if="b.past?.length">
        <h4>以前读的几遍</h4>
        <article v-for="x in [...b.past].reverse()" :key="x.round" class="mem"><b>第 {{ x.round }} 遍{{ x.mine?.stars ? " · " + stars(x.mine.stars) : "" }}</b><p>{{ x.impression?.text || x.mine?.text || "（没写读后感）" }}</p><small>{{ new Date(x.at).toLocaleDateString("zh-CN") }}</small></article>
      </section>

      <section v-if="b.gist?.text">
        <h4>{{ role?.name }} 读到这里的印象</h4>
        <article class="mem"><p>{{ b.gist.text }}</p><small>记到{{ b.chapters[b.gist.upTo.ch]?.title || `第 ${b.gist.upTo.ch + 1} 章` }}</small></article>
      </section>

      <section v-if="mems.length">
        <h4>{{ role?.name }} 的读书笔记</h4>
        <article v-for="m in mems" :key="m.id" class="mem"><b>{{ m.title }}</b><p>{{ m.content }}</p><small>{{ m.date }}</small></article>
      </section>

      <section class="acts">
        <button class="list-row" @click="changeCover">换封面</button>
        <button class="list-row" @click="rename">改书名</button>
        <button class="list-row danger" @click="takeDown">从书架上拿下来</button>
      </section>
    </div>
  </Sheet>
</template>

<style scoped>
.info { display: flex; flex-direction: column; gap: 16px; max-height: 76vh; overflow-y: auto; padding-bottom: 6px; }
.top { display: flex; gap: 16px; align-items: flex-end; }
.cv { width: 92px; flex: none; }
.meta h3 { margin: 0; font-size: 1.15rem; font-weight: 600; }
.au { margin: 2px 0 10px; color: var(--text-2); font-size: .82rem; }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.stats div { background: var(--bg); border-radius: 14px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.stats b { font-size: 1.1rem; font-weight: 600; }
.stats span { font-size: .72rem; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
section { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
h4 { margin: 0; font-size: .82rem; color: var(--text-2); font-weight: 600; }
.rv { width: 100%; padding: 12px 14px; border-radius: 14px; background: var(--bg); }
.rv.his { background: #eef4fb; }
.st { color: #e0a53a; letter-spacing: 2px; font-size: .9rem; }
.rv p { margin: 6px 0 2px; font-size: .9rem; line-height: 1.7; white-space: pre-wrap; }
.rv small, .mem small { color: var(--text-3); font-size: .7rem; }
.review-edit { width: 100%; display: flex; flex-direction: column; gap: 8px; }
.pick-stars button { border: 0; background: none; font-size: 1.6rem; color: var(--line); padding: 0 2px; }
.pick-stars button.on { color: #e0a53a; }
.row { display: flex; gap: 8px; justify-content: flex-end; }
.mem { width: 100%; padding: 10px 12px; border-left: 3px solid #b9cde3; background: var(--bg); border-radius: 4px 12px 12px 4px; }
.mem b { font-size: .85rem; font-weight: 600; }
.mem p { margin: 4px 0; font-size: .85rem; line-height: 1.7; color: var(--text-2); white-space: pre-wrap; }
.round { margin-left: 8px; font-size: .7rem; font-weight: 500; color: #b05a6e; background: #fbe9ee; padding: 2px 8px; border-radius: 999px; vertical-align: middle; }
.acts { gap: 0; align-items: stretch; }
.acts .list-row { text-align: left; }
.danger { color: var(--danger); }
</style>
