<script setup>
// TXT 的分章预览：编码、分章规则、写开头重分、合并 / 拆开；放上书架和「重新导入并覆盖」共用
// 确认时把 { encoding, rule, edits } 交给上面的人去导入
import { ref, computed } from "vue";
import { txtLines } from "../../lib/books.js";
import { SPLIT_RULES, splitLines } from "../../lib/chapterSplit.js";
import { toast } from "../../lib/toast.js";
import { decodeTxt, analyzeTxt, TXT_ENCODINGS, encodingLabel } from "../../lib/txtEncoding.js";

const props = defineProps({
  file: Object, bytes: Object, busy: Boolean, force: Boolean,
  title: { type: String, default: "放上书架前看一眼" },
  confirmText: { type: String, default: "确认导入" },
  busyText: { type: String, default: "在放…" },
});
const emit = defineEmits(["cancel", "confirm"]);

const analysis = analyzeTxt(props.bytes);
const txt = ref({ detected: analysis.encoding, pick: props.force || analysis.needsPreview });
const encoding = ref(analysis.encoding);
const rule = ref('auto');
const decoded = computed(() => decodeTxt(props.bytes, encoding.value));
const prefix = ref('');
const edits = ref({ add: [], del: [] });
const opened = ref(-1); // 展开着看内容、挑从哪一行拆开的那一章
const lines = computed(() => decoded.value?.usable ? txtLines(decoded.value.text) : []);
const preview = computed(() => splitLines(lines.value, rule.value, undefined, edits.value).map(c => ({ ...c, n: c.lines.length, heads: c.heads || (c.head >= 0 ? [c.head] : []) })));
function setRule(k) { rule.value = k; edits.value = { add: [], del: [] }; opened.value = -1; }
function applyPrefix() {
  const pre = prefix.value.trim();
  if (!pre) return toast('先写一个章节开头，比如 ☆、');
  setRule('custom:' + pre);
  if (preview.value.length < 2) toast('这样没分出几章，看看开头是不是写对了', 3000);
}
function mergeNext(k) {
  const next = preview.value[k + 1];
  if (!next?.heads.length) return;
  const e = edits.value;
  edits.value = { add: e.add.filter(i => !next.heads.includes(i)), del: [...e.del, ...next.heads] };
  opened.value = -1;
}
function splitAt(i) {
  const e = edits.value;
  edits.value = { add: [...e.add, i], del: e.del.filter(x => x !== i) };
  opened.value = -1;
}
const edited = computed(() => edits.value.add.length + edits.value.del.length > 0);
function confirmTxt() {
  if (props.busy || !decoded.value.usable) return;
  emit("confirm", { encoding: encoding.value, rule: rule.value, edits: edited.value ? edits.value : null });
}
</script>

<template>
<div class="txt-shade" @click.self="!busy && emit('cancel')">
  <section class="txt-dialog" role="dialog" aria-modal="true" aria-labelledby="txt-title">
    <h2 id="txt-title">{{ title }}</h2>
    <p class="txt-name">{{ file.name }}</p>
    <template v-if="txt.pick">
      <label class="txt-encoding">编码
        <select v-model="encoding" :disabled="busy" aria-label="TXT 编码">
          <option v-for="e in TXT_ENCODINGS" :key="e" :value="e">{{ encodingLabel(e) }}</option>
        </select>
      </label>
      <small>自动识别：{{ encodingLabel(txt.detected) }}</small>
      <pre class="txt-preview">{{ decoded.text.slice(0, 700).replace(/\u0000/g, '␀') || '（正文为空）' }}</pre>
      <p v-if="decoded.suspicious" class="txt-warning" role="alert">正文可能有乱码，请核对预览或切换编码。</p>
      <p v-if="!decoded.usable" class="txt-warning">正文为空或损坏字符过多，请选择其他编码。</p>
    </template>
    <p v-else class="txt-enc-line">编码 {{ encodingLabel(encoding) }}（自动认出来的）<button :disabled="busy" @click="txt.pick = true">有乱码？换编码</button></p>
    <div v-if="decoded.usable" class="txt-chapters">
      <div class="txt-rules" role="group" aria-label="分章规则">
        <button v-for="(l, k) in SPLIT_RULES" :key="k" :class="{ on: rule === k }" :disabled="busy" @click="setRule(k)">{{ l }}</button>
      </div>
      <form class="txt-prefix" @submit.prevent="applyPrefix">
        <input v-model="prefix" maxlength="12" placeholder="自己写章节开头，比如 ☆、" aria-label="章节开头" />
        <button type="submit" :class="{ on: rule.startsWith('custom:') }" :disabled="busy">按这个分</button>
      </form>
      <small>认出了 {{ preview.length }} 章{{ preview.length === 1 ? "（没认出章节标题，可以换个规则、或者自己写开头）" : "" }}{{ edited ? "（手动改过）" : "" }}。分错了可以点「合并」或「拆开」</small>
      <ol class="txt-toc">
        <template v-for="(c, k) in preview.slice(0, 80)" :key="k">
          <li>
            <span>{{ c.title }}</span><small>{{ c.n }} 段<template v-if="c.noteLines?.length"> · 有作者便签</template></small>
            <button v-if="c.n > 1" :disabled="busy" @click="opened = opened === k ? -1 : k">{{ opened === k ? '收起' : '拆开' }}</button>
            <button v-if="preview[k + 1]?.heads.length" :disabled="busy" @click="mergeNext(k)">和下一章合并</button>
          </li>
          <li v-if="opened === k" class="txt-lines">
            <button v-for="i in c.lines.slice(1, 120)" :key="i" :disabled="busy" @click="splitAt(i)"><b>从这里拆开</b>{{ lines[i].slice(0, 40) }}</button>
          </li>
        </template>
        <li v-if="preview.length > 80" class="more">……还有 {{ preview.length - 80 }} 章</li>
      </ol>
      <button v-if="edited" class="txt-reset" :disabled="busy" @click="setRule(rule)">撤销手动改的</button>
    </div>
    <div class="txt-actions">
      <button :disabled="busy" @click="emit('cancel')">取消</button>
      <button :disabled="busy || !decoded.usable" @click="confirmTxt">{{ busy ? busyText : confirmText }}</button>
    </div>
  </section>
</div>
</template>

<style scoped>
.txt-shade { position: fixed; inset: 0; z-index: 100; background: #0006; display: flex; align-items: center; justify-content: center; padding: max(16px, var(--safe-top)) 16px max(16px, var(--safe-bottom)); }
.txt-dialog { width: 100%; max-width: 440px; max-height: 100%; overflow-y: auto; padding: 20px; border-radius: 20px; background: var(--card); color: var(--text); box-sizing: border-box; }
.txt-dialog h2 { margin: 0 0 10px; font-size: 1.15rem; }
.txt-name { overflow-wrap: anywhere; color: var(--text-2); }
.txt-encoding { display: flex; align-items: center; gap: 12px; }
.txt-encoding select { flex: 1; min-width: 0; min-height: 44px; font-size: 16px; background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
.txt-dialog small { display: block; margin-top: 8px; color: var(--text-2); }
.txt-preview { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: .9rem; line-height: 1.8; background: var(--bg); border-radius: 10px; padding: 12px; max-height: 32dvh; overflow-y: auto; }
.txt-warning { color: var(--text); font-size: .85rem; }
.txt-enc-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: .82rem; color: var(--text-2); margin: 6px 0 4px; }
.txt-enc-line button { flex: none; border: 0; background: none; color: var(--accent); font-size: .8rem; padding: 4px 0; }
.txt-chapters { margin: 12px 0 14px; }
.txt-rules { display: flex; flex-wrap: wrap; gap: 6px; }
.txt-rules button { border: 1px solid var(--line); background: var(--bg); color: var(--text-2); border-radius: 999px; padding: 5px 11px; font-size: .78rem; }
.txt-rules button.on { background: var(--ink); color: var(--on-ink); border-color: var(--ink); }
.txt-prefix { display: flex; gap: 6px; margin-top: 8px; }
.txt-prefix input { flex: 1; min-width: 0; min-height: 36px; font-size: 16px; background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 999px; padding: 0 14px; }
.txt-prefix button, .txt-reset { flex: none; border: 1px solid var(--line); background: var(--bg); color: var(--text-2); border-radius: 999px; padding: 5px 12px; font-size: .78rem; }
.txt-prefix button.on { background: var(--ink); color: var(--on-ink); border-color: var(--ink); }
.txt-reset { margin-top: 8px; }
.txt-toc li { flex-wrap: wrap; }
.txt-toc li > button { flex: none; border: 0; background: none; color: var(--accent); font-size: .74rem; padding: 2px 0; }
.txt-toc li.txt-lines { display: block; padding: 0; max-height: 22dvh; overflow-y: auto; background: var(--card); border-radius: 8px; }
.txt-toc li.txt-lines button { display: flex; gap: 8px; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line); background: none; padding: 7px 8px; font-size: .78rem; color: var(--text); line-height: 1.5; }
.txt-toc li.txt-lines button b { flex: none; color: var(--accent); font-weight: 500; font-size: .7rem; }
.txt-toc { list-style: none; margin: 8px 0 0; padding: 4px 12px; max-height: 30dvh; overflow-y: auto; background: var(--bg); border-radius: 10px; }
.txt-toc li { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: .85rem; }
.txt-toc li:last-child { border-bottom: 0; }
.txt-toc li span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.txt-toc li small { margin: 0; flex: none; font-size: .7rem; color: var(--text-3); }
.txt-toc li.more { color: var(--text-3); justify-content: center; }
.txt-actions { display: flex; gap: 12px; }
.txt-actions button { flex: 1; min-height: 44px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--text); }
.txt-actions button:last-child { background: var(--ink); color: var(--on-ink); }
.txt-actions button:disabled { opacity: .4; }
</style>
