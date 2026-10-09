<script setup>
// TA 自己的邮箱：笔友列表 + 下面一个小对话框（只在这里能用邮箱工具）
import { ref, computed, onMounted, nextTick, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { roleById, mailThreadOf, threadsOf, loadMessages, saveMessages, messageCache } from "../store/index.js";
import { serversForMode, isMailServer, callTool } from "../lib/mcp.js";
import { sendMessage, generating, pathOf, splitBubbles } from "../lib/chat.js";
import { goBack } from "../lib/nav.js";
import { toast } from "../lib/toast.js";
import Icon from "../components/Icon.vue";

const route = useRoute();
const router = useRouter();
const role = computed(() => roleById(route.params.roleId));
if (!role.value) router.replace("/chats");
const server = computed(() => role.value && serversForMode(role.value.id, "mail").find(isMailServer));
const back = () => goBack(router, `/room/${role.value?.id}`);

// ---------- 笔友 ----------
const pals = ref([]);
const me = ref(null); // { email, unread_in_inbox }
const loading = ref(false);
const err = ref("");
const open = ref({});
const parse = t => { try { return JSON.parse(t); } catch { return null; } };
async function loadPals() {
  if (!server.value) return;
  loading.value = true;
  err.value = "";
  try {
    const [p, l] = await Promise.all([callTool(server.value, "get_profile", {}), callTool(server.value, "list_pen_pals", { days: 90 })]);
    me.value = parse(p.text);
    const list = parse(l.text);
    if (l.isError || !Array.isArray(list)) throw new Error(/unknown|not found|未知|找不到/i.test(l.text) ? "OLD" : l.text.slice(0, 200));
    pals.value = list;
  } catch (e) {
    err.value = e.message === "OLD" ? "邮箱脚本还是旧版，没有「笔友」这个功能：照 docs/gmail.md 把新的 Code.gs 贴进去、重新部署一次。" : e.message;
  } finally {
    loading.value = false;
  }
}
const waiting = p => !p.last_from_me && p.received > 0; // 最后一封是对方发的：等 TA 回
const day = iso => { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日`; };

// ---------- 小对话框 ----------
const thread = computed(() => role.value && mailThreadOf(role.value.id));
const draft = ref("");
const list = ref(null);
const busy = computed(() => !!(thread.value && generating[thread.value.id]));
// 跟着消息缓存走：TA 一边写，这里一边出字
const msgs = computed(() => (thread.value && messageCache[thread.value.id] ? pathOf(thread.value, messageCache[thread.value.id]) : []));
const toBottom = () => nextTick(() => { if (list.value) list.value.scrollTop = list.value.scrollHeight; });
watch(() => msgs.value.length + ":" + (msgs.value.at(-1)?.text?.length || 0), toBottom);
async function loadMsgs() {
  if (thread.value) await loadMessages(thread.value.id);
  toBottom();
}
async function send(text = draft.value.trim()) {
  if (!text || busy.value || !thread.value) return;
  draft.value = "";
  const all = await loadMessages(thread.value.id);
  const before = all.length;
  await sendMessage(thread.value, text);
  leaveNote(all.slice(before));
  loadPals();
}
// 在邮箱里回了信、写了信：平时的聊天里留一行小记，TA 在那边也知道
async function leaveNote(added) {
  const did = added.flatMap(m => (m.notes || []).map(n => n.text || "")).filter(t => /send_email|reply_email/.test(t) && !/出错|失败/.test(t));
  if (!did.length) return;
  const main = threadsOf(role.value.id).find(x => x.id === role.value.lastThreadId) || threadsOf(role.value.id)[0];
  if (!main) return;
  const all = await loadMessages(main.id);
  const path = pathOf(main, all);
  const last = path[path.length - 1];
  if (!last) return;
  const sent = did.filter(t => /send_email/.test(t)).length, replied = did.filter(t => /reply_email/.test(t)).length;
  const what = [replied && `回了 ${replied} 封信`, sent && `写了 ${sent} 封新信`].filter(Boolean).join("、");
  last.notes = [...(last.notes || []), { text: `${role.value.name} 在邮箱里${what}` }];
  saveMessages(main.id);
}
const bubbles = m => (m.from === "user" ? [m.text] : splitBubbles(m.text));
const ask = p => send(waiting(p) ? `${p.name} 来信了，看看吧，想回就回。` : `看看和 ${p.name} 最近的信。`);

watch(() => role.value?.id, () => { pals.value = []; loadPals(); loadMsgs(); });
onMounted(() => { loadPals(); loadMsgs(); });
</script>

<template>
  <div v-if="role" class="page mail">
    <header class="head">
      <button class="icon-btn" @click="back"><Icon name="back" /></button>
      <div class="grow">
        <h1>{{ role.name }} 的邮箱</h1>
        <p v-if="me?.email" class="sub">{{ me.email }}<template v-if="me.unread_in_inbox"> · {{ me.unread_in_inbox }} 封未读</template></p>
      </div>
      <button class="icon-btn" :disabled="loading" aria-label="刷新" @click="loadPals"><Icon name="refresh" /></button>
    </header>

    <p v-if="!server" class="empty">{{ role.name }} 还没有接邮箱：在「设置 → 工具 → MCP」里添加 TA 的邮箱，并勾上 TA。</p>
    <template v-else>
      <div class="section-label">笔友</div>
      <div class="card pals">
        <p v-if="loading && !pals.length" class="empty">在翻信……</p>
        <p v-else-if="err" class="empty warn">{{ err }}</p>
        <p v-else-if="!pals.length" class="empty">最近三个月还没有和谁通过信。</p>
        <div v-for="p in pals" :key="p.email" class="pal" @click="open[p.email] = !open[p.email]">
          <div class="pal-top">
            <b>{{ p.name }}</b>
            <span class="tag" :class="{ due: waiting(p) }">{{ waiting(p) ? `等 ${role.name} 回` : "等对方回" }}</span>
            <span class="when">{{ day(p.last) }}</span>
          </div>
          <p class="pal-sub">{{ p.last_subject || "（没有主题）" }} · 来 {{ p.received }} 封 / 回 {{ p.sent }} 封<template v-if="p.unread"> · {{ p.unread }} 封没读</template></p>
          <div v-if="open[p.email]" class="pal-more">
            <p class="addr">{{ p.email }}</p>
            <p class="preview">{{ p.preview }}</p>
            <button class="btn soft small" :disabled="busy" @click.stop="ask(p)">让 {{ role.name }} 看看</button>
          </div>
        </div>
      </div>

      <div class="section-label">和 {{ role.name }} 一起看信</div>
      <div ref="list" class="card talk">
        <p v-if="!msgs.length" class="empty">在这里叫 {{ role.name }} 看信、回信。这里的话不会出现在平时的聊天里，只留一行小记。</p>
        <template v-for="m in msgs" :key="m.id">
          <p v-for="(n, i) in (m.notes || []).filter(n => n.before)" :key="m.id + 'n' + i" class="note">{{ n.text }}</p>
          <p v-for="(b, i) in bubbles(m)" :key="m.id + i" class="b" :class="m.from === 'user' ? 'mine' : 'theirs'">{{ b }}</p>
          <p v-if="m.pending && !m.text" class="note">{{ role.name }} 在看……</p>
        </template>
      </div>
      <div class="composer">
        <textarea v-model="draft" class="input" rows="1" :placeholder="`跟 ${role.name} 说…`" @keydown.enter.exact.prevent="send()" />
        <button class="btn" :disabled="busy || !draft.trim()" @click="send()">发送</button>
      </div>
      <button class="btn soft small self" :disabled="busy" @click="send('看看有没有新邮件，想回的就回吧。')">让 {{ role.name }} 自己看看新邮件</button>
    </template>
  </div>
</template>

<style scoped>
.mail { padding-bottom: 40px; }
.head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.head h1 { margin: 0; font-size: 1.2rem; font-weight: 600; }
.sub { margin: 2px 0 0; font-size: 0.75rem; color: var(--text-2); }
.grow { flex: 1; min-width: 0; }
.empty { color: var(--text-2); font-size: 0.85rem; margin: 6px 0; }
.warn { color: var(--danger); }
.pals { padding: 4px 14px; }
.pal { padding: 10px 0; border-bottom: 1px solid var(--line, #0000000f); cursor: pointer; }
.pal:last-child { border-bottom: 0; }
.pal-top { display: flex; align-items: center; gap: 8px; }
.pal-top b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag { font-size: 0.7rem; padding: 1px 8px; border-radius: 999px; background: var(--bg); color: var(--text-2); }
.tag.due { background: #f6e3c8; color: #9a5a17; }
.when { font-size: 0.72rem; color: var(--text-2); }
.pal-sub { margin: 3px 0 0; font-size: 0.78rem; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pal-more { margin-top: 6px; }
.addr { margin: 0; font-size: 0.72rem; color: var(--text-2); }
.preview { margin: 4px 0 8px; font-size: 0.82rem; line-height: 1.6; }
.talk { padding: 10px 12px; max-height: 46vh; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.b { margin: 0; padding: 8px 12px; border-radius: 14px; max-width: 85%; font-size: 0.9rem; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.b.mine { align-self: flex-end; background: var(--ink); color: #fff; }
.b.theirs { align-self: flex-start; background: var(--bg); }
.note { margin: 0; align-self: center; font-size: 0.7rem; color: var(--text-2); text-align: center; }
.composer { display: flex; gap: 8px; margin-top: 10px; align-items: flex-end; }
.composer textarea { flex: 1; resize: none; min-height: 40px; max-height: 120px; }
.self { margin-top: 8px; }
</style>
