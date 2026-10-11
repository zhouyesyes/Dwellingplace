<script setup>
// 信箱的大页面：整个信架竖起来，点一封拆开看；右上角写信
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
import "@fontsource/long-cang/400.css";

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
  draft.value = { title: "", body: "", sign: role.value?.me?.name || store.profile.userName || "", date: todayYmd(), locked: false };
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
    <p class="legend"><i class="dot w" />你的信　<i class="dot b" />他的信　🔒 上锁的他读不到</p>

    <LetterOpen :letter="opened" @close="opened = null" @lock="toggleLock" @remove="remove" />

    <!-- 写信：一张白纸 -->
    <Teleport to="body">
      <div v-if="draft" class="compose-mask" @click="draft = null">
        <div class="compose" @click.stop>
          <input v-model="draft.title" class="c-title" placeholder="标题" maxlength="60" />
          <textarea v-model="draft.body" class="c-body" placeholder="想对他说的话……" />
          <div class="foot">
            <input v-model="draft.sign" class="c-sign" placeholder="署名" maxlength="30" />
            <input v-model="draft.date" class="c-date" type="date" />
          </div>
          <label class="lock"><input v-model="draft.locked" type="checkbox" /> 上锁<small>（他只知道有这封信，你开锁后才能读）</small></label>
          <div class="btns">
            <button class="btn soft" @click="draft = null">先不寄</button>
            <button class="btn soft" @click="send(false)">寄出</button>
            <button v-if="!draft.locked" class="btn" @click="send(true)">寄出，叫他来拆</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.letters { min-height: 100%; padding: calc(var(--safe-top) + 16px) 18px calc(var(--safe-bottom) + 40px); max-width: 560px; margin: 0 auto; }
.head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.head h1 { margin: 0; font-size: 1.3rem; font-family: Georgia, "Songti SC", serif; }
.sub { margin: 2px 0 0; font-size: 0.78rem; color: var(--text-2); }
.grow { flex: 1; }
.head .btn { display: flex; align-items: center; gap: 4px; }
.empty { text-align: center; color: var(--text-3); font-size: 0.85rem; margin-top: 18px; }
.legend { text-align: center; font-size: 0.75rem; color: var(--text-3); margin-top: 14px; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: -1px; margin-right: 3px; }
.dot.w { background: #fbf8f1; box-shadow: 0 0 0 1px #d8d0c0; } .dot.b { background: #16213a; box-shadow: 0 0 0 1px #c9a75c; }

.compose-mask { position: fixed; inset: 0; z-index: 950; background: rgba(20, 20, 28, .4); display: grid; place-items: center; padding: 16px; }
.compose {
  width: min(100%, 460px); max-height: 92vh; overflow-y: auto; border-radius: 6px; padding: 24px 22px 18px;
  background: #fffdf8; color: #2f2b28; font-family: "Long Cang", cursive;
  background-image: repeating-linear-gradient(transparent 0 37px, rgba(120, 140, 170, .22) 37px 38px);
  background-position: 0 80px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, .25);
  animation: rise .35s ease-out;
}
@keyframes rise { from { transform: translateY(30px); opacity: 0; } }
.compose input:not([type=checkbox]), .compose textarea { font-family: inherit; color: inherit; background: none; border: 0; outline: none; width: 100%; }
.c-title { font-size: 1.8rem; text-align: center; margin-bottom: 14px; }
.c-body { font-size: 1.4rem; line-height: 38px; min-height: 300px; resize: vertical; }
.foot { display: flex; justify-content: flex-end; gap: 10px; align-items: baseline; margin-top: 8px; }
.c-sign { font-size: 1.4rem; text-align: right; max-width: 50%; }
.c-date { font-size: 1rem; max-width: 9.5em; text-align: right; }
.lock input { width: 18px; height: 18px; accent-color: #3b3b43; flex: none; }
.lock { display: flex; align-items: center; gap: 6px; margin-top: 14px; font-family: -apple-system, "PingFang SC", sans-serif; font-size: 0.85rem; color: #6c665f; }
.lock small { color: #a39d95; font-size: 0.75rem; }
.btns { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; margin-top: 14px; font-family: -apple-system, "PingFang SC", sans-serif; }
</style>
