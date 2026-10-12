<script setup>
// 信箱的大页面：从上往下看进信盒子，点一封拆开看；右上角写信（先挑信纸）
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { store, MAIN, roleById, threadsOf } from "../store/index.js";
import { lettersOf, writeLetter } from "../lib/letters.js";
import { generate } from "../lib/chat.js";
import { todayYmd } from "../lib/dates.js";
import { toast } from "../lib/toast.js";
import { goBack } from "../lib/nav.js";
import Icon from "../components/Icon.vue";
import LetterRack from "../components/letters/LetterRack.vue";
import LetterOpen from "../components/letters/LetterOpen.vue";
import LetterPaper from "../components/letters/LetterPaper.vue";
import { PAPERS, paperById, DEFAULT_MINE } from "../lib/stationery.js";

const router = useRouter();
const role = computed(() => roleById(MAIN));
const letters = computed(() => lettersOf(MAIN));
const opened = ref(null);
function open(l) {
  opened.value = l;
  if (l.from !== "me" && !l.readAt) l.readAt = Date.now(); // 你拆开了他的信
}
function toggleLock(l) { l.locked = !l.locked; toast(l.locked ? "上锁了，他读不到" : "开锁了，他下次聊天时会读到"); }
function remove(l) {
  if (!confirm("把这封信撕掉？撕了就没有了。")) return;
  store.letters.splice(store.letters.indexOf(l), 1);
  opened.value = null;
}

// ---------- 写信 ----------
const draft = ref(null);
function startWrite() {
  const last = [...letters.value].reverse().find(l => l.from === "me" && l.paper);
  draft.value = { title: "", body: "", sign: role.value?.me?.name || store.profile.userName || "", date: todayYmd(), locked: false, paper: last?.paper || DEFAULT_MINE };
}
const draftPaper = computed(() => paperById(draft.value?.paper) || PAPERS[0]);
// 正文越写越长，纸跟着长；高度凑成整行，横线才对得上
function grow(e) {
  const t = e.target, line = parseFloat(getComputedStyle(t).lineHeight) || 30;
  t.style.height = "auto";
  t.style.height = `${Math.max(4, Math.ceil(t.scrollHeight / line)) * line}px`;
}
async function send(callHim) {
  const d = draft.value;
  if (!d.body.trim()) return toast("信还是空的");
  writeLetter(d);
  draft.value = null;
  if (callHim && !d.locked) {
    const r = role.value;
    const t = threadsOf(MAIN).find(x => x.id === r?.lastThreadId) || threadsOf(MAIN)[0];
    if (t) { toast("寄出去了，他去拆信了"); generate(t); router.push(`/chat/${MAIN}/${t.id}`); return; }
  }
  toast(d.locked ? "寄出去了（上着锁）" : "寄出去了，他下次聊天时会读到");
}
</script>

<template>
  <div class="letters">
    <header class="head">
      <button class="icon-btn" aria-label="返回" @click="goBack(router, `/chat/${MAIN}`)"><Icon name="back" /></button>
      <div class="grow">
        <h1>信箱</h1>
        <p class="sub">{{ letters.length ? `${letters.length} 封信` : "还没有信" }}<template v-if="letters.some(l => l.from !== 'me' && !l.readAt)"> · 有没拆的</template></p>
      </div>
      <button class="btn small" @click="startWrite"><Icon name="edit" :size="16" /> 写信</button>
    </header>

    <LetterRack :letters="letters" @open="open" />
    <p v-if="!letters.length" class="empty">信箱还是空的。写第一封吧，他也会给你写。</p>
    <p v-else class="legend">🔒 上锁的他读不到 · <i class="new" /> 他的信还没拆</p>

    <LetterOpen :letter="opened" @close="opened = null" @lock="toggleLock" @remove="remove" />

    <!-- 写信：一张白纸 -->
    <Teleport to="body">
      <div v-if="draft" class="compose-mask" @click="draft = null">
        <div class="compose" @click.stop>
          <div class="pick">
            <button v-for="p in PAPERS" :key="p.id" :class="{ on: draft.paper === p.id }" @click="draft.paper = p.id">
              <img :src="p.env[0]" alt="" /><span>{{ p.name }}</span>
            </button>
          </div>
          <LetterPaper :paper="draftPaper">
            <input v-model="draft.title" class="c-title" placeholder="标题" maxlength="60" />
            <textarea v-model="draft.body" class="c-body" placeholder="想对他说的话……" @input="grow" />
            <div class="foot">
              <input v-model="draft.sign" class="c-sign" placeholder="署名" maxlength="30" />
              <input v-model="draft.date" class="c-date" type="date" />
            </div>
          </LetterPaper>
          <div class="panel">
          <label class="lock"><input v-model="draft.locked" type="checkbox" /> 上锁<small>（他只知道有这封信，你开锁后才能读）</small></label>
          <div class="btns">
            <button class="btn soft" @click="draft = null">先不寄</button>
            <button class="btn soft" @click="send(false)">寄出</button>
            <button v-if="!draft.locked" class="btn" @click="send(true)">寄出，叫他来拆</button>
          </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.letters { min-height: 100%; padding: calc(var(--safe-top) + 16px) 18px calc(var(--safe-bottom) + 40px); max-width: 560px; margin: 0 auto; }
.head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.head h1 { margin: 0; font-size: 1.3rem; font-weight: 600; }
.sub { margin: 2px 0 0; font-size: 0.78rem; color: var(--text-2); }
.grow { flex: 1; }
.head .btn { display: flex; align-items: center; gap: 4px; }
.empty { text-align: center; color: var(--text-3); font-size: 0.85rem; margin-top: 18px; }
.legend { text-align: center; font-size: 0.75rem; color: var(--text-3); margin-top: 14px; }
.legend .new { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #d4ad5a; box-shadow: 0 0 5px rgba(240, 205, 120, .9); vertical-align: 1px; }

.compose-mask { position: fixed; inset: 0; z-index: 950; background: rgba(20, 20, 28, .45); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); overflow-y: auto; padding: calc(var(--safe-top) + 12px) 14px calc(var(--safe-bottom) + 20px); }
.compose { width: min(100%, 460px); margin: 0 auto; animation: rise .35s ease-out; }
@keyframes rise { from { transform: translateY(30px); opacity: 0; } }
.pick { display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px 12px; scrollbar-width: none; }
.pick::-webkit-scrollbar { display: none; }
.pick button { flex: none; display: flex; flex-direction: column; align-items: center; gap: 3px; border: 0; background: none; padding: 4px; border-radius: 10px; color: #fff; font-size: .7rem; opacity: .75; }
.pick button.on { opacity: 1; background: rgba(255, 255, 255, .22); }
.pick img { width: 58px; filter: drop-shadow(0 2px 4px rgba(0, 0, 0, .3)); }
.compose input:not([type=checkbox]), .compose textarea { font: inherit; color: inherit; background: none; border: 0; outline: none; width: 100%; padding: 0; display: block; line-height: var(--line); height: var(--line); }
.compose ::placeholder { color: inherit; opacity: .4; }
.c-title { font-size: 1.3em !important; font-weight: 600 !important; text-align: center; margin-bottom: var(--line) !important; }
.compose textarea.c-body { height: calc(var(--line) * 6); resize: none; overflow: hidden; }
.foot { display: flex; flex-direction: column; align-items: flex-end; padding-top: var(--line); } /* 署名在上、日期在下，都靠右下 */
.c-sign { font-size: 1.05em !important; font-weight: 500 !important; text-align: right; width: 60% !important; }
.c-date { font-size: .85em !important; width: 10em !important; text-align: right; -webkit-appearance: none; appearance: none; min-height: 0; margin: 0 !important; }
.c-date::-webkit-date-and-time-value { text-align: right; margin: 0; }
.c-date::-webkit-datetime-edit { padding: 0; }
.panel { margin-top: 12px; padding: 12px 14px; border-radius: 16px; background: rgba(255, 255, 255, .94); }
.lock input { width: 18px; height: 18px; accent-color: #3b3b43; flex: none; }
.lock { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: #6c665f; }
.lock small { color: #a39d95; font-size: 0.75rem; }
.btns { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; margin-top: 12px; }
</style>
