<script setup>
// 群聊：你和几个 AI 一起聊。你说完，大家轮流接话（@谁就只让谁说）；也可以让大家接着聊
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, roleById, groupById, groupThread, deleteGroup, loadMessages, messageCache, saveMessages, fmtTokens, apiFor } from "../store/index.js";
import { generating, generate, sendMessage, pathOf, splitBubbles, touchThread, fileToAttachment } from "../lib/chat.js";
import { stamp } from "../lib/time.js";
import { toast } from "../lib/toast.js";
import { pickAndCrop, deleteImage, useImage, pickFile, saveImage, CHAT_IMAGE } from "../lib/images.js";
import { goBack } from "../lib/nav.js";
import Avatar from "../components/Avatar.vue";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";
import ImgThumb from "../components/ImgThumb.vue";
import ImageViewer from "../components/ImageViewer.vue";
import UsageSheet from "../components/UsageSheet.vue";

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
        if (part.trim()) add({ ...m, text: part, pending: false, _src: m, _key: `${m.id}~${k}`, _first: from === 0 });
        event(m, n, i);
        from = at;
      });
      add({ ...m, text: text.slice(from), _src: m, _key: `${m.id}~end`, _first: from === 0 });
    }
    all.filter(([n]) => !n.before).forEach(([n, i]) => event(m, n, i));
  }
  return out;
});
const src = m => m._src || m;

// ---------- tokens：每组消息下面一行，点「用量」看总的 ----------
function tokensOf(grp) {
  if (grp.from !== "ai") return "";
  let i = 0, o = 0, c = 0;
  for (const m of grp.msgs) {
    if (m._src && !m._key.endsWith("~end")) continue; // 用工具时一条消息会拆成几段，算在最后一段
    i += m.usage?.input || 0; o += m.usage?.output || 0; c += m.usage?.cached || 0;
  }
  return i || o ? `输入 ${fmtTokens(i)}${c ? `（缓存 ${fmtTokens(c)}）` : ""} · 输出 ${fmtTokens(o)} tokens` : "";
}
const usageOpen = ref(false);
// 和私聊一样：上一次接话的人看了多少 / 模型上限，加一条进度条
const ctxInfo = computed(() => {
  const last = [...messages.value].reverse().find(m => m.from === "ai" && !m.error && (m.ctx || m.usage?.input));
  if (!last) return null;
  const ctx = last.ctx || last.usage.input;
  const limit = Number(apiFor(thread.value, roleById(last.speaker))?.contextLimit) || 200000;
  const pct = Math.min(100, Math.round((ctx / limit) * 100));
  return { ctx, limit, pct, level: pct >= 85 ? "high" : pct >= 60 ? "mid" : "" };
});
const openNotes = ref({});
const openThink = ref({}); // 思考过程：点开 / 收起

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
  // 先「只发送」再点「让大家接话」：按你最后一条消息里 @ 的人来
  if (!text) { const last = messages.value[messages.value.length - 1]; if (last?.from === "user") text = last.text || ""; }
  running.value = true;
  stopped = false;
  try {
    for (const r of speakersFor(text)) {
      if (stopped) break;
      scrollToBottom(true);
      const before = messages.value.length;
      await generate(thread.value, undefined, { speaker: r.id });
      // 选了 [不说话] 的那条不会留下：告诉你一声，不然看起来像 TA 没被叫到
      if (!stopped && messages.value.length === before) toast(`${r.name} 这次没说话`, 2000);
    }
  } finally {
    running.value = false;
  }
}
async function send(reply) {
  if (busy.value) return;
  const text = draft.value.trim();
  if (!text && !attachments.value.length) return reply ? round() : undefined;
  const atts = attachments.value;
  draft.value = "";
  attachments.value = [];
  nextTick(autoGrow);
  scrollToBottom(true);
  await sendMessage(thread.value, text, atts, { reply: false });
  if (reply) await round(text);
}

// ---------- ＋ 图片、文件 ----------
const attachments = ref([]);
const plusOpen = ref(false);
async function addImages() {
  plusOpen.value = false;
  for (const f of await pickFile("image/*", true)) {
    try { attachments.value.push({ kind: "image", img: await saveImage(f, CHAT_IMAGE), name: f.name }); }
    catch { toast("这张图片读不了：" + f.name); }
  }
}
async function addFiles() {
  plusOpen.value = false;
  for (const f of await pickFile(".pdf,.txt,.md,.json,.csv,.html,.js,.py,text/*,application/pdf", true)) {
    try { attachments.value.push(await fileToAttachment(f)); }
    catch (e) { toast(e.message, 3000); }
  }
}
function removeAttachment(i) {
  const [a] = attachments.value.splice(i, 1);
  if (a.kind === "image") deleteImage(a.img);
}
const imgsOf = m => (m.attachments || []).filter(a => a.kind === "image");
const filesOf = m => (m.attachments || []).filter(a => a.kind !== "image");
const gallery = ref(null); // { m, start }：全屏看图，左右滑
const viewImgs = (m, start = 0) => (gallery.value = { m, start });
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
  for (const a of m.attachments || []) if (a.kind === "image") deleteImage(a.img);
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
  if (group.value.myAvatar) deleteImage(group.value.myAvatar);
  if (thread.value?.bg) deleteImage(thread.value.bg);
  await deleteGroup(group.value.id);
  router.replace("/chats");
}
const nameOf = id => roleById(id)?.name || "（已离开）";

// 我在这个群里的头像、群聊背景
const myAvatar = computed(() => group.value?.myAvatar || store.profile.avatar);
async function changeMyAvatar() {
  const id = await pickAndCrop({ aspect: 1, round: true, title: "我在这个群里的头像", maxSize: 500 });
  if (!id) return;
  if (group.value.myAvatar) deleteImage(group.value.myAvatar);
  group.value.myAvatar = id;
}
function resetMyAvatar() {
  if (group.value.myAvatar) deleteImage(group.value.myAvatar);
  group.value.myAvatar = null;
}
const bgUrl = useImage(() => thread.value?.bg);
async function changeBg() {
  setOpen.value = false;
  const id = await pickAndCrop({ aspect: innerWidth / innerHeight, title: "调整背景", maxSize: 1800 });
  if (!id) return;
  const old = thread.value.bg;
  thread.value.bg = id;
  if (old) deleteImage(old);
}
function clearBg() {
  deleteImage(thread.value.bg);
  thread.value.bg = null;
}
</script>

<template>
  <div v-if="group && thread" class="chat" :class="{ 'has-bg': bgUrl }">
    <div class="bg" :style="bgUrl ? { backgroundImage: `url(${bgUrl})` } : {}" />
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
              <Avatar v-if="it.from === 'user'" :img="myAvatar" :name="store.profile.name" :color="store.profile.color" :size="40" />
              <Avatar v-else :img="roleById(it.who)?.avatar" :name="nameOf(it.who)" :color="roleById(it.who)?.color" :size="40" />
            </div>
            <div class="col">
              <div v-if="it.from !== 'user'" class="speaker">{{ nameOf(it.who) }}</div>
              <template v-for="m in it.msgs" :key="m._key || m.id">
                <template v-if="m.from === 'user'">
                  <div v-if="imgsOf(m).length > 1" class="img-grid" :class="'n' + Math.min(4, imgsOf(m).length)">
                    <div v-for="(a, i) in imgsOf(m).slice(0, 4)" :key="i" class="cell" @click="viewImgs(m, i)">
                      <ImgThumb :id="a.img" />
                      <span v-if="i === 3 && imgsOf(m).length > 4" class="more">+{{ imgsOf(m).length - 4 }}</span>
                    </div>
                  </div>
                  <div v-else-if="imgsOf(m).length" class="att one" @click="viewImgs(m)"><ImgThumb :id="imgsOf(m)[0].img" /></div>
                  <div v-for="(a, i) in filesOf(m)" :key="'f' + i" class="att" @click="actionMsg = m">
                    <div class="file-chip"><Icon name="file" :size="18" />{{ a.name }}</div>
                  </div>
                  <div v-if="m.text" class="bubble" @click="actionMsg = m">{{ m.text }}</div>
                </template>
                <template v-else>
                  <div v-if="m.thinking && (!m._src || m._first)" class="think" @click="openThink[m.id] = !openThink[m.id]">
                    <Icon name="bulb" :size="14" />
                    {{ m.pending && !splitBubbles(m.text).length ? "思考中…" : "思考过程" }}
                    <span class="arrow">{{ openThink[m.id] ? "▴" : "▾" }}</span>
                  </div>
                  <div v-if="m.thinking && openThink[m.id] && (!m._src || m._first)" class="think-body">{{ m.thinking.trim() }}</div>
                  <div v-if="m.error" class="bubble error" @click="actionMsg = src(m)">{{ m.text }}</div>
                  <div v-else-if="m.pending && !splitBubbles(m.text).length" class="bubble typing"><i /><i /><i /></div>
                  <div v-for="(b, i) in splitBubbles(m.text)" v-else :key="i" class="bubble" @click="actionMsg = src(m)">{{ b }}</div>
                </template>
              </template>
              <div class="stamp">{{ stamp(it.lastTs) }}<template v-if="tokensOf(it)"> · {{ tokensOf(it) }}</template></div>
            </div>
          </div>
        </template>
      </div>
    </main>

    <footer class="composer">
      <div class="mentions">
        <button v-for="r in members" :key="r.id" class="at" @click="mention(r)">@{{ r.name }}</button>
        <button class="usage" :class="ctxInfo?.level" @click="usageOpen = true">
          <template v-if="ctxInfo"><span>{{ fmtTokens(ctxInfo.ctx) }} / {{ fmtTokens(ctxInfo.limit) }}</span><i class="bar"><b :style="{ width: ctxInfo.pct + '%' }" /></i></template>
          <template v-else>用量</template>
        </button>
      </div>
      <div v-if="attachments.length" class="pending-atts">
        <div v-for="(a, i) in attachments" :key="i" class="patt">
          <ImgThumb v-if="a.kind === 'image'" :id="a.img" />
          <span v-else class="file-chip"><Icon name="file" :size="16" />{{ a.name }}</span>
          <button class="x" aria-label="去掉" @click="removeAttachment(i)"><Icon name="close" :size="14" /></button>
        </div>
      </div>
      <div class="row">
        <button class="tool" aria-label="添加图片或文件" @click="plusOpen = true"><Icon name="plus" :size="26" /></button>
        <textarea ref="inputEl" v-model="draft" rows="1" placeholder="在群里说点什么…" @input="autoGrow" />
        <div class="sends">
          <button class="send small" :class="{ on: draft.trim() || attachments.length }" aria-label="发送" @click="send(false)"><Icon name="send" :size="20" /></button>
          <button v-if="busy" class="send reply on" aria-label="停止" @click="stop"><Icon name="stop" :size="20" /></button>
          <button v-else class="send reply" :class="{ on: draft.trim() || attachments.length || lastIsMine || messages.length }" :aria-label="draft.trim() || attachments.length ? '发送并让大家接话' : '让大家接着聊'" @click="send(true)"><Icon name="chat" :size="20" /></button>
        </div>
      </div>
    </footer>

    <UsageSheet :open="usageOpen" title="这个群的用量" :all="allMessages" :path="messages" :limit="ctxInfo?.limit || 200000" per-member @close="usageOpen = false">
      群里每个人每次说话，都要把群聊记录、TA 和你的私聊（设置里调条数）一起看一遍，人越多、轮得越多就越费。
    </UsageSheet>

    <Sheet :open="plusOpen" @close="plusOpen = false">
      <div class="grid-actions">
        <button @click="addImages"><span><Icon name="image" :size="26" /></span>图片</button>
        <button @click="addFiles"><span><Icon name="file" :size="26" /></span>文件</button>
      </div>
    </Sheet>

    <ImageViewer :open="!!gallery" :images="gallery ? imgsOf(gallery.m).map(a => a.img) : []" :start="gallery?.start || 0"
      @close="gallery = null" @more="actionMsg = gallery.m; gallery = null" />

    <Sheet :open="!!actionMsg" @close="actionMsg = null">
      <div v-if="actionMsg" class="grid-actions">
        <button @click="copyMsg"><span><Icon name="copy" :size="24" /></span>复制</button>
        <button :disabled="busy" @click="removeMsg"><span><Icon name="trash" :size="24" /></span>删除</button>
      </div>
    </Sheet>

    <Sheet :open="setOpen" title="群设置" @close="setOpen = false">
      <template v-if="form">
        <label class="field"><span>群名字</span><input v-model="form.name" class="input" /></label>
        <div class="field"><span>我在这个群里的头像</span></div>
        <div class="me-row">
          <Avatar :img="myAvatar" :name="store.profile.name" :color="store.profile.color" :size="44" />
          <button class="btn soft small" @click="changeMyAvatar">换一张</button>
          <button v-if="group.myAvatar" class="btn soft small" @click="resetMyAvatar">用回原来的</button>
        </div>
        <div class="field"><span>聊天背景</span></div>
        <div class="me-row">
          <button class="btn soft small" @click="changeBg">换背景</button>
          <button v-if="thread.bg" class="btn soft small" @click="clearBg">去掉背景</button>
        </div>
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
.bg { position: absolute; inset: 0; z-index: -1; background: var(--bg); background-size: cover; background-position: center; }
.me-row { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
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
.speaker { font-size: 0.75rem; color: var(--text-2); margin: 0 0 -2px 4px; }
.think { display: inline-flex; align-items: center; gap: 5px; align-self: flex-start; font-size: 0.73rem; color: var(--text-2); background: rgba(255, 255, 255, .78); padding: 3px 10px; border-radius: 999px; cursor: pointer; }
.think .arrow { font-size: 0.7rem; }
.think-body { max-width: 100%; font-size: 0.78rem; line-height: 1.7; color: var(--text-2); background: rgba(255, 255, 255, .72); border-left: 3px solid var(--line); border-radius: 6px 14px 14px 6px; padding: 8px 12px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 45vh; overflow-y: auto; }
.bubble { padding: 10px 15px; border-radius: 20px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.65; font-size: 1rem; cursor: pointer; }
.theirs .bubble { background: var(--their); color: var(--their-text); border-top-left-radius: 8px; }
.mine .bubble { background: #fff; border-top-right-radius: 8px; box-shadow: 0 1px 3px rgba(40, 40, 60, .06); }
.bubble.error { background: #fdecec !important; color: var(--danger) !important; }
.typing { display: flex; gap: 5px; padding: 14px 16px; }
.typing i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); animation: blink 1.2s infinite; }
.typing i:nth-child(2) { animation-delay: .2s; }
.typing i:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%, 100% { opacity: .3; } 50% { opacity: 1; } }
.stamp { font-size: 0.7rem; color: var(--text-2); padding: 0 6px; }
.composer { background: rgba(255, 255, 255, .97); border-radius: 30px 30px 0 0; box-shadow: 0 -6px 30px rgba(40, 40, 60, .08); padding: 10px 14px calc(var(--safe-bottom) + 14px); }
.mentions { max-width: 760px; margin: 0 auto 6px; display: flex; gap: 6px; overflow-x: auto; padding: 0 6px; }
.at { flex: none; border: 0; border-radius: 999px; padding: 2px 10px; background: var(--bg); color: var(--text-2); font-size: 0.78rem; }
.usage { flex: none; margin-left: auto; display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; padding: 2px 4px; font-size: 0.7rem; color: var(--text-2); }
.bar { display: inline-block; width: 44px; height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; }
.bar b { display: block; height: 100%; background: #9cc5a1; border-radius: 2px; }
.usage.mid .bar b { background: #f0c36a; }
.usage.high .bar b { background: var(--danger); }
.usage.high { color: var(--danger); }
.row { display: flex; align-items: flex-end; gap: 4px; max-width: 760px; margin: 0 auto; }
.tool { flex: none; width: 40px; height: 44px; border: 0; background: none; color: var(--text-3); display: grid; place-items: center; }
.tool:active { color: var(--ink); }
.att { cursor: pointer; }
.img-grid { display: grid; grid-template-columns: repeat(2, 84px); gap: 4px; border-radius: 16px; overflow: hidden; cursor: pointer; }
.img-grid.n2 { grid-template-columns: repeat(2, 96px); }
.img-grid .cell { position: relative; width: 100%; aspect-ratio: 1; overflow: hidden; background: var(--bg-deep); }
.img-grid .cell :deep(.thumb) { width: 100%; height: 100%; border-radius: 0; box-shadow: none; pointer-events: none; }
.img-grid .cell :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.img-grid .more { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, .38); color: #fff; font-weight: 700; font-size: 1.1rem; }
.att.one :deep(.thumb) { pointer-events: none; } /* 点图片打开看图，不是在新窗口打开 */
.img-grid .cell { cursor: pointer; }
.file-chip { display: inline-flex; align-items: center; gap: 6px; background: var(--card); border-radius: 12px; padding: 8px 12px; font-size: 0.867rem; color: var(--text-2); box-shadow: var(--shadow-soft); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pending-atts { display: flex; gap: 8px; overflow-x: auto; max-width: 760px; margin: 0 auto 10px; padding: 6px 2px 2px; }
.patt { position: relative; flex: none; }
.patt :deep(.thumb) { width: 64px; height: 64px; }
.patt :deep(.thumb img) { width: 64px; height: 64px; object-fit: cover; }
.patt .x { position: absolute; top: -6px; right: -6px; width: 22px; height: 22px; border-radius: 50%; border: 0; background: var(--ink); color: #fff; display: grid; place-items: center; padding: 0; }
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
