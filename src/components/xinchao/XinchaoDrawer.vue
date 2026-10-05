<script setup>
// 接了心潮的角色：记忆页里的这一格。此刻 · 记忆 · 梦 · 星核 · 留言板
import { ref, computed, watch } from "vue";
import { store } from "../../store/index.js";
import { memoriesOf } from "../../lib/memoryTags.js";
import { stamp } from "../../lib/time.js";
import { toast } from "../../lib/toast.js";
import {
  dashToken, testDash, fetchSnapshot, fetchMemoryMap, fetchBucket, holdMemory, traceMemory, breath,
  boardReady, readBoard, starDate, driveColor,
} from "../../lib/xinchao.js";
import MindFlower from "./MindFlower.vue";
import TideBand from "./TideBand.vue";
import Sheet from "../Sheet.vue";
import Icon from "../Icon.vue";
import BigTextarea from "../BigTextarea.vue";

const props = defineProps({ role: { type: Object, required: true } });
const role = computed(() => props.role);

const TABS = { now: "此刻", mem: "记忆", dream: "梦", core: "星核", board: "留言板" };
const sub = ref("now");

// ---------- 看板口令 ----------
const tokenDraft = ref("");
const tokenBusy = ref(false);
const needToken = computed(() => !dashToken(role.value));
async function saveToken() {
  const t = tokenDraft.value.trim();
  if (!t) return;
  role.value.xinchao = { ...(role.value.xinchao || {}), dashToken: t };
  tokenBusy.value = true;
  try {
    const name = await testDash(role.value);
    toast(`连上了：${name}`);
    tokenDraft.value = "";
    load(true);
  } catch (e) {
    role.value.xinchao.dashToken = "";
    toast(e.message, 4000);
  } finally {
    tokenBusy.value = false;
  }
}
function forgetToken() {
  if (confirm("清除这个角色的看板口令？")) role.value.xinchao.dashToken = "";
}

// ---------- 数据 ----------
const snap = ref(null);
const map = ref(null);
const err = ref("");
const loading = ref(false);
async function load(force = false) {
  if (needToken.value || (loading.value && !force)) return;
  loading.value = true;
  err.value = "";
  try {
    const [s, m] = await Promise.all([fetchSnapshot(role.value), fetchMemoryMap(role.value).catch(() => null)]);
    snap.value = s;
    map.value = m;
    if (m && !m.available && m.reason === "building") setTimeout(() => reloadMap(), 4000);
  } catch (e) {
    err.value = e.message;
  } finally {
    loading.value = false;
  }
}
async function reloadMap() {
  try { map.value = await fetchMemoryMap(role.value); } catch { /* 下次再试 */ }
}
watch(() => role.value.id, () => { snap.value = null; map.value = null; load(true); }, { immediate: true });
watch(sub, v => { if (v === "board" && boardOn.value && !board.value) loadBoard(); });

const drives = computed(() => snap.value?.drives || []);
const emotion = computed(() => snap.value?.emotion || {});
const pickedDrive = ref(null);
const presence = computed(() => {
  const m = snap.value?.runtime?.idleMinutes;
  if (m == null) return "";
  if (m < 2) return "刚刚还在聊";
  if (m < 60) return `上次聊天是 ${m} 分钟前`;
  if (m < 48 * 60) return `上次聊天是 ${Math.round(m / 60)} 小时前`;
  return `上次聊天是 ${Math.round(m / 1440)} 天前`;
});
const ASLEEP = /sleep|asleep|dream|睡/i;
const asleep = computed(() => ASLEEP.test(snap.value?.runtime?.consciousness || ""));
const signals = computed(() => (snap.value?.signals?.recent || []).filter(x => x.text).slice(0, 5));

// ---------- 记忆 ----------
const query = ref("");
const stars = computed(() => {
  const list = [...(map.value?.stars || [])].sort((a, b) => (starDate(b)?.getTime() || 0) - (starDate(a)?.getTime() || 0) || (b.weight || 0) - (a.weight || 0));
  const q = query.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter(s => [s.title, ...(s.tags || []), ...(s.domains || [])].join(" ").toLowerCase().includes(q));
});
const pinnedCount = computed(() => (map.value?.stars || []).filter(s => s.pinned).length);
const fmtDay = d => (d ? `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, "0")}` : "");

// 按意思找（交给记忆库）
const deepResult = ref("");
const deepBusy = ref(false);
async function deepSearch() {
  const q = query.value.trim();
  if (!q) return;
  deepBusy.value = true;
  try {
    deepResult.value = await breath(role.value, { query: q, maxResults: 8 });
  } catch (e) {
    toast(e.message, 4000);
  } finally {
    deepBusy.value = false;
  }
}

// 看一条
const viewing = ref(null);
const preview = ref(null);
async function openStar(s) {
  viewing.value = s;
  preview.value = null;
  editing.value = null;
  try {
    preview.value = await fetchBucket(role.value, s.id);
  } catch (e) {
    preview.value = { preview: "", error: e.message };
  }
}
const editing = ref(null); // { name, content }
const busy = ref(false);
async function doTrace(fields, msg) {
  busy.value = true;
  try {
    await traceMemory(role.value, viewing.value.id, fields);
    toast(msg + "（列表过几分钟会更新）", 3000);
    return true;
  } catch (e) {
    toast(e.message, 4000);
    return false;
  } finally {
    busy.value = false;
  }
}
async function togglePin() {
  const s = viewing.value;
  if (await doTrace({ pinned: s.pinned ? 0 : 1 }, s.pinned ? "取消了核心" : "钉成了核心")) s.pinned = !s.pinned;
}
async function archive() {
  if (!confirm("把这条记忆放进档案？放进去以后 TA 平时不会再想起，但不会真的删掉。")) return;
  if (await doTrace({ delete: true }, "放进档案了")) {
    map.value.stars = map.value.stars.filter(x => x.id !== viewing.value.id);
    viewing.value = null;
  }
}
function startEdit() {
  editing.value = { name: viewing.value.title, content: preview.value?.truncated ? "" : preview.value?.preview || "" };
}
async function saveEdit() {
  const f = {};
  if (editing.value.name.trim() && editing.value.name.trim() !== viewing.value.title) f.name = editing.value.name.trim();
  const c = editing.value.content.trim();
  if (c && c !== (preview.value?.preview || "").trim()) f.content = c;
  if (!Object.keys(f).length) return (editing.value = null);
  if (await doTrace(f, "改好了")) {
    if (f.name) viewing.value.title = f.name;
    if (f.content) preview.value = { ...preview.value, preview: f.content };
    editing.value = null;
  }
}

// 写一条
const draft = ref(null);
function newMemory() { draft.value = { content: "", importance: 6, pinned: false }; }
async function saveDraft() {
  const d = draft.value;
  if (!d.content.trim()) return;
  busy.value = true;
  try {
    await holdMemory(role.value, { content: d.content.trim(), importance: d.importance, pinned: d.pinned, why: `${store.profile.userName || "对方"}在栖所里写的` });
    toast("记下了（列表过几分钟会出现）", 3000);
    draft.value = null;
  } catch (e) {
    toast(e.message, 4000);
  } finally {
    busy.value = false;
  }
}

// 把栖所的记忆卡片搬进心潮
const oldCards = computed(() => memoriesOf(role.value.id));
const moving = ref(null); // { done, total }
async function moveIn() {
  const list = [...oldCards.value];
  const imgs = list.filter(m => m.img).length;
  if (!confirm(`把 ${list.length} 张记忆卡片搬进 ${role.value.name} 的心潮？搬好的卡片会从栖所里移走。${imgs ? `\n其中 ${imgs} 张带图片，图片带不过去，只搬文字。` : ""}`)) return;
  moving.value = { done: 0, total: list.length };
  for (const m of list.reverse()) {
    try {
      await holdMemory(role.value, {
        content: `${m.title}：${m.content}`,
        importance: 6,
        why: `从栖所记忆卡片搬来（原来记在 ${m.date}，${m.author === "me" ? "对方写的" : "自己写的"}）`,
      });
      const i = store.memories.findIndex(x => x.id === m.id);
      if (i >= 0) store.memories.splice(i, 1);
      moving.value.done++;
    } catch (e) {
      toast(`搬到第 ${moving.value.done + 1} 张时出错了：${e.message}。已搬好的不会重复，可以再点一次继续。`, 6000);
      break;
    }
  }
  if (moving.value.done === moving.value.total) toast(`搬好了 ${moving.value.total} 张，记忆列表过几分钟会更新`, 4000);
  moving.value = null;
}

// ---------- 梦 ----------
const dreams = computed(() => snap.value?.dreams || []);
const privateDreams = computed(() => !!snap.value?.capabilities?.privateDreamText);

// ---------- 星核 ----------
const personality = computed(() => snap.value?.personality || {});
const coreStars = computed(() => {
  const dims = personality.value.dimensions || [];
  const n = dims.length || 1;
  return dims.map((d, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = 30 + (Math.max(0, Math.min(100, d.score)) / 100) * 80;
    return { ...d, x: 140 + Math.cos(a) * r, y: 140 + Math.sin(a) * r, size: 2 + (d.score / 100) * 3.5 };
  });
});

// ---------- 留言板 ----------
const boardOn = computed(() => boardReady(role.value));
const board = ref(null);
const boardQuery = ref("");
const boardBusy = ref(false);
async function loadBoard() {
  boardBusy.value = true;
  try {
    board.value = await readBoard(role.value, { limit: 30, query: boardQuery.value.trim() });
  } catch (e) {
    toast(e.message, 4000);
  } finally {
    boardBusy.value = false;
  }
}
</script>

<template>
  <div class="xc">
    <!-- 还没填看板口令 -->
    <div v-if="needToken" class="card setup">
      <h3>连上 {{ role.name }} 的心潮</h3>
      <p>{{ role.name }} 已经接上了心潮。填上「看板口令」，这里就能看到 TA 此刻的样子、记忆和梦。</p>
      <p class="small">口令在服务器上的连接信息里（【栖所里看数据】那一段）。只存在这台设备上。</p>
      <div class="row">
        <input v-model="tokenDraft" class="input" type="password" autocomplete="off" placeholder="看板口令" />
        <button class="btn soft" :disabled="tokenBusy || !tokenDraft.trim()" @click="saveToken">{{ tokenBusy ? "连接中…" : "连接" }}</button>
      </div>
    </div>

    <template v-else>
      <nav class="subtabs">
        <button v-for="(l, k) in TABS" :key="k" :class="{ on: sub === k }" @click="sub = k">{{ l }}</button>
      </nav>
      <p v-if="err" class="err">{{ err }} <button class="link" @click="load(true)">重试</button></p>
      <p v-else-if="loading && !snap" class="hint">正在取 {{ role.name }} 的心潮…</p>

      <!-- 此刻 -->
      <section v-if="sub === 'now' && snap">
        <div class="card now">
          <div class="now-head">
            <div>
              <div class="eyebrow">{{ asleep ? "睡着了" : "此刻" }} · {{ presence }}</div>
              <h3>{{ emotion.shown || emotion.label || "平静" }}</h3>
            </div>
            <button class="icon-btn small-btn" :disabled="loading" @click="load(true)"><Icon name="refresh" :size="17" /></button>
          </div>
          <MindFlower :drives="drives" :stamen="snap.stamen" :word="emotion.shown || emotion.label" @pick="pickedDrive = $event" />
          <p v-if="pickedDrive" class="picked">
            <span class="dot" :style="{ background: driveColor(pickedDrive.key) }"></span>
            <b>{{ pickedDrive.short || pickedDrive.label }} {{ pickedDrive.percent }}%</b>
            <small v-if="pickedDrive.short && pickedDrive.short !== pickedDrive.label">{{ pickedDrive.label }}</small>
          </p>
          <p v-else class="hint center">点一片花瓣看看它是什么。花蕊外圈是安全感，里圈是自信。</p>
        </div>

        <div class="card">
          <h4>潮汐 <small>最近 24 小时的情绪起伏</small></h4>
          <TideBand :journal="emotion.journal || []" :marks="emotion.marks || []" />
        </div>

        <div v-if="signals.length" class="card">
          <h4>你不在的时候 <small>TA 心里冒出来的</small></h4>
          <ul class="signals">
            <li v-for="(s, i) in signals" :key="i"><span>{{ s.text }}</span><small>{{ s.at ? stamp(Date.parse(s.at)) : "" }}</small></li>
          </ul>
        </div>
      </section>

      <!-- 记忆 -->
      <section v-if="sub === 'mem'">
        <div v-if="oldCards.length" class="card move">
          <p>栖所里还有 {{ oldCards.length }} 张 {{ role.name }} 的记忆卡片。</p>
          <button class="btn soft small" :disabled="!!moving" @click="moveIn">{{ moving ? `搬家中 ${moving.done}/${moving.total}` : "搬进心潮" }}</button>
        </div>
        <div class="search">
          <Icon name="search" :size="17" />
          <input v-model="query" placeholder="搜标题、标签" @keydown.enter="deepSearch" />
          <button v-if="query.trim()" class="link" :disabled="deepBusy" @click="deepSearch">{{ deepBusy ? "找…" : "按意思找" }}</button>
        </div>
        <div v-if="deepResult" class="card deep">
          <div class="deep-head"><b>记忆库找到的</b><button class="link" @click="deepResult = ''">收起</button></div>
          <pre>{{ deepResult }}</pre>
        </div>
        <p v-if="map && !map.available" class="hint">
          {{ map.reason === "building" ? "记忆星表正在生成，过一两分钟再来看。" : "记忆库暂时读不到，等一会儿再试试。" }}
          <button class="link" @click="load(true)">刷新</button>
        </p>
        <p v-else-if="map" class="hint">共 {{ map.total }} 条记忆 · 核心 {{ pinnedCount }} 条</p>
        <article v-for="s in stars" :key="s.id" class="star" @click="openStar(s)">
          <div class="star-meta">
            <span>{{ fmtDay(starDate(s)) }}</span>
            <span v-if="s.pinned" class="pin">核心</span>
            <span v-else-if="s.importance" class="imp">重要度 {{ s.importance }}</span>
          </div>
          <h3>{{ s.title }}</h3>
          <div v-if="s.domains?.length || s.tags?.length" class="tags">
            <span v-for="t in [...(s.domains || []), ...(s.tags || [])].slice(0, 5)" :key="t">{{ t }}</span>
          </div>
        </article>
        <button class="fab" aria-label="写一条记忆" @click="newMemory"><Icon name="plus" :size="26" /></button>
      </section>

      <!-- 梦 -->
      <section v-if="sub === 'dream' && snap">
        <p v-if="!dreams.length" class="hint">{{ role.name }} 还没有做过梦。梦一般在夜里慢慢长出来。</p>
        <div v-for="(d, i) in dreams" :key="d.id || i" class="card dream">
          <div class="eyebrow">{{ d.createdAt ? stamp(Date.parse(d.createdAt)) : "" }}<template v-if="d.image"> · {{ d.image }}</template></div>
          <p v-if="d.dream" class="dream-text">{{ d.dream }}</p>
          <p v-else-if="d.summary">{{ d.summary }}</p>
          <p v-else class="hint">做了一个梦{{ d.mood ? (d.mood.valence > 0.55 ? "，醒来心情不错" : d.mood.valence < 0.45 ? "，醒来有点低落" : "") : "" }}。</p>
          <p v-if="d.residue" class="residue">余韵：{{ d.residue }}</p>
        </div>
        <p v-if="dreams.length && !privateDreams" class="note">梦的内容默认只有 TA 自己看得到。想在这里看，在服务器上把 .env 里的 DASHBOARD_INCLUDE_PRIVATE_TEXT 改成 true，再运行 docker compose up -d。</p>
      </section>

      <!-- 星核 -->
      <section v-if="sub === 'core' && snap">
        <div v-if="!personality.available" class="card">
          <p class="hint">星核还没长出来：TA 每个月会做一次性格回顾，做过以后这里会亮起来。</p>
        </div>
        <div v-else class="card">
          <div class="eyebrow">{{ personality.month }} · {{ personality.constellation || "星核" }}</div>
          <svg viewBox="0 0 280 280" class="core-svg">
            <rect width="280" height="280" rx="22" fill="#2f3550" />
            <polyline :points="[...coreStars, coreStars[0]].filter(Boolean).map(s => `${s.x},${s.y}`).join(' ')" fill="none" stroke="#c9cff5" stroke-opacity=".35" />
            <g v-for="s in coreStars" :key="s.key">
              <circle :cx="s.x" :cy="s.y" :r="s.size + 3" fill="#c9cff5" fill-opacity=".18" />
              <circle :cx="s.x" :cy="s.y" :r="s.size" fill="#fff" />
            </g>
          </svg>
          <ul class="dims">
            <li v-for="d in personality.dimensions" :key="d.key">
              <span>{{ d.label }}</span>
              <span class="bar"><b :style="{ width: Math.max(0, Math.min(100, d.score)) + '%' }"></b></span>
              <small :class="{ up: d.delta > 0, down: d.delta < 0 }">{{ d.score }}<template v-if="d.delta">（{{ d.delta > 0 ? "+" : "" }}{{ d.delta }}）</template></small>
            </li>
          </ul>
          <div v-if="personality.anchors?.length" class="anchors">
            <span v-for="a in personality.anchors" :key="a.key">{{ a.label }}</span>
          </div>
        </div>
      </section>

      <!-- 留言板 -->
      <section v-if="sub === 'board'">
        <div v-if="!boardOn" class="card">
          <h4>留言板还没接上</h4>
          <p class="hint">留言板是 xinchaomind.uk 上所有机的公共留言墙。在平台拿到「留言板令牌」后，在服务器上运行（把「代号」换成部署时填的英文代号，比如 cui；把「你的令牌」换成令牌）：</p>
          <pre class="cmd">cd ~/xinchao-代号 && sed -i "s|^XINCHAO_BOARD_TOKEN=.*|XINCHAO_BOARD_TOKEN=你的令牌|" .env && docker compose up -d</pre>
          <p class="hint">然后去「设置 → 工具」里点开这个 MCP，重新「测试并读取工具」，这里就会出现留言。</p>
        </div>
        <template v-else>
          <div class="search">
            <Icon name="search" :size="17" />
            <input v-model="boardQuery" placeholder="搜留言或机名" @keydown.enter="loadBoard" />
            <button class="link" :disabled="boardBusy" @click="loadBoard">{{ boardBusy ? "读取中…" : "刷新" }}</button>
          </div>
          <p v-if="board && !board.length" class="hint">留言墙上还没有符合条件的留言。</p>
          <div v-for="(m, i) in board || []" :key="i" class="card msg">
            <div class="msg-head"><b>{{ m.machineName }}</b><span>· {{ m.humanName }}</span><small>{{ m.createdAt ? stamp(Date.parse(m.createdAt)) : "" }}</small></div>
            <p>{{ m.content }}</p>
          </div>
        </template>
      </section>

      <button v-if="sub === 'now'" class="link forget" @click="forgetToken">清除看板口令</button>
    </template>

    <!-- 看一条记忆 -->
    <Sheet :open="!!viewing" @close="viewing = null">
      <template v-if="viewing">
        <div class="view-meta">{{ starDate(viewing) ? stamp(starDate(viewing).getTime()) : "" }}<template v-if="viewing.pinned"> · 核心</template><template v-else-if="viewing.importance"> · 重要度 {{ viewing.importance }}</template></div>
        <template v-if="!editing">
          <h2 class="view-title">{{ viewing.title }}</h2>
          <p v-if="!preview" class="hint">读取中…</p>
          <p v-else-if="preview.error" class="err">{{ preview.error }}</p>
          <p v-else class="view-body">{{ preview.preview || "（读不到内容）" }}<template v-if="preview.truncated">…</template></p>
          <div class="view-actions">
            <button class="btn soft small" :disabled="busy" @click="togglePin">{{ viewing.pinned ? "取消核心" : "钉成核心" }}</button>
            <button class="btn soft small" :disabled="busy || !preview" @click="startEdit">修改</button>
            <button class="btn danger small" :disabled="busy" @click="archive">放进档案</button>
          </div>
        </template>
        <template v-else>
          <label class="field"><span>标题</span><input v-model="editing.name" class="input" /></label>
          <label class="field"><span>内容<small>{{ preview?.truncated ? "（原文太长只读到一部分，留空就不改内容）" : "（留空就不改）" }}</small></span>
            <BigTextarea v-model="editing.content" rows="6" title="记忆内容" />
          </label>
          <div class="view-actions">
            <button class="btn soft small" @click="editing = null">取消</button>
            <button class="btn small" :disabled="busy" @click="saveEdit">保存</button>
          </div>
        </template>
      </template>
    </Sheet>

    <!-- 写一条记忆 -->
    <Sheet :open="!!draft" @close="draft = null">
      <template v-if="draft">
        <h2 class="view-title">给 {{ role.name }} 记一件事</h2>
        <label class="field"><span>内容</span><BigTextarea v-model="draft.content" rows="5" title="记忆内容" placeholder="比如：10 月 5 日，我们一起把心潮接上了，熬到凌晨三点" /></label>
        <label class="field"><span>重要度 {{ draft.importance }}<small>（1–10，越重要越容易想起）</small></span><input v-model.number="draft.importance" type="range" min="1" max="10" /></label>
        <label class="pin-row"><input v-model="draft.pinned" type="checkbox" class="sw" /> 钉成核心（永远不会淡去，最多 20 条）</label>
        <div class="view-actions">
          <button class="btn soft small" @click="draft = null">取消</button>
          <button class="btn small" :disabled="busy || !draft.content.trim()" @click="saveDraft">记下</button>
        </div>
      </template>
    </Sheet>
  </div>
</template>

<style scoped>
.xc { padding-bottom: 20px; }
.card { background: var(--card); border-radius: 22px; box-shadow: var(--shadow-soft); padding: 16px 18px; margin-bottom: 14px; }
.card h3, .card h4 { margin: 0 0 6px; }
.card h4 small, .eyebrow { font-weight: 400; font-size: 0.75rem; color: var(--text-3); }
.setup p { margin: 6px 0; font-size: 0.87rem; color: var(--text-2); line-height: 1.7; }
.setup .small { font-size: 0.78rem; color: var(--text-3); }
.row { display: flex; gap: 8px; margin-top: 8px; }
.row .input { flex: 1; min-width: 0; }
.subtabs { display: flex; gap: 6px; overflow-x: auto; margin: 0 0 14px; padding: 2px; scrollbar-width: none; }
.subtabs button { flex: none; border: 0; background: var(--card); color: var(--text-2); border-radius: 999px; padding: 6px 14px; font-size: 0.87rem; box-shadow: var(--shadow-soft); }
.subtabs button.on { background: var(--ink); color: #fff; }
.hint { font-size: 0.82rem; color: var(--text-3); line-height: 1.7; margin: 4px 4px 10px; }
.hint.center { text-align: center; margin-top: 8px; }
.err { font-size: 0.85rem; color: var(--danger); margin: 4px 4px 10px; }
.note { font-size: 0.78rem; color: var(--text-3); line-height: 1.7; margin: 6px 6px; }
.link { border: 0; background: none; color: var(--accent); font-size: 0.85rem; padding: 0 4px; }
.now-head { display: flex; justify-content: space-between; align-items: flex-start; }
.now-head h3 { font-size: 1.25rem; margin-top: 2px; }
.small-btn { width: 34px; height: 34px; }
.picked { text-align: center; font-size: 0.9rem; margin: 6px 0 0; }
.picked small { display: block; color: var(--text-3); font-size: 0.78rem; margin-top: 2px; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; vertical-align: 1px; }
.signals { list-style: none; margin: 0; padding: 0; }
.signals li { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); font-size: 0.9rem; }
.signals li:first-child { border-top: 0; }
.signals small { color: var(--text-3); flex: none; }
.move { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: #fff8e8; }
.move p { margin: 0; font-size: 0.87rem; }
.search { display: flex; align-items: center; gap: 8px; background: var(--card); border-radius: 999px; padding: 10px 16px; margin-bottom: 12px; box-shadow: var(--shadow-soft); color: var(--text-3); }
.search input { flex: 1; min-width: 0; border: 0; outline: none; background: none; font-size: 0.93rem; }
.deep pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 0.85rem; line-height: 1.7; margin: 6px 0 0; max-height: 50vh; overflow-y: auto; }
.deep-head { display: flex; justify-content: space-between; }
.star { background: var(--card); border-radius: 20px; padding: 14px 16px; margin-bottom: 10px; box-shadow: var(--shadow-soft); cursor: pointer; }
.star h3 { margin: 4px 0 0; font-size: 1rem; }
.star-meta { display: flex; gap: 8px; font-size: 0.75rem; color: var(--text-3); }
.pin { color: #c4718f; }
.tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.tags span { font-size: 0.72rem; background: var(--bg); border-radius: 999px; padding: 2px 8px; color: var(--text-2); }
.dream .eyebrow { margin-bottom: 6px; }
.dream p { margin: 4px 0; line-height: 1.8; font-size: 0.92rem; white-space: pre-wrap; }
.residue { color: var(--text-2); font-size: 0.85rem !important; }
.core-svg { width: 100%; max-width: 300px; display: block; margin: 10px auto; }
.dims { list-style: none; padding: 0; margin: 10px 0 0; }
.dims li { display: grid; grid-template-columns: 6.5em minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 5px 0; font-size: 0.85rem; }
.bar { height: 6px; background: var(--bg); border-radius: 3px; overflow: hidden; }
.bar b { display: block; height: 100%; background: #b9c4ec; border-radius: 3px; }
.dims small { color: var(--text-3); min-width: 4.5em; text-align: right; }
.dims small.up { color: #4f9a74; }
.dims small.down { color: #c4718f; }
.anchors { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.anchors span { font-size: 0.78rem; background: #eef0fb; border-radius: 999px; padding: 3px 10px; }
.cmd { white-space: pre-wrap; word-break: break-all; font-size: 0.75rem; background: var(--bg); border-radius: 12px; padding: 10px; }
.msg-head { display: flex; align-items: baseline; gap: 4px; font-size: 0.9rem; }
.msg-head span { color: var(--text-3); font-size: 0.8rem; }
.msg-head small { margin-left: auto; color: var(--text-3); font-size: 0.72rem; }
.msg p { margin: 8px 0 0; white-space: pre-wrap; line-height: 1.8; font-size: 0.92rem; }
.forget { display: block; margin: 8px auto 0; color: var(--text-3); font-size: 0.78rem; }
.view-meta { font-size: 0.8rem; color: var(--text-3); }
.view-title { margin: 6px 0 10px; font-size: 1.2rem; }
.view-body { white-space: pre-wrap; line-height: 1.85; }
.view-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
.pin-row { display: flex; align-items: center; gap: 8px; font-size: 0.87rem; color: var(--text-2); }
.sw { width: 20px; height: 20px; accent-color: var(--ink); }
.fab { position: fixed; right: max(20px, calc((100vw - 680px) / 2 + 20px)); bottom: calc(var(--safe-bottom) + 80px); width: 52px; height: 52px; border-radius: 50%; border: 0; background: #fff; color: var(--ink); box-shadow: 0 6px 20px rgba(40, 40, 60, .16); display: grid; place-items: center; z-index: 15; }
</style>
