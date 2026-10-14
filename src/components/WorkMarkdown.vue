<script setup>
import { computed } from "vue";
const props = defineProps({ text: String, render: Function });
// 只有这一条的正文变化时才重新解析 Markdown。
const html = computed(() => props.render(props.text));
</script>
<template><div v-html="html" /></template>
