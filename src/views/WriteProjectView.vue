<script setup>
// 一本书（共写）：两页——卡片（人物、设定、大纲、灵感、片段……一张张）和讨论（坐在书桌前和他聊这本书）。
// 卡片上可以贴便利贴：你的黄色，他的蓝色；他的可以「采纳」（接到卡片里）或撕掉
import { ref, computed, nextTick, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, MAIN, roleById } from "../store/index.js";
import { projectById, cardsOf, notesOfCard, addCard, removeCard, addNote, removeNote, adoptNote, loadTalk, talk, reviewCard, removeProject, summarize, toAtt, importFiles, CARD_TYPES, SPINES } from "../lib/writing.js";
import { pickFile, deleteImage } from "../lib/images.js";
import AttList from "../components/write/AttList.vue";
import { describeError } from "../lib/chat.js";
import { toast } from "../lib/toast.js";
import { goBack } from "../lib/nav.js";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";

const route = useRoute();
const router = useRouter();
const p = computed(() => projectById(route.params.id));
const role = computed(() => roleById(MAIN));
const tab = ref("cards");
const filter = ref("all");
const cards = computed(() => (p.value ? cardsOf(p.value.id) : []).filter(c => filter.value === "all" || c.type === filter.value).sort((a, b) => b.ts - a.ts));
const counts = computed(() => { const m = {}; for (const c of p.value ? cardsOf(p.value.id) : []) m[c.type] = (m[c.type] || 0) + 1; return m; });
onMounted(() => {
  if (!p.value) return router.replace("/write");
  // 从书桌墙上的便利贴点进来：直接打开那张卡片
  const c = route.query.card && cardsOf(p.value.id).find(x => x.id === route.query.card);
  if (c) openCard(c);
});

// ---------- 卡片 ----------
const edit = ref(null); // 正在看 / 改的卡片（副本）
const editing = ref(null); // 原卡片
function openCard(c) {
  editing.value = c;
  edit.value = c ? { ...c, atts: [...(c.atts || [])] } : { type: filter.value === "all" ? "idea" : filter.value, title: "", content: "", atts: [] };
  for (const n of c ? notesOfCard(c.id) : []) n.seen = true;
}
function saveCard() {
  const e = edit.value;
  if (!e.title.trim() && !e.content.trim() && !e.atts.length) return toast("卡片还是空的");
  if (editing.value) Object.assign(editing.value, { type: e.type, title: e.title.trim(), content: e.content.trim(), atts: e.atts, ts: Date.now(), from: "me" });
  else editing.value = addCard(p.value.id, e);
  edit.value = null;
}
function dropCard() {
  if (!editing.value || !confirm("撕掉这张卡片？上面的便利贴也会一起没有。")) return;
  removeCard(editing.value);
  edit.value = null;
}
// 卡片上挂图片、文件；导入一批文件（每个一张卡片，放进现在选的分类，「全部」时放进资料）
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
const importing = ref(false);
async function importMany() {
  const files = await pickFile(ACCEPT, true);
  if (!files.length) return;
  importing.value = true;
  try {
    const made = await importFiles(p.value.id, files, filter.value === "all" ? "ref" : filter.value);
    toast(`放进来 ${made.length} 张卡片`);
  } catch (e) {
    toast(e.message, 4000);
  } finally {
    importing.value = false;
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
watch(tab, async t => { if (t === "talk" && p.value) { msgs.value = await loadTalk(p.value.id); down(); } });
async function send() {
  if (sending.value || !role.value) return;
  const t = draft.value, atts = draftAtts.value;
  if (!t.trim() && !atts.length && msgs.value.at(-1)?.from !== "me") return;
  draft.value = "";
  draftAtts.value = [];
  sending.value = true;
  msgs.value = await loadTalk(p.value.id);
  down();
  try {
    const promise = talk(role.value, p.value, t, atts);
    down();
    await promise;
  } catch (e) {
    toast(describeError(e), 4000);
  } finally {
    sending.value = false;
    down();
  }
}

// ---------- 这本书 ----------
const menu = ref(false);
function rename() { const t = prompt("书名", p.value.title); if (t?.trim()) p.value.title = t.trim().slice(0, 60); }
async function drop() {
  if (!confirm(`把《${p.value.title}》从书桌上拿走？卡片和讨论都会没有（他记忆库里的总结还在）。`)) return;
  const x = p.value;
  router.replace("/write");
  await removeProject(x);
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
  <div v-if="p" class="proj">
    <header class="head">
      <button class="icon-btn" aria-label="回书桌" @click="goBack(router, '/write')"><Icon name="back" /></button>
      <div class="t"><i class="spine" :style="{ background: SPINES[p.color % SPINES.length] }" /><h1>{{ p.title }}</h1></div>
      <button class="icon-btn" aria-label="更多" @click="menu = true"><Icon name="more" /></button>
    </header>
    <nav class="tabs">
      <button :class="{ on: tab === 'cards' }" @click="tab = 'cards'">卡片</button>
      <button :class="{ on: tab === 'talk' }" @click="tab = 'talk'">和{{ role?.name || "他" }}讨论</button>
    </nav>

    <!-- 卡片 -->
    <template v-if="tab === 'cards'">
      <div class="filters">
        <button :class="{ on: filter === 'all' }" @click="filter = 'all'">全部</button>
        <button v-for="(t, k) in CARD_TYPES" :key="k" :class="{ on: filter === k }" @click="filter = k">{{ t.label }}<small v-if="counts[k]">{{ counts[k] }}</small></button>
      </div>
      <div class="cards">
        <div class="new-col">
          <button class="card new" @click="openCard(null)"><Icon name="plus" :size="20" /><span>写一张{{ filter === "all" ? "" : CARD_TYPES[filter].label }}卡片</span></button>
          <button class="card new imp" :disabled="importing" @click="importMany"><Icon name="upload" :size="18" /><span>{{ importing ? "在放…" : `导入图片、文件${filter === "all" ? "（放进资料）" : `（放进${CARD_TYPES[filter].label}）`}` }}</span></button>
        </div>
        <div v-for="c in cards" :key="c.id" class="card" role="button" tabindex="0" :class="{ his: c.from === 'ai' }" @click="openCard(c)">
          <span class="type">{{ CARD_TYPES[c.type]?.mark }}</span>
          <b>{{ c.title || "无题" }}</b>
          <p v-if="c.content">{{ c.content }}</p>
          <AttList v-if="c.atts?.length" :atts="c.atts.slice(0, 3)" small />
          <span v-if="notesOfCard(c.id).length" class="stk" :class="{ fresh: notesOfCard(c.id).some(n => n.from === 'ai' && !n.seen) }">{{ notesOfCard(c.id).length }}</span>
          <small v-if="c.from === 'ai'" class="by">{{ role?.name }} 提的</small>
        </div>
      </div>
      <p v-if="!cards.length" class="hint">人物、设定、大纲、灵感、写好的片段……想到什么就放一张。他会读这些卡片，和你一起琢磨。</p>
    </template>

    <!-- 讨论 -->
    <div v-else class="talk">
      <div ref="box" class="msgs">
        <p v-if="!msgs.length" class="hint">坐下来，和{{ role?.name || "他" }}聊聊这本书：卡在哪、想试什么、哪里不对劲。他会看着你的卡片说。</p>
        <div v-for="m in msgs" :key="m.id" class="m" :class="m.from">
          <AttList v-if="m.atts?.length" :atts="m.atts" small />
          <p v-if="m.text">{{ m.text }}</p>
          <span v-for="(n, i) in m.notes || []" :key="i" class="act">📌 {{ n }}</span>
        </div>
        <div v-if="sending" class="m ai"><p class="typing">在想……</p></div>
      </div>
      <AttList v-if="draftAtts.length" :atts="draftAtts" removable small class="draft-atts" @remove="a => draftAtts.splice(draftAtts.indexOf(a), 1)" />
      <div class="composer">
        <button class="plus" aria-label="发图片或文件" @click="attachToTalk"><Icon name="plus" :size="20" /></button>
        <textarea v-model="draft" rows="1" placeholder="想和他说的…" @keydown.enter.exact.prevent="send" />
        <button class="send" :disabled="sending" aria-label="发送" @click="send"><Icon name="send" :size="18" /></button>
      </div>
    </div>

    <!-- 一张卡片 -->
    <Sheet :open="!!edit" @close="edit = null">
      <div v-if="edit" class="ed">
        <div class="types"><button v-for="(t, k) in CARD_TYPES" :key="k" :class="{ on: edit.type === k }" @click="edit.type = k">{{ t.label }}</button></div>
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
              <div class="nf"><small>— {{ n.from === "me" ? "我" : role?.name }} · {{ when(n.ts) }}</small>
                <button v-if="n.from === 'ai'" @click="adoptNote(n); edit.content = editing.content">采纳</button>
                <button @click="removeNote(n)">撕掉</button></div>
            </div>
          </div>
          <div class="add-note">
            <input v-model="noteText" class="input" placeholder="自己贴一张便利贴" @keydown.enter="myNote" />
            <button class="btn soft small" @click="myNote">贴</button>
          </div>
          <button class="btn soft" :disabled="reviewing" @click="askReview">{{ reviewing ? `${role?.name}在看……` : `请${role?.name || "他"}看看这张` }}</button>
        </template>
      </div>
    </Sheet>

    <Sheet :open="menu" :title="`《${p.title}》`" @close="menu = false">
      <div class="menu">
        <p v-if="memo" class="memo"><b>他记着的：</b>{{ memo.content }}</p>
        <button class="list-row" :disabled="summing" @click="sumNow">{{ summing ? "在整理……" : "让他把最近的讨论记进记忆库" }}</button>
        <div class="list-row"><span class="grow">书脊颜色</span>
          <div class="colors"><button v-for="(c, i) in SPINES" :key="i" :style="{ background: c }" :class="{ on: p.color === i }" @click="p.color = i" /></div>
        </div>
        <button class="list-row" @click="rename">改书名</button>
        <button class="list-row danger" @click="drop">从书桌上拿走</button>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.proj { min-height: 100%; padding: calc(var(--safe-top) + 14px) 18px calc(var(--safe-bottom) + 30px); max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; }
.head { display: flex; align-items: center; gap: 12px; }
.t { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0; }
.spine { width: 6px; height: 26px; border-radius: 1px; flex: none; }
.t h1 { margin: 0; font-size: 1.25rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tabs { display: flex; gap: 6px; margin: 16px 0 12px; }
.tabs button, .filters button { border: 0; background: var(--card); padding: 7px 16px; border-radius: 999px; font-size: .85rem; color: var(--text-2); box-shadow: var(--shadow-soft); white-space: nowrap; }
.tabs button.on, .filters button.on { background: var(--ink); color: #fff; font-weight: 600; }
.filters { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 2px 2px 10px; }
.filters::-webkit-scrollbar { display: none; }
.filters button { padding: 5px 12px; font-size: .78rem; box-shadow: none; background: var(--bg-deep); }
.filters small { margin-left: 4px; opacity: .6; }
.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (min-width: 640px) { .cards { grid-template-columns: repeat(3, 1fr); } }
.card { position: relative; text-align: left; cursor: pointer; border: 0; border-radius: 16px; background: var(--card); padding: 12px 12px 14px; box-shadow: var(--shadow-soft); display: flex; flex-direction: column; gap: 4px; min-height: 120px; }
.card.his { background: #f1f6fc; }
.card.new { align-items: center; justify-content: center; color: var(--text-3); background: var(--card-2); box-shadow: inset 0 0 0 1.5px var(--line); font-size: .8rem; gap: 6px; }
.type { width: 22px; height: 22px; border-radius: 6px; background: var(--bg-deep); font-size: .7rem; display: grid; place-items: center; color: var(--text-2); }
.card b { font-size: .92rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card p { margin: 0; font-size: .8rem; line-height: 1.6; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
.stk { position: absolute; top: 10px; right: 10px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 3px; background: #f4e7a8; font-size: .7rem; display: grid; place-items: center; transform: rotate(4deg); }
.stk.fresh { background: #cfe0f2; }
.by { font-size: .65rem; color: #7a96b4; }
.hint { text-align: center; color: var(--text-3); font-size: .8rem; line-height: 1.7; margin: 22px 10px; }
.talk { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.msgs { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 4px 2px 12px; max-height: calc(100dvh - var(--safe-top) - var(--safe-bottom) - 200px); }
.m { max-width: 86%; display: flex; flex-direction: column; gap: 4px; }
.m p { margin: 0; padding: 10px 14px; border-radius: 16px; font-size: .92rem; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.m.me { align-self: flex-end; align-items: flex-end; }
.m.me p { background: #fff; box-shadow: var(--shadow-soft); }
.m.ai p { background: var(--blue); }
.act { font-size: .72rem; color: var(--text-2); padding: 0 6px; }
.typing { color: var(--text-2); animation: breathe 1.6s ease-in-out infinite; }
@keyframes breathe { 50% { opacity: .5; } }
.composer { display: flex; align-items: flex-end; gap: 8px; padding: 8px; background: var(--card); border-radius: 22px; box-shadow: var(--shadow-soft); }
.composer textarea { flex: 1; border: 0; outline: none; background: none; resize: none; font-size: .95rem; line-height: 1.5; padding: 6px 8px; max-height: 140px; field-sizing: content; }
.send { width: 36px; height: 36px; border-radius: 50%; border: 0; background: var(--ink); color: #fff; display: grid; place-items: center; flex: none; }
.ed { display: flex; flex-direction: column; gap: 10px; max-height: 78vh; overflow-y: auto; }
.types { display: flex; gap: 6px; flex-wrap: wrap; }
.types button { border: 0; background: var(--bg-deep); padding: 5px 12px; border-radius: 999px; font-size: .8rem; color: var(--text-2); }
.types button.on { background: var(--ink); color: #fff; }
.body { min-height: 160px; line-height: 1.7; }
.row { display: flex; gap: 8px; align-items: center; }
.grow { flex: 1; }
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
.memo { margin: 0 0 8px; padding: 10px 12px; border-radius: 12px; background: var(--bg); font-size: .82rem; line-height: 1.7; color: var(--text-2); }
.memo b { color: var(--text); font-weight: 600; }
.colors { display: flex; gap: 6px; }
.colors button { width: 18px; height: 26px; border: 0; border-radius: 2px; }
.colors button.on { box-shadow: 0 0 0 2px var(--ink); }
.new-col { display: flex; flex-direction: column; gap: 10px; }
.new-col .card.new { min-height: 55px; flex: 1; }
.card.new.imp { font-size: .72rem; text-align: center; padding: 8px; }
.card :deep(.atts) { margin-top: 4px; }
.plus { width: 36px; height: 36px; border-radius: 50%; border: 0; background: var(--bg-deep); color: var(--text-2); display: grid; place-items: center; flex: none; }
.draft-atts { margin-bottom: 8px; }
.att-btn { align-self: flex-start; display: flex; align-items: center; gap: 4px; }
</style>
