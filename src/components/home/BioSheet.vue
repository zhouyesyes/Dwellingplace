<script setup>
// 简介：每个 AI 各写一段，全部保留；也可以自己写一段
import { ref, reactive } from "vue";
import { store, roleById } from "../../store/index.js";
import { oneShot, describeError } from "../../lib/chat.js";
import { toast } from "../../lib/toast.js";
import Sheet from "../Sheet.vue";
import Avatar from "../Avatar.vue";
import Icon from "../Icon.vue";

defineProps({ open: Boolean });
const emit = defineEmits(["close"]);

const loading = reactive({});
const editingId = ref(null);
const editText = ref("");

function promptFor(role) {
  const who = store.profile.userName ? `「${store.profile.userName}」` : "对方";
  return [
    `${who}有一个叫「${store.profile.name}」的个人主页，需要一段简介。`,
    `请你以「${role.name}」的身份和口吻，写一段你眼中的${who}，作为主页简介。`,
    `60 字以内，自然、有你自己的风格。只输出简介本身，不要引号、标题或解释。`,
  ].join("\n");
}

async function write(role) {
  if (loading[role.id]) return;
  loading[role.id] = true;
  try {
    const text = await oneShot(role, promptFor(role));
    if (text) store.profile.bios[role.id] = { text, ts: Date.now() };
  } catch (e) {
    toast(`${role.name}：${describeError(e)}`, 3500);
  } finally {
    delete loading[role.id];
  }
}

function writeAll() {
  store.roles.forEach(write);
}

function startEdit(id) {
  editingId.value = id;
  editText.value = id === "me" ? store.profile.bioSelf : store.profile.bios[id]?.text || "";
}
function saveEdit() {
  const id = editingId.value;
  const t = editText.value.trim();
  if (id === "me") store.profile.bioSelf = t;
  else if (t) store.profile.bios[id] = { text: t, ts: Date.now() };
  else delete store.profile.bios[id];
  editingId.value = null;
}
function removeBio(id) {
  delete store.profile.bios[id];
}
</script>

<template>
  <Sheet :open="open" title="简介" @close="emit('close')">
    <button class="btn soft wide" :disabled="!store.roles.length" @click="writeAll">
      <Icon name="refresh" :size="16" /> 让 TA 们都写一段
    </button>

    <div class="item">
      <div class="who"><Avatar :img="store.profile.avatar" :name="store.profile.name" :color="store.profile.color" :size="28" /><b>我自己写的</b></div>
      <template v-if="editingId === 'me'">
        <textarea v-model="editText" class="input" rows="3" placeholder="写点什么介绍自己" />
        <div class="ops"><button class="btn soft small" @click="editingId = null">取消</button><button class="btn small" @click="saveEdit">保存</button></div>
      </template>
      <template v-else>
        <p class="text" :class="{ empty: !store.profile.bioSelf }">{{ store.profile.bioSelf || "还没写" }}</p>
        <div class="ops"><button class="btn soft small" @click="startEdit('me')">编辑</button></div>
      </template>
    </div>

    <div v-for="r in store.roles" :key="r.id" class="item" :style="{ '--c': r.color }">
      <div class="who"><Avatar :img="r.avatar" :name="r.name" :color="r.color" :size="28" /><b>{{ r.name }} 写的</b></div>
      <template v-if="editingId === r.id">
        <textarea v-model="editText" class="input" rows="3" />
        <div class="ops"><button class="btn soft small" @click="editingId = null">取消</button><button class="btn small" @click="saveEdit">保存</button></div>
      </template>
      <template v-else>
        <p class="text" :class="{ empty: !store.profile.bios[r.id] }">
          {{ loading[r.id] ? `${r.name} 正在写…` : store.profile.bios[r.id]?.text || "还没写" }}
        </p>
        <div class="ops">
          <button v-if="store.profile.bios[r.id]" class="btn soft small" @click="removeBio(r.id)">删除</button>
          <button v-if="store.profile.bios[r.id]" class="btn soft small" @click="startEdit(r.id)">编辑</button>
          <button class="btn small" :disabled="loading[r.id]" @click="write(r)">{{ store.profile.bios[r.id] ? "重写" : "让 TA 写" }}</button>
        </div>
      </template>
    </div>
  </Sheet>
</template>

<style scoped>
.wide { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; margin-bottom: 6px; }
.item { padding: 14px 4px; border-bottom: 1px solid var(--line); }
.item:last-child { border-bottom: 0; }
.who { display: flex; align-items: center; gap: 8px; font-size: 0.87rem; }
.text { margin: 8px 0; padding-left: 10px; border-left: 3px solid var(--c, var(--line)); font-size: 0.93rem; line-height: 1.7; white-space: pre-wrap; }
.text.empty { color: var(--text-3); }
.ops { display: flex; justify-content: flex-end; gap: 8px; }
textarea.input { min-height: 80px; margin: 8px 0; }
</style>
