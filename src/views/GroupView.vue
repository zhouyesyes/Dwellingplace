<script setup>
// 群聊：你和几个 AI 一起聊。你说完，大家轮流接话（@谁就只让谁说）；也可以让大家接着聊
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, roleById, groupById, groupThread, deleteGroup, loadMessages, messageCache, saveMessages } from "../store/index.js";
import { generating, generate, sendMessage, pathOf, splitBubbles, touchThread } from "../lib/chat.js";
import { stamp } from "../lib/time.js";
import { toast } from "../lib/toast.js";
import { goBack } from "../lib/nav.js";
import Avatar from "../components/Avatar.vue";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";

const route = useRoute();
const router = useRouter();
const group = computed(() => groupById(route.params.id));
const thread = computed(() => (group.value ? groupThread(group.value.id) : null));
const members = computed(() => (group.value?.memberIds || []).map(roleById).filter(Boolean));
const allMessages = computed(() => (thread.value ? messageCache[thread.value.id] || [] : []));
const messages = computed(() => (thread.value ? pathOf(thread.value, allMessages.value) : []));
const busy = computed(() => !!(thread.value && generating[thread.value.id]) || running.value);

onMounted(async () => {
  if (!group.value || !thread.value) return router.replace("/chats");
  await loadMessages(thread.value.id);
  await nextTick();
  scrollToBottom(true);
});

// ---------- 消息分组：同一个人 5 分钟内连续的算一组；工具提示插在说到一半的地方 ----------
const items = computed(() => {
  const out = [];
  let grp = null;
  const who = m => (m.from === "user" ? "me" : m.speaker || "?");
  const event = (m, n, i) => { out.push({ type: "event", m: n, key: `${m.id}:${i}` }); grp = null; };
  const add = m => {
    if (grp && grp.who === who(m) && m.ts - grp.lastTs < 5 * 60_000) { grp.msgs.push(m); grp.lastTs = m.ts; }
    else { grp = { type: "group", who: who(m), from: m.from, msgs: [m], lastTs: m.ts, key: m._key || m.id }; out.push(grp); }
  };
  for (const m of messages.value) {
    const all = (m.notes || []).map((n, i) => [n, i]);
    const mid = m.from === "ai" && !m.error ? all.filter(([n]) => n.before && n.at > 0) : [];
    all.filter(([n]) => n.before && !mid.some(([x]) => x === n)).forEach(([n, i]) => event(m, n, i));
    if (!mid.length) add(m);
    else {
      const text = m.text || "";
      let from = 0;
      mid.forEach(([n, i], k) => {
        const at = Math.min(n.at, text.length);
        const part = text.slice(from, at);
        if (part.trim()) add({ ...m, text: part, pending: false, _src: m, _key: `${m.id}~${k}` });
        event(m, n, i);
        from = at;
      });
      add({ ...m, text: text.slice(from), _src: m, _key: `${m.id}~end` });
    }
    all.filter(([n]) => !n.before).forEach(([n, i]) => event(m, n, i));
  }
  return out;
});
const src = m => m._src || m;
const openNotes = ref({});

// 气泡颜色跟着说话的人
function tint(id) {
  const c = roleById(id)?.bubbleColor || "#eeeff3";
  const n = parseInt(c.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return { "--their": c, "--their-text": lum < 0.55 ? "#ffffff" : "var(--text)" };
}

// ---------- 滚动 ----------
const scroller = ref(null);
const nearBottom = () => { const el = scroller.value; return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 140; };
function scrollToBottom(force = false) { const el = scroller.value; if (el && (force || nearBottom())) el.scrollTop = el.scrollHeight; }
watch(() => { const l = messages.value; return l.length + ":" + (l[l.length - 1]?.text?.length ?? 0); }, () => { const stick = nearBottom(); nextTick(() => stick && scrollToBottom(true)); });

// ---------- 发消息、轮流接话 ----------
const draft = ref("");
const inputEl = ref(null);
const running = ref(false);
let stopped = false;
function autoGrow() { const el = inputEl.value; if (!el) return; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 140) + "px"; }

// 这一轮谁来说：@了谁就是谁，没 @ 就大家都说（顺序随机一点，像真的群聊）
function speakersFor(text) {
  const named = members.value.filter(r => text.includes("@" + r.name));
  if (named.length) return named;
  const list = [...members.value];
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}
async function round(text = "") {
  if (!members.value.length) return toast("群里还没有成员");
  running.value = true;
  stopped = false;
  try {
    for (const r of speakersFor(text)) {
      if (stopped) break;
      scrollToBottom(true);
      await generate(thread.value, undefined, { speaker: r.id });
    }
  } finally {
    running.value = false;
  }
}
async function send(reply) {
  if (busy.value) return;
  const text = draft.value.trim();
  if (!text) return reply ? round() : undefined;
  draft.value = "";
  nextTick(autoGrow);
  scrollToBottom(true);
  await sendMessage(thread.value, text, [], { reply: false });
  if (reply) await round(text);
}
function stop() {
  stopped = true;
  generating[thread.value.id]?.abort();
}
const lastIsMine = computed(() => messages.value[messages.value.length - 1]?.from === "user");
function mention(r) {
  draft.value = `${draft.value}${draft.value && !draft.value.endsWith(" ") ? " " : ""}@${r.name} `;
  nextTick(() => inputEl.value?.focus());
}

// ---------- 点消息：复制、删除 ----------
const actionMsg = ref(null);
async function copyMsg() {
  try { await navigator.clipboard.writeText(splitBubbles(actionMsg.value.text).join("\n\n") || actionMsg.value.text); toast("复制好了"); } catch { toast("复制不了"); }
  actionMsg.value = null;
}
// 群聊是一条线：删掉一条，后面的接到前一条上（不连带删掉后面的）
async function removeMsg() {
  const m = actionMsg.value;
  actionMsg.value = null;
  const t = thread.value;
  const all = await loadMessages(t.id);
  const i = all.findIndex(x => x.id === m.id);
  if (i < 0) return;
  const kids = all.filter(x => x.parentId === m.id);
  for (const k of kids) k.parentId = m.parentId;
  if (t.sel?.[m.parentId] === m.id) { if (kids[0]) t.sel[m.parentId] = kids[0].id; else delete t.sel[m.parentId]; }
  if (t.sel?.[m.id]) { if (kids.length) t.sel[m.parentId] = t.sel[m.id]; delete t.sel[m.id]; }
  all.splice(i, 1);
  touchThread(t, all);
  saveMessages(t.id);
}

// ---------- 群设置 ----------
const setOpen = ref(false);
const form = ref(null);
function openSettings() {
  form.value = { name: group.value.name, ids: [...group.value.memberIds] };
  setOpen.value = true;
}
function toggleMember(id) {
  const ids = form.value.ids;
  form.value.ids = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
}
function saveSettings() {
  if (form.value.ids.length < 1) return toast("至少留一个成员");
  group.value.name = form.value.name.trim() || "群聊";
  group.value.memberIds = form.value.ids;
  thread.value.title = group.value.name;
  setOpen.value = false;
}
async function clearChat() {
  if (!confirm("清空这个群的聊天记录？")) return;
  const all = await loadMessages(thread.value.id);
  all.splice(0, all.length);
  thread.value.sel = {};
  thread.value.preview = "";
  saveMessages(thread.value.id);
  setOpen.value = false;
}
async function removeGroup() {
  if (!confirm(`删除群聊「${group.value.name}」和里面的聊天记录？`)) return;
  setOpen.value = false;
  await deleteGroup(group.value.id);
  router.replace("/chats");
}
const nameOf = id => roleById(id)?.name || "（已离开）";
</script>

<template>
  <div v-if="group && thread" class="chat">
    <div class="bg" />
    <header class="top">
      <button class="icon-btn" aria-label="返回" @click="goBack(router, '/chats')"><Icon name="back" /></button>
      <div class="who">
        <div class="name">{{ group.name }}</div>
        <div class="sig">{{ members.map(r => r.name).join("、") || "还没有成员" }}</div>
      </div>
      <button class="icon-btn" aria-label="群设置" @click="openSettings"><Icon name="more" /></button>
    </header>

    <main ref="scroller" class="scroll">
      <div class="inner">
        <div v-if="!messages.length" class="hello">
          <div class="avas"><Avatar v-for="r in members" :key="r.id" :img="r.avatar" :name="r.name" :color="r.color" :size="46" /></div>
          <p>和 {{ members.map(r => r.name).join("、") }} 的群聊</p>
          <small>说点什么，大家会轮流接话；想只让某个人说，就 @TA</small>
        </div>
        <template v-for="it in items" :key="it.key">
          <div v-if="it.type === 'event'" class="event">
            <span :class="{ link: it.m.detail || it.m.sources?.length }" @click="(it.m.detail || it.m.sources?.length) && (openNotes[it.key] = !openNotes[it.key])">{{ it.m.text }}<template v-if="it.m.detail || it.m.sources?.length"> {{ openNotes[it.key] ? "▴" : "▾" }}</template></span>
            <pre v-if="openNotes[it.key] && it.m.detail" class="detail">{{ it.m.detail }}</pre>
          </div>
          <div v-else class="group" :class="it.from === 'user' ? 'mine' : 'theirs'" :style="it.from === 'user' ? null : tint(it.who)">
            <div class="ava">
              <Avatar v-if="it.from === 'user'" :img="store.profile.avatar" :name="store.profile.name" :color="store.profile.color" :size="40" />
              <Avatar v-else :img="roleById(it.who)?.avatar" :name="nameOf(it.who)" :color="roleById(it.who)?.color" :size="40" />
            </div>
            <div class="col">
              <div v-if="it.from !== 'user'" class="speaker">{{ nameOf(it.who) }}</div>
              <template v-for="m in it.msgs" :key="m._key || m.id">
                <div v-if="m.from === 'user'" class="bubble" @click="actionMsg = m">{{ m.text }}</div>
                <template v-else>
                  <div v-if="m.error" class="bubble error" @click="actionMsg = src(m)">{{ m.text }}</div>
                  <div v-else-if="m.pending && !splitBubbles(m.text).length" class="bubble typing"><i /><i /><i /></div>
                  <div v-for="(b, i) in splitBubbles(m.text)" v-else :key="i" class="bubble" @click="actionMsg = src(m)">{{ b }}</div>
                </template>
              </template>
              <div class="stamp">{{ stamp(it.lastTs) }}</div>
            </div>
          </div>
        </template>
      </div>
    </main>

    <footer class="composer">
      <div class="mentions">
        <button v-for="r in members" :key="r.id" class="at" @click="mention(r)">@{{ r.name }}</button>
      </div>
      <div class="row">
        <textarea ref="inputEl" v-model="draft" rows="1" placeholder="在群里说点什么…" @input="autoGrow" />
        <div class="sends">
          <button class="send small" :class="{ on: draft.trim() }" aria-label="发送" @click="send(false)"><Icon name="send" :size="20" /></button>
          <button v-if="busy" class="send reply on" aria-label="停止" @click="stop"><Icon name="stop" :size="20" /></button>
          <button v-else class="send reply" :class="{ on: draft.trim() || lastIsMine || messages.length }" :aria-label="draft.trim() ? '发送并让大家接话' : '让大家接着聊'" @click="send(true)"><Icon name="chat" :size="20" /></button>
        </div>
      </div>
    </footer>

    <Sheet :open="!!actionMsg" @close="actionMsg = null">
      <div v-if="actionMsg" class="grid-actions">
        <button @click="copyMsg"><span><Icon name="copy" :size="24" /></span>复制</button>
        <button :disabled="busy" @click="removeMsg"><span><Icon name="trash" :size="24" /></span>删除</button>
      </div>
    </Sheet>

    <Sheet :open="setOpen" title="群设置" @close="setOpen = false">
      <template v-if="form">
        <label class="field"><span>群名字</span><input v-model="form.name" class="input" /></label>
        <div class="field"><span>成员</span></div>
        <div class="pick">
          <button v-for="r in store.roles" :key="r.id" class="pick-row" :class="{ on: form.ids.includes(r.id) }" @click="toggleMember(r.id)">
            <Avatar :img="r.avatar" :name="r.name" :color="r.color" :size="32" /> <span class="grow">{{ r.name }}</span> <Icon v-if="form.ids.includes(r.id)" name="check" :size="18" />
          </button>
        </div>
        <div class="set-actions">
          <button class="btn danger small" @click="removeGroup">删除群聊</button>
          <button class="btn soft small" @click="clearChat">清空聊天</button>
          <span class="grow" />
          <button class="btn small" @click="saveSettings">保存</button>
        </div>
      </template>
    </Sheet>
  </div>
</template>

<style scoped>
.chat { position: fixed; inset: 0; display: flex; flex-direction: column; height: 100dvh; }
.bg { position: absolute; inset: 0; z-index: -1; background: var(--bg); }
.top { width: 100%; max-width: 860px; margin: 0 auto; display: flex; align-items: center; gap: 12px; padding: calc(var(--safe-top) + 10px) 16px 10px; }
.who { flex: 1; text-align: center; min-width: 0; }
.name { font-size: 1.13rem; font-weight: 700; letter-spacing: 1px; }
.sig { font-size: 0.833rem; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.inner { max-width: 760px; margin: 0 auto; padding: 12px 14px 24px; display: flex; flex-direction: column; gap: 16px; }
.hello { text-align: center; color: var(--text-2); margin-top: 16vh; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.hello p { margin: 10px 0 0; }
.hello small { color: var(--text-3); }
.avas { display: flex; gap: 6px; }
.event { text-align: center; padding: 0 6%; line-height: 2.1; }
.event span { font-size: 0.73rem; color: var(--text-2); background: rgba(255, 255, 255, .75); padding: 2px 10px; border-radius: 999px; }
.event span.link { cursor: pointer; }
.detail { text-align: left; white-space: pre-wrap; word-break: break-all; font-size: 0.72rem; line-height: 1.6; color: var(--text-2); background: rgba(255, 255, 255, .85); border-radius: 12px; padding: 8px 10px; margin: 6px auto 0; max-width: 92%; max-height: 40vh; overflow-y: auto; }
.group { display: flex; gap: 10px; align-items: flex-start; }
.group.mine { flex-direction: row-reverse; }
.ava { flex: none; padding-top: 2px; }
.col { display: flex; flex-direction: column; gap: 6px; min-width: 0; max-width: min(78%, 560px); }
.mine .col { align-items: flex-end; }
.theirs .col { align-items: flex-start; }
.speaker { font-size: 0.75rem; color: var(--text-3); margin: 0 0 -2px 4px; }
.bubble { padding: 10px 15px; border-radius: 20px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.65; font-size: 1rem; cursor: pointer; }
.theirs .bubble { background: var(--their); color: var(--their-text); border-top-left-radius: 8px; }
.mine .bubble { background: #fff; border-top-right-radius: 8px; box-shadow: 0 1px 3px rgba(40, 40, 60, .06); }
.bubble.error { background: #fdecec !important; color: var(--danger) !important; }
.typing { display: flex; gap: 5px; padding: 14px 16px; }
.typing i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); animation: blink 1.2s infinite; }
.typing i:nth-child(2) { animation-delay: .2s; }
.typing i:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%, 100% { opacity: .3; } 50% { opacity: 1; } }
.stamp { font-size: 0.73rem; color: var(--text-3); padding: 0 4px; }
.composer { background: rgba(255, 255, 255, .97); border-radius: 30px 30px 0 0; box-shadow: 0 -6px 30px rgba(40, 40, 60, .08); padding: 10px 14px calc(var(--safe-bottom) + 14px); }
.mentions { max-width: 760px; margin: 0 auto 6px; display: flex; gap: 6px; overflow-x: auto; padding: 0 6px; }
.at { flex: none; border: 0; border-radius: 999px; padding: 2px 10px; background: var(--bg); color: var(--text-2); font-size: 0.78rem; }
.row { display: flex; align-items: flex-end; gap: 4px; max-width: 760px; margin: 0 auto; }
textarea { flex: 1; border: 0; outline: none; resize: none; background: none; padding: 10px 6px; line-height: 1.5; max-height: 140px; color: var(--text); }
textarea::placeholder { color: var(--text-3); font-size: 0.93rem; }
.sends { flex: none; display: flex; gap: 6px; align-items: flex-end; }
.send { flex: none; width: 40px; height: 40px; border-radius: 50%; border: 0; display: grid; place-items: center; background: var(--bg-deep); color: #fff; transition: background .2s; }
.send.small.on { background: #9aa0ad; }
.send.reply.on { background: var(--ink); }
.grid-actions { display: flex; justify-content: space-around; padding: 6px 0 4px; }
.grid-actions button { display: flex; flex-direction: column; align-items: center; gap: 6px; border: 0; background: none; font-size: 0.867rem; color: var(--text-2); }
.grid-actions button:disabled { opacity: .4; }
.grid-actions span { display: grid; place-items: center; width: 58px; height: 58px; border-radius: 20px; background: var(--bg-deep); color: var(--ink); }
.pick { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
.pick-row { display: flex; align-items: center; gap: 10px; border: 0; background: var(--bg); border-radius: 14px; padding: 8px 12px; font-size: 0.93rem; text-align: left; opacity: .55; }
.pick-row.on { opacity: 1; background: var(--card-2); box-shadow: 0 0 0 1px var(--line); }
.grow { flex: 1; }
.set-actions { display: flex; align-items: center; gap: 8px; }
</style>
