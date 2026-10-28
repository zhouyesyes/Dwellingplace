<script setup>
// 群聊页：就是聊天页（ChatView）的群聊模式。单独一个组件，从群聊跳到别的聊天时页面会重新开，不会串
import ChatView from "./ChatView.vue";
</script>

<template>
  <ChatView group />
</template>
