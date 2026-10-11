<script setup>
// 小世界：聊天页右上角点开，从右边滑出来的半边（后面的聊天虚掉）。
// 上面是他；下面是对话和背景、信箱（只露半截，点开是整个信箱）、邮箱、表情包
import { computed } from "vue";
import { useRouter } from "vue-router";
import { store, threadsOf, today } from "../store/index.js";
import { lettersOf } from "../lib/letters.js";
import { serversForMode, isMailServer } from "../lib/mcp.js";
import Avatar from "./Avatar.vue";
import Icon from "./Icon.vue";
import LetterRack from "./letters/LetterRack.vue";

const props = defineProps({ open: Boolean, role: Object });
const emit = defineEmits(["close", "threads"]);
const router = useRouter();

const days = computed(() => Math.max(1, Math.ceil((Date.now() - (props.role?.createdAt || Date.now())) / 86400000)));
const letters = computed(() => (props.role ? lettersOf(props.role.id) : []));
const unread = computed(() => letters.value.filter(l => l.from !== "me" && !l.readAt).length);
const todayCalls = computed(() => Object.values(store.usage[today()] || {}).reduce((a, u) => a + (u.calls || 0), 0));
const hasMail = computed(() => props.role && !!serversForMode(props.role.id, "mail").find(isMailServer));
const go = path => { emit("close"); router.push(path); };
</script>

<template>
  <Teleport to="body">
    <Transition name="world">
      <div v-if="open && role" class="world-mask" @click="emit('close')">
        <aside class="world" @click.stop>
          <h2 class="script">Little World</h2>

          <div class="top">
            <div class="me-card">
              <Avatar :img="role.avatar" :name="role.name" :color="role.color" :size="52" />
              <div class="grow">
                <div class="name">{{ role.name }} <i class="online" /></div>
                <div class="days">{{ days }} days</div>
                <div class="tiny">{{ role.signature || "still here" }}</div>
              </div>
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
          <button class="row" @click="go('/settings/role/' + role.id)">
            <Icon name="settings" :size="20" /><span class="grow">他的设定<small>名字、头像库、说话的样子</small></span><Icon name="right" :size="16" class="chev" />
          </button>

          <p class="sec">信箱 <em>letters</em></p>
          <div class="rack-card" @click="go('/letters')">
            <LetterRack :letters="letters" half @open="go('/letters')" />
            <div class="rack-foot">
              <span>{{ letters.length ? `${letters.length} 封信${unread ? `，${unread} 封没拆` : ""}` : "还没有信" }}</span>
              <span class="link">打开信箱 ›</span>
            </div>
          </div>

          <p class="sec">正在发生 <em>still growing</em></p>
          <button class="row" :class="{ dim: !hasMail }" @click="hasMail && go('/mail/' + role.id)">
            <Icon name="mail" :size="20" /><span class="grow">邮箱<small>{{ hasMail ? "他的信件和笔友" : "还没接上邮箱，之后再说" }}</small></span><Icon v-if="hasMail" name="right" :size="16" class="chev" />
          </button>
          <button class="row" @click="go('/settings/stickers')">
            <Icon name="smile" :size="20" /><span class="grow">表情包<small>{{ store.stickers?.length ? `${store.stickers.length} 张` : "上传几张，你们都能发" }}</small></span><Icon name="right" :size="16" class="chev" />
          </button>
          <button class="row" @click="go('/memory')">
            <Icon name="memory" :size="20" /><span class="grow">记忆<small>记忆卡片、搜聊天、收藏</small></span><Icon name="right" :size="16" class="chev" />
          </button>
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
  background: rgba(248, 247, 245, .86); -webkit-backdrop-filter: blur(22px) saturate(1.2); backdrop-filter: blur(22px) saturate(1.2);
  border-radius: 26px 0 0 26px; box-shadow: -10px 0 40px rgba(30, 30, 40, .12);
}
.script { margin: 2px 0 14px; text-align: center; font-family: "Snell Roundhand", "Apple Chancery", "Brush Script MT", Georgia, serif; font-style: italic; font-weight: 400; font-size: 1.9rem; color: #3b3b43; }
.top { display: flex; gap: 8px; }
.me-card, .mini, .row, .rack-card { background: rgba(255, 255, 255, .62); border: 1px solid rgba(255, 255, 255, .7); box-shadow: 0 2px 10px rgba(40, 40, 60, .05); }
.me-card { flex: 1; display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 18px; min-width: 0; }
.name { font-weight: 600; display: flex; align-items: center; gap: 6px; }
.online { width: 7px; height: 7px; border-radius: 50%; background: #5fc77a; display: inline-block; }
.days { font-family: Georgia, "Times New Roman", serif; font-size: 1.6rem; line-height: 1.15; }
.tiny { font-size: 0.72rem; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mini { width: 72px; border-radius: 18px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 10px; font-size: 0.75rem; color: var(--text-2); }
.mini span + span { border-top: 1px solid var(--line); padding-top: 10px; }
.sec { margin: 18px 6px 8px; font-size: 0.85rem; font-weight: 600; color: var(--text); }
.sec em, .sec:first-of-type { font-family: Georgia, serif; font-style: italic; font-weight: 400; color: var(--text-3); }
.row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; border-radius: 16px; margin-bottom: 8px; text-align: left; color: var(--text); font-size: 0.95rem; }
.row small { display: block; font-size: 0.72rem; color: var(--text-2); margin-top: 1px; }
.row.dim { opacity: .55; }
.grow { flex: 1; min-width: 0; }
.chev { color: var(--text-3); }
.rack-card { border-radius: 18px; padding: 10px 10px 8px; cursor: pointer; }
.rack-foot { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-2); padding: 6px 6px 0; }
.link { color: var(--ink); }
.world-enter-active, .world-leave-active { transition: opacity .25s; }
.world-enter-active .world, .world-leave-active .world { transition: transform .3s cubic-bezier(.2, .8, .2, 1); }
.world-enter-from, .world-leave-to { opacity: 0; }
.world-enter-from .world, .world-leave-to .world { transform: translateX(100%); }
</style>
