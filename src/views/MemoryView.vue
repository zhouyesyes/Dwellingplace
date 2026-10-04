<script setup>
// 记忆库：每个角色一个抽屉，里面是一张张记忆卡片
import { ref, reactive, computed, watch } from "vue";
import { store, uid, roleById, authorInfo } from "../store/index.js";
import { memoriesOf } from "../lib/memoryTags.js";
import { todayYmd } from "../lib/dates.js";
import { imageURL, pickAndCrop, deleteImage, useImage } from "../lib/images.js";
import Sheet from "../components/Sheet.vue";
import Icon from "../components/Icon.vue";
import Avatar from "../components/Avatar.vue";
import BigTextarea from "../components/BigTextarea.vue";

const tab = ref(store.roles[0]?.id ?? null);
watch(() => store.roles.length, () => { if (!roleById(tab.value)) tab.value = store.roles[0]?.id ?? null; });
const role = computed(() => roleById(tab.value));

const query = ref("");
const cards = computed(() => {
  const q = query.value.trim().toLowerCase();
  const list = tab.value ? memoriesOf(tab.value) : [];
  return q ? list.filter(m => (m.title + m.content + m.date).toLowerCase().includes(q)) : list;
});

const imgUrls = reactive({});
function imgOf(m) {
  if (m.img && !imgUrls[m.img]) imageURL(m.img).then(u => (imgUrls[m.img] = u));
  return m.img ? imgUrls[m.img] : null;
}
const md = d => d.slice(5).replace("-", ".");
const tint = c => `color-mix(in srgb, ${c} 14%, #ffffff)`;

// ---------- 查看 ----------
const viewing = ref(null);

// ---------- 新建 / 编辑 ----------
const draft = ref(null);
const draftImg = useImage(() => draft.value?.img);
function newCard() {
  if (!role.value) return;
  draft.value = { id: uid(), roleId: tab.value, title: "", content: "", img: null, date: todayYmd(), author: "me", ts: Date.now(), _isNew: true };
}
function editCard(m) {
  viewing.value = null;
  draft.value = { ...m, _isNew: false };
}
async function changeImg() {
  const id = await pickAndCrop({ aspect: 4 / 3, title: "调整图片", maxSize: 1400 });
  if (!id) return;
  const orig = store.memories.find(x => x.id === draft.value.id);
  if (draft.value.img && draft.value.img !== orig?.img) deleteImage(draft.value.img);
  draft.value.img = id;
}
function save() {
  const { _isNew, ...m } = draft.value;
  m.title = m.title.trim() || m.content.trim().slice(0, 12);
  m.content = m.content.trim();
  if (!m.content) return;
  const i = store.memories.findIndex(x => x.id === m.id);
  if (i >= 0) {
    if (store.memories[i].img && store.memories[i].img !== m.img) deleteImage(store.memories[i].img);
    store.memories[i] = { ...m, ts: Date.now() };
  } else {
    store.memories.push(m);
  }
  tab.value = m.roleId;
  draft.value = null;
}
function remove() {
  if (!confirm("删除这张记忆卡片？")) return;
  const i = store.memories.findIndex(x => x.id === draft.value.id);
  if (i >= 0) {
    deleteImage(store.memories[i].img);
    store.memories.splice(i, 1);
  }
  draft.value = null;
}
</script>

<template>
  <div class="page memory">
    <h1 class="studio">Memory Studio</h1>

    <nav class="tabs">
      <button v-for="r in store.roles" :key="r.id" :class="{ on: tab === r.id }" @click="tab = r.id">{{ r.name }} 的抽屉</button>
    </nav>

    <div class="search">
      <Icon name="search" :size="17" />
      <input v-model="query" placeholder="搜索标题、内容、日期" />
    </div>

    <div class="cards">
      <article v-for="m in cards" :key="m.id" class="mcard" :style="{ background: tint(role.color) }" @click="viewing = m">
        <div class="meta"><span>{{ md(m.date) }}</span><span>{{ role.name }}</span></div>
        <img v-if="imgOf(m)" :src="imgOf(m)" alt="" class="pic" />
        <h3>{{ m.title }}</h3>
        <p>{{ m.content }}</p>
        <div class="by">
          <Avatar v-if="m.author === 'me'" :img="role.me?.avatar || store.profile.avatar" :name="authorInfo('me').name" :color="store.profile.color" :size="22" />
          <Avatar v-else :img="role.avatar" :name="role.name" :color="role.color" :size="22" />
          <span>{{ m.author === "me" ? "我写的" : `${role.name} 写的` }}</span>
          <Icon name="right" :size="15" class="chev" />
        </div>
      </article>
    </div>

    <p v-if="!store.roles.length" class="empty-hint">还没有角色，先去「设置」里添加一个吧</p>
    <p v-else-if="!cards.length" class="empty-hint">
      {{ query ? "没有找到相关的记忆" : `${role?.name} 的抽屉还是空的。聊天时 TA 会自己写下记忆，你也可以点右下角 ＋ 自己写。` }}
    </p>

    <button v-if="role" class="fab" aria-label="写一张记忆卡片" @click="newCard"><Icon name="plus" :size="26" /></button>

    <!-- 查看 -->
    <Sheet :open="!!viewing" @close="viewing = null">
      <template v-if="viewing">
        <img v-if="imgOf(viewing)" :src="imgOf(viewing)" alt="" class="view-pic" />
        <div class="view-meta">{{ viewing.date }} · {{ viewing.author === "me" ? "我写的" : `${roleById(viewing.roleId)?.name} 写的` }}</div>
        <h2 class="view-title">{{ viewing.title }}</h2>
        <p class="view-body">{{ viewing.content }}</p>
        <div class="edit-actions"><button class="btn soft" @click="editCard(viewing)"><Icon name="edit" :size="16" /> 编辑</button></div>
      </template>
    </Sheet>

    <!-- 编辑 -->
    <Sheet :open="!!draft" :title="draft?._isNew ? '写一张记忆卡片' : '编辑记忆卡片'" @close="draft = null">
      <template v-if="draft">
        <label class="field">
          <span>放进谁的抽屉</span>
          <select v-model="draft.roleId" class="input">
            <option v-for="r in store.roles" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </label>
        <label class="field"><span>标题</span><input v-model="draft.title" class="input" placeholder="例如：第一次给小鸡起名字" /></label>
        <label class="field"><span>内容</span><BigTextarea v-model="draft.content" rows="5" title="记忆内容" placeholder="想让 TA 一直记得的事" /></label>
        <label class="field"><span>日期</span><input v-model="draft.date" class="input" type="date" /></label>
        <div class="field">
          <span>图片（可选）</span>
          <div class="img-row">
            <div class="img-prev" :style="draftImg ? { backgroundImage: `url(${draftImg})` } : {}"><Icon v-if="!draftImg" name="image" :size="20" /></div>
            <button class="btn soft small" @click="changeImg">{{ draft.img ? "换一张" : "添加图片" }}</button>
            <button v-if="draft.img" class="btn soft small" @click="draft.img = null">去掉</button>
          </div>
        </div>
        <div class="edit-actions">
          <button v-if="!draft._isNew" class="btn danger" @click="remove">删除</button>
          <span class="spacer" />
          <button class="btn" :disabled="!draft.content.trim()" @click="save">保存</button>
        </div>
      </template>
    </Sheet>
  </div>
</template>

<style scoped>
.studio {
  font-family: Georgia, "Times New Roman", "Songti SC", serif;
  text-align: center;
  font-size: 1.75rem;
  font-weight: 600;
  margin: 10px 0 12px;
  letter-spacing: .3px;
}
.tabs { display: flex; justify-content: center; gap: 18px; overflow-x: auto; scrollbar-width: none; margin-bottom: 14px; }
.tabs::-webkit-scrollbar { display: none; }
.tabs button {
  flex: none;
  border: 0;
  background: none;
  padding: 4px 2px 6px;
  font-size: 0.8rem;
  color: var(--text-3);
  border-bottom: 2px solid transparent;
}
.tabs button.on { color: var(--text); font-weight: 600; border-bottom-color: var(--ink); }

.search {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--card);
  border-radius: 999px;
  padding: 9px 16px;
  box-shadow: var(--shadow-soft);
  color: var(--text-3);
  margin-bottom: 16px;
}
.search input { flex: 1; border: 0; outline: none; background: none; font-size: 0.93rem; color: var(--text); }

.cards { display: flex; flex-direction: column; gap: 14px; }
.mcard {
  border-radius: 20px;
  padding: 14px 16px 12px;
  box-shadow: var(--shadow-soft);
  cursor: pointer;
}
.meta { display: flex; justify-content: space-between; font-size: 0.73rem; color: var(--text-3); margin-bottom: 8px; }
.pic { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 14px; margin-bottom: 10px; }
.mcard h3 { margin: 0 0 4px; font-size: 1rem; font-weight: 700; }
.mcard p {
  margin: 0;
  font-size: 0.87rem;
  color: var(--text-2);
  line-height: 1.65;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.by { display: flex; align-items: center; gap: 6px; margin-top: 10px; font-size: 0.75rem; color: var(--text-2); }
.by .chev { margin-left: auto; color: var(--text-3); }

.fab {
  position: fixed;
  right: max(20px, calc((100vw - 680px) / 2 + 20px));
  bottom: calc(var(--safe-bottom) + 80px);
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 0;
  background: #fff;
  color: var(--ink);
  box-shadow: 0 6px 20px rgba(40, 40, 60, .16);
  display: grid;
  place-items: center;
  z-index: 15;
}

.view-pic { display: block; width: 100%; border-radius: 16px; margin-bottom: 12px; }
.view-meta { font-size: 0.8rem; color: var(--text-3); }
.view-title { margin: 6px 0 8px; font-size: 1.2rem; }
.view-body { margin: 0; white-space: pre-wrap; line-height: 1.75; font-size: 0.97rem; }
.edit-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.edit-actions .btn { display: flex; align-items: center; gap: 4px; }
.spacer { flex: 1; }
.img-row { display: flex; align-items: center; gap: 10px; }
.img-prev { width: 64px; height: 48px; border-radius: 10px; background: var(--bg) center / cover; display: grid; place-items: center; color: var(--text-3); box-shadow: 0 0 0 1px var(--line); }
</style>
