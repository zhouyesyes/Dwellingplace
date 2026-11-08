<script setup>
// 仓库：派活能改哪些仓库。单子由她的服务器拿 GitHub 钥匙去问（钥匙不在网页里），这里只开关「能派活」。
import { onMounted, ref } from "vue";
import { store } from "../store/index.js";
import { tavernCfg, tavernStatus, tavernTest } from "../lib/tavern.js";
import Icon from "../components/Icon.vue";
import SubHeader from "../components/SubHeader.vue";
import { repoState, loadRepos, toggleRepo } from "../lib/repos.js";
import { toast } from "../lib/toast.js";

const tv = tavernCfg();
const tvInfo = ref(null); // 服务器上专用钥匙的情况
const tvTest = ref(null); // 试连结果：{ ok, text }
const tvBusy = ref(false);
onMounted(() => { loadRepos(true); tavernStatus().then(x => (tvInfo.value = x)).catch(() => {}); });
async function tryTavern() {
  tvBusy.value = true; tvTest.value = null;
  try {
    const r = await tavernTest();
    tvTest.value = r.ok ? { ok: true, text: `连上了 ✓ 登录的是 ${r.user || "该用户"}${r.folders?.length ? `，找到文件夹：${r.folders.join("、")}` : "，不过没找到名字带 SillyTavern 的文件夹（路径不是默认的也没关系）"}` } : { ok: false, text: r.error };
  } catch (e) { tvTest.value = { ok: false, text: e.message }; }
  finally { tvBusy.value = false; }
}
async function copyKey() {
  try { await navigator.clipboard.writeText(tvInfo.value.publicKey); toast("公钥已复制"); } catch { toast("复制不了，长按下面那行选中复制"); }
}
async function flip(r) {
  try { await toggleRepo(r.full, !r.enabled); } catch (e) { toast(e.message); }
}
</script>

<template>
  <div class="page repos">
    <SubHeader title="仓库" />
    <p class="hint">小章鱼和小螃蟹派活时，可以改这里打开的仓库。不指定就改栖所。</p>
    <div v-if="repoState.list" class="list-card">
      <div v-for="r in repoState.list" :key="r.full" class="list-row">
        <Icon name="tool" :size="20" />
        <span class="grow">{{ r.name }}<span class="sub">{{ r.isDefault ? "栖所自己 · 默认，一直开着" : r.memory ? "私人对话本 · 默认关着" : r.private ? "私有" : "公开" }}</span></span>
        <div v-if="r.fixed" class="seg"><button class="on" disabled>开</button></div>
        <div v-else class="seg">
          <button :class="{ on: r.enabled }" @click="!r.enabled && flip(r)">开</button>
          <button :class="{ on: !r.enabled }" @click="r.enabled && flip(r)">关</button>
        </div>
      </div>
    </div>
    <p v-else-if="repoState.loading" class="hint">正在问服务器…</p>
    <p v-if="repoState.error" class="err">没取到仓库单子：{{ repoState.error }}</p>
    <p class="hint">单子是服务器上那把 GitHub 钥匙能看到的仓库。想加新的，先在 GitHub 把仓库加进钥匙的范围，再重新运行一次服务器安装（粘新钥匙），回到这里就会出现；新出现的仓库默认是关着的。</p>
    <button class="refresh" :disabled="repoState.loading" @click="loadRepos(true)">刷新单子</button>

    <h3 class="sec">酒馆服务器</h3>
    <p class="hint">小螃蟹派活时第一行写「仓库：酒馆服务器」，就交给栖所服务器上的 Claude Code，通过一把专用钥匙去你的 SillyTavern 那台干活。地址、端口、用户名只存在你自己的数据里。</p>
    <div class="list-card">
      <div class="list-row">
        <Icon name="tool" :size="20" />
        <span class="grow">允许派活去酒馆<span class="sub">默认关着</span></span>
        <div class="seg">
          <button :class="{ on: tv.enabled }" @click="tv.enabled = true">开</button>
          <button :class="{ on: !tv.enabled }" @click="tv.enabled = false">关</button>
        </div>
      </div>
    </div>
    <label class="field"><span>地址</span><input v-model="tv.host" class="input" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="域名或 IP" /></label>
    <div class="two">
      <label class="field"><span>端口</span><input v-model="tv.port" class="input" inputmode="numeric" placeholder="22" /></label>
      <label class="field"><span>登录用户名</span><input v-model="tv.user" class="input" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="酒馆那台上的用户" /></label>
    </div>
    <button class="refresh" :disabled="tvBusy || !tv.host?.trim() || !tv.user?.trim()" @click="tryTavern">{{ tvBusy ? "正在试…" : "试连一下" }}</button>
    <p v-if="tvTest" :class="tvTest.ok ? 'okmsg' : 'err'">{{ tvTest.text }}</p>
    <div v-if="tvInfo" class="key">
      <p v-if="!tvInfo.keyReady" class="hint">服务器上还没有专用钥匙：在服务器上再运行一次安装那一行，选装「酒馆服务器上的 CC」。</p>
      <template v-else>
        <p class="hint">专用公钥（文件名 {{ tvInfo.keyFile }}）：把这一整行放到酒馆那台那个用户的 ~/.ssh/authorized_keys 里。</p>
        <code class="pub">{{ tvInfo.publicKey }}</code>
        <button class="refresh" @click="copyKey">复制公钥</button>
      </template>
      <p v-if="!tvInfo.claudeLoggedIn" class="err">服务器上的 Claude 还没登录：再运行一次安装那一行，按提示登录。</p>
    </div>
  </div>
</template>

<style scoped>
.seg { display: flex; background: var(--bg); border-radius: 12px; padding: 3px; gap: 2px; }
.seg button { border: 0; background: none; border-radius: 9px; padding: 4px 12px; font-size: 0.87rem; color: var(--text-2); }
.seg button.on { background: var(--card); color: var(--text); box-shadow: var(--shadow-soft); font-weight: 600; }
.hint { margin: 12px 4px; font-size: .8rem; line-height: 1.6; color: var(--text-2); }
.sec { margin: 26px 4px 0; font-size: .95rem; font-weight: 600; }
.two { display: grid; grid-template-columns: 90px 1fr; gap: 10px; margin-top: 10px; }
.field { margin-top: 10px; }
.two .field { margin-top: 0; }
.okmsg { margin: 12px 4px; font-size: .8rem; line-height: 1.6; color: var(--text); overflow-wrap: anywhere; }
.pub { display: block; margin: 0 4px 8px; padding: 10px 12px; border-radius: 12px; background: var(--card); font-size: .72rem; line-height: 1.5; word-break: break-all; user-select: all; }
.err { margin: 12px 4px; font-size: .8rem; line-height: 1.6; color: var(--danger); }
.refresh { display: block; margin: 8px auto; padding: 8px 18px; border-radius: 999px; background: var(--card); color: var(--text); box-shadow: var(--shadow); font-size: .85rem; }
</style>
