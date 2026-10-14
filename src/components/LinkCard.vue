<script setup>
// 一张网址卡片：封面（有的话）、标题、简介、网站名，右下角一个 ↗，点了打开网页
import { computed } from "vue";
import { previewOf } from "../lib/linkcard.js";

const props = defineProps({ url: String, title: String, desc: String });
const info = computed(() => previewOf(props.url));
const host = computed(() => { try { return new URL(props.url).hostname.replace(/^www\./, ""); } catch { return props.url; } });
const title = computed(() => props.title || info.value.title || host.value);
const desc = computed(() => props.desc || info.value.description || (info.value.loading ? "" : props.url));
const open = () => window.open(props.url, "_blank", "noopener");
</script>

<template>
  <a class="lc" :href="url" target="_blank" rel="noopener noreferrer" @click.prevent="open">
    <img v-if="info.image" :src="info.image" alt="" class="cover" loading="lazy" @error="e => (e.target.style.display = 'none')" />
    <div class="txt">
      <b class="t">{{ title }}</b>
      <p v-if="desc" class="d">{{ desc }}</p>
      <p v-else-if="info.loading" class="d sk">　</p>
    </div>
    <p v-if="info.error" class="why">没读到网页：{{ info.error }}</p>
    <div class="foot">
      <span class="site"><img v-if="info.icon" :src="info.icon" alt="" @error="e => (e.target.style.display = 'none')" />{{ info.site || host }}</span>
      <svg class="go" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
    </div>
  </a>
</template>

<style scoped>
.lc {
  display: flex; flex-direction: column; gap: 10px; width: min(300px, 100%); padding: 16px 18px 14px; border-radius: 22px;
  background: var(--card); color: var(--text); text-decoration: none; box-shadow: 0 2px 10px rgba(40, 40, 60, .07); cursor: pointer;
}
.lc:active { transform: scale(.98); }
.cover { width: 100%; max-height: 170px; object-fit: cover; border-radius: 14px; background: var(--bg-deep); }
.t { font-size: 1.2rem; font-weight: 700; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.d { margin: 6px 0 0; font-size: .85rem; line-height: 1.6; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.d.sk { background: linear-gradient(90deg, var(--bg-deep), #f4f4f6, var(--bg-deep)); border-radius: 6px; width: 80%; }
.foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.site { display: inline-flex; align-items: center; gap: 6px; min-width: 0; padding: 6px 12px; border-radius: 999px; background: var(--bg); font-size: .78rem; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.site img { width: 14px; height: 14px; border-radius: 3px; flex: none; }
.go { flex: none; color: var(--text); }
.why { margin: -4px 0 0; font-size: .68rem; color: var(--text-3); overflow-wrap: anywhere; }
</style>
