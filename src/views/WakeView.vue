<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { store } from "../store/index.js";
import { relayPing } from "../lib/search.js";
import { wakeStatus, syncNow, scheduleText, enablePush, testPush, pushSupported, isIOS, isStandalone } from "../lib/wake.js";
import { stamp } from "../lib/time.js";
import { toast } from "../lib/toast.js";
import SubHeader from "../components/SubHeader.vue";
import Avatar from "../components/Avatar.vue";
import Icon from "../components/Icon.vue";

const router = useRouter();
const GUIDE = "https://github.com/zhouyesyes/Dwellingplace/blob/main/docs/wake.md";
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
    else if (!r.tick) relay.value = { ok: false, text: "还没检测到定时任务：请按说明添加 Cron 触发器（*/5 * * * *）。刚添加的话，过 5 分钟再来看" };
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
        打开以后，就算你没打开栖所，TA 们也会按设好的时间自己醒来：想你了就给你发消息，也可以去看看邮箱、逛逛花园，或者什么都不做接着睡。
        TA 发来的消息会推送到你的手机上。
      </p>
      <p class="desc small">
        唤醒在你自己的 Cloudflare 中转上运行，需要把 TA 们的设定、记忆、最近的聊天、对外保密、API Key 和 MCP 的 token 存到你的 Cloudflare 里（只有你能看到）。
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
        <span class="grow">开启唤醒<span class="sub">每个角色可以分别设置</span></span>
        <input v-model="store.wake.enabled" type="checkbox" class="sw" :disabled="!relaySet" />
      </label>
    </div>

    <template v-if="store.wake.enabled">
      <div class="section-label">角色</div>
      <div class="list-card">
        <button v-for="r in store.roles" :key="r.id" class="list-row" @click="router.push(`/settings/wake/${r.id}`)">
          <Avatar :img="r.avatar" :name="r.name" :color="r.color" :size="36" />
          <span class="grow">{{ r.name }}<span class="sub">{{ scheduleText(r) }}</span></span>
          <Icon name="right" class="chev" :size="18" />
        </button>
      </div>

      <div class="section-label">通知</div>
      <div class="card body">
        <p v-if="iosHint" class="desc small">iPhone（iOS 16.4 以上）要先在 Safari 里点「分享 → 添加到主屏幕」，然后从主屏幕打开栖所，才能收到通知。</p>
        <p v-else-if="!pushSupported()" class="desc small">这个浏览器不支持推送通知。</p>
        <p class="desc small">通知会显示 TA 的名字和消息开头几个字。</p>
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
      <p class="note">Cloudflare 免费版每天能写 1000 次数据，TA 们醒得太频繁（比如好几个角色都设成每 10 分钟）可能会不够用，一般的设置完全够。</p>
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
.btns { display: flex; gap: 8px; flex-wrap: wrap; }
.btns .btn { flex: 1; }
.note { font-size: 0.8rem; color: var(--text-3); line-height: 1.7; margin: 10px 8px 0; }
</style>
