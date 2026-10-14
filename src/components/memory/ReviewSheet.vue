<script setup>
// 他的整理建议：每隔两周他把记忆卡片从头看一遍，提出合并、改写、标过时、归档、常驻……你一条条采纳或跳过，采纳了也能撤回
import { ref, computed } from "vue";
import { reviewsOf, cardsFor, applyItem, undoItem, skipItem, applyAll, runReview, reviewEvery, OPS } from "../../lib/review.js";
import { describeError } from "../../lib/chat.js";
import { toast } from "../../lib/toast.js";
import Sheet from "../Sheet.vue";

const props = defineProps({ open: Boolean, role: Object });
const emit = defineEmits(["close", "view"]);
const list = computed(() => (props.role ? reviewsOf(props.role.id) : []));
const busy = ref(false);
async function runNow() {
  busy.value = true;
  try { const r = await runReview(props.role, { why: "manual" }); toast(r.items.length ? `${props.role.name}提了 ${r.items.length} 条建议` : `${props.role.name}看了一遍，觉得不用改`); }
  catch (e) { toast(describeError(e), 4000); } finally { busy.value = false; }
}
const when = ts => new Date(ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const ok = x => { const e = applyItem(props.role, x); if (e) toast(e, 3500); };
function okAll(r) { const errs = applyAll(props.role, r); toast(errs.length ? `有 ${errs.length} 条没做成：${errs[0]}` : "都照做了"); }
const pending = r => r.items.filter(x => x.state === "pending").length;
const STATE = { done: "已采纳", skipped: "跳过了" };
const showOld = ref(false);
</script>

<template>
  <Sheet :open="open" title="他的整理建议" @close="emit('close')">
    <div class="rv">
      <p class="lead">{{ role?.name }}每隔 {{ reviewEvery() || "—" }} 天把记忆卡片从头看一遍：合并重复的、改掉过时的、挑出要常驻的。都是建议，你同意了才算数；采纳了也能撤回。{{ reviewEvery() ? "" : "（现在关着自动整理，⚙ 里能开）" }}</p>
      <button class="btn" :disabled="busy" @click="runNow">{{ busy ? `${role?.name}在整理……` : `现在让${role?.name}整理一遍` }}</button>
      <p v-if="!list.length" class="dim">还没有整理过。</p>

      <template v-for="(r, ri) in list" :key="r.id">
        <section v-if="ri === 0 || showOld" class="round">
          <div class="rh"><b>{{ when(r.at) }}</b><span>{{ r.why === "manual" ? "你让他整理的" : "到时候自己整理的" }}{{ r.model ? ` · ${r.model}` : "" }}</span></div>
          <p v-if="r.note" class="note">{{ r.note }}</p>
          <button v-if="pending(r) > 1" class="btn soft small" @click="okAll(r)">剩下的 {{ pending(r) }} 条都照做</button>
          <article v-for="x in r.items" :key="x.id" class="it" :class="x.state">
            <div class="op"><span class="tag" :class="x.op">{{ OPS[x.op] }}</span><small v-if="STATE[x.state]">{{ STATE[x.state] }}</small></div>
            <button v-for="m in cardsFor(role.id, x.ids)" :key="m.id" class="card" @click="emit('view', m)"><b>{{ m.title }}</b><span>{{ m.content }}</span></button>
            <div v-if="x.op === 'merge' || x.op === 'edit' || x.op === 'add'" class="new"><small>{{ x.op === "add" ? "新的一张" : "改成" }}</small><b v-if="x.title">{{ x.title }}</b><span>{{ x.content }}</span></div>
            <p v-if="x.why" class="why">{{ x.why }}</p>
            <div class="acts">
              <template v-if="x.state === 'pending'"><button class="btn small" @click="ok(x)">采纳</button><button class="btn soft small" @click="skipItem(x)">跳过</button></template>
              <button v-else-if="x.state === 'done'" class="btn soft small" @click="undoItem(role, x)">撤回</button>
              <button v-else class="btn soft small" @click="x.state = 'pending'">再看看</button>
            </div>
          </article>
          <p v-if="!r.items.length" class="dim">这次没有要改的。</p>
        </section>
      </template>
      <button v-if="list.length > 1" class="btn soft small" @click="showOld = !showOld">{{ showOld ? "收起以前的" : `以前的 ${list.length - 1} 次` }}</button>
    </div>
  </Sheet>
</template>

<style scoped>
.rv { display: flex; flex-direction: column; gap: 10px; max-height: 78vh; overflow-y: auto; padding-bottom: 8px; }
.lead { margin: 0; font-size: .8rem; line-height: 1.7; color: var(--text-2); }
.dim { margin: 0; font-size: .76rem; color: var(--text-3); }
.round { display: flex; flex-direction: column; gap: 8px; padding-top: 6px; border-top: 1px solid var(--line); }
.rh { display: flex; justify-content: space-between; align-items: baseline; font-size: .8rem; }
.rh span { font-size: .72rem; color: var(--text-3); }
.note { margin: 0; background: color-mix(in srgb, #eef4fb var(--pastel), var(--card)); border-radius: 14px; padding: 10px 13px; font-size: .84rem; line-height: 1.7; white-space: pre-wrap; }
.it { background: var(--card); border-radius: 16px; padding: 10px 12px; box-shadow: var(--shadow-soft); display: flex; flex-direction: column; gap: 6px; }
.it.done, .it.skipped { opacity: .6; }
.op { display: flex; justify-content: space-between; align-items: center; }
.op small { font-size: .7rem; color: var(--text-3); }
.tag { font-size: .72rem; font-weight: 600; padding: 2px 9px; border-radius: 999px; background: var(--bg); color: var(--text-2); }
.tag.merge, .tag.edit { background: #e4eefa; color: #3c6a99; }
.tag.obsolete, .tag.drop { background: color-mix(in srgb, #fbe8ec var(--pastel), var(--card)); color: #a0455a; }
.tag.pin, .tag.confirm, .tag.add { background: #e3f3ec; color: #3d7a5a; }
.card { border: 0; text-align: left; background: var(--bg); border-radius: 10px; padding: 6px 10px; display: flex; flex-direction: column; gap: 1px; font-size: .78rem; color: var(--text-2); }
.card b { font-size: .8rem; color: var(--text); }
.card span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.new { border-left: 3px solid #9cc5a1; padding: 2px 0 2px 10px; display: flex; flex-direction: column; gap: 1px; font-size: .8rem; color: var(--text-2); }
.new small { font-size: .68rem; color: var(--text-3); }
.new b { color: var(--text); }
.why { margin: 0; font-size: .76rem; color: var(--text-3); line-height: 1.6; }
.acts { display: flex; gap: 8px; }
</style>
