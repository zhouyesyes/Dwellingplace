<script setup>
// 共读的讨论室：/books/talk/<书的 id>（一本书一间），/books/talk/hall（共读室里的大讨论室）。
// 我的话有气泡；他的话没有气泡，直接占满一行（和共写的讨论一样）。点一句可以删、他的可以重新说；右上角「⋯」整理讨论、看摘要
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { MAIN, roleById } from "../store/index.js";
import { HALL, roomBook, roomOwner, roomTitle, loadRoom, roomTalk, saveRoom, dropRoomMsg, regenRoom, compressRoom, roomLimit, roomAfterSum } from "../lib/readTalk.js";
import { progressOf } from "../lib/books.js";
import { latestImpr } from "../lib/reading.js";
import { describeError } from "../lib/chat.js";
import { blockMd } from "../lib/inlineMd.js";
import { vAutoGrow } from "../lib/autogrow.js";
import { sumTokens, fmtTok } from "../lib/budget.js";
import { toast } from "../lib/toast.js";
import { goBack } from "../lib/nav.js";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";

const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id || HALL));
const role = computed(() => roleById(MAIN));
const him = computed(() => role.value?.name || "他");
const book = computed(() => roomBook(id.value));
const owner = computed(() => roomOwner(id.value));
const msgs = ref([]);
const draft = ref("");
const busy = ref(false);
const scroller = ref(null);
// 滚到最新一句：排完版再滚一次（长回复、表格渲染出来会变高）
const stick = () => { if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight; };
const down = () => nextTick(() => { stick(); requestAnimationFrame(stick); });

onMounted(async () => {
  if (id.value !== HALL && !book.value) return router.replace("/books");
  msgs.value = await loadRoom(id.value);
  down();
});

// 一句话说这间屋子
const sub = computed(() => {
  const b = book.value;
  if (!b) return "读过的、在读的书，读书这件事";
  const pct = Math.round(progressOf(b) * 100);
  const im = latestImpr(b);
  return [b.his || b.mine ? "读完了" : pct > 0 ? `读到 ${pct}%` : "还没开始读", im && `${him.value}的印象：${im.text}`].filter(Boolean).join(" · ");
});

async function send(text = draft.value) {
  if (busy.value || !role.value) return;
  if (!text.trim() && msgs.value.at(-1)?.from !== "me") return;
  draft.value = "";
  busy.value = true;
  down();
  try {
    await roomTalk(role.value, id.value, text);
  } catch (e) {
    toast(describeError(e), 5000);
  } finally {
    busy.value = false;
    down();
  }
}
const onKey = e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer: fine)").matches) { e.preventDefault(); send(); } };

// 点一句：删掉 / 他的重新说
const act = ref(null);
async function del() {
  const m = act.value; act.value = null;
  await dropRoomMsg(id.value, m.id);
}
async function regen() {
  const m = act.value; act.value = null;
  busy.value = true;
  try { await regenRoom(role.value, id.value, m.id); } catch (e) { toast(describeError(e), 5000); } finally { busy.value = false; down(); }
}
function copy() {
  navigator.clipboard?.writeText(act.value.text).then(() => toast("复制了")).catch(() => {});
  act.value = null;
}

// 「⋯」：整理讨论、看摘要
const menu = ref(false);
const sumOpen = ref(false);
const rawTok = computed(() => sumTokens(roomAfterSum(owner.value, msgs.value)));
async function compress() {
  menu.value = false;
  busy.value = true;
  try {
    const n = await compressRoom(role.value, id.value);
    toast(n ? `整理了前面 ${n} 句，最近的留着原文` : "还没什么要整理的");
    await saveRoom(id.value);
  } catch (e) { toast(describeError(e), 5000); } finally { busy.value = false; }
}
async function clearAll() {
  menu.value = false;
  if (!confirm("清空这间讨论室的讨论？摘要也一起清掉。")) return;
  msgs.value.splice(0);
  await saveRoom(id.value);
  if (owner.value) delete owner.value.talkSum;
}
const ideas = computed(() => book.value
  ? ["读到现在，你最在意哪个人物？", "这本书哪里让你不舒服？", "你最开始的印象现在还成立吗？"]
  : ["最近读的几本里，你最喜欢哪本？", "有没有两本书其实在讲同一件事？", "下一本想一起读什么？"]);

const dock = ref(null);
const dockH = ref(80);
let ro = null;
onMounted(() => { ro = new ResizeObserver(() => { if (dock.value) dockH.value = dock.value.offsetHeight; }); if (dock.value) ro.observe(dock.value); });
onBeforeUnmount(() => ro?.disconnect());
</script>

<template>
  <div class="rt" :style="{ '--dock': dockH + 'px' }">
    <header class="bar">
      <button class="icon-btn" aria-label="返回" @click="goBack(router, book ? `/read/${book.id}` : '/books')"><Icon name="back" /></button>
      <div class="ttl"><b>{{ roomTitle(id) }}</b><small>{{ sub }}</small></div>
      <button v-if="book" class="icon-btn" aria-label="回到书里" @click="router.push(`/read/${book.id}`)"><Icon name="file" /></button>
      <button class="icon-btn" aria-label="更多" @click="menu = true"><Icon name="more" /></button>
    </header>

    <main ref="scroller" class="list">
      <div v-if="!msgs.length && !busy" class="empty">
        <p>{{ book ? `坐下来，和${him}聊聊这本书。${him}会看着这本书的前情、他一路写的中途印象、读后感、你们的批注和读书笔记。` : `共读室的大讨论室：聊读过的、在读的书，几本放在一起比，或者聊读书这件事。${him}会看着书架上每本书读到哪、他的印象和读后感。` }}</p>
        <button v-for="q in ideas" :key="q" class="idea" @click="send(q)">{{ q }}</button>
      </div>
      <p v-if="owner?.talkSum?.text" class="sum-tip" @click="sumOpen = true">前面 {{ owner.talkSum.count }} 句已经整理成摘要了 · 点开看</p>
      <template v-for="m in msgs" :key="m.id">
        <div v-if="m.from === 'me'" class="m me" @click="act = m"><p>{{ m.text }}</p></div>
        <div v-else class="m ai" @click="act = m">
          <div v-for="(para, i) in (m.text || '').split(/\n\s*\n/).filter(x => x.trim())" :key="i" class="mt" v-html="blockMd(para)" />
          <small v-for="(n, i) in m.notes || []" :key="i" class="note">{{ n }}</small>
        </div>
      </template>
      <div v-if="busy" class="m ai"><span class="dots"><i /><i /><i /></span></div>
    </main>

    <footer ref="dock" class="dock">
      <textarea v-model="draft" v-auto-grow rows="1" class="input" :placeholder="`和${him}说…`" @keydown="onKey" />
      <button class="send" :class="{ on: draft.trim() }" :disabled="busy" aria-label="发送" @click="send()"><Icon name="send" :size="20" /></button>
    </footer>

    <Sheet :open="!!act" @close="act = null">
      <div class="acts">
        <button @click="copy"><Icon name="copy" :size="17" />复制</button>
        <button v-if="act?.from === 'ai'" :disabled="busy" @click="regen"><Icon name="refresh" :size="17" />重新说</button>
        <button class="danger" @click="del"><Icon name="trash" :size="17" />删掉这句</button>
      </div>
    </Sheet>

    <Sheet :open="menu" :title="roomTitle(id)" @close="menu = false">
      <p class="info">没整理的讨论约 {{ fmtTok(rawTok) }} token，到 {{ fmtTok(Math.round(roomLimit() * 0.8)) }} 会自动把前面的整理成摘要（接在旧摘要后面，旧的不改），最近一半留着原文。</p>
      <div class="acts">
        <button v-if="owner?.talkSum?.text" @click="menu = false; sumOpen = true"><Icon name="file" :size="17" />看讨论摘要</button>
        <button :disabled="busy" @click="compress"><Icon name="refresh" :size="17" />现在整理</button>
        <button class="danger" @click="clearAll"><Icon name="trash" :size="17" />清空讨论</button>
      </div>
    </Sheet>

    <Sheet :open="sumOpen" title="讨论摘要" @close="sumOpen = false">
      <pre class="sum">{{ owner?.talkSum?.text }}</pre>
    </Sheet>
  </div>
</template>

<style scoped>
.rt { height: 100dvh; background: var(--bg); display: flex; flex-direction: column; }
.bar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 8px; padding: calc(var(--safe-top) + 10px) 12px 10px; background: rgba(var(--glass-rgb), .86); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); }
.ttl { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ttl b { font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ttl small { font-size: .72rem; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.list { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; max-width: 760px; width: 100%; margin: 0 auto; padding: 14px 16px calc(var(--dock) + var(--safe-bottom) + 24px); display: flex; flex-direction: column; gap: 14px; }
.empty { text-align: center; color: var(--text-3); font-size: .84rem; line-height: 1.8; margin: 30px 8px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.empty p { margin: 0 0 6px; }
.idea { border: 0; background: var(--card); color: var(--text-2); border-radius: 999px; padding: 7px 14px; font-size: .8rem; box-shadow: var(--shadow-soft); }
.sum-tip { align-self: center; margin: 0; font-size: .72rem; color: var(--text-3); background: var(--card); border-radius: 999px; padding: 4px 12px; cursor: pointer; }
.m.me { align-self: flex-end; max-width: 82%; }
.m.me p { margin: 0; background: var(--card); color: var(--text); padding: 10px 14px; border-radius: 18px 18px 4px 18px; box-shadow: var(--shadow-soft); white-space: pre-wrap; line-height: 1.65; font-size: .95rem; }
.m.ai { color: var(--text); line-height: 1.8; font-size: .97rem; }
.m.ai .note { display: block; font-size: .72rem; color: var(--text-3); margin-top: 4px; }
.mt { margin-bottom: .7em; }
.mt :deep(p) { margin: 0 0 .6em; }
.mt :deep(.md-h) { margin: .6em 0 .3em; font-weight: 700; }
.mt :deep(.md-list) { margin: .2em 0 .6em; padding-left: 1.3em; }
.mt :deep(.md-quote) { margin: .3em 0; padding-left: 10px; border-left: 3px solid var(--line); color: var(--text-2); }
.mt :deep(.md-tbl) { overflow-x: auto; margin: .4em 0; }
.mt :deep(table) { border-collapse: collapse; font-size: .88em; }
.mt :deep(td), .mt :deep(th) { border: 1px solid var(--line); padding: 4px 8px; }
.dots { display: inline-flex; gap: 5px; padding: 6px 2px; }
.dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); animation: hop 1.2s infinite; }
.dots i:nth-child(2) { animation-delay: .15s; }
.dots i:nth-child(3) { animation-delay: .3s; }
@keyframes hop { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }
.dock { position: fixed; left: 0; right: 0; bottom: 0; z-index: 6; display: flex; align-items: flex-end; gap: 8px; max-width: 760px; margin: 0 auto; padding: 10px 14px var(--dock-bottom); }
.dock .input { flex: 1; resize: none; min-height: 44px; height: 44px; max-height: 40vh; line-height: 1.5; border-radius: 22px; padding: 11px 16px; background: rgba(var(--glass-rgb), .92); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); box-shadow: var(--shadow-soft); }
.send { width: 44px; height: 44px; border-radius: 50%; border: 0; display: grid; place-items: center; background: var(--card); color: var(--text-3); box-shadow: var(--shadow-soft); flex: none; }
.send.on { background: var(--ink); color: var(--on-ink); }
.acts { display: flex; flex-direction: column; gap: 4px; }
.acts button { display: flex; align-items: center; gap: 10px; border: 0; background: none; padding: 12px 6px; font-size: .95rem; color: var(--text); text-align: left; }
.acts .danger { color: var(--danger); }
.info { font-size: .8rem; color: var(--text-3); line-height: 1.7; margin: 0 4px 8px; }
.sum { white-space: pre-wrap; font-family: inherit; font-size: .86rem; line-height: 1.75; color: var(--text-2); max-height: 60vh; overflow-y: auto; margin: 0; }
</style>
