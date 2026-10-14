<script setup>
import { reactive, computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, newRole, roleById, deleteRole, PALETTE, BUBBLE_COLORS } from "../store/index.js";
import { deleteImage, pickAndCrop } from "../lib/images.js";
import { toast } from "../lib/toast.js";
import { draftStyle } from "../lib/chat.js";
import { goBack } from "../lib/nav.js";
import SubHeader from "../components/SubHeader.vue";
import Avatar from "../components/Avatar.vue";
import Icon from "../components/Icon.vue";
import ColorSwatches from "../components/ColorSwatches.vue";

const route = useRoute();
const router = useRouter();
// 只有一个 AI：不再新建角色
const isNew = false;
const original = roleById(route.params.id);
if (!original) router.replace("/settings");

const form = reactive(JSON.parse(JSON.stringify(original || newRole({ color: PALETTE[store.roles.length % PALETTE.length] }))));
const valid = computed(() => form.name.trim().length > 0);

// 使用的 API 和模型：默认模型 + 标星的模型都能选
form.model ??= null;
const apiChoices = computed(() => store.apis.flatMap(a => [...new Set([a.model, ...(a.favModels || [])])].filter(Boolean).map(m => ({
  key: `${a.id}|${m}`,
  label: `${a.name} · ${m}${m === a.model ? "（默认）" : " ★"}`,
}))));
const apiPick = computed({
  get: () => (form.apiId ? `${form.apiId}|${form.model || store.apis.find(a => a.id === form.apiId)?.model || ""}` : ""),
  set: v => {
    if (!v) { form.apiId = null; form.model = null; return; }
    const i = v.indexOf("|");
    const id = v.slice(0, i), m = v.slice(i + 1);
    form.apiId = id;
    form.model = m === store.apis.find(a => a.id === id)?.model ? null : m;
  },
});

form.me ??= { name: "", avatar: null, about: "" };
form.style ??= "";
// 以前的「设定」「关于我」还存着：可以放进来当底稿
const oldPersona = computed(() => [form.persona?.trim(), form.me?.about?.trim() && `（以前写的关于${form.me.name || "你"}）\n${form.me.about.trim()}`].filter(Boolean).join("\n\n"));
function useOld() {
  form.style = [form.style.trim(), oldPersona.value].filter(Boolean).join("\n\n").slice(0, 2000);
}
// 说话方式：让他照着最近的聊天自己写一份，写完你再改
const drafting = ref(false);
async function draft() {
  if (!original) return;
  drafting.value = true;
  try {
    const t = await draftStyle(original);
    if (t) form.style = t.slice(0, 2000);
  } catch (e) {
    toast(e.message, 4000);
  } finally {
    drafting.value = false;
  }
}

// 我的头像：和主页、聊天里的是同一张，换了马上生效
async function changeMyAvatar() {
  const id = await pickAndCrop({ aspect: 1, round: true, title: "我的头像", maxSize: 500 });
  if (!id) return;
  const old = store.profile.avatar;
  store.profile.avatar = id;
  if (old) deleteImage(old);
}

// ---------- 头像库 ----------
form.avatars ??= [];
form.avatarAuto ??= true;
async function addAvatar() {
  const id = await pickAndCrop({ aspect: 1, round: true, title: "加进头像库", maxSize: 500 });
  if (!id) return;
  const name = (prompt("给这张头像起个名字（他换的时候写这个，比如「晴天」「困了」）", "") || "").trim().slice(0, 20) || `头像${form.avatars.length + 1}`;
  form.avatars.push({ id, name, img: id });
  if (!form.avatar) form.avatar = id;
}
// 点一张：设为现在的头像，下面出现「改名 / 删掉」
const picked = ref(null);
function pickAvatar(a) { if (justDragged) return; form.avatar = a.img; picked.value = a; }
// 长按一张（0.35 秒，轻轻一震）拿起来，拖到别的位置上就换过去，松手放下
const dragging = ref(null);
let press = null, justDragged = false;
function avDown(e, a) {
  press = { x: e.clientX, y: e.clientY, t: setTimeout(() => { dragging.value = a; navigator.vibrate?.(12); }, 350) };
}
function avMove(e) {
  if (press && !dragging.value && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.t); press = null; }
  if (!dragging.value) return;
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-av]");
  const to = el ? form.avatars.findIndex(x => x.id === el.dataset.av) : -1;
  const from = form.avatars.indexOf(dragging.value);
  if (to < 0 || to === from) return;
  form.avatars.splice(from, 1);
  form.avatars.splice(to, 0, dragging.value);
}
function avUp() {
  if (press) clearTimeout(press.t);
  press = null;
  if (dragging.value) { justDragged = true; setTimeout(() => (justDragged = false), 50); }
  dragging.value = null;
}
// 拖着的时候页面别跟着滚（iPhone 要在 touchmove 里拦）
const avLib = ref(null);
const stopScroll = e => { if (dragging.value) e.preventDefault(); };
watch(avLib, (el, old) => { old?.removeEventListener("touchmove", stopScroll); el?.addEventListener("touchmove", stopScroll, { passive: false }); });
function renameAvatar(a) { const n = (prompt("新名字", a.name) || "").trim().slice(0, 20); if (n) a.name = n; }
function dropAvatar(a) {
  if (!confirm(`把「${a.name}」从头像库删掉？`)) return;
  form.avatars.splice(form.avatars.indexOf(a), 1);
  if (form.avatar !== a.img) deleteImage(a.img);
  picked.value = null;
}

async function changeAvatar() {
  const id = await pickAndCrop({ aspect: 1, round: true, title: "调整头像", maxSize: 500 });
  if (!id) return;
  if (form.avatar && form.avatar !== original?.avatar) deleteImage(form.avatar);
  form.avatar = id;
}

function save() {
  if (!valid.value) return;
  form.name = form.name.trim();
  if (original) {
    if (original.avatar && original.avatar !== form.avatar) deleteImage(original.avatar);
    if (original.me?.avatar && original.me.avatar !== form.me.avatar) deleteImage(original.me.avatar);
    Object.assign(original, form);
  } else {
    store.roles.push(form);
  }
  toast("已保存");
  goBack(router, "/settings");
}

async function remove() {
  if (!confirm(`确定删除「${original.name}」？和他的所有对话都会被删除，无法恢复。`)) return;
  await deleteRole(original.id);
  router.replace("/settings");
}
</script>

<template>
  <div class="page">
    <SubHeader :title="'他的设定'">
      <button class="btn small" :disabled="!valid" @click="save">保存</button>
    </SubHeader>

    <div class="card body">
      <div class="ava-row">
        <button class="ava-btn" @click="changeAvatar">
          <Avatar :img="form.avatar" :name="form.name" :color="form.color" :size="76" />
          <span>换头像</span>
        </button>
      </div>

      <div class="field">
        <span>头像库<small>（放两张以上，他会按心情自己换；点一张就换成它；长按拖动排顺序）</small></span>
        <div ref="avLib" class="av-lib" :class="{ dragging }" @pointermove="avMove" @pointerup="avUp" @pointercancel="avUp">
          <button v-for="a in form.avatars" :key="a.id" :data-av="a.id" class="av" :class="{ cur: a.img === form.avatar, lifted: dragging === a }" @pointerdown="avDown($event, a)" @click="pickAvatar(a)" @contextmenu.prevent>
            <Avatar :img="a.img" :name="a.name" :color="form.color" :size="52" />
            <small>{{ a.name }}</small>
          </button>
          <button class="av add" @click="addAvatar"><span><Icon name="plus" :size="20" /></span><small>添加</small></button>
        </div>
        <div v-if="picked && form.avatars.includes(picked)" class="av-edit">
          <span>「{{ picked.name }}」</span>
          <button class="btn soft small" @click="renameAvatar(picked)">改名字</button>
          <button class="btn soft small" @click="dropAvatar(picked)">从头像库删掉</button>
        </div>
        <label v-if="form.avatars.length >= 2" class="switch-row"><span>让他自己换头像<small class="sub-note">最多 6 小时换一次</small></span><input v-model="form.avatarAuto" type="checkbox" /></label>
      </div>

      <label class="field"><span>名字</span><input v-model="form.name" class="input" placeholder="例如：小机" /></label>

      <div class="field">
        <span>代表色<small>（日历小圆点、头像底色）</small></span>
        <ColorSwatches v-model="form.color" :colors="PALETTE" />
      </div>

      <div class="field">
        <span>他的气泡颜色</span>
        <ColorSwatches v-model="form.bubbleColor" :colors="BUBBLE_COLORS" />
        <div class="bubble-preview" :style="{ background: form.bubbleColor }">聊天时他的消息是这个颜色</div>
      </div>

      <label class="field">
        <span>使用的 API</span>
        <select v-model="apiPick" class="input">
          <option value="">跟随全局默认</option>
          <option v-for="c in apiChoices" :key="c.key" :value="c.key">{{ c.label }}</option>
        </select>
        <small class="field-hint">每个 API 的默认模型和标了星的模型都能选</small>
      </label>
    </div>

    <div class="section-label">在他面前的我</div>
    <div class="card body">
      <div class="me-row">
        <button class="ava-btn" @click="changeMyAvatar">
          <Avatar :img="store.profile.avatar" :name="form.me.name || store.profile.name" :color="store.profile.color" :size="56" />
          <span>我的头像</span>
        </button>
        <label class="field grow">
          <span>他怎么称呼我</span>
          <input v-model.trim="form.me.name" class="input" placeholder="例如：存在" />
        </label>
      </div>
    </div>

    <div class="section-label">我是谁 · 说话的样子</div>
    <div class="card body">
      <textarea v-model="form.style" class="input style-box" rows="8" maxlength="2000" placeholder="用他自己的口吻写：我是什么样的人、在意什么，我和你是什么关系，我平时怎么说话，再加几句例句。每次聊天他都会先看这里，记起自己是谁" />
      <div class="style-row">
        <small>放在他看到的最前面，每次都带上（几乎都能命中缓存）。可以让他自己写，你再改；他变了就一起改。</small>
      </div>
      <div class="style-row">
        <button v-if="oldPersona" class="btn soft small" @click="useOld">放进以前的设定</button>
        <span class="grow" />
        <button class="btn soft small" :disabled="!original || drafting" @click="draft">{{ drafting ? "他在写…" : "让他自己写" }}</button>
      </div>
    </div>

    <div class="section-label">签名</div>
    <div class="card body">
      <label class="field">
        <span>当前签名</span>
        <input v-model="form.signature" class="input" placeholder="由他自己决定，也可以手动写" />
      </label>
      <label class="field">
        <span>最快多久能改一次（小时）</span>
        <input v-model.number="form.sigCooldownHours" class="input" type="number" min="0" step="1" />
      </label>
      <label class="field">
        <span>他每天能整理几次日历<small>（记、改、删都算；一次最多 5 条；每天早上 5 点重置）</small></span>
        <input v-model.number="form.calPerDay" class="input" type="number" min="0" max="20" step="1" inputmode="numeric" />
      </label>
      <label class="switch-row">
        <span>锁定签名，不让他改</span>
        <input v-model="form.sigLocked" type="checkbox" />
      </label>
    </div>

    <div v-if="false" class="danger-zone">
      <button class="btn danger" @click="remove">删除这个角色</button>
    </div>
  </div>
</template>

<style scoped>
.style-box { width: 100%; min-height: 110px; resize: vertical; line-height: 1.6; }
.style-row { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.style-row .grow { flex: 1; }
.style-row small { flex: 1; color: var(--text-2); font-size: 0.75rem; }
.field-hint { display: block; font-size: 0.75rem; color: var(--text-3); margin-top: 4px; }
.body { padding: 18px; }
.ava-row { display: flex; justify-content: center; margin-bottom: 14px; }
.av-edit { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 0.85rem; color: var(--text-2); }
.av-lib { display: flex; flex-wrap: wrap; gap: 10px; }
.av-lib .av { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; transition: transform .15s; }
.av-lib .av.lifted { transform: scale(1.12); z-index: 2; }
.av-lib.dragging .av:not(.lifted) { opacity: .7; }
.av { border: 0; background: none; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 3px; border-radius: 16px; }
.av.cur { background: var(--bg-deep); }
.av small { font-size: 0.72rem; color: var(--text-2); max-width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.av.add span { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 50%; border: 2px dashed var(--line); color: var(--text-3); }
.ava-btn { display: flex; flex-direction: column; align-items: center; gap: 8px; border: 0; background: none; font-size: 0.867rem; color: var(--text-2); }
.bubble-preview { align-self: flex-start; margin: 6px 4px 0; padding: 8px 14px; border-radius: 8px 18px 18px 18px; font-size: 0.93rem; color: var(--text); box-shadow: 0 0 0 1px var(--line); }
.me-row { display: flex; gap: 14px; align-items: flex-start; }
.me-row .grow { flex: 1; }
.switch-row { display: flex; justify-content: space-between; align-items: center; padding: 4px; font-size: 0.933rem; }
.switch-row input { width: 20px; height: 20px; accent-color: var(--ink); }
.danger-zone { display: flex; justify-content: center; margin-top: 28px; }
</style>
