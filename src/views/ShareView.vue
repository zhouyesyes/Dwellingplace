<script setup>
// 聊天记录卡片点开的完整记录：按原来的顺序，每条的发言人、时间、文字和图片
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { store, roleById, loadMessages } from "../store/index.js";
import SubHeader from "../components/SubHeader.vue";
import Avatar from "../components/Avatar.vue";
import ImgThumb from "../components/ImgThumb.vue";
import ImageViewer from "../components/ImageViewer.vue";
import { clock } from "../lib/share.js";

const route = useRoute();
const share = ref(null);
const missing = ref(false);
const gallery = ref(null);
onMounted(async () => {
  const list = await loadMessages(route.params.threadId);
  const m = list.find(x => x.id === route.params.msgId);
  if (m?.share) share.value = m.share; else missing.value = true;
});
const avatarOf = it => {
  if (it.from === "user") return { img: store.profile.avatar, name: it.name, color: store.profile.color };
  const r = roleById(it.who);
  return { img: r?.avatar, name: it.name, color: r?.color };
};
const day = ts => new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
// 换了一天，中间放一条日期
const rows = computed(() => (share.value?.items || []).map((it, i, a) => ({ it, day: i === 0 || day(a[i - 1].ts) !== day(it.ts) ? day(it.ts) : "" })));
const allImgs = computed(() => (share.value?.items || []).flatMap(it => (it.media || []).map(x => x.img)));
</script>

<template>
  <div class="page share-view">
    <SubHeader :title="share?.title || '聊天记录'" home="/" />
    <p v-if="missing" class="empty">这张卡片不在了</p>
    <template v-else-if="share">
      <p class="from">转来自{{ share.label }} · 共 {{ share.items.length }} 条</p>
      <div class="list">
        <template v-for="(r, i) in rows" :key="i">
          <div v-if="r.day" class="day"><span>{{ r.day }}</span></div>
          <div class="row" :class="r.it.from === 'user' ? 'mine' : 'theirs'">
            <Avatar v-bind="avatarOf(r.it)" :size="36" />
            <div class="col">
              <div class="who">{{ r.it.name }} <time>{{ clock(r.it.ts).replace(/^\d+月\d+日 /, "") }}</time></div>
              <div v-if="r.it.text" class="bubble">{{ r.it.text }}</div>
              <div v-if="r.it.media?.length" class="pics">
                <span v-for="(x, k) in r.it.media" :key="k" class="pic" @click="gallery = { start: allImgs.indexOf(x.img) }">
                  <ImgThumb :id="x.img" />
                  <template v-if="x.kind === 'video'"><i class="vplay" /><em v-if="x.dur">{{ x.dur }}″</em></template>
                </span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
    <ImageViewer :open="!!gallery" :images="allImgs" :start="gallery?.start || 0" @close="gallery = null" />
  </div>
</template>

<style scoped>
.empty { text-align: center; color: var(--text-3); margin-top: 20vh; }
.from { margin: -6px 0 12px; font-size: .78rem; color: var(--text-3); }
.list { display: flex; flex-direction: column; gap: 16px; padding-bottom: 40px; }
.day { text-align: center; }
.day span { font-size: .72rem; color: var(--text-3); background: var(--bg-deep); border-radius: 999px; padding: 2px 10px; }
.row { display: flex; gap: 10px; align-items: flex-start; }
.col { min-width: 0; max-width: min(78%, 520px); display: flex; flex-direction: column; gap: 5px; align-items: flex-start; }
.who { font-size: .74rem; color: var(--text-2); padding: 0 4px; }
.who time { margin-left: 6px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.bubble { background: var(--card); border: 1px solid var(--line); color: var(--text); border-radius: 18px; border-top-left-radius: 4px; padding: 9px 14px; font-size: .95rem; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.row.mine .bubble { background: var(--bg-deep); }
.pics { display: flex; flex-wrap: wrap; gap: 6px; }
.pic { position: relative; display: block; cursor: pointer; }
.pic :deep(.thumb) { pointer-events: none; width: 140px; max-width: 46vw; }
.vplay { position: absolute; left: 50%; top: 50%; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; background: rgba(0, 0, 0, .45); }
.vplay::after { content: ""; position: absolute; left: 13px; top: 9px; border: 8px solid transparent; border-left: 13px solid #fff; border-right: 0; }
.pic em { position: absolute; right: 6px; bottom: 5px; font-style: normal; font-size: 11px; color: #fff; background: rgba(0, 0, 0, .5); border-radius: 8px; padding: 0 6px; }
</style>
