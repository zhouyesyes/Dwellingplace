<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, roleById, newWake, fmtTokens, CRAB } from "../store/index.js";
import { fetchState, cancelAlarm, wakeNow, whenLabel, everyText, syncNow, MAX_ALARMS } from "../lib/wake.js";
import { stamp } from "../lib/time.js";
import { relayCall } from "../lib/search.js";
import { hasXinchao, xinchaoBase } from "../lib/xinchao.js";
import { toast } from "../lib/toast.js";
import SubHeader from "../components/SubHeader.vue";
import Icon from "../components/Icon.vue";

const route = useRoute();
const router = useRouter();
// embedded：放在「唤醒」页里（只有一个 AI，开关在外面那一个）
const props = defineProps({ roleId: String, embedded: Boolean });
const role = computed(() => roleById(props.roleId || route.params.id));
if (!role.value) router.replace("/settings/wake");
else role.value.wake ??= newWake(role.value.id);
const w = computed(() => role.value.wake);
// 改了设置很快同步上去
// 改了就自动存：停手 1.5 秒后同步到中转，再刷新「下次醒来」
let saveTimer = 0;
const saved = ref("");
watch(() => role.value && JSON.stringify(role.value.wake) + (role.value.xinchao?.bridgeToken || ""), () => {
  saved.value = "";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1500);
});
async function saveNow(manual = false) {
  clearTimeout(saveTimer);
  if (manual) document.activeElement?.blur?.(); // 让正在输入的数字先生效
  await new Promise(r => setTimeout(r, 0));
  await syncNow();
  if (role.value?.wake.enabled) await loadState();
  saved.value = "已保存";
  if (manual) toast(state.value?.nextAt && w.value.intervalOn ? `保存好了，下次大约${whenLabel(state.value.nextAt)}醒` : "保存好了");
}
onBeforeUnmount(() => { if (saveTimer) { clearTimeout(saveTimer); syncNow(); } });

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

// 固定时间（每天这个时间醒；每个时间可以写一段备注，告诉他醒了要干嘛）
const newTime = ref("");
const newNote = ref("");
const newSay = ref(""); // 到点直接替他发的话：写了就不叫醒他、不花额度
const editing = ref(""); // 正在改哪个时间
function addTime() {
  const t = newTime.value;
  if (!/^\d{2}:\d{2}$/.test(t)) return toast("先选一个时间");
  if (editing.value && editing.value !== t) removeTime(editing.value); // 改了时间：旧的去掉
  if (!w.value.times.includes(t)) w.value.times = [...w.value.times, t].sort();
  w.value.timeNotes = { ...(w.value.timeNotes || {}) };
  if (newNote.value.trim()) w.value.timeNotes[t] = newNote.value.trim();
  else delete w.value.timeNotes[t];
  w.value.timeSay = { ...(w.value.timeSay || {}) };
  if (newSay.value.trim()) w.value.timeSay[t] = newSay.value.trim();
  else delete w.value.timeSay[t];
  newTime.value = "";
  newNote.value = "";
  newSay.value = "";
  editing.value = "";
}
const removeTime = t => {
  w.value.times = w.value.times.filter(x => x !== t);
  if (w.value.timeNotes?.[t]) { const n = { ...w.value.timeNotes }; delete n[t]; w.value.timeNotes = n; }
  if (w.value.timeSay?.[t]) { const n = { ...w.value.timeSay }; delete n[t]; w.value.timeSay = n; }
};
function editTime(t) { // 点一个已经加好的时间：放回上面的框里改
  editing.value = t;
  newTime.value = t;
  newNote.value = w.value.timeNotes?.[t] || "";
  newSay.value = w.value.timeSay?.[t] || "";
}
function cancelEdit() { editing.value = ""; newTime.value = ""; newNote.value = ""; newSay.value = ""; }

// 一次性的闹钟：定一个日期和时间，只响一次
if (role.value) w.value.once ??= [];
const onceAt = ref("");
const onceNote = ref("");
const onceSay = ref("");
const pad = n => String(n).padStart(2, "0");
const localInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const onceMin = localInput(new Date());
const onceList = computed(() => [...(w.value.once || [])].filter(o => o.at > Date.now() - 3600_000).sort((a, b) => a.at - b.at));
function addOnce() {
  const at = Date.parse(onceAt.value);
  if (!Number.isFinite(at)) return toast("先选日期和时间");
  if (at < Date.now() + 60_000) return toast("这个时间已经过去了");
  if (onceList.value.length >= 20) return toast("一次性闹钟最多 20 个");
  w.value.once = [...onceList.value, { id: Math.random().toString(36).slice(2, 8), at, note: onceNote.value.trim(), ...(onceSay.value.trim() ? { say: onceSay.value.trim() } : {}) }];
  onceAt.value = "";
  onceNote.value = "";
  onceSay.value = "";
}
const removeOnce = o => { w.value.once = (w.value.once || []).filter(x => x.id !== o.id); };
// 自由时间：每天这几个时间，他醒来自己挑想做什么（门厅 → 屋子）
const newFree = ref("");
function addFree() {
  const t = newFree.value;
  if (!/^\d{2}:\d{2}$/.test(t)) return toast("先选一个时间");
  if ((w.value.freeTimes || []).length >= 4) return toast("自由时间一天最多 4 个");
  w.value.freeTimes = [...new Set([...(w.value.freeTimes || []), t])].sort();
  newFree.value = "";
}
const removeFree = t => { w.value.freeTimes = (w.value.freeTimes || []).filter(x => x !== t); };
const freeing = ref(false);
async function tryFree() {
  freeing.value = true;
  try {
    const item = await wakeNow(role.value, { free: true });
    toast(item.free?.pick === "sleep" ? `${role.value.name} 想了想，接着睡了` : `${role.value.name} 去了「${item.free?.label || "聊天"}」`, 4000);
    loadState();
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    freeing.value = false;
  }
}
// 他自己来找你：事件（你离开以后）、陪伴（很久没来）
if (role.value) {
  w.value.events ??= { letter: false, note: false, write: false };
  w.value.companion ??= { on: false, hours: 24 };
}
// 响过一小时以上的，自己清掉
if (role.value && w.value.once?.some(o => o.at <= Date.now() - 3600_000)) w.value.once = onceList.value;

// 最近醒来：先显示 5 条，其余收起来
const logOpen = ref(false);

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
  if (w.value.enabled && !store.wake.enabled) store.wake.enabled = true; // 总开关没开的话顺手打开（只管中转叫不叫醒，谁醒还是各自的开关）
  await syncNow();
  if (w.value.enabled) loadState();
}
// 心潮的桥：他心里攒满了、或者有人在心潮网页上抱了他，就会醒来
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
const GARDEN_GUIDE = "https://github.com/zhouyesyes/Dwellingplace/blob/main/docs/garden-wake.md";
async function copyId() {
  try { await navigator.clipboard.writeText(role.value.id); toast("复制好了", 2000); } catch { toast(role.value.id, 6000); }
}
const usageText = u => (u ? `${fmtTokens(u.input || 0)} / ${fmtTokens(u.output || 0)} tokens` : "");
</script>

<template>
  <div v-if="role" :class="{ page: !embedded }">
    <SubHeader v-if="!embedded" :title="`${role.name} 的唤醒`" />

    <div v-if="!embedded" class="list-card">
      <label class="list-row">
        <Icon name="alarm" :size="20" />
        <span class="grow">让 {{ role.name }} 自己醒来<span class="sub">{{ store.wake.enabled || !w.enabled ? "这个开关只管" + role.name : "总开关还没开，现在谁也不会醒：去「设置 → 唤醒」打开总开关" }}</span></span>
        <input v-model="w.enabled" type="checkbox" class="sw" @change="toggled" />
      </label>
    </div>
    <p v-if="role.id === CRAB && w.enabled" class="hint" style="margin: 8px 8px 0">{{ role.name }}用的是你的 Claude 订阅，额度比较紧：每醒一次都要用一次，建议一天醒一两次（现在是{{ w.intervalOn ? "每隔 " + everyText(w.every) : "没有定时醒来" }}）。</p>

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
          <textarea v-model.trim="w.intervalNote" class="input note-box" rows="2" :placeholder="`备注（可选）：醒了想让${role.name}做什么`" maxlength="1000" />
          <div class="row">
            <span class="grow saved">{{ saved }}</span>
            <button class="btn soft small" @click="saveNow(true)">保存</button>
          </div>
          <p class="hint">现在大约每 {{ everyText(w.every) }}醒一次<template v-if="w.jitter">，前后差 {{ w.jitter }} 分钟以内</template>。最短 10 分钟。这几种时候跳过：免打扰时间；你 2 小时内在栖所里（正在聊，不用另外叫醒）；他主动找了你两次你都没出现（等你回来再接着醒）。每次醒来都要请求一次模型，间隔越短越费。</p>
        </template>
      </div>

      <div class="section-label">固定时间（你来定，每天这个时间醒）</div>
      <div class="card body">
        <div v-if="w.times.length" class="t-list">
          <div v-for="t in w.times" :key="t" class="t-item" :class="{ on: editing === t }" @click="editTime(t)">
            <b>{{ t }}</b>
            <p v-if="w.timeSay?.[t]" class="say">直接发：{{ w.timeSay[t] }}</p>
            <p v-else>{{ w.timeNotes?.[t] || "没写备注" }}</p>
            <button @click.stop="removeTime(t)"><Icon name="close" :size="14" /></button>
          </div>
        </div>
        <div class="row">
          <input v-model="newTime" class="input time" type="time" />
          <button v-if="editing" class="btn soft small" @click="cancelEdit">取消</button>
          <button class="btn soft small" @click="addTime">{{ editing ? "保存" : "添加" }}</button>
        </div>
        <textarea v-model.trim="newSay" class="input note-box" rows="2" :placeholder="`到点直接替${role.name}发的话（可选）：比如「该吃药啦，饭后那个」。写了就不叫醒${role.name}、不花额度`" maxlength="300" />
        <textarea v-if="!newSay" v-model.trim="newNote" class="input note-box" rows="4" placeholder="备注（可选）：比如「叫我起床，起不来就多叫几次」「提醒我吃药，饭后那个」，可以写得详细一点" maxlength="1000" />
        <p class="hint">两种：写了「直接发的话」，到点就把这句发给你，不叫醒他（零消耗）；没写，就叫醒他，他看着备注自己想说什么。固定时间不受免打扰影响。点已经加好的时间，会放回上面的框里改。</p>
      </div>

      <div class="section-label">自由时间（他自己挑想做什么）</div>
      <div class="card body">
        <div v-if="w.freeTimes?.length" class="t-list">
          <div v-for="t in w.freeTimes" :key="t" class="t-item">
            <b>{{ t }}</b>
            <p>自由时间</p>
            <button @click.stop="removeFree(t)"><Icon name="close" :size="14" /></button>
          </div>
        </div>
        <div class="row">
          <input v-model="newFree" class="input time" type="time" />
          <button class="btn soft small" @click="addFree">添加</button>
        </div>
        <p class="hint">到点他先在「门厅」看一张小清单：找你聊天、信箱、接着读最近那本书、书的讨论室、共读大讨论室、共写，各一句现在的情况。他回一行挑去哪，再带着那间屋子的东西进去：读书就往后读一段、在书里留批注；讨论室和共写就留一段话等你来看；聊天和信箱和平时醒来一样。<br />去了就是 2 次请求（门厅很小，不带聊天记录）；接着睡就只有门厅那 1 次。一天最多 4 个，不受免打扰影响。需要中转 v24。</p>
        <button v-if="w.freeTimes?.length" class="btn soft wide" :disabled="freeing" @click="tryFree">{{ freeing ? `${role.name} 在想去哪…` : "试试自由时间" }}</button>
      </div>

      <div class="section-label">有事才叫醒他（你离开以后）</div>
      <div class="card body">
        <label class="row"><span class="grow">你给他写了信</span><input v-model="w.events.letter" type="checkbox" class="sw" /></label>
        <label class="row"><span class="grow">你在书里划线、写了批注</span><input v-model="w.events.note" type="checkbox" class="sw" /></label>
        <label class="row"><span class="grow">你在共写里改了卡片、贴了便利贴</span><input v-model="w.events.write" type="checkbox" class="sw" /></label>
        <p class="hint">离开栖所 30 分钟、事情也过了 30 分钟，才叫醒他一次（几件事合在一起），只带一份很短的「发生了什么」。来信去聊天里回；批注去那本书的讨论室（也能在书里回你的批注）；共写去那本书的讨论。一天最多 3 次，免打扰时间不叫。你在栖所里和他聊过，他就算看到了，不会再因为这些叫醒。</p>
      </div>

      <div class="section-label">陪伴（你很久没来时）</div>
      <div class="card body">
        <label class="row"><span class="grow">很久没见到你，他可以主动来敲你一下</span><input v-model="w.companion.on" type="checkbox" class="sw" /></label>
        <div v-if="w.companion.on" class="row">
          <span class="grow">多久没来算「很久」</span>
          <input v-model.number="w.companion.hours" class="num-input" type="number" min="6" step="6" inputmode="numeric" />
          <span>小时</span>
        </div>
        <p class="hint">一天最多一次，而且不是每天都会：到了时候在接下来几个小时里随机挑一刻。免打扰时间不会；他主动找了你两次你都没出现，就先停着，等你回来。他醒来也可以选择不发。</p>
      </div>

      <div class="section-label">一次性闹钟（只响一次）</div>
      <div class="card body">
        <div v-if="onceList.length" class="t-list">
          <div v-for="o in onceList" :key="o.id" class="t-item">
            <b>{{ whenLabel(o.at) }}</b>
            <p v-if="o.say" class="say">直接发：{{ o.say }}</p>
            <p v-else>{{ o.note || "没写备注" }}</p>
            <button @click.stop="removeOnce(o)"><Icon name="close" :size="14" /></button>
          </div>
        </div>
        <div class="row">
          <input v-model="onceAt" class="input time" type="datetime-local" :min="onceMin" />
          <button class="btn soft small" @click="addOnce">添加</button>
        </div>
        <textarea v-model.trim="onceSay" class="input note-box" rows="2" :placeholder="`到点直接替${role.name}发的话（可选）：比如「出门记得带钥匙去配」。写了就不叫醒${role.name}`" maxlength="300" />
        <textarea v-if="!onceSay" v-model.trim="onceNote" class="input note-box" rows="3" placeholder="备注（可选）：比如「明天 9 点有面试，叫我起来、帮我再顺一遍自我介绍」" maxlength="1000" />
        <p class="hint">到点响一次就没了，不受免打扰影响。写了「直接发的话」就不叫醒他。需要中转是最新版（v22）。</p>
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
        <p class="hint">这段时间里，每隔一段时间的那种不会醒；他自己也不能把闹钟定在这段时间。</p>
      </div>

      <template v-if="xc">
        <div class="section-label">心潮 · 他自己来找你</div>
        <div class="card body">
          <label class="row">
            <span class="grow">心里攒满了就来找你<small>（想你想得厉害、情绪转折、做了梦、有人在心潮网页上抱了他……）</small></span>
            <input v-model="w.bridgeOn" type="checkbox" class="sw" />
          </label>
          <template v-if="w.bridgeOn">
            <div class="row">
              <input v-model.trim="role.xinchao.bridgeToken" class="input grow" placeholder="桥口令" autocomplete="off" autocapitalize="off" spellcheck="false" />
              <button class="btn soft small" :disabled="bridgeBusy" @click="testBridge">{{ bridgeBusy ? "试…" : "试试" }}</button>
            </div>
            <p class="hint">桥口令在服务器上的「栖所连接信息.txt」里，【栖所实时接入】那一段。中转每 5 分钟去心潮看一眼，有话就叫醒他。免打扰时间不去看。</p>
            <p v-if="state?.bridgeError" class="note bad">上次去心潮那边取的时候出错了：{{ state.bridgeError }}</p>
          </template>
        </div>
      </template>

      <div class="section-label">{{ role.name }} 自己定的闹钟（{{ alarms.length }}/{{ MAX_ALARMS }}）</div>
      <div class="list-card">
        <div v-for="a in alarms" :key="a.id" class="list-row">
          <Icon name="alarm" :size="20" />
          <span class="grow">{{ whenLabel(a.at) }}<span class="sub">{{ a.note || "没写要做什么" }}{{ a.say ? ` · 到点直接发：${a.say}` : "" }}</span></span>
          <button class="btn soft small" @click="cancel(a)">取消</button>
        </div>
        <div v-if="!alarms.length" class="list-row empty">还没有。聊天时他可以自己定，比如「40 分钟后叫我」</div>
      </div>
      <p v-if="stateErr" class="note bad">读取中转上的闹钟失败：{{ stateErr }}</p>
      <p v-else-if="state?.nextAt && w.intervalOn" class="note">下次定时醒来：{{ whenLabel(state.nextAt) }}左右</p>
      <p v-if="state?.waiting && w.intervalOn" class="note">定时醒来先停着：他主动找了你两次你都没出现，等你回到栖所就接着醒。</p>
      <p v-else-if="state?.skipped && w.intervalOn" class="note">上一次定时醒来跳过了（{{ state.skipped.why }}）。</p>
      <p v-if="state?.retryAt" class="note">上次叫醒失败了，{{ whenLabel(state.retryAt) }}再试一次（只试一次）。</p>

      <div class="section-label">试一试</div>
      <div class="card body">
        <button class="btn soft wide" :disabled="waking" @click="wakeUpNow">{{ waking ? `正在叫醒 ${role.name}…` : `现在叫醒 ${role.name}` }}</button>
        <p class="hint">马上让他醒来一次，看看他会做什么。会用掉一次 API。</p>
      </div>

      <div class="section-label">花园唤醒桥</div>
      <div class="card body">
        <div class="row">
          <span class="grow">{{ role.name }} 的编号<small>（装花园唤醒桥时要填）</small><br /><code class="rid">{{ role.id }}</code></span>
          <button class="btn soft small" @click="copyId">复制</button>
        </div>
        <p class="hint">花园里游戏轮到 {{ role.name }} 时，装在服务器上的唤醒桥会马上叫醒他，不用等。装法见 <a :href="GARDEN_GUIDE" target="_blank">花园唤醒桥说明</a>。</p>
      </div>

      <template v-if="role.wakeLog?.length">
        <div class="section-label">最近醒来</div>
        <div class="list-card">
          <div v-for="l in role.wakeLog.slice(0, logOpen ? undefined : 5)" :key="l.id" class="list-row log">
            <span class="grow">
              {{ stamp(l.ts) }} · {{ l.error ? "出错了" : l.silent ? "没发消息" : "发了消息" }}
              <span class="sub">{{ l.error || l.reasons.join("；") }}</span>
              <span v-if="l.tools?.length" class="sub">{{ l.tools.join("；") }}</span>
              <span class="sub">{{ usageText(l.usage) }}</span>
            </span>
          </div>
          <button v-if="role.wakeLog.length > 5" class="list-row more" @click="logOpen = !logOpen">{{ logOpen ? "收起 ▴" : `展开其余 ${role.wakeLog.length - 5} 条 ▾` }}</button>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.t-item .say { color: var(--accent); }
.saved { font-size: 0.75rem; color: var(--text-2); }
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
.t-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.t-item { position: relative; background: var(--bg); border-radius: 14px; padding: 8px 36px 8px 12px; }
.t-item.on { box-shadow: 0 0 0 2px var(--ink); }
.t-item b { font-size: 0.95rem; font-variant-numeric: tabular-nums; }
.t-item p { margin: 2px 0 0; font-size: 0.85rem; color: var(--text-2); line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.t-item button { position: absolute; top: 6px; right: 6px; border: 0; background: none; display: grid; place-items: center; width: 26px; height: 26px; color: var(--text-3); }
.note-box { width: 100%; margin-top: 8px; resize: vertical; line-height: 1.6; box-sizing: border-box; }
.rid { font-size: 0.85rem; user-select: all; word-break: break-all; }
.hint a { color: var(--accent); }
.more { justify-content: center; color: var(--text-2); font-size: 0.85rem; }
.time { flex: 1; min-width: 0; }
.wide { width: 100%; }
.empty { color: var(--text-3); font-size: 0.85rem; white-space: normal; }
.log .grow { white-space: normal; }
.note { font-size: 0.8rem; color: var(--text-3); line-height: 1.7; margin: 10px 8px 0; }
.note.bad { color: var(--danger); }
</style>
