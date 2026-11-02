<script setup>
// 分享的两步：先选发到哪（不含现在这一处），再确认（卡片预览 + 可补一句话）
import { ref, computed, watch } from "vue";
import Sheet from "../Sheet.vue";
import Avatar from "../Avatar.vue";
import GroupAvatar from "../GroupAvatar.vue";
import Icon from "../Icon.vue";
import ShareCard from "./ShareCard.vue";
import { shareTargets, dmThreadOf, groupThreadOf } from "../../lib/share.js";
import { sendShare } from "../../lib/chat.js";
import { toast } from "../../lib/toast.js";

const props = defineProps({ open: Boolean, share: Object, here: String });
const emit = defineEmits(["close", "done"]);
const targets = computed(() => (props.open ? shareTargets({ here: props.here }) : []));
const picked = ref(null);
const note = ref("");
watch(() => props.open, on => { if (on) { picked.value = null; note.value = ""; } });

function send() {
  const t = picked.value;
  const thread = t.kind === "group" ? groupThreadOf() : dmThreadOf(t.key);
  if (!thread) return toast("找不到那个聊天");
  const share = JSON.parse(JSON.stringify(props.share));
  // 不等回复：发出去就回到原来的聊天，对方在后台回
  sendShare(thread, share, note.value).catch(e => console.warn("分享失败", e));
  toast(`已分享到「${t.kind === "group" ? "群聊" + t.name : t.name}」`);
  emit("done");
}
</script>

<template>
  <!-- 选目标 -->
  <Sheet :open="open && !picked" title="分享到" @close="emit('close')">
    <div class="list-card flat">
      <button v-for="t in targets" :key="t.key" class="list-row" @click="picked = t">
        <GroupAvatar v-if="t.kind === 'group'" :size="40" />
        <Avatar v-else :img="t.role.avatar" :name="t.role.name" :color="t.role.color" :size="40" />
        <span class="grow">{{ t.name }}<span class="sub">{{ t.sub }}</span></span>
        <Icon name="right" :size="16" />
      </button>
    </div>
    <p v-if="!targets.length" class="tip">没有别的聊天可以分享了</p>
  </Sheet>

  <!-- 确认 -->
  <Sheet :open="open && !!picked" :title="picked ? `分享给 ${picked.kind === 'group' ? '群聊' : ''}${picked.name}` : ''" @close="emit('close')">
    <template v-if="picked">
      <div class="preview"><ShareCard :share="share" flat /></div>
      <textarea v-model="note" class="note" rows="2" maxlength="2000" placeholder="补一句话（可以不写）" />
      <div class="acts">
        <button class="btn soft" @click="picked = null">返回</button>
        <button class="btn" @click="send">发送</button>
      </div>
    </template>
  </Sheet>
</template>

<style scoped>
.list-card.flat { box-shadow: none; border: 1px solid var(--line); }
.list-row { width: 100%; border: 0; background: none; text-align: left; color: inherit; font: inherit; }
.list-row .sub { display: block; font-size: .76rem; color: var(--text-3); font-weight: 300; }
.tip { color: var(--text-3); font-size: .85rem; text-align: center; }
.preview { max-height: 34dvh; overflow-y: auto; border-radius: 18px; }
.note { width: 100%; box-sizing: border-box; margin-top: 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--bg); color: var(--text); padding: 10px 12px; font: inherit; font-size: .93rem; resize: none; outline: none; }
.note:focus { border-color: var(--text-3); }
.acts { display: flex; gap: 10px; margin-top: 12px; }
.acts .btn { flex: 1; }
</style>
