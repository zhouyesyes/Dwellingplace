<script setup>
// 纪念日：可以有好几个，左右滑动切换；点卡片管理
import { ref, reactive, computed } from "vue";
import { store, uid, roleById } from "../../store/index.js";
import { anniversaryInfo, todayYmd } from "../../lib/dates.js";
import { useImage, pickAndCrop, deleteImage, imageURL } from "../../lib/images.js";
import Sheet from "../Sheet.vue";
import Icon from "../Icon.vue";

const props = defineProps({ size: String, editing: Boolean });

const list = computed(() => store.anniversaries);
const titleOf = a => a.title || (roleById(a.roleId) ? `和${roleById(a.roleId).name}相遇` : "纪念日");
const colorOf = a => roleById(a.roleId)?.color || store.profile.color;

// 背景图 url 缓存
const bgUrls = reactive({});
async function loadBg(a) {
  if (a.bg && !bgUrls[a.bg]) bgUrls[a.bg] = await imageURL(a.bg);
}
const bgOf = a => { loadBg(a); return a.bg ? bgUrls[a.bg] : null; };

// 当前显示第几张
const track = ref(null);
const current = ref(0);
function onScroll() {
  const el = track.value;
  if (el) current.value = Math.round(el.scrollLeft / el.clientWidth);
}

// ---------- 管理 ----------
const manageOpen = ref(false);
const draft = ref(null); // 正在编辑的纪念日（副本）
function openManage() {
  if (props.editing) return;
  if (!list.value.length) return startEdit(null);
  manageOpen.value = true;
}
function startEdit(a) {
  manageOpen.value = false;
  draft.value = a
    ? { ...a, _isNew: false }
    : { id: uid(), title: "", roleId: store.roles[0]?.id ?? null, date: todayYmd(), bg: null, _isNew: true };
}
const editBg = useImage(() => draft.value?.bg);
async function changeBg() {
  const id = await pickAndCrop({ aspect: 16 / 10, title: "调整纪念日背景", maxSize: 1400 });
  if (!id) return;
  const orig = store.anniversaries.find(x => x.id === draft.value.id);
  if (draft.value.bg && draft.value.bg !== orig?.bg) deleteImage(draft.value.bg);
  draft.value.bg = id;
}
function saveEdit() {
  const { _isNew, ...a } = draft.value;
  if (!a.date) return;
  const i = store.anniversaries.findIndex(x => x.id === a.id);
  if (i >= 0) {
    if (store.anniversaries[i].bg && store.anniversaries[i].bg !== a.bg) deleteImage(store.anniversaries[i].bg);
    store.anniversaries[i] = a;
  } else {
    store.anniversaries.push(a);
  }
  draft.value = null;
}
function removeEdit() {
  if (!confirm("删除这个纪念日？")) return;
  const i = store.anniversaries.findIndex(x => x.id === draft.value.id);
  if (i >= 0) {
    deleteImage(store.anniversaries[i].bg);
    store.anniversaries.splice(i, 1);
  }
  draft.value = null;
}
</script>

<template>
  <div class="anniv-w" :class="size" @click="openManage">
    <div v-if="!list.length" class="card empty-card">
      <svg class="mountains" viewBox="0 0 320 60" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 60V44l26-12 18 8 30-22 22 14 16-6 34 20 28-26 26 18 20-6 30 18 24-14 22 10 24-4V60Z" fill="rgba(255,255,255,.55)" />
        <path d="M0 44l26-12 18 8 30-22 22 14 16-6 34 20 28-26 26 18 20-6 30 18 24-14 22 10 24-4" fill="none" stroke="rgba(80,90,110,.35)" stroke-width="1" />
      </svg>
      <div class="t">纪念日</div>
      <div class="plus">＋</div>
      <div class="s">添加第一个纪念日</div>
    </div>

    <div v-else ref="track" class="track" @scroll.passive="onScroll">
      <div v-for="a in list" :key="a.id" class="card" :class="{ img: bgOf(a) }" :style="bgOf(a) ? { backgroundImage: `url(${bgOf(a)})` } : {}">
        <svg v-if="!bgOf(a)" class="mountains" viewBox="0 0 320 60" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 60V44l26-12 18 8 30-22 22 14 16-6 34 20 28-26 26 18 20-6 30 18 24-14 22 10 24-4V60Z" fill="rgba(255,255,255,.55)" />
          <path d="M0 44l26-12 18 8 30-22 22 14 16-6 34 20 28-26 26 18 20-6 30 18 24-14 22 10 24-4" fill="none" stroke="rgba(80,90,110,.35)" stroke-width="1" />
        </svg>
        <template v-for="info in [anniversaryInfo(a.date)]" :key="a.date">
          <div class="t"><i :style="{ background: colorOf(a) }" />{{ titleOf(a) }}</div>
          <div class="n">{{ info.future ? info.until : info.day }}</div>
          <div class="s">
            <template v-if="info.future">天后就是那一天</template>
            <template v-else>距离{{ info.nextLabel }}还有 {{ info.until }} 天</template>
          </div>
        </template>
      </div>
    </div>
    <div v-if="list.length > 1" class="dots"><i v-for="(a, i) in list" :key="a.id" :class="{ on: i === current }" /></div>
  </div>

  <!-- 列表 -->
  <Sheet :open="manageOpen" title="纪念日" @close="manageOpen = false">
    <div class="list-card flat">
      <button v-for="a in list" :key="a.id" class="list-row" @click="startEdit(a)">
        <span class="dot" :style="{ background: colorOf(a) }" />
        <span class="grow">{{ titleOf(a) }}<span class="sub">{{ a.date }} · 第 {{ anniversaryInfo(a.date).day }} 天</span></span>
        <Icon name="right" class="chev" :size="18" />
      </button>
    </div>
    <button class="btn soft wide" @click="startEdit(null)"><Icon name="plus" :size="16" /> 新的纪念日</button>
  </Sheet>

  <!-- 编辑 -->
  <Sheet :open="!!draft" :title="draft?._isNew ? '新的纪念日' : '编辑纪念日'" @close="draft = null">
    <template v-if="draft">
      <label class="field">
        <span>是谁的纪念日</span>
        <select v-model="draft.roleId" class="input">
          <option v-for="r in store.roles" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </label>
      <label class="field">
        <span>名字</span>
        <input v-model="draft.title" class="input" :placeholder="roleById(draft.roleId) ? `和${roleById(draft.roleId).name}相遇` : '纪念日'" />
      </label>
      <label class="field"><span>日期</span><input v-model="draft.date" class="input" type="date" /></label>
      <div class="field">
        <span>背景</span>
        <div class="bg-row">
          <div class="bg-prev" :style="editBg ? { backgroundImage: `url(${editBg})` } : {}" />
          <button class="btn soft small" @click="changeBg">换背景</button>
          <button v-if="draft.bg" class="btn soft small" @click="draft.bg = null">用默认</button>
        </div>
      </div>
      <div class="edit-actions">
        <button v-if="!draft._isNew" class="btn danger" @click="removeEdit">删除</button>
        <span class="spacer" />
        <button class="btn" :disabled="!draft.date" @click="saveEdit">保存</button>
      </div>
    </template>
  </Sheet>
</template>

<style scoped>
.anniv-w { position: relative; height: 100%; cursor: pointer; }
.track { display: flex; height: 100%; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
.track::-webkit-scrollbar { display: none; }
.card {
  position: relative;
  flex: 0 0 100%;
  height: 100%;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 12px;
  background: linear-gradient(180deg, #e9edf3, #dfe5ee);
  background-size: cover;
  background-position: center;
  overflow: hidden;
  color: var(--text);
}
.card.img { text-shadow: 0 0 8px rgba(255, 255, 255, .85); }
.mountains { position: absolute; left: 0; right: 0; bottom: 0; width: 100%; height: 28%; }
.t { position: relative; font-size: 0.8rem; color: var(--text-2); display: flex; align-items: center; gap: 5px; }
.card.img .t { color: var(--text); }
.t i { width: 7px; height: 7px; border-radius: 50%; }
.n { position: relative; font-size: 2.6rem; font-weight: 800; line-height: 1.15; letter-spacing: -1px; }
.large .n { font-size: 3.6rem; }
.s { position: relative; font-size: 0.75rem; color: var(--text-2); }
.card.img .s { color: var(--text); }
.large .s { font-size: 0.87rem; }
.empty-card .plus { font-size: 2rem; color: var(--text-3); line-height: 1.2; }
.dots { position: absolute; bottom: 8px; left: 0; right: 0; display: flex; justify-content: center; gap: 4px; pointer-events: none; }
.dots i { width: 5px; height: 5px; border-radius: 50%; background: rgba(60, 60, 80, .2); }
.dots i.on { background: rgba(60, 60, 80, .55); }

.list-card.flat { box-shadow: none; border: 1px solid var(--line); }
.dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.wide { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; margin-top: 10px; }
.bg-row { display: flex; align-items: center; gap: 10px; }
.bg-prev { width: 80px; height: 50px; border-radius: 10px; background: linear-gradient(180deg, #e9edf3, #dfe5ee) center / cover; box-shadow: 0 0 0 1px var(--line); }
.edit-actions { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.spacer { flex: 1; }
</style>
