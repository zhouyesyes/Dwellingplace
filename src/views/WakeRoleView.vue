<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { roleById, newWake, fmtTokens } from "../store/index.js";
import { fetchState, cancelAlarm, wakeNow, whenLabel, everyText, syncNow, scheduleSync, MAX_ALARMS } from "../lib/wake.js";
import { stamp } from "../lib/time.js";
import { relayCall } from "../lib/search.js";
import { hasXinchao, xinchaoBase } from "../lib/xinchao.js";
import { toast } from "../lib/toast.js";
import SubHeader from "../components/SubHeader.vue";
import Icon from "../components/Icon.vue";

const route = useRoute();
const router = useRouter();
const role = computed(() => roleById(route.params.id));
if (!role.value) router.replace("/settings/wake");
else role.value.wake ??= newWake();
const w = computed(() => role.value.wake);
// 改了设置很快同步上去
watch(() => role.value && JSON.stringify(role.value.wake) + (role.value.xinchao?.bridgeToken || ""), () => scheduleSync(2000));

// 间隔：存的是分钟，显示可以按小时
const everyShown = computed({
  get: () => (w.value.unit === "hour" ? +(w.value.every / 60).toFixed(2) : w.value.every),
  set: v => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    w.value.every = Math.max(10, Math.round(w.value.unit === "hour" ? n * 60 : n));
  },
});
function setUnit(u) {
  w.value.unit = u;
  if (u === "hour" && w.value.every < 60) w.value.every = 60;
}

// 固定时间（每个时间可以写一句备注，告诉 TA 醒了要干嘛）
const newTime = ref("");
const newNote = ref("");
function addTime() {
  const t = newTime.value;
  if (!/^\d{2}:\d{2}$/.test(t)) return toast("先选一个时间");
  if (!w.value.times.includes(t)) w.value.times = [...w.value.times, t].sort();
  w.value.timeNotes = { ...(w.value.timeNotes || {}) };
  if (newNote.value.trim()) w.value.timeNotes[t] = newNote.value.trim();
  else delete w.value.timeNotes[t];
  newTime.value = "";
  newNote.value = "";
}
const removeTime = t => {
  w.value.times = w.value.times.filter(x => x !== t);
  if (w.value.timeNotes?.[t]) { const n = { ...w.value.timeNotes }; delete n[t]; w.value.timeNotes = n; }
};
function editNote(t) {
  const v = prompt(`${t} 醒来要做什么？（留空就是没有备注）`, w.value.timeNotes?.[t] || "");
  if (v === null) return;
  w.value.timeNotes = { ...(w.value.timeNotes || {}) };
  if (v.trim()) w.value.timeNotes[t] = v.trim();
  else delete w.value.timeNotes[t];
}

// 中转上的情况
const state = ref(null);
const stateErr = ref("");
async function loadState() {
  stateErr.value = "";
  try {
    const r = await fetchState();
    state.value = r.roles?.[role.value.id] || null;
  } catch (e) {
    stateErr.value = e.message;
  }
}
onMounted(() => { if (role.value?.wake.enabled) loadState(); });

const alarms = computed(() => (role.value.wakeAlarms || []).filter(a => a.at > Date.now()));
async function cancel(a) {
  try {
    await cancelAlarm(role.value, a.id);
    toast("取消了");
  } catch (e) {
    toast(e.message, 4000);
  }
}

const waking = ref(false);
async function wakeUpNow() {
  waking.value = true;
  try {
    const item = await wakeNow(role.value);
    toast(item.silent ? `${role.value.name} 醒了一下，没有发消息` : `${role.value.name} 给你发了消息`, 4000);
    loadState();
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    waking.value = false;
  }
}
async function toggled() {
  await syncNow();
  if (w.value.enabled) loadState();
}
// 心潮的桥：TA 心里攒满了、或者有人在心潮网页上抱了 TA，就会醒来
const xc = computed(() => hasXinchao(role.value));
if (role.value) role.value.xinchao ??= {};
const bridgeBusy = ref(false);
async function testBridge() {
  const token = (role.value.xinchao.bridgeToken || "").trim();
  if (!token) return toast("先填桥口令");
  bridgeBusy.value = true;
  try {
    await relayCall("/wake/bridge-test", { url: xinchaoBase(role.value), token });
    toast("连上了～", 2500);
  } catch (e) {
    toast(/没有这个地址/.test(e.message) ? "中转（Worker）还是旧版本，要先更新" : e.message, 5000);
  } finally {
    bridgeBusy.value = false;
  }
}
const usageText = u => (u ? `${fmtTokens(u.input || 0)} / ${fmtTokens(u.output || 0)} tokens` : "");
</script>

<template>
  <div v-if="role" class="page">
    <SubHeader :title="`${role.name} 的唤醒`" />

    <div class="list-card">
      <label class="list-row">
        <Icon name="alarm" :size="20" />
        <span class="grow">让 {{ role.name }} 自己醒来<span class="sub">醒来后 TA 自己决定要不要给你发消息</span></span>
        <input v-model="w.enabled" type="checkbox" class="sw" @change="toggled" />
      </label>
    </div>

    <template v-if="w.enabled">
      <div class="section-label">每隔一段时间</div>
      <div class="card body">
        <label class="row">
          <span class="grow">定时醒来</span>
          <input v-model="w.intervalOn" type="checkbox" class="sw" />
        </label>
        <template v-if="w.intervalOn">
          <div class="row">
            <span class="grow">每隔</span>
            <input v-model.lazy="everyShown" class="num-input" type="number" min="0.5" step="0.5" inputmode="decimal" />
            <div class="seg">
              <button :class="{ on: w.unit === 'hour' }" @click="setUnit('hour')">小时</button>
              <button :class="{ on: w.unit !== 'hour' }" @click="setUnit('min')">分钟</button>
            </div>
          </div>
          <div class="row">
            <span class="grow">前后随机浮动<small>（分钟，免得像闹钟一样准）</small></span>
            <input v-model.number="w.jitter" class="num-input" type="number" min="0" step="5" inputmode="numeric" />
          </div>
          <div class="row">
            <input v-model.trim="w.intervalNote" class="input grow" placeholder="备注（可选）：醒了想让 TA 做什么" maxlength="200" />
          </div>
          <p class="hint">现在大约每 {{ everyText(w.every) }}醒一次<template v-if="w.jitter">，前后差 {{ w.jitter }} 分钟以内</template>。碰上免打扰时间就跳过。最短 10 分钟。</p>
        </template>
      </div>

      <div class="section-label">固定时间（你来定，每天这个时间醒）</div>
      <div class="card body">
        <div v-if="w.times.length" class="chips">
          <span v-for="t in w.times" :key="t" class="chip" @click="editNote(t)">{{ t }}<small v-if="w.timeNotes?.[t]" class="note-txt"> · {{ w.timeNotes[t] }}</small><button @click.stop="removeTime(t)"><Icon name="close" :size="14" /></button></span>
        </div>
        <div class="row">
          <input v-model="newTime" class="input time" type="time" />
          <button class="btn soft small" @click="addTime">添加</button>
        </div>
        <div class="row">
          <input v-model.trim="newNote" class="input grow" placeholder="备注（可选）：比如「叫我起床」「提醒我吃药」" maxlength="200" />
        </div>
        <p class="hint">固定时间不受免打扰影响，到点就醒。点已经加好的时间可以改备注。TA 醒来时会看到备注。</p>
      </div>

      <div class="section-label">免打扰</div>
      <div class="card body">
        <label class="row">
          <span class="grow">免打扰时间</span>
          <input v-model="w.quiet.enabled" type="checkbox" class="sw" />
        </label>
        <div v-if="w.quiet.enabled" class="row">
          <input v-model="w.quiet.from" class="input time" type="time" />
          <span>到</span>
          <input v-model="w.quiet.to" class="input time" type="time" />
        </div>
        <p class="hint">这段时间里，每隔一段时间的那种不会醒；TA 自己也不能把闹钟定在这段时间。</p>
      </div>

      <template v-if="xc">
        <div class="section-label">心潮 · TA 自己来找你</div>
        <div class="card body">
          <label class="row">
            <span class="grow">心里攒满了就来找你<small>（想你想得厉害、情绪转折、做了梦、有人在心潮网页上抱了 TA……）</small></span>
            <input v-model="w.bridgeOn" type="checkbox" class="sw" />
          </label>
          <template v-if="w.bridgeOn">
            <div class="row">
              <input v-model.trim="role.xinchao.bridgeToken" class="input grow" placeholder="桥口令" autocomplete="off" autocapitalize="off" spellcheck="false" />
              <button class="btn soft small" :disabled="bridgeBusy" @click="testBridge">{{ bridgeBusy ? "试…" : "试试" }}</button>
            </div>
            <p class="hint">桥口令在服务器上的「栖所连接信息.txt」里，【栖所实时接入】那一段。中转每 5 分钟去心潮看一眼，有话就叫醒 TA。免打扰时间不去看。</p>
            <p v-if="state?.bridgeError" class="note bad">上次去心潮那边取的时候出错了：{{ state.bridgeError }}</p>
          </template>
        </div>
      </template>

      <div class="section-label">{{ role.name }} 自己定的闹钟（{{ alarms.length }}/{{ MAX_ALARMS }}）</div>
      <div class="list-card">
        <div v-for="a in alarms" :key="a.id" class="list-row">
          <Icon name="alarm" :size="20" />
          <span class="grow">{{ whenLabel(a.at) }}<span class="sub">{{ a.note || "没写要做什么" }}</span></span>
          <button class="btn soft small" @click="cancel(a)">取消</button>
        </div>
        <div v-if="!alarms.length" class="list-row empty">还没有。聊天时 TA 可以自己定，比如「40 分钟后叫我」</div>
      </div>
      <p v-if="stateErr" class="note bad">读取中转上的闹钟失败：{{ stateErr }}</p>
      <p v-else-if="state?.nextAt && w.intervalOn" class="note">下次定时醒来：{{ whenLabel(state.nextAt) }}左右</p>

      <div class="section-label">试一试</div>
      <div class="card body">
        <button class="btn soft wide" :disabled="waking" @click="wakeUpNow">{{ waking ? `正在叫醒 ${role.name}…` : `现在叫醒 ${role.name}` }}</button>
        <p class="hint">马上让 TA 醒来一次，看看 TA 会做什么。会用掉一次 API。</p>
      </div>

      <template v-if="role.wakeLog?.length">
        <div class="section-label">最近醒来</div>
        <div class="list-card">
          <div v-for="l in role.wakeLog.slice(0, 10)" :key="l.id" class="list-row log">
            <span class="grow">
              {{ stamp(l.ts) }} · {{ l.error ? "出错了" : l.silent ? "没发消息" : "发了消息" }}
              <span class="sub">{{ l.error || l.reasons.join("；") }}</span>
              <span v-if="l.tools?.length" class="sub">{{ l.tools.join("；") }}</span>
              <span class="sub">{{ usageText(l.usage) }}</span>
            </span>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.body { padding: 14px 18px; }
.row { display: flex; align-items: center; gap: 10px; min-height: 40px; }
.row + .row { margin-top: 6px; }
.grow { flex: 1; min-width: 0; }
.row small { font-size: 0.78rem; color: var(--text-3); }
.sw { width: 20px; height: 20px; accent-color: var(--ink); }
.num-input { width: 64px; border: 0; background: var(--bg); border-radius: 10px; padding: 6px 8px; text-align: center; outline: none; }
.seg { display: flex; background: var(--bg); border-radius: 12px; padding: 3px; gap: 2px; }
.seg button { border: 0; background: none; border-radius: 9px; padding: 4px 10px; font-size: 0.85rem; color: var(--text-2); }
.seg button.on { background: var(--card); color: var(--text); box-shadow: var(--shadow-soft); font-weight: 600; }
.hint { margin: 8px 2px 0; font-size: 0.8rem; color: var(--text-3); line-height: 1.6; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.chip { display: inline-flex; align-items: center; gap: 4px; background: var(--bg); border-radius: 999px; padding: 4px 6px 4px 12px; font-size: 0.93rem; font-variant-numeric: tabular-nums; }
.note-txt { font-size: 0.8rem; color: var(--text-2); max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip button { border: 0; background: none; display: grid; place-items: center; width: 24px; height: 24px; color: var(--text-3); }
.time { flex: 1; min-width: 0; }
.wide { width: 100%; }
.empty { color: var(--text-3); font-size: 0.85rem; white-space: normal; }
.log .grow { white-space: normal; }
.note { font-size: 0.8rem; color: var(--text-3); line-height: 1.7; margin: 10px 8px 0; }
.note.bad { color: var(--danger); }
</style>
