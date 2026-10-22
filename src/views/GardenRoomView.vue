<script setup>
// 小世界里花园的一间房（逛 / 玩 / 雾潮群岛）：/garden/<谁>/<stroll|play|nostos>。
// 和共读讨论室一样的对话框：我的话有气泡，他的话占满一行；点一句可以删、他的可以重新说。
// 右上角：这间房的心得本（和记忆页 Drawers 里是同一本）、「⋯」整理对话、调这间房带多少字
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, roleById } from "../store/index.js";
import { roomOf, roomConnected, roomIntro } from "../lib/rooms.js";
import { loadGRoom, saveGRoom, roomSay, dropGMsg, regenGRoom, compressGRoom, clearGRoom, gSum, afterSum, roomTokens, roomScene, roomSystem } from "../lib/gardenTalk.js";
import { INSIGHT_CATS, insightsOf, removeInsight, groupByGame } from "../lib/insights.js";
import { wakeName } from "../lib/wake.js";
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
const role = computed(() => roleById(String(route.params.roleId)));
const key = computed(() => String(route.params.room));
const room = computed(() => roomOf(key.value));
const intro = computed(() => (void store.roomIntros, role.value && room.value ? roomIntro(role.value, key.value) : ""));
const who = computed(() => wakeName(role.value));
const connected = computed(() => !!role.value && roomConnected(role.value, key.value));
const owner = computed(() => (role.value ? gSum(role.value, key.value) : null));
const msgs = ref([]);
const draft = ref("");
const busy = ref(false);
const scroller = ref(null);
const stick = () => { if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight; };
const down = () => nextTick(() => { stick(); requestAnimationFrame(stick); });

// 换了人、换了房（路由参数变了，页面是同一个）要重新载入这间房的对话
async function load() {
  if (!role.value || !room.value) return router.replace("/");
  msgs.value = [];
  msgs.value = await loadGRoom(role.value, key.value);
  down();
}
onMounted(load);
watch(() => [route.params.roleId, route.params.room], load);

async function send(text = draft.value) {
  if (busy.value || !connected.value) return;
  if (!text.trim() && msgs.value.at(-1)?.from !== "me") return;
  draft.value = "";
  busy.value = true;
  down();
  try {
    await roomSay(role.value, key.value, text);
  } catch (e) {
    toast(describeError(e), 5000);
  } finally {
    busy.value = false;
    down();
  }
}
const onKey = e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer: fine)").matches) { e.preventDefault(); send(); } };

const nt = n => (typeof n === "string" ? { text: n } : n);
const openNote = ref({});

// 点一句：删掉 / 他的重新说
const act = ref(null);
async function del() {
  const m = act.value; act.value = null;
  await dropGMsg(role.value, key.value, m.id);
}
async function regen() {
  const m = act.value; act.value = null;
  busy.value = true;
  try { await regenGRoom(role.value, key.value, m.id); } catch (e) { toast(describeError(e), 5000); } finally { busy.value = false; down(); }
}
function copy() {
  navigator.clipboard?.writeText(act.value.text).then(() => toast("复制了")).catch(() => {});
  act.value = null;
}

// 「⋯」：整理对话、看摘要、这间房带多少字
const menu = ref(false);
const sumOpen = ref(false);
const rawTok = computed(() => sumTokens(afterSum(owner.value, msgs.value)));
async function compress() {
  menu.value = false;
  busy.value = true;
  try {
    const n = await compressGRoom(role.value, key.value);
    toast(n ? `整理了前面 ${n} 句，最近的留着原文` : "还没什么要整理的");
    await saveGRoom(role.value, key.value);
  } catch (e) { toast(describeError(e), 5000); } finally { busy.value = false; }
}
async function clearAll() {
  menu.value = false;
  if (!confirm("清空这间房的对话？摘要也一起清掉。心得本和此刻不动。")) return;
  await clearGRoom(role.value, key.value);
}
const peek = ref(null);
async function showPeek() {
  menu.value = false;
  peek.value = { system: roomSystem(role.value, key.value), scene: await roomScene(role.value, key.value, msgs.value) };
}

// 心得本：这间房那一栏（和 Drawers 里是同一份）
const book = ref(false);
const cat = computed(() => room.value?.cat);
const insights = computed(() => (void store.memories.length, role.value ? insightsOf(role.value.id, cat.value) : []));
const groups = computed(() => (cat.value === "game" ? groupByGame(insights.value) : [{ game: "", list: insights.value }])); // 玩这一栏按游戏分组
const md = d => String(d || "").slice(5).replace("-", "/");
function dropInsight(m) { if (confirm("把这条心得删掉？总本里也会没有。")) removeInsight(m); }

const ideas = computed(() => ({
  stroll: ["去看看有什么新帖子", "有人回你的帖子吗？", "今天想发点什么？"],
  play: ["有没有能玩的局？", "上一局怎么样？", "想玩哪个游戏？"],
  nostos: ["雾潮群岛现在怎么样了？", "上次玩到哪了？", "今天接着玩吗？"],
}[key.value] || []));

const dock = ref(null);
const dockH = ref(80);
let ro = null;
onMounted(() => { ro = new ResizeObserver(() => { if (dock.value) dockH.value = dock.value.offsetHeight; }); if (dock.value) ro.observe(dock.value); });
onBeforeUnmount(() => ro?.disconnect());
</script>

<template>
  <div v-if="role && room" class="rt" :style="{ '--dock': dockH + 'px' }">
    <header class="bar">
      <button class="icon-btn" aria-label="返回" @click="goBack(router, `/chat/${role.id}`)"><Icon name="back" /></button>
      <div class="ttl"><b>{{ who }} 的「{{ room.label }}」</b><small>{{ room.sub }}</small></div>
      <button class="icon-btn" aria-label="心得本" @click="book = true"><Icon name="memory" /></button>
      <button class="icon-btn" aria-label="更多" @click="menu = true"><Icon name="more" /></button>
    </header>

    <main ref="scroller" class="list">
      <p v-if="!connected" class="off">{{ who }} 这边这间房还没接上工具，先空着。接好以后再来；心得本右上角还能翻。</p>
      <div v-if="!msgs.length && !busy" class="empty">
        <p>坐下来，和{{ who }}在「{{ room.label }}」这间房里待一会儿。{{ intro }}——这间房的工具只在这里带着。</p>
        <button v-for="q in connected ? ideas : []" :key="q" class="idea" @click="send(q)">{{ q }}</button>
      </div>
      <p v-if="owner?.talkSum?.text" class="sum-tip" @click="sumOpen = true">前面 {{ owner.talkSum.count }} 句已经整理成摘要了 · 点开看</p>
      <template v-for="m in msgs" :key="m.id">
        <div v-if="m.from === 'me'" class="m me" @click="act = m"><p>{{ m.text }}</p></div>
        <div v-else class="m ai" @click="act = m">
          <div v-for="(para, i) in (m.text || '').split(/\n\s*\n/).filter(x => x.trim())" :key="i" class="mt" v-html="blockMd(para)" />
          <template v-for="(n, i) in m.notes || []" :key="i">
            <small class="note" :class="{ more: nt(n).detail }" @click.stop="nt(n).detail && (openNote[m.id + i] = !openNote[m.id + i])">{{ nt(n).text }}<template v-if="nt(n).detail"> {{ openNote[m.id + i] ? "▴" : "▾" }}</template></small>
            <pre v-if="nt(n).detail && openNote[m.id + i]" class="detail" @click.stop>{{ nt(n).detail }}</pre>
          </template>
        </div>
      </template>
      <div v-if="busy" class="m ai"><span class="dots"><i /><i /><i /></span></div>
    </main>

    <footer ref="dock" class="dock">
      <textarea v-model="draft" v-auto-grow rows="1" class="input" :disabled="!connected" :placeholder="connected ? `和${who}说…` : '这间房还没接上工具'" @keydown="onKey" />
      <button class="send" :class="{ on: draft.trim() && connected }" :disabled="busy || !connected" aria-label="发送" @click="send()"><Icon name="send" :size="20" /></button>
    </footer>

    <Sheet :open="!!act" @close="act = null">
      <div class="acts">
        <button @click="copy"><Icon name="copy" :size="17" />复制</button>
        <button v-if="act?.from === 'ai'" :disabled="busy || !connected" @click="regen"><Icon name="refresh" :size="17" />重新说</button>
        <button class="danger" @click="del"><Icon name="trash" :size="17" />删掉这句</button>
      </div>
    </Sheet>

    <Sheet :open="menu" :title="`${who} 的「${room.label}」`" @close="menu = false">
      <p class="info">没整理的对话约 {{ fmtTok(rawTok) }} token，到 {{ fmtTok(Math.round(roomTokens() * 0.8)) }} 会自动把前面的整理成摘要（接在旧摘要后面，旧的不改），最近一半留着原文。</p>
      <div class="lim">
        <b>这间房每次带多少字</b>
        <div class="seg"><button v-for="n in [10000, 20000, 30000, 50000]" :key="n" :class="{ on: roomTokens() === n }" @click="store.settings.roomTokens = n">{{ fmtTok(n) }}</button></div>
        <small>三间房、两个人共用这一个数。也在记忆页「记忆设置」里。</small>
      </div>
      <div class="acts">
        <button v-if="owner?.talkSum?.text" @click="menu = false; sumOpen = true"><Icon name="file" :size="17" />看这间房的摘要</button>
        <button :disabled="busy" @click="compress"><Icon name="refresh" :size="17" />现在整理</button>
        <button @click="showPeek"><Icon name="search" :size="17" />看看带了什么</button>
        <button class="danger" @click="clearAll"><Icon name="trash" :size="17" />清空这间房的对话</button>
      </div>
    </Sheet>

    <Sheet :open="sumOpen" title="这间房的摘要" @close="sumOpen = false">
      <pre class="sum">{{ owner?.talkSum?.text }}</pre>
    </Sheet>

    <Sheet :open="book" :title="`「${room.label}」的心得本`" @close="book = false">
      <p class="info">{{ who }} 自己记的「{{ INSIGHT_CATS[cat] }}」，和记忆页 Drawers 里的心得本是同一本：这边删了，那边也没有。进这间房时他会先看最近几条。</p>
      <template v-for="g in groups" :key="g.game">
        <h4 v-if="g.game" class="sub">{{ g.game }}<small>{{ g.list.length }}</small></h4>
        <article v-for="m in g.list" :key="m.id" class="ins">
          <div class="meta"><span>{{ md(m.date) }}</span><button aria-label="删掉" @click="dropInsight(m)"><Icon name="close" :size="14" /></button></div>
          <p>{{ m.content }}</p>
        </article>
      </template>
      <p v-if="!insights.length" class="none">还没有心得</p>
    </Sheet>

    <Sheet :open="!!peek" title="这间房带给他的" @close="peek = null">
      <template v-if="peek">
        <p class="info">先是下面的「设定和规矩」，再是「场景」；你说的话接在最后。</p>
        <h4 class="sub">设定和规矩</h4>
        <pre class="sum">{{ peek.system }}</pre>
        <h4 class="sub">场景</h4>
        <pre class="sum">{{ peek.scene }}</pre>
      </template>
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
.off { margin: 0; text-align: center; font-size: .8rem; line-height: 1.7; color: var(--text-2); background: var(--card); border-radius: 14px; padding: 10px 14px; box-shadow: var(--shadow-soft); }
.empty { text-align: center; color: var(--text-3); font-size: .84rem; line-height: 1.8; margin: 30px 8px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.empty p { margin: 0 0 6px; }
.idea { border: 0; background: var(--card); color: var(--text-2); border-radius: 999px; padding: 7px 14px; font-size: .8rem; box-shadow: var(--shadow-soft); }
.sum-tip { align-self: center; margin: 0; font-size: .72rem; color: var(--text-3); background: var(--card); border-radius: 999px; padding: 4px 12px; cursor: pointer; }
.m.me { align-self: flex-end; max-width: 82%; }
.m.me p { margin: 0; background: var(--card); color: var(--text); padding: 10px 14px; border-radius: 18px 18px 4px 18px; box-shadow: var(--shadow-soft); white-space: pre-wrap; line-height: 1.65; font-size: .95rem; }
.m.ai { color: var(--text); line-height: 1.8; font-size: .97rem; }
.m.ai .note { display: block; font-size: .72rem; color: var(--text-3); margin-top: 4px; }
.m.ai .note.more { cursor: pointer; }
.detail { margin: 4px 0 0; padding: 8px 10px; border-radius: 10px; background: var(--card); color: var(--text-2); font: inherit; font-size: .72rem; line-height: 1.6; white-space: pre-wrap; word-break: break-all; max-height: 220px; overflow-y: auto; }
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
.dock .input:disabled { opacity: .6; }
.send { width: 44px; height: 44px; border-radius: 50%; border: 0; display: grid; place-items: center; background: var(--card); color: var(--text-3); box-shadow: var(--shadow-soft); flex: none; }
.send.on { background: var(--ink); color: var(--on-ink); }
.acts { display: flex; flex-direction: column; gap: 4px; }
.acts button { display: flex; align-items: center; gap: 10px; border: 0; background: none; padding: 12px 6px; font-size: .95rem; color: var(--text); text-align: left; }
.acts .danger { color: var(--danger); }
.info { font-size: .8rem; color: var(--text-3); line-height: 1.7; margin: 0 4px 8px; }
.lim { margin: 0 4px 10px; display: flex; flex-direction: column; gap: 6px; }
.lim b { font-size: .88rem; font-weight: 500; }
.lim small { font-size: .72rem; color: var(--text-3); }
.seg { display: flex; gap: 6px; flex-wrap: wrap; }
.seg button { border: 0; background: var(--card); color: var(--text-2); border-radius: 999px; padding: 6px 13px; font-size: .8rem; box-shadow: var(--shadow-soft); }
.seg button.on { background: var(--ink); color: var(--on-ink); }
.sum { white-space: pre-wrap; font-family: inherit; font-size: .86rem; line-height: 1.75; color: var(--text-2); max-height: 60vh; overflow-y: auto; margin: 0; }
.ins { background: var(--card); border-radius: 14px; padding: 10px 12px; margin-bottom: 8px; box-shadow: var(--shadow-soft); }
.ins .meta { display: flex; justify-content: space-between; align-items: center; font-size: .72rem; color: var(--text-3); }
.ins .meta button { border: 0; background: none; color: var(--text-3); padding: 2px; }
.ins p { margin: 4px 0 0; font-size: .9rem; line-height: 1.7; }
.none { margin: 0 4px 8px; font-size: .78rem; color: var(--text-3); }
.sub { margin: 14px 4px 8px; font-size: .84rem; font-weight: 500; color: var(--text-2); }
.sub small { margin-left: 8px; font-weight: 400; color: var(--text-3); font-size: .72rem; }
</style>
