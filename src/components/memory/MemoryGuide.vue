<script setup>
// 记忆库的说明书
import Sheet from "../Sheet.vue";
defineProps({ open: Boolean, him: String });
defineEmits(["close"]);
</script>

<template>
  <Sheet :open="open" title="记忆库说明书" @close="$emit('close')">
    <div class="guide">
      <p>发给{{ him }}的记忆分两种。每一种都能在这里看到、改错；每一处都有「看看发给{{ him }}的」，能看到原样发过去的全部内容。</p>

      <h4>① 全局记忆：在哪都带着</h4>
      <ul>
        <li><b>记忆卡片</b>：{{ him }}自己写的，或者你写的。</li>
        <li><b>聊天摘要</b>：聊久了，前面的聊天会整理成一份摘要。一直只有一份：每次整理都是把旧摘要和新聊的合在一起，整理成新的。在小世界里可以随时看、改、点「现在整理」。换到新对话时，摘要会跟着过去。</li>
        <li><b>从共读、共写整理来的</b>：读书笔记、写书的总结。在全局记忆里它们排在记忆卡片后面，分开标好。</li>
      </ul>
      <p class="sub">平时聊天的顺序：说话方式 → 各种规矩 → 全局记忆（记忆卡片 → 读书笔记 → 写书总结）→ 摘要记忆 → 最近的聊天 → 【此刻】（时间、心境、新来信、在读什么）→ 你的新消息。</p>

      <h4>② 场景记忆：只在那个地方才带</h4>
      <ul>
        <li><b>共读</b>：这本书读到这里的印象（前情）→ 最近的划线和批注 → 这本书的读书笔记 → 其他也在读的书（一句话，免得弄混）→ 然后才是全局记忆 → 最后是这次的原文。</li>
        <li><b>共写</b>：定位、简介、资料（按你排的顺序）→ 他记着的这本书 → 最近 16 句讨论 → 其他在写的书（一句话）→ 然后才是全局记忆。</li>
      </ul>
      <p class="sub">进到共读、共写里，场景记忆排在全局记忆前面；全局记忆里和这个场景有关的那部分不重复放。</p>

      <h4>③ 信箱</h4>
      <p class="sub">你写的信只在{{ him }}下一次聊天时附给他读一遍，之后就不再带了。想让他一直记得，可以让他记进记忆卡片。</p>

      <h4>④ 用的模型</h4>
      <p class="sub">整理类的活（聊天摘要、共读的前情、共写的总结）用「设置 → API」里的「整理用的模型」，可以选便宜的。{{ him }}说的话、划线批注、记忆卡片，还是用{{ him }}自己的模型。</p>
    </div>
  </Sheet>
</template>

<style scoped>
.guide { font-size: .88rem; line-height: 1.8; color: var(--text); }
.guide p { margin: 0 0 10px; }
.guide h4 { margin: 16px 0 6px; font-size: .92rem; }
.guide ul { margin: 0 0 8px; padding-left: 1.2em; }
.guide li { margin-bottom: 4px; }
.sub { color: var(--text-2); font-size: .82rem; }
</style>
