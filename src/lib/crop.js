// 裁剪：cropImage(file, { aspect, round }) -> Promise<Blob | null>
import { reactive } from "vue";
import { fileActivity } from "./filePicker.js";

export const cropState = reactive({ open: false, url: null, aspect: 1, round: false, title: "", resolve: null });

export function cropImage(file, { aspect = 1, round = false, title = "调整位置" } = {}) {
  if (cropState.open) return Promise.resolve(null);
  // URL 创建失败时不能留下全局裁剪锁。
  const url = URL.createObjectURL(file);
  fileActivity.cropping = true;
  return new Promise(resolve => {
    Object.assign(cropState, { open: true, url, aspect, round, title, resolve });
  });
}

export function finishCrop(blob) {
  fileActivity.cropping = false;
  const done = cropState.resolve;
  if (cropState.url) URL.revokeObjectURL(cropState.url);
  Object.assign(cropState, { open: false, url: null, resolve: null });
  done?.(blob);
}
