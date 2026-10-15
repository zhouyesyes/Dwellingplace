<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { syncState, syncNow, startSync, bindDevice, enableSync, disableSync } from '../lib/sync.js';
import { binding, createBindingCode, listDevices, revokeDevice } from '../lib/deviceSync.js';
import { toast } from '../lib/toast.js';
import SubHeader from '../components/SubHeader.vue';

const code = ref(''), name = ref('我的设备'), url = ref(''), origin = ref(''), busy = ref(false);
const clock = ref(Date.now());
const bound = computed(() => !!binding.device && !syncState.revoked);
const remaining = computed(() => Math.max(0, Math.ceil((binding.expiresAt - clock.value) / 1000)));
const shownCode = computed(() => remaining.value ? binding.code : '');
let tick;
onMounted(async () => {
  tick = setInterval(() => { clock.value = Date.now(); }, 1000);
  await startSync();
  if (bound.value) await listDevices().catch(e => { binding.error = e.message; });
});
onBeforeUnmount(() => { clearInterval(tick); binding.code = ''; binding.expiresAt = 0; });
async function act(fn) {
  busy.value = true; binding.error = '';
  try { await fn(); } catch (e) { binding.error = e.message || '暂时没连上，请稍后重试'; }
  finally { busy.value = false; }
}
const bind = () => act(async () => {
  await bindDevice(code.value, name.value, origin.value);
  code.value = ''; await listDevices();
  toast('这台设备已绑定，正在同步原来的栖所');
});
const migrate = () => act(async () => {
  await enableSync(url.value); url.value = '';
  if (binding.device) await listDevices();
});
async function revoke(d) {
  const self = d.id === binding.device?.id;
  if (!confirm(self ? '撤销这台设备？本地内容会保留，再次访问云端需要新的绑定码。' : `撤销「${d.name}」？它将不能再读取或修改云端数据，已下载的本地副本无法远程删除。`)) return;
  await act(async () => {
    await revokeDevice(d.id);
    if (self) await disableSync();
  });
}
</script>

<template>
  <div class="page">
    <SubHeader title="设备与同步" />
    <div class="card body">
      <h2>{{ bound ? '这台设备已绑定' : syncState.revoked ? '这台设备已被撤销' : '输入绑定码' }}</h2>
      <p class="desc">所有设备共用云端同一份栖所。本地保留离线副本，重新联网后自动合并。</p>
      <template v-if="bound">
        <p>{{ binding.device.name }}</p>
        <p class="desc">{{ syncState.busy ? '正在同步…' : syncState.lastAt ? '已经同步过' : '等待同步' }}<template v-if="syncState.pending"> · {{ syncState.pending }} 项待同步</template></p>
        <button class="btn wide" :disabled="busy || syncState.busy" @click="syncNow">现在同步</button>
      </template>
      <form v-else @submit.prevent="bind">
        <p class="desc">在一台已绑定的设备打开这里，点「绑定新设备」，再把绑定码填到下面。不需要同步链接或服务器口令。</p>
        <label>这台设备的名字<input v-model="name" class="input" maxlength="60" placeholder="例如：我的 iPad" autocomplete="off" /></label>
        <label>绑定码<input v-model="code" class="input pairing-input" maxlength="32" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX" /></label>
        <button class="btn wide" :disabled="busy || !code.trim()">{{ busy ? '正在绑定…' : '绑定这台设备' }}</button>
      </form>
      <p v-if="syncState.error || binding.error" role="status" class="warn">{{ binding.error || syncState.error }}</p>
    </div>

    <template v-if="bound">
      <div class="section-label">绑定新设备</div>
      <div class="card body">
        <p class="desc">在新设备打开同一个栖所网址，输入下方绑定码。5 分钟内有效，只能绑定一台设备。重新生成会作废上一个码。</p>
        <button class="btn wide" :disabled="busy" @click="act(createBindingCode)">{{ shownCode ? '重新生成绑定码' : '生成绑定码' }}</button>
        <template v-if="shownCode">
          <output class="pair-code" aria-label="一次性绑定码">{{ shownCode }}</output>
          <p class="desc">{{ remaining }} 秒后失效 · 只给你自己的新设备</p>
        </template>
        <button class="btn soft wide" disabled title="当前版本先使用绑定码">二维码绑定（待支持）</button>
      </div>
      <div class="section-label devices-heading">已绑定设备<button class="btn soft" :disabled="busy" @click="act(listDevices)">刷新</button></div>
      <div class="card body">
        <div v-for="d in binding.devices" :key="d.id" class="device">
          <div class="grow"><b>{{ d.name }}</b><small>{{ d.id === binding.device.id ? '这台设备 · ' : '' }}{{ d.revokedAt ? '已撤销' : '可同步' }}<br />绑定于 {{ new Date(d.createdAt).toLocaleDateString() }}</small></div>
          <button v-if="!d.revokedAt" class="btn soft danger" :disabled="busy" @click="revoke(d)">撤销</button>
        </div>
        <p class="tip">撤销会阻止后续云端访问，无法抹掉设备已经下载的内容。</p>
      </div>
    </template>
    <details class="card body advanced">
      <summary>高级服务器配置与旧设备迁移</summary>
      <p class="desc">通常不用填写。若网页和数据服务器不在同一域名，由部署时配置公开服务器域名；也可在这里临时指定，不包含口令。</p>
      <label>公开服务器域名<input v-model="origin" class="input" inputmode="url" placeholder="https://你的服务器域名" autocomplete="off" /></label>
      <p class="desc">首次升级会把已有同步配置无损迁移为设备凭证；若另一台设备已先完成迁移，请用它生成绑定码。本地与云端内容都会保留。</p>
      <label>旧同步地址（仅用于首次迁移或恢复）<input v-model="url" type="password" class="input" autocomplete="off" placeholder="旧服务器同步地址" /></label>
      <button class="btn soft wide" :disabled="busy || !url.trim()" @click="migrate">无损迁移旧配置</button>
    </details>
    <p class="tip">启动、回到前台和恢复网络时会自动同步；失败后保留本地修改并重试。冲突优先保留云端同字段版本，本地冲突副本仍留在此设备。</p>
  </div>
</template>

<style scoped>
.body { padding: 16px 18px; }
h2 { margin: 0 0 8px; font-size: 1.1rem; }
.desc { margin: 8px 0 12px; color: var(--text-2); line-height: 1.7; font-size: .93rem; }
label { display: block; margin-top: 12px; font-size: .85rem; color: var(--text-2); }
.input { margin-top: 6px; width: 100%; font-size: 16px; }
.btn:not(.soft) { color: var(--on-ink); }
.wide { width: 100%; margin-top: 10px; }
.warn { color: var(--danger); font-size: .85rem; overflow-wrap: anywhere; }
.pair-code { display: block; text-align: center; margin-top: 16px; font: 600 1.5rem ui-monospace, monospace; letter-spacing: .08em; user-select: all; overflow-wrap: anywhere; }
.pairing-input { text-transform: uppercase; letter-spacing: .08em; }
.device { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.grow { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.device small { display: block; color: var(--text-3); font-size: .75rem; }
.danger { color: var(--danger); }
.tip { color: var(--text-3); font-size: .8rem; line-height: 1.7; margin: 12px 6px; }
.advanced { margin-top: 24px; }
summary { cursor: pointer; color: var(--text-2); }
.devices-heading { display: flex; align-items: center; justify-content: space-between; }
</style>
