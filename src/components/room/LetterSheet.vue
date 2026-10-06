<script setup>
// 小屋的信箱：心潮小屋里的信。TA 写给你的、你写给 TA 的都在这里（和心潮小屋网页上的是同一份）
import { ref, computed, watch } from "vue";
import { hasXinchao, dashToken, fetchCabin, sendLetter, markLettersRead, unlockLetter } from "../../lib/xinchao.js";
import { stamp } from "../../lib/time.js";
import { toast } from "../../lib/toast.js";
import Sheet from "../Sheet.vue";

const props = defineProps({ role: { type: Object, required: true }, open: Boolean });
const emit = defineEmits(["close", "changed"]);

const ready = computed(() => hasXinchao(props.role) && !!dashToken(props.role));
const notes = ref(null);
const err = ref("");
const tab = ref("ai");
const draft = ref("");
const locked = ref(false);
const busy = ref(false);

const fromAi = computed(() => (notes.value || []).filter(n => n.from === "ai"));
const mine = computed(() => (notes.value || []).filter(n => n.from === "user"));

async function load() {
  if (!ready.value) return;
  err.value = "";
  try {
    const r = await fetchCabin(props.role);
    notes.value = r?.notes || [];
    // 打开信箱就算读过了
    const unread = fromAi.value.filter(n => !n.readAt).map(n => n.id);
    if (unread.length) {
      markLettersRead(props.role, unread).catch(() => {});
      setTimeout(() => notes.value?.forEach(n => { if (unread.includes(n.id)) n.readAt = new Date().toISOString(); }), 4000);
    }
    emit("changed", 0);
  } catch (e) {
    err.value = e.message;
  }
}
watch(() => props.open, v => { if (v) { tab.value = "ai"; load(); } });

async function send() {
  const text = draft.value.trim();
  if (!text || busy.value) return;
  busy.value = true;
  try {
    await sendLetter(props.role, text, locked.value);
    draft.value = "";
    toast(locked.value ? "信放进去了（上了锁）" : `信放进去了，${props.role.name}会看到的`, 2500);
    await load();
    tab.value = "mine";
  } catch (e) {
    toast(e.message, 4000);
  } finally {
    busy.value = false;
  }
}
async function unlock(n) {
  if (!confirm("给这封信开锁？开锁以后 TA 就能读到了。")) return;
  try {
    await unlockLetter(props.role, n.id);
    n.locked = false;
    toast("开锁了", 2000);
  } catch (e) {
    toast(e.message, 4000);
  }
}
const when = n => stamp(Date.parse(n.createdAt));
</script>

<template>
  <Sheet :open="open" title="小屋的信箱" @close="emit('close')">
    <p v-if="!ready" class="empty">接上心潮、填好看板口令以后，就能在这里和 {{ role.name }} 写信了。</p>
    <template v-else>
      <nav class="tabs">
        <button :class="{ on: tab === 'ai' }" @click="tab = 'ai'">{{ role.name }} 的来信<i v-if="fromAi.some(n => !n.readAt)" class="dot" /></button>
        <button :class="{ on: tab === 'mine' }" @click="tab = 'mine'">我写的 · 写信</button>
      </nav>
      <p v-if="err" class="empty bad">{{ err }}</p>
      <p v-else-if="!notes" class="empty">正在打开信箱…</p>

      <div v-else-if="tab === 'ai'" class="list">
        <article v-for="n in fromAi" :key="n.id" class="letter" :class="{ fresh: !n.readAt }">
          <div class="meta">{{ when(n) }}<span v-if="!n.readAt" class="new">新</span></div>
          <p>{{ n.content }}</p>
        </article>
        <p v-if="!fromAi.length" class="empty">信箱里还空空的。{{ role.name }}写了信会放在这里。</p>
      </div>

      <div v-else class="list">
        <div class="compose">
          <textarea v-model="draft" class="input" rows="4" :placeholder="`写给 ${role.name} 的信…`" />
          <div class="row">
            <label class="lock"><input v-model="locked" type="checkbox" /> 上锁<small>（TA 只知道有这封信，你开锁后才能读）</small></label>
            <button class="btn small" :disabled="busy || !draft.trim()" @click="send">{{ busy ? "放进去…" : "放进信箱" }}</button>
          </div>
        </div>
        <article v-for="n in mine" :key="n.id" class="letter mine">
          <div class="meta">{{ when(n) }}<template v-if="n.locked"> · 🔒 上着锁</template><template v-else-if="n.aiReadAt"> · TA 读过了</template></div>
          <p>{{ n.content }}</p>
          <button v-if="n.locked" class="btn soft small" @click="unlock(n)">开锁</button>
        </article>
      </div>
    </template>
  </Sheet>
</template>

<style scoped>
.tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.tabs button { flex: 1; border: 0; border-radius: 12px; padding: 8px; background: var(--bg); font-size: 0.87rem; color: var(--text-2); position: relative; }
.tabs button.on { background: var(--ink); color: #fff; font-weight: 600; }
.dot { position: absolute; top: 6px; right: 10px; width: 7px; height: 7px; border-radius: 50%; background: #e9789a; }
.list { display: flex; flex-direction: column; gap: 10px; max-height: 58vh; overflow-y: auto; padding-bottom: 4px; }
.letter { background: #fbf6ea; border-radius: 16px; padding: 12px 14px; box-shadow: 0 0 0 1px #efe4cc; }
.letter.fresh { box-shadow: 0 0 0 2px #f0c2cf; }
.letter.mine { background: var(--card-2); box-shadow: 0 0 0 1px var(--line); }
.letter p { margin: 6px 0 0; white-space: pre-wrap; line-height: 1.75; font-size: 0.93rem; }
.letter .btn { margin-top: 8px; }
.meta { font-size: 0.75rem; color: var(--text-3); display: flex; align-items: center; gap: 6px; }
.new { background: #e9789a; color: #fff; border-radius: 6px; padding: 0 5px; font-size: 0.68rem; }
.compose { display: flex; flex-direction: column; gap: 8px; }
.compose textarea { resize: vertical; }
.row { display: flex; align-items: center; gap: 10px; }
.lock { flex: 1; font-size: 0.85rem; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.lock small { color: var(--text-3); font-size: 0.72rem; }
.empty { color: var(--text-3); font-size: 0.87rem; text-align: center; margin: 18px 0; line-height: 1.7; }
.empty.bad { color: var(--danger); }
</style>
