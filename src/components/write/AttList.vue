<script setup>
// 卡片、讨论里挂着的图片和文件：图片是小方块（点开大图），文件是一个小标签；可以拿掉
import { ref, h, defineComponent } from "vue";
import { useImage } from "../../lib/images.js";
import ImageViewer from "../ImageViewer.vue";
import Icon from "../Icon.vue";

const props = defineProps({ atts: { type: Array, default: () => [] }, removable: Boolean, small: Boolean });
const emit = defineEmits(["remove"]);
const view = ref(null);
// 一张小图
const Pic = defineComponent({
  props: { id: String },
  setup(p) { const u = useImage(() => p.id); return () => (u.value ? h("img", { src: u.value, alt: "" }) : h("span", { class: "ph" })); },
});
const imgs = () => props.atts.filter(a => a.kind === "image").map(a => a.img);
</script>

<template>
  <div v-if="atts.length" class="atts" :class="{ small }">
    <template v-for="(a, i) in atts" :key="i">
      <button v-if="a.kind === 'image'" class="pic" @click.stop="view = imgs().indexOf(a.img)">
        <Pic :id="a.img" />
        <span v-if="removable" class="x" @click.stop="emit('remove', a)">×</span>
      </button>
      <span v-else class="file"><Icon name="file" :size="14" />{{ a.name }}<span v-if="removable" class="x in" @click="emit('remove', a)">×</span></span>
    </template>
    <ImageViewer :open="view != null" :images="imgs()" :start="view || 0" @close="view = null" />
  </div>
</template>

<style scoped>
.atts { display: flex; flex-wrap: wrap; gap: 8px; }
.pic { position: relative; width: 76px; height: 76px; border: 0; padding: 0; border-radius: 12px; overflow: hidden; background: var(--bg-deep); }
.small .pic { width: 56px; height: 56px; border-radius: 10px; }
.pic :deep(img) { width: 100%; height: 100%; object-fit: cover; display: block; }
.file { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 5px 10px; border-radius: 999px; background: var(--bg-deep); font-size: .75rem; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.x { position: absolute; top: 3px; right: 3px; width: 18px; height: 18px; border-radius: 50%; background: rgba(0, 0, 0, .55); color: #fff; font-size: .75rem; line-height: 18px; text-align: center; }
.x.in { position: static; background: none; color: var(--text-3); margin-left: 2px; }
</style>
