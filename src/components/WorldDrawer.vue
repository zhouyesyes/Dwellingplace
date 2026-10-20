<script setup>
// 小世界：聊天页右上角点开，从右边滑出来的半边（后面的聊天虚掉）。
// 上面是他（点卡片进他的设定）；下面是对话和背景、唤醒、语音和画画、信箱（平时收在右边，点一下整个抽出来、最近的信轮流冒头；再点一下进整个信箱）、邮箱、表情包
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { store, threadsOf, today, apiById, CRAB } from "../store/index.js";
import { stickersOf } from "../lib/stickers.js";
import { lettersOf } from "../lib/letters.js";
import { serversForMode, isMailServer } from "../lib/mcp.js";
import Avatar from "./Avatar.vue";
import Icon from "./Icon.vue";
import LetterRack from "./letters/LetterRack.vue";

const props = defineProps({ open: Boolean, role: Object, thread: Object });
const emit = defineEmits(["close", "threads", "search", "summary"]);
const router = useRouter();

const days = computed(() => Math.max(1, Math.ceil((Date.now() - (props.role?.createdAt || Date.now())) / 86400000)));
const letters = computed(() => (props.role ? lettersOf(props.role.id) : []));
const unread = computed(() => letters.value.filter(l => l.from !== "me" && !l.readAt).length);
const todayCalls = computed(() => Object.values(store.usage[today()] || {}).reduce((a, u) => a + (u.calls || 0), 0));
const hasMail = computed(() => props.role && !!serversForMode(props.role.id, "mail").find(isMailServer));
const mediaOn = computed(() => ["stt", "tts", "image"].filter(k => store.media?.[k]?.enabled).map(k => ({ stt: "语音转文字", tts: "他的声音", image: "画画" })[k]).join("、"));
const summaryLine = computed(() => {
  const t = props.thread;
  if (!t?.summary?.text) return "聊久了，前面的聊天会整理成一份摘要；也可以现在整理";
  return `${t.summary.count || 0} 条聊天整理成的一份${t.summary.from ? `（从「${t.summary.from}」带过来）` : ""}`;
});
const go = path => { emit("close"); router.push(path); };

// 小螃蟹的工作室：小世界里只放仓库连没连上、对话（背景气泡）、摘要和记忆
const studio = computed(() => !!props.thread?.studio);
const repo = ref(null); // null：正在看；{ repo, head, count, pulledAt } 或 { error }
watch(() => props.open && studio.value, async on => {
  if (!on) return;
  repo.value = null;
  const base = String(apiById(props.thread.apiId)?.baseUrl || "").replace(/\/+$/, "").replace(/\/v1$/i, "");
  try { repo.value = await fetch(base + "/status", { cache: "no-store" }).then(r => r.json()); }
  catch { repo.value = { error: "连不上服务器" }; }
}, { immediate: true });
const pulledText = t => { if (!t) return "刚拉过"; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "刚刚拉的最新" : m < 60 ? `${m} 分钟前拉的最新` : `${Math.round(m / 60)} 小时前拉的最新`; };
const rackOut = ref(false);
watch(() => props.open, o => { if (!o) rackOut.value = false; });
function tapRack() {
  if (rackOut.value || !letters.value.length) go(`/letters?role=${props.role.id}`);
  else rackOut.value = true;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="world">
      <div v-if="open && role" class="world-mask" @click="emit('close')">
        <aside class="world" @click.stop>
          <template v-if="studio">
          <h2 class="script">Studio</h2>
          <div class="row repo">
            <Icon name="book" :size="20" />
            <span class="grow">
              栖所的仓库
              <small v-if="!repo">正在看连上没有…</small>
              <small v-else-if="repo.repo">已连上 ✓ · 一共 {{ repo.count }} 个提交 · {{ pulledText(repo.pulledAt) }}</small>
              <small v-else class="bad">没连上：{{ repo.error?.message || repo.error || "服务器还没更新，要重新跑一次安装" }}</small>
              <small v-if="repo?.head" class="head">最新：{{ repo.head }}</small>
            </span>
          </div>
          <p class="sec">still at home</p>
          <button class="row" @click="emit('threads')">
            <Icon name="chat" :size="20" /><span class="grow">背景和气泡<small>换背景、换气泡颜色</small></span><Icon name="right" :size="16" class="chev" />
          </button>
          <button class="row" @click="emit('summary')">
            <Icon name="memory" :size="20" /><span class="grow">摘要记忆<small>{{ summaryLine }}</small></span><Icon name="right" :size="16" class="chev" />
          </button>
          <button class="row" @click="go('/memory?role=' + role.id)">
            <Icon name="memory" :size="20" /><span class="grow">记忆<small>{{ role.name }} 在这里写下的卡片</small></span><Icon name="right" :size="16" class="chev" />
          </button>
          </template>

          <template v-else>
          <h2 class="script">Little World</h2>

          <div class="top">
            <div class="me-card" role="button" @click="go('/settings/role/' + role.id)">
              <Avatar :img="role.avatar" :name="role.name" :color="role.color" :size="52" />
              <div class="grow">
                <div class="name">{{ role.name }} <i class="online" /></div>
                <div class="days">{{ days }} days</div>
                <div class="tiny">{{ role.signature || "still here" }}</div>
              </div>
              <Icon name="right" :size="16" class="chev" />
            </div>
            <div class="mini">
              <span>信 {{ letters.length }}</span>
              <span>今天 {{ todayCalls }}</span>
            </div>
          </div>

          <p class="sec">still at home</p>
          <button class="row" @click="emit('threads')">
            <Icon name="chat" :size="20" /><span class="grow">对话<small>换一段对话、新对话、背景和气泡颜色</small></span><Icon name="right" :size="16" class="chev" />
          </button>
          <button class="row" @click="emit('summary')">
            <Icon name="memory" :size="20" /><span class="grow">摘要记忆<small>{{ summaryLine }}</small></span><Icon name="right" :size="16" class="chev" />
          </button>
          <button class="row" @click="go(role.id === CRAB ? '/settings/wake/' + role.id : '/settings/wake')">
            <Icon name="bell" :size="20" /><span class="grow">唤醒<small>{{ role.wake?.enabled ? `已开启：${role.id === CRAB ? role.name : "他"}会自己醒来` : `让${role.id === CRAB ? role.name : "他"}按时间自己醒来，给你发消息` }}</small></span><Icon name="right" :size="16" class="chev" />
          </button>
          <button class="row" @click="go('/settings/media')">
            <Icon name="mic" :size="20" /><span class="grow">语音和画画<small>{{ mediaOn || "还没开：选好服务商再来填" }}</small></span><Icon name="right" :size="16" class="chev" />
          </button>


          <p class="sec">信箱 <em>letters</em></p>
          <div class="rack-card" :class="{ out: rackOut }" @click="tapRack">
            <LetterRack :letters="letters" half :active="rackOut" :role-id="role.id" />
            <div class="rack-foot">
              <span>{{ letters.length ? `${letters.length} 封信${unread ? `，${unread} 封没拆` : ""}` : "还没有信" }}</span>
              <span class="link">{{ rackOut ? "再点一下，打开信箱 ›" : "打开信箱 ›" }}</span>
            </div>
          </div>

          <p class="sec">正在发生 <em>still growing</em></p>
          <button class="row" :class="{ dim: !hasMail }" @click="hasMail && go('/mail/' + role.id)">
            <Icon name="mail" :size="20" /><span class="grow">邮箱<small>{{ hasMail ? "他的信件和笔友" : "还没接上邮箱，之后再说" }}</small></span><Icon v-if="hasMail" name="right" :size="16" class="chev" />
          </button>
          <button class="row" @click="go('/settings/stickers?owner=' + role.id)">
            <Icon name="smile" :size="20" /><span class="grow">表情包<small>{{ stickersOf(role.id).length ? `${stickersOf(role.id).length} 张（${role.name}的和共用的）` : "上传几张，你们都能发" }}</small></span><Icon name="right" :size="16" class="chev" />
          </button>
          <button class="row" @click="emit('search')">
            <Icon name="search" :size="20" /><span class="grow">搜聊天<small>在你们说过的话里找，还有收藏</small></span><Icon name="right" :size="16" class="chev" />
          </button>
          <button class="row" @click="go('/memory')">
            <Icon name="memory" :size="20" /><span class="grow">记忆<small>他记住的一张张卡片</small></span><Icon name="right" :size="16" class="chev" />
          </button>
          </template>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.world-mask { position: fixed; inset: 0; z-index: 800; background: rgba(30, 30, 40, .18); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.world {
  position: absolute; top: 0; right: 0; bottom: 0; width: min(86vw, 420px); overflow-y: auto;
  padding: calc(var(--safe-top) + 18px) 16px calc(var(--safe-bottom) + 24px);
  background: rgba(var(--glass-rgb), .86); -webkit-backdrop-filter: blur(22px) saturate(1.2); backdrop-filter: blur(22px) saturate(1.2);
  border-radius: 26px 0 0 26px; box-shadow: -10px 0 40px rgba(30, 30, 40, .12);
}
.script { margin: 2px 0 14px; text-align: center; font-weight: 300; letter-spacing: .12em; font-size: 1.9rem; color: var(--ink); }
.top { display: flex; gap: 8px; }
.me-card, .mini, .row, .rack-card { background: rgba(var(--glass-rgb), .62); border: 1px solid rgba(var(--glass-rgb), .7); box-shadow: 0 2px 10px rgba(40, 40, 60, .05); }
.me-card { cursor: pointer;  flex: 1; display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 18px; min-width: 0; }
.name { font-weight: 600; display: flex; align-items: center; gap: 6px; }
.online { width: 7px; height: 7px; border-radius: 50%; background: #5fc77a; display: inline-block; }
.days { font-weight: 500; font-size: 1.6rem; line-height: 1.15; }
.tiny { font-size: 0.72rem; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mini { width: 72px; border-radius: 18px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 10px; font-size: 0.75rem; color: var(--text-2); }
.mini span + span { border-top: 1px solid var(--line); padding-top: 10px; }
.repo { cursor: default; }
.repo small.head { margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.repo small.bad { color: var(--danger); }
.sec { margin: 18px 6px 8px; font-size: 0.85rem; font-weight: 600; color: var(--text); }
.sec em, .sec:first-of-type { font-style: normal; font-weight: 300; letter-spacing: .06em; color: var(--text-3); }
.row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; border-radius: 16px; margin-bottom: 8px; text-align: left; color: var(--text); font-size: 0.95rem; }
.row small { display: block; font-size: 0.72rem; color: var(--text-2); margin-top: 1px; }
.row.dim { opacity: .55; }
.grow { flex: 1; min-width: 0; }
.chev { color: var(--text-3); }
.rack-card { border-radius: 18px; padding: 10px 10px 8px; cursor: pointer; transition: box-shadow .3s; overflow: hidden; }
.rack-card.out { box-shadow: 0 10px 28px rgba(60, 40, 20, .16); }
.rack-foot { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-2); padding: 6px 6px 0; }
.link { color: var(--ink); }
.world-enter-active, .world-leave-active { transition: opacity .25s; }
.world-enter-active .world, .world-leave-active .world { transition: transform .3s cubic-bezier(.2, .8, .2, 1); }
.world-enter-from, .world-leave-to { opacity: 0; }
.world-enter-from .world, .world-leave-to .world { transform: translateX(100%); }
</style>
