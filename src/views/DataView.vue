<script setup>
// 数据：上半是同步（开关、设备、恢复到同步升级之前），下半是导出 / 导入全部数据
import SubHeader from "../components/SubHeader.vue";
import SyncView from "./SyncView.vue";
import BackupView from "./BackupView.vue";
</script>

<template>
  <div class="page data">
    <SubHeader title="数据" />
    <div class="section-label">同步</div>
    <SyncView embedded />
    <div class="section-label gap">备份</div>
    <BackupView embedded />
  </div>
</template>

<style scoped>
.gap { margin-top: 26px; }
</style>
