<script setup>
// 群聊的头像：设了群头像就用它；没设就把三个人（她、小章鱼、小螃蟹）的小头像拼在一起
import { computed } from "vue";
import { store, roleById, MAIN, CRAB } from "../store/index.js";
import Avatar from "./Avatar.vue";

const props = defineProps({ size: { type: Number, default: 40 } });
const him = computed(() => roleById(MAIN));
const crab = computed(() => roleById(CRAB));
const myName = computed(() => him.value?.me?.name || store.profile.userName || "我");
const s = computed(() => Math.round(props.size * 0.58));
</script>

<template>
  <span class="gava" :style="{ width: size + 'px', height: size + 'px' }">
    <Avatar v-if="store.group.avatar" :img="store.group.avatar" :name="store.group.name" color="#b9a2ef" :size="size" class="solo" />
    <template v-else>
      <Avatar v-if="him" :img="him.avatar" :name="him.name" :color="him.color" :size="s" class="a1" />
      <Avatar v-if="crab" :img="crab.avatar" :name="crab.name" :color="crab.color" :size="s" class="a2" />
      <Avatar :img="store.profile.avatar" :name="myName" :color="store.profile.color" :size="s" class="a3" />
    </template>
  </span>
</template>

<style scoped>
.gava { position: relative; display: inline-block; flex: none; }
.gava .solo { position: absolute; inset: 0; }
.gava .a1, .gava .a2, .gava .a3 { position: absolute; }
.gava .a1 { left: 0; top: 0; }
.gava .a2 { right: 0; top: 0; }
.gava .a3 { left: 50%; bottom: 0; transform: translateX(-50%); }
.gava :deep(.avatar) { box-shadow: 0 0 0 1.5px var(--card); }
</style>
