<script setup>
// 表情包：上传、改名、删除
import { ref } from "vue";
import { store } from "../store/index.js";
import { pickFile } from "../lib/images.js";
import { addSticker, removeSticker, stickerUrl } from "../lib/stickers.js";
import { toast } from "../lib/toast.js";
import SubHeader from "../components/SubHeader.vue";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";

const busy = ref(false);
const editing = ref(null); // { s, name }
async function add() {
  const files = await pickFile("image/*", true);
  if (!files.length) return;
  busy.value = true;
  try {
    for (const f of files) await addSticker(f, f.name.replace(/\.[^.]+$/, ""));
    toast(files.length > 1 ? `加了 ${files.length} 张，点一张可以改名字` : "加好了，点它可以改名字");
  } catch (e) {
    toast("没加上：" + (e?.message || e));
  } finally {
    busy.value = false;
  }
}
function open(s) { editing.value = { s, name: s.name }; }
function saveName() {
  const n = editing.value.name.trim().slice(0, 20);
  if (!n) return;
  if (store.stickers.some(x => x !== editing.value.s && x.name === n)) return toast("已经有叫这个名字的了");
  editing.value.s.name = n;
  editing.value = null;
}
function del() {
  if (!confirm(`删掉「${editing.value.s.name}」？`)) return;
  removeSticker(editing.value.s);
  editing.value = null;
}
</script>

<template>
  <div class="page">
    <SubHeader title="表情包">
      <button class="btn small" :disabled="busy" @click="add">{{ busy ? "加入中…" : "添加" }}</button>
    </SubHeader>
    <p class="lead">他在回复里写 <code>[表情:名字]</code> 就会显示成那张图；你在聊天的「＋」里也能发。名字起得像描述一样（比如「抱抱」「委屈」「偷笑」），他才知道什么时候用。</p>

    <div class="grid">
      <button v-for="s in store.stickers || []" :key="s.id" class="cell" @click="open(s)">
        <img v-if="stickerUrl(s)" :src="stickerUrl(s)" alt="" />
        <span>{{ s.name }}</span>
      </button>
      <button class="cell add" :disabled="busy" @click="add"><Icon name="plus" :size="26" /><span>添加</span></button>
    </div>

    <Sheet :open="!!editing" title="这张表情" @close="editing = null">
      <template v-if="editing">
        <img v-if="stickerUrl(editing.s)" :src="stickerUrl(editing.s)" alt="" class="big" />
        <label class="field"><span>名字（他发的时候写这个）</span><input v-model="editing.name" class="input" maxlength="20" /></label>
        <div class="row">
          <button class="btn danger" @click="del">删除</button>
          <span class="grow" />
          <button class="btn" :disabled="!editing.name.trim()" @click="saveName">保存</button>
        </div>
      </template>
    </Sheet>
  </div>
</template>

<style scoped>
.lead { margin: -6px 6px 16px; font-size: 0.85rem; color: var(--text-2); line-height: 1.7; }
.lead code { font-size: 0.8rem; background: var(--bg-deep); padding: 1px 5px; border-radius: 5px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 10px; }
.cell { border: 0; background: var(--card); border-radius: 16px; box-shadow: var(--shadow-soft); padding: 10px 6px 8px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.cell img { width: 64px; height: 64px; object-fit: contain; }
.cell span { font-size: 0.78rem; color: var(--text-2); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cell.add { color: var(--text-3); border: 2px dashed var(--line); background: none; box-shadow: none; justify-content: center; min-height: 104px; }
.big { display: block; max-width: 180px; max-height: 180px; margin: 0 auto 14px; object-fit: contain; }
.row { display: flex; align-items: center; gap: 10px; }
.grow { flex: 1; }
</style>
