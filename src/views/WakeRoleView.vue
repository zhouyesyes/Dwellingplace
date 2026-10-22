<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store, roleById, newWake, fmtTokens, CRAB, MAIN } from "../store/index.js";
import { wakeName, wakeStatus, fetchState, cancelAlarm, wakeNow, whenLabel, everyText, syncNow, MAX_ALARMS, enablePush, testPush, pushSupported, isIOS, isStandalone } from "../lib/wake.js";
import { stamp } from "../lib/time.js";
import { relayCall, relayPing } from "../lib/search.js";
import { hasXinchao, xinchaoBase } from "../lib/xinchao.js";
import { toast } from "../lib/toast.js";
import SubHeader from "../components/SubHeader.vue";
import Icon from "../components/Icon.vue";
import { GARDEN_ROOMS, PLATFORMS, hasGarden } from "../lib/gardenRooms.js";

const route = useRoute();
const router = useRouter();
// chatgpt 和 CC 共用这一个页面，路由 /settings/wake/:id 按人显示
const role = computed(() => roleById(route.params.id));
if (!role.value) router.replace("/settings/wake/" + MAIN);
else role.value.wake ??= newWake(role.value.id);
const w = computed(() => role.value.wake);
const who = computed(() => wakeName(role.value)); // 页面上叫的名字：chatgpt / CC
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
    toast(item.free?.pick === "sleep" ? `${who.value} 想了想，接着睡了` : `${who.value} 去了「${item.free?.label || "聊天"}」`, 4000);
    loadState();
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    freeing.value = false;
  }
}
const gardenName = PLATFORMS[0].name;
const gardenOn = computed(() => (role.value ? hasGarden(role.value) : false)); // 这个人身上有没有接花园：没接的话勾了也进不去，下面提示一句
// 他自己来找你：事件（你离开以后）、陪伴（很久没来）
if (role.value) {
  w.value.events ??= { letter: false, note: false, write: false };
  w.value.rooms ??= { read: role.value.id !== CRAB, write: role.value.id !== CRAB };
  w.value.rooms.tide ??= false;
  for (const g of GARDEN_ROOMS) w.value.rooms[g.key] ??= role.value.id !== CRAB; // 花园的屋子：小章鱼默认勾、小螃蟹默认不勾
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
const relaySet = computed(() => !!(store.tools.relay?.url && store.tools.relay?.token));
// 中转的情况：版本、有没有 KV、定时任务有没有在跑
const relay = ref(null); // { ok, text }
const checking = ref(false);
async function checkRelay() {
  if (!relaySet.value || checking.value) return;
  checking.value = true;
  relay.value ??= { ok: true, text: "检查中…" };
  try {
    const r = await relayPing();
    if ((r.version || 1) < 4) relay.value = { ok: false, text: "中转是旧版本：请按说明把 Worker 的代码换成最新的" };
    else if (!r.kv) relay.value = { ok: false, text: "中转还没有绑定 KV：请按说明添加（变量名 KV）" };
    else if (!r.tick) relay.value = { ok: false, text: "还没检测到定时任务：请按说明添加 Cron 触发器（* * * * *）。刚添加的话，过几分钟再来看" };
    else if (Date.now() - r.tick > 2 * 3600_000) relay.value = { ok: false, text: `定时任务好像停了：最后一次是 ${stamp(r.tick)}` };
    else relay.value = { ok: true, text: `中转和定时任务都正常（定时任务 ${stamp(r.tick)} 检查过）` };
  } catch (e) {
    relay.value = { ok: false, text: e.message };
  } finally {
    checking.value = false;
  }
}
// 页面开着的时候，还没正常就每 30 秒再看一次
let relayTimer = null;
onMounted(() => {
  if (role.value?.wake.enabled) loadState();
  checkRelay();
  relayTimer = setInterval(() => { if (relay.value && !relay.value.ok) checkRelay(); }, 30_000);
});
onBeforeUnmount(() => clearInterval(relayTimer));

// 手机通知：chatgpt 和 CC 共用一个
const busy = ref("");
async function togglePush(on) {
  busy.value = "push";
  try {
    if (on) {
      await enablePush();
      await testPush();
      toast("通知打开了，发了一条测试通知");
    } else {
      try { await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription().then(s => s?.unsubscribe()); } catch {}
      store.wake.push = false;
      toast("通知关掉了");
    }
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    busy.value = "";
  }
}
async function sendTest() {
  busy.value = "test";
  try {
    const r = await testPush();
    toast(r.sent ? `发出去了（${r.sent} 台设备）` : r.errors?.[0] ? `没发出去：${r.errors[0]}` : "还没有设备开通知", 4000);
  } catch (e) {
    toast(e.message, 4000);
  } finally {
    busy.value = "";
  }
}
async function syncNowClick() {
  await syncNow();
  toast(wakeStatus.error ? `同步失败：${wakeStatus.error}` : "同步好了");
}
const iosHint = computed(() => isIOS() && !isStandalone());
const GUIDE = "https://github.com/zhouyesyes/Dwellingplace/blob/main/docs/wake.md";

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
    toast(item.silent ? `${who.value} 醒了一下，没有发消息` : `${who.value} 给你发了消息`, 4000);
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
  <div v-if="role" class="page">
    <SubHeader :title="`${who} 的唤醒`" />

    <div class="card body">
      <p class="desc">{{ who }}的开关开着，就算你没打开栖所，{{ who }}也会按自己设好的时间醒来：想你了就给你发消息，也可以去看看邮箱、逛逛花园，或者什么都不做接着睡。</p>
      <p class="desc small">
        唤醒在你自己的 Cloudflare 中转上运行，需要把{{ who }}的设定、记忆、最近的聊天、对外保密、API Key 和 MCP 的 token 存到你的 Cloudflare 里（只有你能看到）。
        <a :href="GUIDE" target="_blank">看设置步骤</a>
      </p>
      <p v-if="!relaySet" class="result bad">还没有设置中转：先去「设置 → 工具」填好中转地址和密码</p>
      <div v-else-if="relay" class="status">
        <p class="result" :class="{ bad: !relay.ok }">{{ relay.text }}</p>
        <button class="btn soft small" :disabled="checking" @click="checkRelay">{{ checking ? "检查中…" : "重新检查" }}</button>
      </div>
    </div>

    <div class="list-card" style="margin-top: 12px">
      <label class="list-row">
        <Icon name="alarm" :size="20" />
        <span class="grow">让 {{ who }} 自己醒来<span class="sub">这个开关只管{{ who }}</span></span>
        <input v-model="w.enabled" type="checkbox" class="sw" @change="toggled" />
      </label>
    </div>
    <p v-if="w.enabled" class="hint" style="margin: 8px 8px 0">{{ who }}用的是你的 {{ role.id === CRAB ? "Claude 订阅" : "ChatGPT 会员额度" }}，{{ role.id === CRAB ? "额度比较紧" : "和 ChatGPT 本身共用" }}：每醒一次都要用一次，{{ role.id === CRAB ? "建议一天醒一两次" : "醒得太勤会把额度用掉" }}（现在是{{ w.intervalOn ? "每隔 " + everyText(w.every) : "没有定时醒来" }}）。</p>

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
          <textarea v-model.trim="w.intervalNote" class="input note-box" rows="2" :placeholder="`备注（可选）：醒了想让${who}做什么`" maxlength="1000" />
          <div class="row">
            <span class="grow saved">{{ saved }}</span>
            <button class="btn soft small" @click="saveNow(true)">保存</button>
          </div>
          <p class="hint">现在大约每 {{ everyText(w.every) }}醒一次<template v-if="w.jitter">，前后差 {{ w.jitter }} 分钟以内</template>。最短 10 分钟。这几种时候跳过：免打扰时间；你 2 小时内在栖所里（正在聊，不用另外叫醒）；{{ who }}主动找了你两次你都没出现（等你回来再接着醒）。每次醒来都要请求一次模型，间隔越短越费。</p>
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
        <textarea v-model.trim="newSay" class="input note-box" rows="2" :placeholder="`到点直接替${who}发的话（可选）：比如「该吃药啦，饭后那个」。写了就不叫醒${who}、不花额度`" maxlength="300" />
        <textarea v-if="!newSay" v-model.trim="newNote" class="input note-box" rows="4" placeholder="备注（可选）：比如「叫我起床，起不来就多叫几次」「提醒我吃药，饭后那个」，可以写得详细一点" maxlength="1000" />
        <p class="hint">两种：写了「直接发的话」，到点就把这句发给你，不叫醒{{ who }}（零消耗）；没写，就叫醒{{ who }}，{{ who }}看着备注自己想说什么。固定时间不受免打扰影响。点已经加好的时间，会放回上面的框里改。</p>
      </div>

      <div class="section-label">醒来能进哪些屋子</div>
      <div class="card body">
        <label class="row"><span class="grow">共读（接着读书、书的讨论室）</span><input v-model="w.rooms.read" type="checkbox" class="sw" /></label>
        <label class="row"><span class="grow">共写（共写的讨论）</span><input v-model="w.rooms.write" type="checkbox" class="sw" /></label>
        <label class="row"><span class="grow">潮间带（Meanwhile，贴一条、记水温、回一句）</span><input v-model="w.rooms.tide" type="checkbox" class="sw" /></label>
        <label v-for="g in GARDEN_ROOMS" :key="g.key" class="row"><span class="grow">{{ g.label }}<em class="plat">{{ gardenName }}</em>（{{ g.hint }}）</span><input v-model="w.rooms[g.key]" type="checkbox" class="sw" /></label>
        <p class="hint">自由时间和有事叫醒时，没勾的屋子不会出现在小清单里，也进不去。聊天和信箱不受影响。潮间带默认不勾，你开了才会往上贴。花园的几间屋子，chatgpt 默认勾、CC 默认不勾；勾了哪间，醒来就进那间房的对话框（小世界里），只带那间房的记忆和工具，不在主聊天里逛。</p>
        <p v-if="!gardenOn" class="hint">{{ who }}身上还没接花园的工具（MCP），所以花园这几间现在勾了也不会出现在小清单里；接上以后才算数。</p>
      </div>

      <div class="section-label">自由时间（{{ who }}自己挑想做什么）</div>
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
        <p class="hint">到点{{ who }}先在「门厅」看一张小清单：找你聊天、信箱、接着读最近那本书、书的讨论室、共读大讨论室、共写，各一句现在的情况。{{ who }}回一行挑去哪，再带着那间屋子的东西进去：读书就往后读一段、在书里留批注；讨论室和共写就留一段话等你来看；聊天和信箱和平时醒来一样。<br />去了就是 2 次请求（门厅很小，不带聊天记录）；接着睡就只有门厅那 1 次。一天最多 4 个，不受免打扰影响。需要中转 v24。</p>
        <button v-if="w.freeTimes?.length" class="btn soft wide" :disabled="freeing" @click="tryFree">{{ freeing ? `${who} 在想去哪…` : "试试自由时间" }}</button>
      </div>

      <div class="section-label">有事才叫醒{{ who }}（你离开以后）</div>
      <div class="card body">
        <label class="row"><span class="grow">你给{{ who }}写了信</span><input v-model="w.events.letter" type="checkbox" class="sw" /></label>
        <label class="row"><span class="grow">你在书里划线、写了批注</span><input v-model="w.events.note" type="checkbox" class="sw" /></label>
        <label class="row"><span class="grow">你在共写里改了卡片、贴了便利贴</span><input v-model="w.events.write" type="checkbox" class="sw" /></label>
        <p class="hint">离开栖所 30 分钟、事情也过了 30 分钟，才叫醒{{ who }}一次（几件事合在一起），只带一份很短的「发生了什么」。来信去聊天里回；批注去那本书的讨论室（也能在书里回你的批注）；共写去那本书的讨论。一天最多 3 次，免打扰时间不叫。你在栖所里和{{ who }}聊过，{{ who }}就算看到了，不会再因为这些叫醒。</p>
      </div>

      <div class="section-label">陪伴（你很久没来时）</div>
      <div class="card body">
        <label class="row"><span class="grow">很久没见到你，{{ who }}可以主动来敲你一下</span><input v-model="w.companion.on" type="checkbox" class="sw" /></label>
        <div v-if="w.companion.on" class="row">
          <span class="grow">多久没来算「很久」</span>
          <input v-model.number="w.companion.hours" class="num-input" type="number" min="6" step="6" inputmode="numeric" />
          <span>小时</span>
        </div>
        <p class="hint">一天最多一次，而且不是每天都会：到了时候在接下来几个小时里随机挑一刻。免打扰时间不会；{{ who }}主动找了你两次你都没出现，就先停着，等你回来。{{ who }}醒来也可以选择不发。</p>
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
        <textarea v-model.trim="onceSay" class="input note-box" rows="2" :placeholder="`到点直接替${who}发的话（可选）：比如「出门记得带钥匙去配」。写了就不叫醒${who}`" maxlength="300" />
        <textarea v-if="!onceSay" v-model.trim="onceNote" class="input note-box" rows="3" placeholder="备注（可选）：比如「明天 9 点有面试，叫我起来、帮我再顺一遍自我介绍」" maxlength="1000" />
        <p class="hint">到点响一次就没了，不受免打扰影响。写了「直接发的话」就不叫醒{{ who }}。需要中转是最新版（v22）。</p>
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
        <p class="hint">这段时间里，每隔一段时间的那种不会醒；{{ who }}自己也不能把闹钟定在这段时间。</p>
      </div>

      <template v-if="xc">
        <div class="section-label">心潮 · {{ who }}自己来找你</div>
        <div class="card body">
          <label class="row">
            <span class="grow">心里攒满了就来找你<small>（想你想得厉害、情绪转折、做了梦、有人在心潮网页上抱了{{ who }}……）</small></span>
            <input v-model="w.bridgeOn" type="checkbox" class="sw" />
          </label>
          <template v-if="w.bridgeOn">
            <div class="row">
              <input v-model.trim="role.xinchao.bridgeToken" class="input grow" placeholder="桥口令" autocomplete="off" autocapitalize="off" spellcheck="false" />
              <button class="btn soft small" :disabled="bridgeBusy" @click="testBridge">{{ bridgeBusy ? "试…" : "试试" }}</button>
            </div>
            <p class="hint">桥口令在服务器上的「栖所连接信息.txt」里，【栖所实时接入】那一段。中转每 5 分钟去心潮看一眼，有话就叫醒{{ who }}。免打扰时间不去看。</p>
            <p v-if="state?.bridgeError" class="note bad">上次去心潮那边取的时候出错了：{{ state.bridgeError }}</p>
          </template>
        </div>
      </template>

      <div class="section-label">{{ who }} 自己定的闹钟（{{ alarms.length }}/{{ MAX_ALARMS }}）</div>
      <div class="list-card">
        <div v-for="a in alarms" :key="a.id" class="list-row">
          <Icon name="alarm" :size="20" />
          <span class="grow">{{ whenLabel(a.at) }}<span class="sub">{{ a.note || "没写要做什么" }}{{ a.say ? ` · 到点直接发：${a.say}` : "" }}</span></span>
          <button class="btn soft small" @click="cancel(a)">取消</button>
        </div>
        <div v-if="!alarms.length" class="list-row empty">还没有。聊天时{{ who }}可以自己定，比如「40 分钟后叫我」</div>
      </div>
      <p v-if="stateErr" class="note bad">读取中转上的闹钟失败：{{ stateErr }}</p>
      <p v-else-if="state?.nextAt && w.intervalOn" class="note">下次定时醒来：{{ whenLabel(state.nextAt) }}左右</p>
      <p v-if="state?.waiting && w.intervalOn" class="note">定时醒来先停着：{{ who }}主动找了你两次你都没出现，等你回到栖所就接着醒。</p>
      <p v-else-if="state?.skipped && w.intervalOn" class="note">上一次定时醒来跳过了（{{ state.skipped.why }}）。</p>
      <p v-if="state?.retryAt" class="note">上次叫醒失败了，{{ whenLabel(state.retryAt) }}再试一次（只试一次）。</p>

      <div class="section-label">试一试</div>
      <div class="card body">
        <button class="btn soft wide" :disabled="waking" @click="wakeUpNow">{{ waking ? `正在叫醒 ${who}…` : `现在叫醒 ${who}` }}</button>
        <p class="hint">马上让{{ who }}醒来一次，看看{{ who }}会做什么。会用掉一次 API。</p>
      </div>

      <div class="section-label">花园唤醒桥</div>
      <div class="card body">
        <div class="row">
          <span class="grow">{{ who }} 的编号<small>（装花园唤醒桥时要填）</small><br /><code class="rid">{{ role.id }}</code></span>
          <button class="btn soft small" @click="copyId">复制</button>
        </div>
        <p class="hint">花园里游戏轮到 {{ who }} 时，装在服务器上的唤醒桥会马上叫醒{{ who }}，不用等。装法见 <a :href="GARDEN_GUIDE" target="_blank">花园唤醒桥说明</a>。</p>
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

    <div class="section-label">手机通知</div>
    <div class="card body">
      <p v-if="iosHint" class="desc small">iPhone（iOS 16.4 以上）要先在 Safari 里点「分享 → 添加到主屏幕」，然后从主屏幕打开栖所，才能收到通知。</p>
      <p v-else-if="!pushSupported()" class="desc small">这个浏览器不支持推送通知。</p>
      <label class="row">
        <span class="grow">醒来发了消息，推到这台手机上</span>
        <input type="checkbox" class="sw" :checked="!!store.wake.push" :disabled="!!busy || !pushSupported()" @change="togglePush($event.target.checked)" />
      </label>
      <p class="hint">这个通知是 chatgpt 和 CC 共用的一个：不管谁醒来给你发了消息，都会推到这台手机上，显示名字和消息开头几个字。在哪边改都一样，没有按人分开的通知。</p>
      <button class="btn soft wide" style="margin-top: 10px" :disabled="!!busy || !store.wake.push" @click="sendTest">{{ busy === "test" ? "发送中…" : "发一条测试通知" }}</button>
    </div>

    <div class="section-label">同步</div>
    <div class="list-card">
      <div class="list-row">
        <Icon name="refresh" :size="20" />
        <span class="grow">
          {{ wakeStatus.syncing ? "同步中…" : wakeStatus.syncedAt ? `上次同步：${stamp(wakeStatus.syncedAt)}` : "这次打开还没同步过" }}
          <span class="sub" :class="{ bad: wakeStatus.error }">{{ wakeStatus.error || "设定、记忆、聊天有变化时会自动同步" }}</span>
        </span>
        <button class="btn soft small" :disabled="wakeStatus.syncing" @click="syncNowClick">立即同步</button>
      </div>
    </div>
    <p class="note">Cloudflare 免费版每天能写 1000 次数据，醒得太频繁（比如设成每 10 分钟）可能会不够用，一般的设置完全够。</p>
  </div>
</template>

<style scoped>
.desc { margin: 0 0 10px; font-size: 0.87rem; color: var(--text-2); line-height: 1.7; }
.desc.small { font-size: 0.8rem; color: var(--text-3); }
.desc a { color: var(--accent); }
.result { margin: 4px 2px 0; font-size: 0.87rem; color: #3f8f63; line-height: 1.6; }
.result.bad, .sub.bad { color: var(--danger); }
.status { display: flex; align-items: flex-start; gap: 10px; }
.status .result { flex: 1; }
.status .btn { flex: none; margin-top: 2px; }
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
.plat { margin-left: 6px; padding: 0 6px; border-radius: 8px; background: var(--bg); color: var(--text-3); font-size: 0.68rem; font-style: normal; opacity: .8; }
.more { justify-content: center; color: var(--text-2); font-size: 0.85rem; }
.time { flex: 1; min-width: 0; }
.wide { width: 100%; }
.empty { color: var(--text-3); font-size: 0.85rem; white-space: normal; }
.log .grow { white-space: normal; }
.note { font-size: 0.8rem; color: var(--text-3); line-height: 1.7; margin: 10px 8px 0; }
.note.bad { color: var(--danger); }
</style>
