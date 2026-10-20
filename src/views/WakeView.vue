<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { store, MAIN, CRAB, roleById } from "../store/index.js";
import WakeRoleView from "./WakeRoleView.vue";
import { relayPing } from "../lib/search.js";
import { wakeStatus, syncNow, scheduleText, enablePush, testPush, pushSupported, isIOS, isStandalone } from "../lib/wake.js";
import { stamp } from "../lib/time.js";
import { toast } from "../lib/toast.js";
import SubHeader from "../components/SubHeader.vue";
import Icon from "../components/Icon.vue";
import Avatar from "../components/Avatar.vue";

const router = useRouter();
const GUIDE = "https://github.com/zhouyesyes/Dwellingplace/blob/main/docs/wake.md";
// 没有总开关：他和小螃蟹各有一个开关，谁开谁醒，互不影响
// 住着的人：他一定有，小螃蟹请进来了才有；各一栏，各自设置
const people = computed(() => [roleById(MAIN), roleById(CRAB)].filter(Boolean));
const pick = ref(MAIN);
const current = computed(() => people.value.find(r => r.id === pick.value) || people.value[0]);
const callName = r => (r.id === CRAB ? r.name : "他");
function setPerson(r, v) {
  r.wake.enabled = v;
  syncNow();
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
let timer = null;
onMounted(() => {
  checkRelay();
  timer = setInterval(() => { if (relay.value && !relay.value.ok) checkRelay(); }, 30_000);
});
onUnmounted(() => clearInterval(timer));

const busy = ref("");
async function turnOnPush() {
  busy.value = "push";
  try {
    await enablePush();
    await testPush();
    toast("通知打开了，发了一条测试通知");
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
</script>

<template>
  <div class="page">
    <SubHeader title="唤醒" />

    <div class="card body">
      <p class="desc">
        他和小螃蟹各有一个开关，谁的开着，就算你没打开栖所，谁也会按自己设好的时间醒来：想你了就给你发消息，也可以去看看邮箱、逛逛花园，或者什么都不做接着睡。两边互不影响；醒来能进哪些屋子（共读、共写），也在各自下面分别勾。
      </p>
      <p class="desc small">
        唤醒在你自己的 Cloudflare 中转上运行，需要把他的设定、记忆、最近的聊天、对外保密、API Key 和 MCP 的 token 存到你的 Cloudflare 里（只有你能看到）。
        <a :href="GUIDE" target="_blank">看设置步骤</a>
      </p>
      <p v-if="!relaySet" class="result bad">还没有设置中转：先去「设置 → 工具」填好中转地址和密码</p>
      <div v-else-if="relay" class="status">
        <p class="result" :class="{ bad: !relay.ok }">{{ relay.text }}</p>
        <button class="btn soft small" :disabled="checking" @click="checkRelay">{{ checking ? "检查中…" : "重新检查" }}</button>
      </div>
    </div>

    <template v-if="relaySet">
      <div class="section-label">谁会自己醒来</div>
      <div class="ppl" :class="{ one: people.length < 2 }">
        <div v-for="r in people" :key="r.id" class="pcard" :class="{ sel: current?.id === r.id }" @click="pick = r.id">
          <div class="phead">
            <Avatar :img="r.avatar" :name="r.name" :color="r.color" :size="34" />
            <b>{{ r.id === MAIN ? "他" : r.name }}</b>
            <input type="checkbox" class="sw" :checked="!!r.wake?.enabled" @click.stop @change="setPerson(r, $event.target.checked)" />
          </div>
          <p class="psub">{{ scheduleText(r) }}</p>
        </div>
      </div>

      <p v-if="current && !current.wake?.enabled" class="note">{{ callName(current) }}的开关还没开：打开上面{{ callName(current) }}那一栏右边的开关，再在这里设几点醒、醒来做什么。</p>
      <WakeRoleView v-if="current" :key="current.id" embedded :role-id="current.id" />

      <div class="section-label">通知</div>
      <div class="card body">
        <p v-if="iosHint" class="desc small">iPhone（iOS 16.4 以上）要先在 Safari 里点「分享 → 添加到主屏幕」，然后从主屏幕打开栖所，才能收到通知。</p>
        <p v-else-if="!pushSupported()" class="desc small">这个浏览器不支持推送通知。</p>
        <p class="desc small">这个通知是他和小螃蟹共用的一个：不管谁醒来给你发了消息，都会推到这台手机上，显示名字和消息开头几个字。没有按人分开的通知。</p>
        <div class="btns">
          <button class="btn soft" :disabled="!!busy" @click="turnOnPush">{{ busy === "push" ? "打开中…" : store.wake.push ? "重新开通知" : "打开通知" }}</button>
          <button class="btn soft" :disabled="!!busy || !store.wake.push" @click="sendTest">{{ busy === "test" ? "发送中…" : "发一条测试通知" }}</button>
        </div>
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
    </template>
  </div>
</template>

<style scoped>
.body { padding: 16px 18px; }
.desc { margin: 0 0 10px; font-size: 0.87rem; color: var(--text-2); line-height: 1.7; }
.desc.small { font-size: 0.8rem; color: var(--text-3); }
.desc a { color: var(--accent); }
.result { margin: 4px 2px 0; font-size: 0.87rem; color: #3f8f63; line-height: 1.6; }
.result.bad, .sub.bad { color: var(--danger); }
.status { display: flex; align-items: flex-start; gap: 10px; }
.status .result { flex: 1; }
.status .btn { flex: none; margin-top: 2px; }
.sw { width: 20px; height: 20px; accent-color: var(--ink); }
.ppl { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ppl.one { grid-template-columns: 1fr; }
.pcard { background: var(--card); border: 1.5px solid transparent; border-radius: 16px; padding: 12px; min-width: 0; cursor: pointer; }
.pcard.sel { border-color: var(--ink); }
.phead { display: flex; align-items: center; gap: 8px; }
.phead b { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.psub { margin: 8px 0 0; font-size: 0.78rem; color: var(--text-3); line-height: 1.5; }
.btns { display: flex; gap: 8px; flex-wrap: wrap; }
.btns .btn { flex: 1; }
.note { font-size: 0.8rem; color: var(--text-3); line-height: 1.7; margin: 10px 8px 0; }
</style>
