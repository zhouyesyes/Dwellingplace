<script setup>
import { ref, onMounted } from "vue";
import { exportAll, readBackup, restoreAll } from "../lib/backup.js";
import { pickFile } from "../lib/images.js";
import { todayYmd } from "../lib/dates.js";
import { toast } from "../lib/toast.js";
import SubHeader from "../components/SubHeader.vue";
import Icon from "../components/Icon.vue";

const includeKeys = ref(true);
const busy = ref(false);
const usage = ref("");

onMounted(async () => {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  if (est?.usage != null) usage.value = (est.usage / 1024 / 1024).toFixed(1) + " MB";
});

async function doExport() {
  busy.value = true;
  try {
    const blob = await exportAll({ includeKeys: includeKeys.value });
    const name = `dwellingplace-backup-${todayYmd()}.json`;
    const file = new File([blob], name, { type: "application/json" });
    // 手机上优先用系统分享（可以存到「文件」或发给自己）
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (e) {
        if (e?.name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (e) {
    toast("导出失败：" + (e?.message || e), 3500);
  } finally {
    busy.value = false;
  }
}

async function doImport() {
  const [file] = await pickFile("application/json,.json");
  if (!file) return;
  try {
    const backup = await readBackup(file);
    const when = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString() : "未知时间";
    if (!confirm(`用这个备份（${when}）覆盖现在的全部数据？现在的数据会被替换，无法撤销。`)) return;
    busy.value = true;
    await restoreAll(backup);
    location.replace(location.pathname + "#/");
    location.reload();
  } catch (e) {
    toast("导入失败：" + (e?.message || e), 3500);
    busy.value = false;
  }
}
</script>

<template>
  <div class="page">
    <SubHeader title="备份" />

    <div class="card body">
      <p class="lead">所有数据都只存在这台设备的浏览器里。换手机、清理浏览器之前，记得先导出一份备份。</p>
      <p v-if="usage" class="usage">现在大约占用 {{ usage }}</p>
    </div>

    <div class="section-label">导出</div>
    <div class="card body">
      <p class="desc">角色、聊天记录、记忆库、日历、纪念日、图片……全部打包成一个文件。</p>
      <label class="switch-row">
        <span>包含 API 密钥</span>
        <input v-model="includeKeys" type="checkbox" />
      </label>
      <small v-if="includeKeys" class="warn">备份文件里会有你的密钥，不要发给别人。</small>
      <button class="btn wide" :disabled="busy" @click="doExport"><Icon name="download" :size="18" /> 导出备份</button>
    </div>

    <div class="section-label">导入</div>
    <div class="card body">
      <p class="desc">从备份文件恢复。会<b>覆盖</b>现在的全部数据。</p>
      <button class="btn soft wide" :disabled="busy" @click="doImport"><Icon name="upload" :size="18" /> 选择备份文件</button>
    </div>
  </div>
</template>

<style scoped>
.body { padding: 16px 18px; }
.lead, .desc { margin: 0 0 10px; font-size: 0.93rem; color: var(--text-2); line-height: 1.7; }
.lead { margin: 0; }
.usage { margin: 8px 0 0; font-size: 0.8rem; color: var(--text-3); }
.switch-row { display: flex; justify-content: space-between; align-items: center; padding: 4px; font-size: 0.93rem; }
.switch-row input { width: 20px; height: 20px; accent-color: var(--ink); }
.warn { display: block; color: var(--danger); font-size: 0.8rem; margin: 2px 4px 8px; }
.wide { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; margin-top: 8px; }
</style>
