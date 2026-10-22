<script setup>
// Meanwhile（同一屋檐下）：她、他、小螃蟹三个人共用的生活记录页。
// 浪花标题 → 潮汐表（日历）→ 今天的水温 → 潮间带（共同动态）。数据和规矩见 lib/meanwhile.js
// 住在底栏的 Record 页里（RecordView 引用），日记本之类的放进插槽 after-temp
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { store } from "../../store/index.js";
import { todayYmd } from "../../lib/dates.js";
import { pickFile, saveImage, deleteImage } from "../../lib/images.js";
import {
  ME, MOODS, REACTS, STATUSES, moodByKey, moodOf, whoList, whoInfo, ensureMeanwhile, postsOf, postsOn, plansOf, planItemsOn, occursOn, planItemOf, recurringPlans, planAlive, stopPlan, repeatLabel, emptyRepeatForm, repeatFormOf, repeatFromForm, updatePlan,
  setMood, clearMood, addPost, removePost, addReply, toggleReact, reactorsOf, addPlan, togglePlan, removePlan, markSeen, dayLabel, monthOf, stamp,
} from "../../lib/meanwhile.js";
import Icon from "../Icon.vue";
import Avatar from "../Avatar.vue";
import Sheet from "../Sheet.vue";
import ImageViewer from "../ImageViewer.vue";
import TideHero from "./TideHero.vue";
import MoodCard from "./MoodCard.vue";
import TideCalendar from "./TideCalendar.vue";
import RepeatPicker from "./RepeatPicker.vue";
import TideImg from "./TideImg.vue";
import ShellPrinter from "./ShellPrinter.vue";

ensureMeanwhile();
const today = ref(todayYmd());
const month = ref(monthOf(today.value));
const selected = ref(null); // 点了哪天（没点就是看全部）
const day = computed(() => selected.value || today.value);
const people = computed(() => whoList().map(whoInfo));

// 回到前台、过了零点：「今天」跟着换
let timer;
onMounted(() => { markSeen(); timer = setInterval(() => { const t = todayYmd(); if (t !== today.value) today.value = t; markSeen(); }, 30_000); });
onBeforeUnmount(() => clearInterval(timer));

function shift(n) {
  const [y, m] = month.value.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  month.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  selected.value = null;
}
const toToday = () => { month.value = monthOf(today.value); selected.value = null; };
function pick(date) {
  selected.value = selected.value === date ? null : date;
}

// ---------- 水温 ----------
const moods = computed(() => people.value.map(p => ({ ...p, m: moodOf(p.who, day.value) })).map(p => ({ ...p, mood: p.m && moodByKey(p.m.key) })));
const canSet = computed(() => day.value <= today.value);
const moodOpen = ref(false);
const moodKey = ref("");
const moodLine = ref("");
// 水温小卡：点任意一张卡、或日历格子里的水滴，弹出大图标 + 名字 + 心情 + 那句话
const card = ref(null);
function showCard(who, date, key, text) {
  const mood = moodByKey(key);
  if (mood) card.value = { who, date, mood, text: text || "" };
}
function tapSlot(p) {
  if (p.mood) showCard(p.who, day.value, p.m.key, p.m.text);
  else if (p.who === ME) openMood();
}
function editFromCard() { card.value = null; openMood(); }
function openMood() {
  if (!canSet.value) return;
  const cur = moodOf(ME, day.value);
  moodKey.value = cur?.key || "";
  moodLine.value = cur?.text || "";
  moodOpen.value = true;
}
function saveMood() {
  if (moodKey.value) setMood(ME, moodKey.value, moodLine.value, day.value);
  moodOpen.value = false;
}
function dropMood() { clearMood(ME, day.value); moodOpen.value = false; }

// ---------- 发一条 ----------
const composeOpen = ref(false);
const text = ref("");
const img = ref(null);
const stKind = ref("");
const stText = ref("");
const quickMood = ref("");
const busyImg = ref(false);
const latestBook = computed(() => [...(store.books || [])].sort((a, b) => (b.readAt || b.addedAt || 0) - (a.readAt || a.addedAt || 0))[0]);
function openCompose() { text.value = ""; img.value = null; stKind.value = ""; stText.value = ""; quickMood.value = ""; composeOpen.value = true; }
function pickStatus(kind) {
  if (stKind.value === kind) { stKind.value = ""; stText.value = ""; return; }
  stKind.value = kind;
  stText.value = kind === "read" && latestBook.value ? `《${latestBook.value.title}》` : "";
}
async function pickImg() {
  if (busyImg.value) return;
  const [file] = await pickFile("image/*");
  if (!file) return;
  busyImg.value = true;
  try { if (img.value) deleteImage(img.value); img.value = await saveImage(file, { maxSize: 1280, quality: 0.8 }); } finally { busyImg.value = false; }
}
function dropImg() { if (img.value) deleteImage(img.value); img.value = null; }
const canPost = computed(() => text.value.trim() || img.value || stKind.value);
function closeCompose() { if (img.value) deleteImage(img.value); img.value = null; composeOpen.value = false; } // 没贴就关了：图也不留
function post() {
  if (!canPost.value) return;
  addPost(ME, { text: text.value, img: img.value, status: stKind.value ? { kind: stKind.value, text: stText.value } : null });
  if (quickMood.value) setMood(ME, quickMood.value, moodOf(ME, today.value)?.key === quickMood.value ? moodOf(ME, today.value).text : "", today.value);
  img.value = null;
  composeOpen.value = false;
  selected.value = null;
}
function dropPost(p) {
  if (!confirm("把这条从潮间带拿下来？")) return;
  if (p.img) deleteImage(p.img);
  removePost(p);
}

// ---------- 动态 ----------
const LIMIT = 20;
const more = ref(0);
const feed = computed(() => {
  const all = selected.value ? postsOn(selected.value) : [...postsOf()].sort((a, b) => b.ts - a.ts);
  return all;
});
const shown = computed(() => feed.value.slice(0, LIMIT + more.value * LIMIT));
const tilt = p => ((p.n * 7) % 5 - 2) * 0.35; // 每张贴得有一点点歪，但不影响读
const statusName = k => STATUSES.find(s => s.kind === k)?.name || "";
const info = who => whoInfo(who);
const replying = ref(null);
const replyText = ref("");
function sendReply(p) {
  if (addReply(p, ME, replyText.value)) { replyText.value = ""; replying.value = null; }
}
const viewImgs = ref([]);
const viewAt = ref(null);
const openImg = p => { viewImgs.value = [p.img]; viewAt.value = 0; };
const poked = ref("");
function react(p, kind) {
  toggleReact(p, ME, kind);
  if (kind === "poke") { poked.value = p.id; setTimeout(() => { if (poked.value === p.id) poked.value = ""; }, 500); }
}

// ---------- 待续 ----------
const plansOpen = ref(false);
const planText = ref("");
const plans = computed(() => plansOf(month.value));
// 点了某一天看那天要做的；没点就只看今天要做的周期待续
const dayPlans = computed(() => (selected.value ? planItemsOn(selected.value) : planItemsOn(today.value).filter(i => i.label)));
// 还在继续的周期待续（每一串一行）；小圆圈勾的是「正在看的这一天」，那天不用做的就没有圈
const series = computed(() => recurringPlans().filter(p => planAlive(p, today.value)).map(p => ({ ...planItemOf(p, day.value), on: occursOn(p, day.value) })));
const newRep = ref(emptyRepeatForm());
// 新加：挂在这个月，或者挂在某一天
const planScope = ref("month");
const planDay = ref("");
function openPlans() {
  planScope.value = "month"; planDay.value = selected.value || (month.value === today.value.slice(0, 7) ? today.value : `${month.value}-01`);
  newRep.value = emptyRepeatForm(selected.value || today.value);
  plansOpen.value = true;
}
function savePlan() {
  const date = planScope.value === "day" && planDay.value ? planDay.value : null;
  const rep = repeatFromForm(newRep.value);
  if (newRep.value.type !== "none" && !rep) return alert("这个周期还没填完整（每周几至少选一天）");
  if (addPlan(ME, planText.value, month.value, date, rep)) { planText.value = ""; newRep.value = emptyRepeatForm(selected.value || today.value); }
}
function tickPlan(p, date) { togglePlan(p, ME, date); }
const monthName = computed(() => `${Number(month.value.slice(5))} 月`);
const md = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
// 点开一件待续：改文字、改日期（月和日之间可以换）、删掉
const editing = ref(null);
const edit = ref({ text: "", scope: "month", date: "", month: "" });
const editDate = ref(""); // 周期待续是从哪一天点进来的（「这次做完了」算哪天）
const editRep = ref(emptyRepeatForm());
function openEdit(p, date = "") {
  editing.value = p;
  editDate.value = p.repeat ? date : "";
  edit.value = { text: p.text, scope: p.date ? "day" : "month", date: p.date || `${p.month}-01`, month: p.month };
  editRep.value = repeatFormOf(p.repeat, p.date || today.value);
}
const editDone = computed(() => !!editing.value?.dones?.some(x => x.id === editDate.value));
const editStopped = computed(() => !!editing.value?.stoppedAt && editing.value.stoppedAt < today.value);
function saveEdit() {
  const e = edit.value;
  const rep = editRep.value.type === "none" ? null : repeatFromForm(editRep.value);
  if (editRep.value.type !== "none" && !rep) return alert("这个周期还没填完整（每周几至少选一天）");
  if (!updatePlan(editing.value, { text: e.text, date: e.scope === "day" ? e.date : null, month: e.month, repeat: rep })) return;
  editing.value = null;
}
// 在卡里点「做完了」：等于在待续清单里点前面的小圆圈（留一条「✓ 待续完成了」），然后关卡
function finishEdit() {
  if (!editing.value.doneAt) togglePlan(editing.value, ME);
  editing.value = null;
}
// 周期待续：「这次做完了」只算点进来的那一天；「整件停掉」之后的日子不再出现，勾过的留着
function finishOnce() { togglePlan(editing.value, ME, editDate.value); editing.value = null; }
function stopWhole() {
  if (!confirm("整件停掉？之后的日子不再出现，已经勾过的记录会留着。")) return;
  stopPlan(editing.value);
  editing.value = null;
}
function dropEdit() {
  if (!confirm("把这件待续拿掉？")) return;
  removePlan(editing.value);
  editing.value = null;
}
</script>

<template>
  <div class="mw">
    <TideHero />

    <TideCalendar :month="month" :selected="selected" @select="pick" @shift="shift" @today="toToday" @plans="openPlans" @mood="x => showCard(x.who, x.date, x.key, x.text)" />

    <!-- 拾贝（今日小报）：当天内容的最上面，没点日期是今天，点了哪天是哪天 -->
    <ShellPrinter :key="day" :date="day" />

    <!-- 水温：默认看今天，点了日历上的哪天就看哪天 -->
    <section class="temp">
      <div class="sec-head">
        <h2>{{ selected ? dayLabel(selected) : "今天的水温" }}</h2>
        <button v-if="selected" class="chip" @click="selected = null">看全部 ×</button>
      </div>
      <div class="slots">
        <button v-for="p in moods" :key="p.who" class="slot" :class="{ mine: p.who === ME, empty: !p.mood }" :disabled="!p.mood && (p.who !== ME || !canSet)" :style="{ '--c': p.color }" @click="tapSlot(p)">
          <span class="pic">
            <img v-if="p.mood" :src="p.mood.img" :alt="p.mood.name" draggable="false" />
            <span v-else class="ph">{{ p.who === ME && canSet ? "＋" : "…" }}</span>
          </span>
          <span class="who"><i />{{ p.name }}</span>
          <span class="say">{{ p.mood ? (p.m.text || p.mood.name) : p.who === ME && canSet ? "选一个水温" : "还没选" }}</span>
        </button>
      </div>
    </section>

    <!-- 点了某一天：挂在那天的待续 -->
    <section v-if="dayPlans.length" class="day-plans">
      <button v-for="p in dayPlans" :key="p.key" class="dp" :class="{ done: p.doneAt }" :style="{ '--c': info(p.who).color }" @click="openEdit(p.plan, p.date)">
        <span class="tag">待续</span><span class="t">{{ p.text }}</span><em v-if="p.label" class="cyc">{{ p.label }}</em><small>{{ info(p.who).name }}</small>
      </button>
    </section>

    <slot name="after-temp" :date="selected" />

    <!-- 潮间带：共同动态 -->
    <section class="tide">
      <div class="sec-head">
        <h2>潮间带</h2>
        <span class="cap">{{ selected ? "这一天贴的" : "三个人的便笺" }}</span>
      </div>
      <p v-if="!feed.length" class="empty">{{ selected ? "这天还没贴过东西" : "还没有东西，贴第一条吧" }}</p>
      <article v-for="p in shown" :key="p.id" class="card" :class="{ polaroid: p.img, plan: p.planId }" :style="{ '--c': info(p.who).color, '--t': tilt(p) + 'deg' }">
        <i class="tape" />
        <header>
          <Avatar :img="info(p.who).avatar" :name="info(p.who).name" :color="info(p.who).color" :size="30" class="ava" />
          <div class="meta"><b>{{ info(p.who).name }}</b><small>{{ stamp(p.ts) }}</small></div>
          <button v-if="p.who === ME" class="more" aria-label="删除" @click="dropPost(p)"><Icon name="trash" :size="15" /></button>
        </header>
        <button v-if="p.img" class="pic" @click="openImg(p)"><TideImg :id="p.img" /></button>
        <p v-if="p.status" class="st"><span>{{ statusName(p.status.kind) }}</span>{{ p.status.text }}</p>
        <p v-if="p.planId" class="done">✓ 待续完成了</p>
        <p v-if="p.text" class="body" :class="{ cap: p.img }">{{ p.text }}</p>
        <ul v-if="p.replies.length" class="replies">
          <li v-for="r in p.replies" :key="r.id"><b :style="{ color: `color-mix(in srgb, ${info(r.who).color} 70%, var(--text))` }">{{ info(r.who).name }}</b>{{ r.text }}</li>
        </ul>
        <footer>
          <button v-for="r in REACTS" :key="r.kind" class="rx" :class="{ on: reactorsOf(p, r.kind).includes(ME), pop: poked === p.id && r.kind === 'poke' }" :aria-label="r.name" @click="react(p, r.kind)">
            <span class="em">{{ r.emoji }}</span>
            <span v-if="reactorsOf(p, r.kind).length" class="who-dots"><i v-for="w in reactorsOf(p, r.kind)" :key="w" :style="{ background: info(w).color }" /></span>
            <span v-else class="nm">{{ r.name }}</span>
          </button>
          <button class="rx reply" @click="replying = replying === p.id ? null : p.id; replyText = ''">回一句</button>
        </footer>
        <form v-if="replying === p.id" class="reply-box" @submit.prevent="sendReply(p)">
          <input v-model="replyText" class="input" maxlength="300" placeholder="短短回一句…" enterkeyhint="send" />
          <button class="btn small" :disabled="!replyText.trim()">发</button>
        </form>
      </article>
      <button v-if="feed.length > shown.length" class="more-btn" @click="more++">再往前看看</button>
    </section>

    <slot name="end" />

    <button class="fab" aria-label="贴一条" @click="openCompose"><Icon name="plus" :size="24" /></button>

    <MoodCard :card="card" :me="ME" :can-edit="canSet" @close="card = null" @edit="editFromCard" />

    <!-- 选今天的水温 -->
    <Sheet :open="moodOpen" :title="selected && selected !== today ? `${dayLabel(selected)}的水温` : '今天的水温'" @close="moodOpen = false">
      <div class="mood-grid">
        <button v-for="m in MOODS" :key="m.key" class="mood" :class="{ on: moodKey === m.key }" @click="moodKey = m.key">
          <img :src="m.img" :alt="m.name" draggable="false" />
          <b>{{ m.name }}</b><small>{{ m.feel }}</small>
        </button>
      </div>
      <input v-model="moodLine" class="input" maxlength="30" placeholder="一句状态（可以不写）" />
      <div class="sheet-act">
        <button v-if="moodOf(ME, day)" class="btn soft" @click="dropMood">清掉</button>
        <button class="btn" :disabled="!moodKey" @click="saveMood">记下来</button>
      </div>
    </Sheet>

    <!-- 贴一条 -->
    <Sheet :open="composeOpen" title="贴一条" @close="closeCompose">
      <textarea v-model="text" class="input area" rows="3" maxlength="1000" placeholder="此刻想贴点什么…" />
      <div v-if="img" class="prev"><TideImg :id="img" /><button class="x" aria-label="去掉图片" @click="dropImg">×</button></div>
      <div class="row-chips">
        <button class="chip" :disabled="busyImg" @click="pickImg"><Icon name="image" :size="14" /> {{ busyImg ? "处理中…" : "图片" }}</button>
        <button v-for="s in STATUSES" :key="s.kind" class="chip" :class="{ on: stKind === s.kind }" @click="pickStatus(s.kind)">{{ s.name }}</button>
      </div>
      <input v-if="stKind" v-model="stText" class="input" maxlength="60" :placeholder="STATUSES.find(s => s.kind === stKind).hint" />
      <div class="quick">
        <span class="lab">顺便记今天的水温</span>
        <div class="q-row">
          <button v-for="m in MOODS" :key="m.key" class="q" :class="{ on: quickMood === m.key }" :aria-label="m.name" @click="quickMood = quickMood === m.key ? '' : m.key"><img :src="m.img" alt="" draggable="false" /></button>
        </div>
      </div>
      <div class="sheet-act"><button class="btn" :disabled="!canPost" @click="post">贴上去</button></div>
    </Sheet>

    <!-- 待续 -->
    <Sheet :open="plansOpen" :title="`${monthName}的待续`" @close="plansOpen = false">
      <p class="hint">接下来想做的事，可以挂在这个月，也可以挂在某一天。点一件可以改字、改日期、删掉；做完了点前面的圈，就会在当天留下一条记录，没做完也没关系。</p>
      <form class="plan-add" @submit.prevent="savePlan">
        <input v-model="planText" class="input" maxlength="60" placeholder="写一件想做的事" enterkeyhint="done" />
        <button class="btn small" :disabled="!planText.trim()">贴上</button>
      </form>
      <div v-if="newRep.type === 'none'" class="scope">
        <button type="button" class="chip" :class="{ on: planScope === 'month' }" @click="planScope = 'month'">这个月</button>
        <button type="button" class="chip" :class="{ on: planScope === 'day' }" @click="planScope = 'day'">某一天</button>
        <input v-if="planScope === 'day'" v-model="planDay" class="input date" type="date" :min="`${month}-01`" :max="`${month}-31`" />
      </div>
      <RepeatPicker :form="newRep" />
      <ul class="plan-list">
        <li v-for="p in plans" :key="p.id" :class="{ done: p.doneAt }" :style="{ '--c': info(p.who).color }">
          <button class="tick" :aria-label="p.doneAt ? '取消完成' : '完成'" @click="tickPlan(p)"><Icon v-if="p.doneAt" name="check" :size="14" /></button>
          <button class="t" @click="openEdit(p)"><em v-if="p.date">{{ md(p.date) }}</em>{{ p.text }}</button>
          <small>{{ info(p.who).name }}</small>
          <button class="x" aria-label="拿掉" @click="removePlan(p)">×</button>
        </li>
        <li v-if="!plans.length && !series.length" class="none">这个月还没有待续</li>
      </ul>
      <template v-if="series.length">
        <p class="hint sub">周期待续（勾的是{{ day === today ? "今天" : md(day) }}）</p>
        <ul class="plan-list">
          <li v-for="p in series" :key="p.key" :class="{ done: p.doneAt }" :style="{ '--c': info(p.who).color }">
            <button v-if="p.on" class="tick" :aria-label="p.doneAt ? '取消这次' : '这次做完了'" @click="tickPlan(p.plan, p.date)"><Icon v-if="p.doneAt" name="check" :size="14" /></button>
            <span v-else class="tick off" />
            <button class="t" @click="openEdit(p.plan, p.on ? p.date : '')">{{ p.text }}<em class="cyc">{{ p.label }}</em></button>
            <small>{{ info(p.who).name }}</small>
          </li>
        </ul>
      </template>
    </Sheet>

    <!-- 改一件待续 -->
    <Sheet :open="!!editing" title="改待续" :z="60" @close="editing = null">
      <template v-if="editing">
        <input v-model="edit.text" class="input" maxlength="60" placeholder="这件事" />
        <template v-if="!editing.repeat">
          <div v-if="editRep.type === 'none'" class="scope">
            <button type="button" class="chip" :class="{ on: edit.scope === 'month' }" @click="edit.scope = 'month'">挂在月上</button>
            <button type="button" class="chip" :class="{ on: edit.scope === 'day' }" @click="edit.scope = 'day'">挂在某一天</button>
          </div>
          <template v-if="editRep.type === 'none'">
            <input v-if="edit.scope === 'day'" v-model="edit.date" class="input date" type="date" />
            <label v-else class="mon">挂在 <input v-model="edit.month" class="input" type="month" /></label>
          </template>
        </template>
        <RepeatPicker :form="editRep" :no-none="!!editing.repeat" />
        <p v-if="editing.repeat" class="hint sub">改文字或改周期是整串一起改，已经勾过的那几天不受影响。{{ editStopped ? "这件已经停掉了。" : "" }}</p>
        <div v-if="editing.repeat" class="sheet-act once">
          <button v-if="editDate" class="btn soft" @click="finishOnce">{{ editDone ? "撤回这次的勾" : "这次做完了" }}</button>
          <button v-if="!editStopped" class="btn soft" @click="stopWhole">整件停掉</button>
        </div>
        <div class="sheet-act">
          <button class="btn soft" @click="dropEdit">删掉</button>
          <span class="act-gap" />
          <button v-if="!editing.repeat && !editing.doneAt && editRep.type === 'none'" class="btn soft" @click="finishEdit">做完了</button>
          <button class="btn" :disabled="!edit.text.trim() || (!editing.repeat && editRep.type === 'none' && ((edit.scope === 'day' && !edit.date) || (edit.scope === 'month' && !edit.month)))" @click="saveEdit">保存</button>
        </div>
      </template>
    </Sheet>

    <ImageViewer :open="viewAt != null" :images="viewImgs" :start="viewAt || 0" @close="viewAt = null" />
  </div>
</template>

<style scoped>
.mw {
  --cream: var(--bg); --note: #fffdf7; --note-line: rgba(120, 100, 70, .14);
  position: relative; min-height: 100%; max-width: 520px; margin: 0 auto; background: var(--cream);
  padding: 0 0 calc(var(--tabbar-h) + var(--safe-bottom) + 40px); overflow-x: clip;
  font-family: "Poppins", var(--font);
}
:root[data-theme="dark"] .mw { --note: #2a2f3a; --note-line: rgba(255, 255, 255, .07); }

.sec-head { display: flex; align-items: baseline; justify-content: space-between; padding: 0 20px; margin-bottom: 10px; }
.sec-head h2 { margin: 0; font-size: .95rem; font-weight: 600; color: var(--text); letter-spacing: .3px; }
.sec-head .cap { font-size: .75rem; color: var(--text-3); }
.chip { display: inline-flex; align-items: center; gap: 4px; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--text-2); font-size: .78rem; }
.chip.on { background: color-mix(in srgb, var(--accent) 16%, var(--card)); border-color: var(--accent); color: var(--text); }
.chip:disabled { opacity: .5; }

/* 今天的水温 */
.temp { margin-top: 10px; padding-top: 6px; }
.slots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 0 16px; }
.slot { border: 0; border-radius: 16px; padding: 8px 6px 10px; display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; background: var(--note); box-shadow: 0 0 0 1px var(--note-line), 0 3px 10px rgba(80, 70, 50, .06); min-width: 0; color: var(--text); }
.slot:disabled { opacity: 1; }
.slot.mine:not(:disabled) { box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--c) 60%, transparent), 0 3px 10px rgba(80, 70, 50, .06); }
.slot .pic { width: 56px; height: 56px; display: grid; place-items: center; }
.slot .pic img { width: 100%; height: 100%; object-fit: contain; }
.slot .ph { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 50%; border: 1.5px dashed var(--text-3); color: var(--text-3); font-size: 1.1rem; }
.slot .who { display: flex; align-items: center; gap: 5px; font-size: .74rem; font-weight: 600; max-width: 100%; }
.slot .who i { width: 7px; height: 7px; border-radius: 50%; background: var(--c); flex: none; }
.slot .say { font-size: .72rem; color: var(--text-2); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slot.empty .say { color: var(--text-3); }

/* 潮间带 */
.tide { margin-top: 26px; }
.empty { margin: 24px 20px; text-align: center; font-size: .85rem; color: var(--text-3); }
.card {
  position: relative; margin: 0 16px 18px; padding: 14px 14px 10px; border-radius: 6px;
  background: color-mix(in srgb, var(--c) 9%, var(--note)); box-shadow: 0 0 0 1px var(--note-line), 0 6px 14px rgba(80, 70, 50, .08);
  transform: rotate(var(--t)); transition: transform .2s;
}
.card.polaroid { background: var(--note); padding: 12px 12px 10px; }
.tape { position: absolute; top: -9px; left: 50%; width: 64px; height: 18px; margin-left: -32px; background: color-mix(in srgb, var(--c) 45%, transparent); transform: rotate(-2deg); border-radius: 2px; opacity: .85; pointer-events: none; }
.card header { display: flex; align-items: center; gap: 9px; }
.ava :deep(.avatar) { box-shadow: 0 0 0 2px var(--c); }
.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.meta b { font-size: .84rem; }
.meta small { font-size: .7rem; color: var(--text-3); }
.more { border: 0; background: none; color: var(--text-3); padding: 6px; }
.pic { display: block; width: 100%; margin: 10px 0 0; padding: 0; border: 0; background: none; }
.st { margin: 10px 0 0; font-size: .8rem; color: var(--text-2); }
.st span { display: inline-block; margin-right: 6px; padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--c) 28%, transparent); color: var(--text); font-size: .72rem; }
.done { margin: 8px 0 0; font-size: .74rem; color: color-mix(in srgb, var(--c) 70%, var(--text-2)); }
.body { margin: 8px 0 0; font-size: .92rem; line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
.body.cap { font-size: .88rem; text-align: center; margin-top: 10px; }
.replies { list-style: none; margin: 10px 0 0; padding: 8px 10px; border-radius: 8px; background: rgba(var(--tint-rgb), .035); font-size: .8rem; line-height: 1.55; display: flex; flex-direction: column; gap: 2px; }
.replies b { margin-right: 6px; font-weight: 600; }
.card footer { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.rx { display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px; border-radius: 999px; border: 0; background: none; font-size: .72rem; color: var(--text-3); min-height: 30px; }
.rx .em { font-size: .95rem; filter: grayscale(.6); opacity: .7; }
.rx.on .em, .rx:active .em { filter: none; opacity: 1; }
.rx.on { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--text-2); }
.rx.reply { margin-left: auto; color: var(--text-2); }
.rx.pop .em { animation: pop .45s; }
@keyframes pop { 30% { transform: translateX(5px) scale(1.2); } 60% { transform: translateX(-3px); } }
.who-dots { display: inline-flex; gap: 2px; }
.who-dots i { width: 7px; height: 7px; border-radius: 50%; }
.reply-box { display: flex; gap: 8px; margin-top: 6px; }
.reply-box .input { flex: 1; min-width: 0; }
.more-btn { display: block; margin: 0 auto; border: 0; background: none; color: var(--text-2); font-size: .82rem; padding: 10px 18px; }

.fab { position: fixed; z-index: 20; right: max(18px, calc(50% - 260px + 18px)); bottom: calc(var(--tabbar-h) + var(--safe-bottom) + 26px); width: 54px; height: 54px; border-radius: 50%; border: 0; display: grid; place-items: center; background: #4a6086; color: #fff; box-shadow: 0 8px 22px rgba(60, 80, 120, .35); }
:root[data-theme="dark"] .fab { background: #a9c1e2; color: #1b1e25; }

/* 弹层里 */
.mood-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin: 4px 0 12px; }
.mood { border: 1.5px solid transparent; border-radius: 14px; background: var(--card-2); padding: 6px 2px 6px; display: flex; flex-direction: column; align-items: center; gap: 0; color: var(--text); }
.mood.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--card-2)); }
.mood img { width: 100%; max-width: 52px; aspect-ratio: 1; object-fit: contain; }
.mood b { font-size: .72rem; font-weight: 600; margin-top: 2px; }
.mood small { font-size: .62rem; color: var(--text-3); }
.sheet-act { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.act-gap { flex: 1; min-width: 14px; }
.area { width: 100%; resize: none; }
.prev { position: relative; margin-top: 10px; width: 140px; }
.prev .x, .plan-list .x { border: 0; background: rgba(30, 30, 40, .55); color: #fff; width: 24px; height: 24px; border-radius: 50%; line-height: 1; }
.prev .x { position: absolute; top: -8px; right: -8px; }
.row-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.sheet-act + * { margin-top: 0; }
.row-chips + .input { margin-top: 10px; }
.quick { margin-top: 14px; }
.quick .lab { font-size: .75rem; color: var(--text-3); }
.q-row { display: flex; gap: 4px; margin-top: 6px; overflow-x: auto; padding-bottom: 4px; }
.q { flex: none; width: 40px; height: 40px; padding: 2px; border-radius: 12px; border: 1.5px solid transparent; background: var(--card-2); }
.q.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--card-2)); }
.q img { width: 100%; height: 100%; object-fit: contain; display: block; }
.hint { margin: 0 0 10px; font-size: .78rem; color: var(--text-3); line-height: 1.6; }
.plan-add { display: flex; gap: 8px; }
.plan-add .input { flex: 1; min-width: 0; }
.plan-list { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.plan-list li { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 10px; background: color-mix(in srgb, var(--c, #ccc) 12%, var(--card-2)); }
.plan-list .tick { flex: none; width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid var(--text-3); background: none; display: grid; place-items: center; color: #fff; }
.plan-list li.done .tick { background: color-mix(in srgb, var(--c) 80%, #555); border-color: transparent; }
.plan-list .t { flex: 1; min-width: 0; font-size: .9rem; word-break: break-word; border: 0; background: none; padding: 0; text-align: left; color: var(--text); font-family: inherit; }
.plan-list .t em { font-style: normal; font-size: .7rem; font-weight: 700; margin-right: 6px; padding: 1px 6px; border-radius: 999px; background: #f3dc8b; color: #6b5a22; }
.scope { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
.scope .date, .mon .input { width: auto; flex: 1; min-width: 150px; }
.scope + .input { margin-top: 10px; }
.mon { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: .85rem; color: var(--text-2); }
.plan-list .t + small { flex: none; }
.day-plans { margin: 14px 16px 0; display: flex; flex-direction: column; gap: 6px; }
.dp { border: 0; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 14px; background: color-mix(in srgb, #f3dc8b 22%, var(--note)); box-shadow: 0 0 0 1px var(--note-line); color: var(--text); text-align: left; font-family: inherit; }
.dp .tag { flex: none; font-size: .68rem; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: #f3dc8b; color: #6b5a22; }
.dp .t { flex: 1; min-width: 0; font-size: .92rem; word-break: break-word; }
.dp.done .t { text-decoration: line-through; color: var(--text-3); }
.cyc { flex: none; font-style: normal; font-size: .64rem; padding: 0 6px; border-radius: 999px; color: var(--text-3); background: color-mix(in srgb, var(--text-3) 14%, transparent); margin-left: 6px; }
.dp .cyc { margin-left: 0; color: var(--text-2); background: color-mix(in srgb, var(--text-2) 16%, transparent); }
.plan-list .tick.off { border-style: dashed; opacity: .35; }
.hint.sub { margin: 14px 0 0; }
.sheet-act.once { justify-content: flex-start; margin-top: 12px; }
.dp small { color: var(--text-3); font-size: .72rem; flex: none; }
.plan-list li.done .t { color: var(--text-3); text-decoration: line-through; }
.plan-list small { color: var(--text-3); font-size: .7rem; }
.plan-list .x { background: none; color: var(--text-3); font-size: 1.1rem; }
.plan-list .none { justify-content: center; background: none; color: var(--text-3); font-size: .82rem; }
@media (prefers-reduced-motion: reduce) { .rx.pop .em { animation: none; } }
</style>
