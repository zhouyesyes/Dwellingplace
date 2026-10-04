<script setup>
import { reactive, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, newRole, roleById, deleteRole, PALETTE } from "../store/index.js";
import { saveImage, deleteImage, pickFile } from "../lib/images.js";
import { toast } from "../lib/toast.js";
import { goBack } from "../lib/nav.js";
import SubHeader from "../components/SubHeader.vue";
import Avatar from "../components/Avatar.vue";

const route = useRoute();
const router = useRouter();
const isNew = route.params.id === "new";
const original = isNew ? null : roleById(route.params.id);
if (!isNew && !original) router.replace("/settings");

const form = reactive(JSON.parse(JSON.stringify(original || newRole({ color: PALETTE[store.roles.length % PALETTE.length] }))));
const valid = computed(() => form.name.trim().length > 0);

async function changeAvatar() {
  const [file] = await pickFile("image/*");
  if (!file) return;
  form.avatar = await saveImage(file, { maxSize: 400, square: true });
}

function save() {
  if (!valid.value) return;
  form.name = form.name.trim();
  if (original) {
    if (original.avatar && original.avatar !== form.avatar) deleteImage(original.avatar);
    Object.assign(original, form);
  } else {
    store.roles.push(form);
  }
  toast("已保存");
  goBack(router, "/settings");
}

async function remove() {
  if (!confirm(`确定删除「${original.name}」？和 TA 的所有对话都会被删除，无法恢复。`)) return;
  await deleteRole(original.id);
  router.replace("/settings");
}
</script>

<template>
  <div class="page">
    <SubHeader :title="isNew ? '添加角色' : '编辑角色'">
      <button class="btn small" :disabled="!valid" @click="save">保存</button>
    </SubHeader>

    <div class="card body">
      <div class="ava-row">
        <button class="ava-btn" @click="changeAvatar">
          <Avatar :img="form.avatar" :name="form.name" :color="form.color" :size="76" />
          <span>换头像</span>
        </button>
      </div>

      <label class="field"><span>名字</span><input v-model="form.name" class="input" placeholder="例如：哥哥" /></label>

      <div class="field">
        <span>代表色</span>
        <div class="swatches">
          <button v-for="c in PALETTE" :key="c" class="sw" :class="{ on: form.color === c }" :style="{ background: c }" @click="form.color = c" />
          <label class="sw custom" :style="{ background: form.color }"><input v-model="form.color" type="color" /></label>
        </div>
      </div>

      <label class="field">
        <span>设定</span>
        <textarea v-model="form.persona" class="input" rows="6" placeholder="TA 是谁？说话是什么风格？和你是什么关系？"></textarea>
      </label>

      <label class="field">
        <span>使用的 API</span>
        <select v-model="form.apiId" class="input">
          <option :value="null">跟随全局默认</option>
          <option v-for="a in store.apis" :key="a.id" :value="a.id">{{ a.name }}（{{ a.model }}）</option>
        </select>
      </label>
    </div>

    <div class="section-label">签名</div>
    <div class="card body">
      <label class="field">
        <span>当前签名</span>
        <input v-model="form.signature" class="input" placeholder="由 TA 自己决定，也可以手动写" />
      </label>
      <label class="field">
        <span>最快多久能改一次（小时）</span>
        <input v-model.number="form.sigCooldownHours" class="input" type="number" min="0" step="1" />
      </label>
      <label class="switch-row">
        <span>锁定签名，不让 TA 改</span>
        <input v-model="form.sigLocked" type="checkbox" />
      </label>
    </div>

    <div v-if="!isNew" class="danger-zone">
      <button class="btn danger" @click="remove">删除这个角色</button>
    </div>
  </div>
</template>

<style scoped>
.body { padding: 18px; }
.ava-row { display: flex; justify-content: center; margin-bottom: 14px; }
.ava-btn { display: flex; flex-direction: column; align-items: center; gap: 8px; border: 0; background: none; font-size: 13px; color: var(--text-2); }
.swatches { display: flex; gap: 10px; flex-wrap: wrap; padding: 2px 4px; }
.sw { width: 30px; height: 30px; border-radius: 50%; border: 3px solid transparent; box-shadow: 0 0 0 1px var(--line); padding: 0; }
.sw.on { border-color: var(--card); box-shadow: 0 0 0 2px var(--ink); }
.sw.custom { position: relative; overflow: hidden; background-image: conic-gradient(#e8a3a3, #f0cf7a, #9cc5a1, #9db8dc, #c7a6d8, #e8a3a3) !important; }
.sw.custom input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.switch-row { display: flex; justify-content: space-between; align-items: center; padding: 4px; font-size: 14px; }
.switch-row input { width: 20px; height: 20px; accent-color: var(--ink); }
.danger-zone { display: flex; justify-content: center; margin-top: 28px; }
</style>
