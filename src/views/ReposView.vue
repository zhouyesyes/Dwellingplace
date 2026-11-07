<script setup>
// 仓库：派活能改哪些仓库。单子由她的服务器拿 GitHub 钥匙去问（钥匙不在网页里），这里只开关「能派活」。
import { onMounted } from "vue";
import Icon from "../components/Icon.vue";
import SubHeader from "../components/SubHeader.vue";
import { repoState, loadRepos, toggleRepo } from "../lib/repos.js";
import { toast } from "../lib/toast.js";

onMounted(() => loadRepos(true));
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
  </div>
</template>

<style scoped>
.seg { display: flex; background: var(--bg); border-radius: 12px; padding: 3px; gap: 2px; }
.seg button { border: 0; background: none; border-radius: 9px; padding: 4px 12px; font-size: 0.87rem; color: var(--text-2); }
.seg button.on { background: var(--card); color: var(--text); box-shadow: var(--shadow-soft); font-weight: 600; }
.hint { margin: 12px 4px; font-size: .8rem; line-height: 1.6; color: var(--text-2); }
.err { margin: 12px 4px; font-size: .8rem; line-height: 1.6; color: var(--danger); }
.refresh { display: block; margin: 8px auto; padding: 8px 18px; border-radius: 999px; background: var(--card); color: var(--text); box-shadow: var(--shadow); font-size: .85rem; }
</style>
