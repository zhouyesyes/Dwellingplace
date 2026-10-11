<script setup>
import { ref, computed } from "vue";
import { syncState, syncNow, probe, enableSync, disableSync, hasOwnData } from "../lib/sync.js";
import { toast } from "../lib/toast.js";
import SubHeader from "../components/SubHeader.vue";
import Icon from "../components/Icon.vue";

const url = ref("");
const busy = ref(false);
const found = ref(null); // { url, count }：服务器上已经有东西，要选怎么办

const ago = computed(() => {
  if (!syncState.lastAt) return "还没同步过";
  const s = Math.round((Date.now() - syncState.lastAt) / 1000);
  return s < 60 ? "刚刚同步过" : `${Math.round(s / 60)} 分钟前同步过`;
});

async function connect() {
  busy.value = true;
  try {
    const p = await probe(url.value);
    if (!p.count) await go(p.url, "local"); // 服务器上还空着：把这台的交上去
    else if (!hasOwnData()) await go(p.url, "server"); // 这台是新的：直接取服务器上的
    else found.value = p;
  } catch (e) {
    toast(e.message || String(e), 4000);
  } finally {
    busy.value = false;
  }
}
async function go(u, how) {
  if (how === "server" && hasOwnData() && !confirm("这台设备上现在的数据会被服务器上的换掉，确定？")) return;
  if (how === "local" && found.value && !confirm("服务器上的会被这台设备的换掉（别的设备同步后也会变成这台的样子），确定？")) return;
  busy.value = true;
  try {
    await enableSync(u, how);
    found.value = null;
    toast(how === "server" ? "正在取回…" : "同步开好了");
  } catch (e) {
    toast(e.message || String(e), 4000);
  } finally {
    busy.value = false;
  }
}
async function off() {
  if (!confirm("关掉这台设备的同步？数据还留在这台设备和服务器上，只是不再互相更新。")) return;
  await disableSync();
  toast("已关闭");
}
</script>

<template>
  <div class="page">
    <SubHeader title="同步" />

    <div class="card body">
      <p class="lead">手机、iPad、电脑连上同一个同步地址，看到的就是同一份栖所：角色、聊天记录、记忆、设置、图片都会互相更新。数据存在你自己的服务器上。</p>
    </div>

    <template v-if="syncState.on">
      <div class="section-label">状态</div>
      <div class="card body">
        <p class="row"><Icon name="refresh" :size="18" /><span class="grow">{{ syncState.busy ? "同步中…" : ago }}<template v-if="syncState.pending"> · {{ syncState.pending }} 样还没交上去</template></span></p>
        <p v-if="syncState.error" class="warn">{{ syncState.error }}</p>
        <p class="addr">{{ syncState.url.replace(/\/p\/[^/]+\//, "/p/••••/") }}</p>
        <button class="btn wide" :disabled="syncState.busy" @click="syncNow()">现在同步</button>
        <button class="btn soft wide danger" @click="off">关闭同步</button>
      </div>
      <p class="tip">打开栖所、切回来、每 20 秒都会自动同步一次。两台设备同时改了同一样东西，会自动合在一起。<br />「备份 → 导入」会关掉这台设备的同步，导入后再来这里重新连上，选「用这台的」。</p>
    </template>

    <template v-else>
      <div class="section-label">连上服务器</div>
      <div class="card body">
        <p class="desc">填服务器信息文件里「多设备同步」那一行（像 <code>https://你的域名/p/口令/sync</code>）。每台设备都填同一个。</p>
        <input v-model="url" class="input" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://…/p/…/sync" />
        <button class="btn wide" :disabled="busy || !url.trim()" @click="connect">{{ busy ? "连接中…" : "连上" }}</button>
      </div>

      <template v-if="found">
        <div class="section-label">服务器上已经有 {{ found.count }} 样东西了</div>
        <div class="card body choices">
          <button class="btn wide" :disabled="busy" @click="go(found.url, 'merge')">两边合在一起（推荐）<small>聊天记录、角色、记忆按条合并，两边都填了不一样的，用服务器上的</small></button>
          <button class="btn soft wide" :disabled="busy" @click="go(found.url, 'server')">用服务器上的<small>这台设备现在的数据会被换掉</small></button>
          <button class="btn soft wide" :disabled="busy" @click="go(found.url, 'local')">用这台的<small>服务器上的会被换掉</small></button>
        </div>
        <p class="tip">不确定的话先去「备份」导出一份。</p>
      </template>
    </template>
  </div>
</template>

<style scoped>
.body { padding: 16px 18px; }
.lead, .desc { margin: 0 0 10px; font-size: 0.93rem; color: var(--text-2); line-height: 1.7; }
.lead { margin: 0; }
.row { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 0.93rem; }
.grow { flex: 1; }
.addr { margin: 8px 0 0; font-size: 0.75rem; color: var(--text-3); word-break: break-all; }
.warn { color: var(--danger); font-size: 0.85rem; margin: 8px 0 0; }
.wide { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; width: 100%; margin-top: 10px; }
.wide small { font-size: 0.72rem; font-weight: 400; opacity: 0.75; }
.danger { color: var(--danger); }
.tip { font-size: 0.8rem; color: var(--text-3); line-height: 1.7; margin: 8px 6px 18px; }
code { font-size: 0.8rem; word-break: break-all; }
</style>
