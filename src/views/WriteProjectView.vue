<script setup>
// 一本书（共写）：点进来就是和他的讨论。上面一条短短的页头图（往下慢慢淡掉，讨论从它下面滑过去），像这本书的样子；
// 右上角「资料」从右边滑出半边：封面、书名、书脊颜色、定位、简介，下面是一个个资料夹（卡片）。
// 卡片上可以贴便利贴：你的黄色，他的蓝色；他的可以「采纳」（接到卡片里）或撕掉。讨论页的背景、气泡颜色可以自己换
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, MAIN, roleById, BUBBLE_COLORS } from "../store/index.js";
import { projectById, cardsOf, notesOfCard, addCard, removeCard, addNote, removeNote, adoptNote, loadTalk, talk, saveTalk, dropTalkMsg, regenTalk, editTalkAndResend, reviewCard, removeProject, summarize, compressTalk, talkLimit, talkAutoAt, toAtt, importFiles, CARD_TYPES, SPINES, TINTS } from "../lib/writing.js";
import { pickFile, pickAndCrop, deleteImage, useImage } from "../lib/images.js";
import AttList from "../components/write/AttList.vue";
import TalkDrawer from "../components/write/TalkDrawer.vue";
import BookDrawer from "../components/write/BookDrawer.vue";
import BigTextarea from "../components/BigTextarea.vue";
import ColorSwatches from "../components/ColorSwatches.vue";
import { vAutoGrow } from "../lib/autogrow.js";
import { describeError, meName } from "../lib/chat.js";
import { toast } from "../lib/toast.js";
import { goBack } from "../lib/nav.js";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";

const route = useRoute();
const router = useRouter();
const p = computed(() => projectById(route.params.id));
const role = computed(() => roleById(MAIN));
const him = computed(() => role.value?.name || "他");
onMounted(async () => {
  if (!p.value) return router.replace("/write");
  msgs.value = await loadTalk(p.value.id);
  down();
  // 从书桌墙上的便利贴点进来：直接打开那张卡片
  const c = route.query.card && cardsOf(p.value.id).find(x => x.id === route.query.card);
  if (c) openCard(c);
});

// ---------- 样子：页头图、背景、气泡 ----------
const bg = useImage(() => p.value?.bg);
const spine = computed(() => SPINES[(p.value?.color || 0) % SPINES.length]);
const textOn = c => {
  const hex = (c || "#ffffff").replace("#", "");
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.55 ? "#fff" : "var(--text)";
};
// 共写室自己的字号（和聊天的分开调）
const FONTS = { small: ["小", 0.92], standard: ["标准", 1.05], large: ["大", 1.18], xl: ["特大", 1.32] };
const wf = computed(() => FONTS[store.settings.writeFont]?.[1] || FONTS.standard[1]);
// 我的话有气泡（换气泡颜色）；他的话没有气泡，直接占满一行（换字的颜色）
const INKS = ["#2f2f36", "#4a4f5c", "#2f4a6b", "#3d5a4a", "#5a4632", "#6b3f4f", "#4b3f6b"];
const look = computed(() => {
  const me = p.value?.bubbleMe || "#ffffff";
  return { "--spine": spine.value, "--me": me, "--me-text": textOn(me), "--ai-ink": p.value?.aiInk || INKS[0], "--wf": wf.value, "--dock": dockH.value + "px" };
});
// 输入框浮在最下面，讨论从它后面滑过去：量一下它多高，讨论底下留出这么多
const dock = ref(null);
const dockH = ref(80);
let ro = null;
onMounted(() => {
  ro = new ResizeObserver(() => { if (dock.value) dockH.value = dock.value.offsetHeight; });
  if (dock.value) ro.observe(dock.value);
});
onBeforeUnmount(() => ro?.disconnect());
const growMax = Math.round(innerHeight * 0.4);
async function swapImage(key, aspect, title) {
  const id = await pickAndCrop({ aspect, title, maxSize: 1800 });
  if (!id) return;
  const old = p.value[key];
  p.value[key] = id;
  if (old) deleteImage(old);
}
const changeBg = () => swapImage("bg", innerWidth / innerHeight, "调整背景");
const changeCover = () => swapImage("cover", 2 / 3, "调整封面");
function clearImage(key) { deleteImage(p.value[key]); p.value[key] = null; }

// ---------- 资料（右边半边）和卡片 ----------
const shelf = ref(false);
const edit = ref(null); // 正在看 / 改的卡片（副本）
const editing = ref(null); // 原卡片
function openCard(c, type = "idea") {
  editing.value = c;
  edit.value = c ? { ...c, atts: [...(c.atts || [])] } : { type, title: "", content: "", atts: [] };
  for (const n of c ? notesOfCard(c.id) : []) n.seen = true;
}
function saveCard() {
  const e = edit.value;
  if (!e.title.trim() && !e.content.trim() && !e.atts.length) return toast("卡片还是空的");
  if (editing.value) Object.assign(editing.value, { type: e.type, tint: e.tint, title: e.title.trim(), content: e.content.trim(), atts: e.atts, ts: Date.now(), from: "me" });
  else { editing.value = addCard(p.value.id, e); editing.value.tint = e.tint; }
  edit.value = null;
}
function dropCard() {
  if (!editing.value || !confirm("撕掉这张卡片？上面的便利贴也会一起没有。")) return;
  removeCard(editing.value);
  edit.value = null;
}
// 卡片上挂图片、文件；导入一批文件（每个一张卡片，放进那个资料夹）
const ACCEPT = "image/*,.pdf,.txt,.md,.markdown,.csv,.json";
async function attachToCard() {
  const files = await pickFile(ACCEPT, true);
  for (const f of files) {
    try { edit.value.atts.push(await toAtt(f)); } catch (e) { toast(e.message, 4000); }
  }
}
function dropAtt(a) {
  edit.value.atts.splice(edit.value.atts.indexOf(a), 1);
  if (a.kind === "image" && !(editing.value?.atts || []).includes(a)) deleteImage(a.img);
}
async function importMany(type) {
  const files = await pickFile(ACCEPT, true);
  if (!files.length) return;
  try {
    const made = await importFiles(p.value.id, files, type);
    toast(`放进来 ${made.length} 张卡片`);
  } catch (e) {
    toast(e.message, 4000);
  }
}
const noteText = ref("");
function myNote() {
  if (!noteText.value.trim() || !editing.value) return;
  addNote(editing.value, noteText.value, "me");
  noteText.value = "";
}
const reviewing = ref(false);
async function askReview() {
  if (!editing.value) { saveCard(); return; }
  reviewing.value = true;
  try { await reviewCard(role.value, editing.value); } catch (e) { toast(describeError(e), 4000); } finally { reviewing.value = false; }
}
const freshCount = computed(() => (p.value ? cardsOf(p.value.id) : []).filter(c => notesOfCard(c.id).some(n => n.from === "ai" && !n.seen)).length);

// ---------- 讨论 ----------
const msgs = ref([]);
const draft = ref("");
const draftAtts = ref([]);
const sending = ref(false);
async function attachToTalk() {
  const files = await pickFile(ACCEPT, true);
  for (const f of files) {
    try { draftAtts.value.push(await toAtt(f)); } catch (e) { toast(e.message, 4000); }
  }
}
const box = ref(null);
const down = () => nextTick(() => { if (box.value) box.value.scrollTop = box.value.scrollHeight; });
async function send() {
  if (sending.value || !role.value) return;
  const t = draft.value, atts = draftAtts.value;
  if (!t.trim() && !atts.length && msgs.value.at(-1)?.from !== "me") return;
  draft.value = "";
  draftAtts.value = [];
  await run(() => talk(role.value, p.value, t, atts));
}

// 讨论里的一句：点一下，手指旁边弹出复制、收藏、修改、重新回答、删除（都只在这本书里）
const actionMsg = ref(null);
const menuPos = ref({});
function openActions(m, e) {
  if (sending.value) return;
  const w = 188, x = Math.min(Math.max(e.clientX - w / 2, 12), innerWidth - w - 12);
  menuPos.value = e.clientY > innerHeight * 0.55 ? { left: x + "px", bottom: innerHeight - e.clientY + 10 + "px" } : { left: x + "px", top: e.clientY + 10 + "px" };
  actionMsg.value = m;
}
const take = () => { const m = actionMsg.value; actionMsg.value = null; return m; };
async function copyMsg() {
  const m = take();
  try { await navigator.clipboard.writeText(m.text || ""); toast("已复制"); } catch { toast("复制失败，浏览器不允许"); }
}
function favMsg(m = take()) {
  m.fav = !m.fav;
  saveTalk(p.value.id);
  toast(m.fav ? "收藏好了，右上角放大镜里能找到" : "取消收藏了");
}
const fixing = ref(null); // { msg, text }
function startEdit() { const m = take(); fixing.value = { msg: m, text: m.text || "" }; }
async function saveEdit(resend) {
  const { msg, text } = fixing.value;
  fixing.value = null;
  if (!resend) { msg.text = text.trim(); msg.edited = true; await saveTalk(p.value.id); return; }
  await run(() => editTalkAndResend(role.value, p.value, msg.id, text));
}
async function regen() { const m = take(); await run(() => regenTalk(role.value, p.value, m.id)); }
async function removeMsg() {
  const m = take();
  if (!confirm("删除这一句？")) return;
  await dropTalkMsg(p.value.id, m.id);
}
async function run(fn) {
  if (sending.value || !role.value) return;
  sending.value = true;
  down();
  try { await fn(); } catch (e) { toast(describeError(e), 4000); } finally { sending.value = false; down(); }
}
// 搜索 / 收藏（右边半边）
const finder = ref(false);
const flash = ref("");
async function goMsg(id) {
  finder.value = false;
  await nextTick();
  document.getElementById("wm-" + id)?.scrollIntoView({ block: "center", behavior: "smooth" });
  flash.value = id;
  setTimeout(() => { if (flash.value === id) flash.value = ""; }, 1800);
}

// ---------- 这本书 ----------
const menu = ref(false);
async function drop() {
  if (!confirm(`把《${p.value.title}》从书桌上拿走？卡片和讨论都会没有（他记忆库里的总结还在）。`)) return;
  const x = p.value;
  router.replace("/write");
  await removeProject(x);
}
// 讨论摘要（只在这本书里）
const talkSumEdit = ref(null);
const talkSumBusy = ref(false);
const openTalkSum = () => (talkSumEdit.value = { text: p.value.talkSum?.text || "" });
function saveTalkSum() {
  const text = talkSumEdit.value.text.trim();
  if (text) p.value.talkSum = { ...(p.value.talkSum || { upTo: null, count: 0 }), text, at: Date.now(), why: "edited" };
  else delete p.value.talkSum;
  talkSumEdit.value = null;
}
async function talkSumNow() {
  talkSumBusy.value = true;
  try {
    const n = await compressTalk(role.value, p.value);
    talkSumEdit.value = { text: p.value.talkSum?.text || "" };
    toast(n ? `把 ${n} 句讨论整理进去了` : `还没有要整理的（最近 ${Math.floor(talkLimit() / 2)} 句留着原样）`);
  } catch (e) { toast(describeError(e), 4000); } finally { talkSumBusy.value = false; }
}
const summing = ref(false);
async function sumNow() {
  summing.value = true;
  try { await summarize(role.value, p.value); toast("记好了，在他的记忆库里"); } catch (e) { toast(describeError(e), 4000); } finally { summing.value = false; }
}
const memo = computed(() => store.memories.find(m => m.id === p.value?.memId));
const when = ts => new Date(ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
</script>

<template>
  <div v-if="p" class="proj" :class="{ 'has-bg': bg }" :style="look">
    <div class="page-bg" :style="bg ? { backgroundImage: `url(${bg})` } : {}" />

    <!-- 顶上：返回、书名，右边搜索、资料、更多（浮在讨论上面，讨论从下面滑过去） -->
    <header class="top">
      <div class="bar">
        <button class="glass" aria-label="回书桌" @click="goBack(router, '/write')"><Icon name="back" :size="20" /></button>
        <b class="ttl">{{ p.title }}</b>
        <button class="glass" aria-label="搜索和收藏" @click="finder = true"><Icon name="search" :size="19" /></button>
        <button class="glass" aria-label="资料" @click="shelf = true"><Icon name="folder" :size="19" /><i v-if="freshCount" class="dot" /></button>
        <button class="glass" aria-label="更多" @click="menu = true"><Icon name="more" :size="19" /></button>
      </div>
    </header>

    <!-- 讨论 -->
    <div ref="box" class="msgs">
      <p v-if="!msgs.length" class="hint">坐下来，和{{ him }}聊聊这本书：卡在哪、想试什么、哪里不对劲。<br />他会看着右上角「资料」里的定位、简介和卡片说。</p>
      <div v-for="m in msgs" :id="'wm-' + m.id" :key="m.id" class="m" :class="[m.from, { flash: flash === m.id }]">
        <AttList v-if="m.atts?.length" :atts="m.atts" small />
        <p v-if="m.text" role="button" @click="openActions(m, $event)">{{ m.text }}<i v-if="m.fav" class="fav">★</i></p>
        <small v-if="m.edited" class="edited">改过</small>
        <span v-for="(n, i) in m.notes || []" :key="i" class="act">📌 {{ n }}</span>
      </div>
      <div v-if="sending" class="m ai"><p class="typing">在想……</p></div>
    </div>
    <div ref="dock" class="dock">
      <AttList v-if="draftAtts.length" :atts="draftAtts" removable small class="draft-atts" @remove="a => draftAtts.splice(draftAtts.indexOf(a), 1)" />
      <div class="composer">
        <button class="plus" aria-label="发图片或文件" @click="attachToTalk"><Icon name="plus" :size="20" /></button>
        <textarea v-model="draft" v-auto-grow="growMax" rows="1" :placeholder="`想和${him}说的…`" />
        <button class="send" :disabled="sending" aria-label="发送" @click="send"><Icon name="send" :size="18" /></button>
      </div>
    </div>

    <BookDrawer :open="shelf" :book="p" :him="him" :wf="wf" @close="shelf = false" @cover="changeCover" @card="c => openCard(c)" @new="t => openCard(null, t)" @import="importMany" />
    <TalkDrawer :open="finder" :msgs="msgs" :me="role ? meName(role) : '我'" :him="him" @close="finder = false" @go="goMsg" @fav="favMsg" />

    <!-- 一张卡片 -->
    <Sheet :open="!!edit" :z="850" @close="edit = null">
      <div v-if="edit" class="ed">
        <div class="types"><button v-for="(t, k) in CARD_TYPES" :key="k" :class="{ on: edit.type === k }" @click="edit.type = k">{{ t.label }}</button></div>
        <div class="tints"><button v-for="(c, k) in TINTS" :key="k" :style="{ background: c }" :class="{ on: (edit.tint || 'white') === k }" :aria-label="k" @click="edit.tint = k" /></div>
        <input v-model="edit.title" class="input" placeholder="标题（比如人物的名字）" maxlength="60" />
        <textarea v-model="edit.content" class="input body" rows="8" placeholder="写下来，长短都行" />
        <AttList :atts="edit.atts" removable @remove="dropAtt" />
        <button class="btn soft small att-btn" @click="attachToCard"><Icon name="image" :size="16" /> 加图片、文件</button>
        <div class="row">
          <button v-if="editing" class="btn soft small danger" @click="dropCard">撕掉</button>
          <span class="grow" />
          <button class="btn small" @click="saveCard">存好</button>
        </div>

        <template v-if="editing">
          <h4>便利贴</h4>
          <div class="notes">
            <div v-for="n in notesOfCard(editing.id)" :key="n.id" class="note" :class="n.from === 'me' ? 'mine' : 'his'">
              <i class="tape" />
              <p>{{ n.text }}</p>
              <div class="nf"><small>— {{ n.from === "me" ? "我" : him }} · {{ when(n.ts) }}</small>
                <button v-if="n.from === 'ai'" @click="adoptNote(n); edit.content = editing.content">采纳</button>
                <button @click="removeNote(n)">撕掉</button></div>
            </div>
          </div>
          <div class="add-note">
            <input v-model="noteText" class="input" placeholder="自己贴一张便利贴" @keydown.enter="myNote" />
            <button class="btn soft small" @click="myNote">贴</button>
          </div>
          <button class="btn soft" :disabled="reviewing" @click="askReview">{{ reviewing ? `${him}在看……` : `请${him}看看这张` }}</button>
        </template>
      </div>
    </Sheet>

    <!-- 讨论里一句话的小选项 -->
    <Teleport to="body">
      <div v-if="actionMsg" class="ctx-mask" @click="actionMsg = null" @contextmenu.prevent>
        <div class="ctx-menu" :style="menuPos" @click.stop>
          <button @click="copyMsg"><Icon name="copy" :size="17" />复制</button>
          <button @click="favMsg()"><Icon name="star" :size="17" />{{ actionMsg.fav ? "取消收藏" : "收藏" }}</button>
          <button @click="startEdit"><Icon name="edit" :size="17" />修改</button>
          <button v-if="actionMsg.from === 'ai'" :disabled="sending" @click="regen"><Icon name="refresh" :size="17" />重新回答</button>
          <button class="danger" @click="removeMsg"><Icon name="trash" :size="17" />删除</button>
        </div>
      </div>
    </Teleport>

    <Sheet :open="!!fixing" title="修改" @close="fixing = null">
      <template v-if="fixing">
        <BigTextarea v-model="fixing.text" rows="7" title="修改" />
        <div class="row edit-actions">
          <button class="btn soft" @click="saveEdit(false)">仅保存</button>
          <button v-if="fixing.msg.from === 'me'" class="btn" :disabled="sending" @click="saveEdit(true)">保存并让{{ him }}重新回答</button>
        </div>
      </template>
    </Sheet>

    <!-- 讨论摘要：只在这本书里，不进记忆库 -->
    <Sheet :open="!!talkSumEdit" title="讨论摘要" @close="talkSumEdit = null">
      <template v-if="talkSumEdit">
        <div class="ts-info">
          <p v-if="p.talkSum?.text">已经整理了 <b>{{ p.talkSum.count }}</b> 句讨论{{ p.talkSum.at ? `，上一次 ${new Date(p.talkSum.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "" }}{{ p.talkSum.why === "limit" ? "（快到上限，自动整理的）" : p.talkSum.why === "manual" ? "（你点「现在整理」整理的）" : "" }}。</p>
          <p v-else>还没有讨论摘要。</p>
          <p class="rule">这份只在《{{ p.title }}》的讨论里给{{ him }}看，不进记忆库。{{ him }}每次看得到最近 {{ talkLimit() }} 句；摘要后面没整理的讨论到 {{ talkAutoAt() }} 句就自动整理：把这份和后面的合成新的一份，最近 {{ Math.floor(talkLimit() / 2) }} 句留着原样。用整理模型。</p>
        </div>
        <BigTextarea v-model="talkSumEdit.text" rows="9" title="讨论摘要" placeholder="还没有：讨论多了会自己整理，也可以点「现在整理」" />
        <div class="row edit-actions">
          <button class="btn soft" :disabled="talkSumBusy" @click="talkSumNow">{{ talkSumBusy ? "在整理……" : "现在整理" }}</button>
          <button class="btn" @click="saveTalkSum">保存</button>
        </div>
      </template>
    </Sheet>

    <Sheet :open="menu" :title="`《${p.title}》`" @close="menu = false">
      <div class="menu">
        <button class="list-row" @click="menu = false; openTalkSum()"><Icon name="memory" :size="20" /><span class="grow">讨论摘要<small class="sub">{{ p.talkSum?.text ? `${p.talkSum.count} 句讨论整理成的，只在这本书里` : "讨论多了会自己整理，只在这本书里" }}</small></span></button>
        <div class="section-label">{{ him }}每次看得到最近多少句讨论</div>
        <div class="seg"><button v-for="n in [30, 60, 100, 200]" :key="n" :class="{ on: talkLimit() === n }" @click="store.settings.writeLimit = n">{{ n }} 句</button></div>

        <div class="section-label">这一页的样子</div>
        <div class="list-row"><Icon name="image" :size="20" /><span class="grow">背景</span>
          <button v-if="p.bg" class="btn soft small" @click="clearImage('bg')">恢复默认</button>
          <button class="btn soft small" @click="menu = false; changeBg()">换背景</button></div>
        <div class="section-label">共写室的字号</div>
        <div class="seg"><button v-for="(f, k) in FONTS" :key="k" :class="{ on: (store.settings.writeFont || 'standard') === k }" @click="store.settings.writeFont = k">{{ f[0] }}</button></div>
        <div class="section-label">我的气泡</div>
        <div class="swatch-row"><ColorSwatches :model-value="p.bubbleMe || '#ffffff'" :colors="BUBBLE_COLORS" @update:model-value="v => (p.bubbleMe = v)" /></div>
        <div class="section-label">{{ him }}的字的颜色</div>
        <div class="swatch-row"><ColorSwatches :model-value="p.aiInk || INKS[0]" :colors="INKS" @update:model-value="v => (p.aiInk = v)" /></div>

        <div class="section-label">记忆库（全局）</div>
        <p v-if="memo" class="memo"><b>{{ him }}记着的：</b>{{ memo.content }}</p>
        <button class="list-row" :disabled="summing" @click="sumNow">{{ summing ? "在整理……" : `让${him}把这本书记进记忆库${memo ? "（更新）" : ""}` }}<small class="sub">手动的：记了以后平时聊天他也知道这本书写到哪了</small></button>

        <button class="list-row danger" @click="drop">从书桌上拿走</button>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
/* 整页固定、里面自己滚：输入框不会被 iPhone 的键盘顶来顶去。页头和输入框都浮在讨论上面，讨论从它们下面滑过去 */
.proj { position: fixed; inset: 0; height: 100dvh; overflow: hidden; }
.page-bg { position: absolute; inset: 0; background: var(--bg); background-size: cover; background-position: center; }
.top { position: absolute; top: 0; left: 0; right: 0; z-index: 2; pointer-events: none; padding-bottom: 22px; background: linear-gradient(var(--bg) 55%, transparent); }
.has-bg .top { background: none; }
.bar { display: flex; align-items: center; gap: 8px; padding: calc(var(--safe-top) + 10px) 14px 0; }
.ttl { flex: 1; min-width: 0; font-size: calc(1.05rem * var(--wf)); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-left: 4px; }
.bar button { pointer-events: auto; }
.glass { position: relative; width: 40px; height: 40px; border-radius: 50%; border: 0; display: grid; place-items: center; color: var(--ink); background: rgba(255, 255, 255, .72); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); box-shadow: 0 2px 10px rgba(40, 40, 60, .1); }
.glass .dot { position: absolute; top: 7px; right: 7px; width: 8px; height: 8px; border-radius: 50%; background: #6aa7e0; box-shadow: 0 0 0 2px #fff; }
.grow { flex: 1; }
.msgs {
  position: absolute; inset: 0; z-index: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; -webkit-overflow-scrolling: touch;
  padding: calc(var(--safe-top) + 72px) max(18px, calc((100% - 760px) / 2)) calc(var(--dock) + var(--safe-bottom) + 24px);
}
.msgs > :first-child { margin-top: auto; }
.hint { text-align: center; color: var(--text-3); font-size: calc(.8rem * var(--wf)); line-height: 1.8; margin: 22px 10px; }
.has-bg .hint { color: var(--text-2); background: rgba(255, 255, 255, .7); border-radius: 14px; padding: 10px 12px; }
.m { max-width: 86%; display: flex; flex-direction: column; gap: 4px; flex: none; }
.m p { margin: 0; padding: 10px 14px; border-radius: 18px; font-size: calc(.92rem * var(--wf)); line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; cursor: pointer; -webkit-touch-callout: none; }
.m.me { align-self: flex-end; align-items: flex-end; }
.m.me p { background: var(--me); color: var(--me-text); box-shadow: var(--shadow-soft); border-bottom-right-radius: 6px; }
.m.ai { max-width: 100%; align-self: stretch; }
.m.ai p { padding: 4px 2px; color: var(--ai-ink); }
.has-bg .m.ai p { background: rgba(255, 255, 255, .72); padding: 10px 14px; }
.fav { font-style: normal; color: #e0a53a; font-size: .7rem; margin-left: 6px; }
.edited { font-size: .66rem; color: var(--text-3); padding: 0 6px; }
.m.flash p { animation: flash 1.8s ease-out; }
@keyframes flash { 0%, 40% { box-shadow: 0 0 0 3px #f0c36a; } 100% { box-shadow: 0 0 0 0 transparent; } }
.act { font-size: calc(.72rem * var(--wf)); color: var(--text-2); padding: 0 6px; }
.has-bg .act, .has-bg .edited { background: rgba(255, 255, 255, .75); border-radius: 999px; padding: 1px 8px; }
.typing { animation: breathe 1.6s ease-in-out infinite; }
@keyframes breathe { 50% { opacity: .5; } }
.dock { position: absolute; left: 0; right: 0; bottom: calc(var(--safe-bottom) + 12px); z-index: 3; display: flex; flex-direction: column; align-items: center; padding: 0 18px; pointer-events: none; }
.dock > * { pointer-events: auto; width: 100%; max-width: 724px; box-sizing: border-box; }
.draft-atts { margin-bottom: 8px; }
.composer { display: flex; align-items: flex-end; gap: 8px; padding: 8px; background: rgba(255, 255, 255, .92); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); border-radius: 24px; box-shadow: 0 6px 24px rgba(40, 40, 60, .1); }
.composer textarea { flex: 1; min-width: 0; border: 0; outline: none; background: none; resize: none; font-size: calc(.95rem * var(--wf)); line-height: 1.55; padding: 7px 8px; overflow-y: hidden; }
.send { width: 38px; height: 38px; border-radius: 50%; border: 0; background: var(--ink); color: #fff; display: grid; place-items: center; flex: none; }
.plus { width: 38px; height: 38px; border-radius: 50%; border: 0; background: var(--bg-deep); color: var(--text-2); display: grid; place-items: center; flex: none; }
.seg { display: flex; gap: 6px; padding: 2px 4px 10px; }
.seg button { border: 0; background: var(--bg); padding: 6px 14px; border-radius: 999px; font-size: .85rem; color: var(--text-2); }
.seg button.on { background: var(--ink); color: #fff; font-weight: 600; }
.ed { display: flex; flex-direction: column; gap: 10px; max-height: 78vh; overflow-y: auto; }
.types { display: flex; gap: 6px; flex-wrap: wrap; }
.types button { border: 0; background: var(--bg-deep); padding: 5px 12px; border-radius: 999px; font-size: .8rem; color: var(--text-2); }
.types button.on { background: var(--ink); color: #fff; }
.tints { display: flex; gap: 8px; padding: 3px; }
.tints button { width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--line); }
.tints button.on { box-shadow: 0 0 0 2px var(--ink); }
.body { min-height: 160px; line-height: 1.7; }
.row { display: flex; gap: 8px; align-items: center; }
h4 { margin: 8px 0 0; font-size: .82rem; color: var(--text-2); font-weight: 600; }
.notes { display: flex; flex-direction: column; gap: 12px; }
.note { position: relative; padding: 14px 14px 8px; border-radius: 2px; box-shadow: 0 6px 14px rgba(60, 45, 30, .12); transform: rotate(-.8deg); }
.note:nth-child(even) { transform: rotate(.8deg); }
.note.mine { background: #fff1a8; }
.note.his { background: #dcebfc; }
.note p { margin: 0; font-size: .9rem; line-height: 1.7; white-space: pre-wrap; }
.tape { position: absolute; top: -8px; left: 50%; width: 46px; height: 16px; transform: translateX(-50%) rotate(-3deg); background: rgba(255, 255, 255, .55); }
.nf { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.nf small { flex: 1; font-size: .68rem; color: rgba(60, 45, 30, .5); }
.nf button { border: 0; background: rgba(255, 255, 255, .6); border-radius: 999px; padding: 3px 10px; font-size: .72rem; }
.add-note { display: flex; gap: 8px; }
.add-note .input { flex: 1; }
.danger { color: var(--danger); }
.menu { display: flex; flex-direction: column; }
.menu .list-row { gap: 10px; }
.memo { margin: 0 0 8px; padding: 10px 12px; border-radius: 12px; background: var(--bg); font-size: .82rem; line-height: 1.7; color: var(--text-2); }
.memo b { color: var(--text); font-weight: 600; }
.menu .sub { display: block; font-size: .72rem; color: var(--text-3); font-weight: 400; }
.ts-info { font-size: .76rem; line-height: 1.7; color: var(--text-2); margin: 0 2px 10px; }
.ts-info p { margin: 0 0 2px; }
.ts-info .rule { color: var(--text-3); margin-top: 4px; }
.swatch-row { padding: 4px 4px 10px; }
.edit-actions { justify-content: flex-end; margin-top: 12px; }
.att-btn { align-self: flex-start; display: flex; align-items: center; gap: 4px; }
</style>
