<script setup>
// 一本书的卡片：读到哪（我、他）、便利贴几张、读了多久；读完的评分和读后感（我写、请他写）；他的读书笔记；换封面改名拿下来
import { ref, shallowRef, computed, watch } from "vue";
import { store, MAIN, roleById } from "../../store/index.js";
import { progressOf, fmtDur, notesOf, removeBook } from "../../lib/books.js";
import { readingMemsOf, hisReview, writeImpression } from "../../lib/reading.js";
import { bookImpression, rereadBook, roundOf, IMPRESSION_MAX } from "../../lib/board.js";
import { pickAndCrop, deleteImage } from "../../lib/images.js";
import { describeError } from "../../lib/chat.js";
import { toast } from "../../lib/toast.js";
import { previewReimport, confirmReimport, restoreReimport } from "../../lib/bookReimport.js";
import { pickFile } from "../../lib/images.js";
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

const replacing = ref(false);
const preview = shallowRef(null);
const importError = ref('');
watch(() => props.book?.id, () => { preview.value = null; importError.value = ''; });
async function reimport() {
  const id = b.value.id;
  const [file] = await pickFile('.epub,application/epub+zip');
  if (!file || b.value?.id !== id) return;
  replacing.value = true;
  preview.value = null;
  importError.value = '';
  try { preview.value = await previewReimport(id, file); }
  catch (e) { importError.value = `未覆盖：${e.message}`; }
  finally { replacing.value = false; }
}
async function applyImport() {
  replacing.value = true;
  try {
    await confirmReimport(preview.value);
    preview.value = null;
    toast('覆盖完成，笔记已保留；可在书籍管理中恢复备份', 4500);
    // 正文与位置一起从持久化结果重新加载，阅读器不会继续使用旧章缓存。
    window.location.reload();
  } catch (e) { importError.value = `未覆盖，旧书保持完整：${e.message}`; }
  finally { replacing.value = false; }
}
async function restoreImport() {
  if (!confirm('恢复覆盖前的正文、阅读进度和笔记？覆盖后新增的笔记会保留在待重新定位中。')) return;
  replacing.value = true;
  try { await restoreReimport(b.value.id); window.location.reload(); }
  catch (e) { importError.value = `未恢复：${e.message}`; }
  finally { replacing.value = false; }
}

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
// 他的中途印象、前情梗概、以前写的读后感：默认收着
const showImprs = ref(false);
const showSegs = ref(false);
const showOld = ref(false);
// pos 是「到这里之前」：正好在一章开头，说成上一章读完
const chOf = pos => {
  if (!pos) return "";
  const c = pos.p === 0 && pos.ch > 0 ? pos.ch - 1 : Math.min(pos.ch, b.value.chapters.length - 1);
  const t = b.value.chapters[c]?.title || `第 ${c + 1} 章`;
  return pos.p === 0 && pos.ch > 0 ? `${t}（读完）` : t;
};
const dayOf = ts => new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
const imprBusy = ref(false);
async function imprNow() {
  imprBusy.value = true;
  try { await writeImpression(role.value, b.value); toast("写好了"); } catch (e) { toast(describeError(e), 4000); } finally { imprBusy.value = false; }
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
          <article v-if="b.his" class="rv his"><span class="st">{{ stars(b.his.stars) }}</span><p>{{ b.his.text }}</p><small>— {{ role?.name }}{{ b.his.at ? ` · ${dayOf(b.his.at)}` : "" }}</small></article>
          <button v-if="b.hisOld?.length" class="btn soft small" @click="showOld = !showOld">{{ showOld ? "收起" : `他以前写的 ${b.hisOld.length} 篇` }}</button>
          <template v-if="showOld"><article v-for="(x, i) in [...b.hisOld].reverse()" :key="i" class="rv his old"><span class="st">{{ stars(x.stars) }}</span><p>{{ x.text }}</p><small>{{ dayOf(x.at) }}</small></article></template>
          <button v-if="role" class="btn soft small" :disabled="asking" @click="askReview">{{ asking ? "他在写……" : b.his ? "请他重写一篇" : `请${role.name}也写一篇` }}</button>
          <article v-if="b.mine || b.impression" class="mem" @click="editImpression"><b>{{ role?.name }}记着的印象<template v-if="roundOf(b) > 1">（第 {{ roundOf(b) }} 遍）</template></b><p>{{ b.impression?.text || "读完以后会自己整理一句，点这里也能自己写" }}</p></article>
          <button v-if="b.mine" class="btn soft small" @click="reread">再读一遍</button>
        </template>
      </section>

      <section v-if="b.past?.length">
        <h4>以前读的几遍</h4>
        <article v-for="x in [...b.past].reverse()" :key="x.round" class="mem"><b>第 {{ x.round }} 遍{{ x.mine?.stars ? " · " + stars(x.mine.stars) : "" }}</b><p>{{ x.impression?.text || x.mine?.text || "（没写读后感）" }}</p>
          <details v-if="x.his?.text || x.imprs?.length" class="past-more"><summary>他那一遍的读后感和中途印象</summary><p v-if="x.his?.text">{{ x.his.text }}</p><p v-for="(m, k) in x.imprs || []" :key="k" class="im">{{ k + 1 }}. {{ m.text }}</p></details>
          <small>{{ new Date(x.at).toLocaleDateString("zh-CN") }}</small></article>
      </section>

      <section v-if="role && (b.imprs?.length || b.readAt)">
        <h4>{{ role.name }} 的中途印象<small class="h-sub">每读 2 万字写一句，平时只带最新的</small></h4>
        <article v-if="b.imprs?.length" class="mem"><p>{{ b.imprs.at(-1).text }}</p><small>读到{{ chOf(b.imprs.at(-1).upTo) }} · {{ dayOf(b.imprs.at(-1).at) }}</small></article>
        <div class="row-btns">
          <button v-if="b.imprs?.length > 1" class="btn soft small" @click="showImprs = !showImprs">{{ showImprs ? "收起" : `看他的理解怎么变的（${b.imprs.length} 版）` }}</button>
          <button class="btn soft small" :disabled="imprBusy" @click="imprNow">{{ imprBusy ? "他在想……" : "让他现在写一句" }}</button>
        </div>
        <template v-if="showImprs">
          <article v-for="(x, i) in [...b.imprs].reverse()" :key="i" class="mem old"><p>{{ x.text }}</p><small>第 {{ b.imprs.length - i }} 版 · 读到{{ chOf(x.upTo) }} · {{ dayOf(x.at) }}</small></article>
        </template>
      </section>

      <section v-if="b.gist?.text">
        <h4>前情梗概<small class="h-sub">整理模型客观记的，6 万字整理一段</small></h4>
        <button class="btn soft small" @click="showSegs = !showSegs">{{ showSegs ? "收起" : `看看（${b.gist.segs?.length || 1} 段，记到${chOf(b.gist.upTo)}）` }}</button>
        <template v-if="showSegs">
          <article v-for="(x, i) in b.gist.segs || [{ text: b.gist.text, upTo: b.gist.upTo, at: b.gist.at }]" :key="i" class="mem old"><p>{{ x.text }}</p><small>第 {{ i + 1 }} 段{{ x.from ? ` · ${chOf(x.from)} 到 ${chOf(x.upTo)}` : "" }}{{ x.model ? ` · ${x.model}` : "" }}</small></article>
        </template>
      </section>

      <section v-if="mems.length">
        <h4>{{ role?.name }} 的读书笔记</h4>
        <article v-for="m in mems" :key="m.id" class="mem"><b>{{ m.title }}</b><p>{{ m.content }}</p><small>{{ m.date }}</small></article>
      </section>

      <section v-if="b.reimport">
        <h4>上次覆盖导入</h4>
        <p>{{ b.reimport.moved }} 条笔记已定位，{{ notes.filter(n => n.unlocated).length }} 条待重新定位。</p>
        <p v-if="b.reimport.approximate">部分阅读位置无法精确恢复，已回到匹配章节的相近段落；未匹配章节回到书首。</p>
        <button class="btn soft small" :disabled="replacing" @click="restoreImport">恢复覆盖前备份</button>
      </section>
      <section v-if="notes.some(n => n.unlocated)">
        <h4>待重新定位 / 未定位笔记</h4>
        <article v-for="n in notes.filter(n => n.unlocated)" :key="n.id" class="mem">
          <b>{{ n.unlocated.chapter }} · {{ n.from === 'ai' ? '他' : '我' }}</b>
          <p>「{{ n.unlocated.quote || n.quote || '未保存摘录' }}」</p><p>{{ n.text || '（划线）' }}</p>
        </article>
      </section>
      <section v-if="preview" class="reimport-preview" aria-label="覆盖导入预览">
        <h4>覆盖《{{ preview.title }}》</h4>
        <p>新文件：{{ preview.newTitle }} · {{ preview.author }}</p>
        <p>章节 {{ preview.oldChapters }} → {{ preview.newChapters }}；插图 {{ preview.oldImages }} → {{ preview.newImages }}</p>
        <p>{{ preview.reason }}</p>
        <p>可定位笔记 {{ preview.moved }} 条；待重新定位 {{ preview.unresolved }} 条。</p>
        <details v-if="preview.pending.length"><summary>查看待重新定位的笔记</summary><article v-for="n in preview.pending" :key="n.id" class="mem"><b>{{ n.unlocated.chapter }}</b><p>「{{ n.unlocated.quote }}」</p><p>{{ n.text || '（划线）' }}</p></article></details>
        <p v-if="preview.approximate">部分阅读位置将回到匹配章节的相近段落，未匹配章节回到书首。</p>
        <p>保留原书、封面、排序和全部笔记。确认时自动保存覆盖前备份，可恢复到覆盖前；失败时旧书不变。备份保存在当前设备，下次成功覆盖会更新。</p>
        <div class="row"><button class="btn soft small" :disabled="replacing" @click="preview = null">取消</button><button class="btn small" :disabled="replacing || !preview.allowed" @click="applyImport">确认覆盖并保留笔记</button></div>
      </section>
      <p v-if="importError" role="alert">{{ importError }}</p>
      <section class="acts">
        <button class="list-row" :disabled="replacing" @click="reimport">{{ replacing ? "正在核对…" : "重新导入并覆盖 EPUB" }}</button>
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
section p { margin: 0; font-size: .85rem; line-height: 1.7; color: var(--text-2); overflow-wrap: anywhere; }
.reimport-preview .btn:not(.soft) { color: var(--on-ink); }
.reimport-preview { padding: 12px; border: 1px solid var(--line); border-radius: 12px; }
section { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
h4 { margin: 0; font-size: .82rem; color: var(--text-2); font-weight: 600; }
.rv { width: 100%; padding: 12px 14px; border-radius: 14px; background: var(--bg); }
.rv.his { background: color-mix(in srgb, #eef4fb var(--pastel), var(--card)); }
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
.h-sub { margin-left: 8px; font-size: .68rem; font-weight: 400; color: var(--text-3); }
.row-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.mem.old, .rv.old { margin-top: 8px; opacity: .85; }
.past-more { margin: 4px 0; font-size: .8rem; color: var(--text-2); }
.past-more summary { cursor: pointer; color: var(--text-3); font-size: .74rem; }
.past-more .im { margin: 2px 0; }
.round { margin-left: 8px; font-size: .7rem; font-weight: 500; color: #b05a6e; background: color-mix(in srgb, #fbe9ee var(--pastel), var(--card)); padding: 2px 8px; border-radius: 999px; vertical-align: middle; }
.acts { gap: 0; align-items: stretch; }
.acts .list-row { text-align: left; }
.danger { color: var(--danger); }
</style>
