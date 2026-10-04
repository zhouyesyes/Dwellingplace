// 裁剪：cropImage(file, { aspect, round }) -> Promise<Blob | null>
import { reactive } from "vue";

export const cropState = reactive({ open: false, url: null, aspect: 1, round: false, title: "", resolve: null });

export function cropImage(file, { aspect = 1, round = false, title = "调整位置" } = {}) {
  return new Promise(resolve => {
    Object.assign(cropState, { open: true, url: URL.createObjectURL(file), aspect, round, title, resolve });
  });
}

export function finishCrop(blob) {
  const done = cropState.resolve;
  if (cropState.url) URL.revokeObjectURL(cropState.url);
  Object.assign(cropState, { open: false, url: null, resolve: null });
  done?.(blob);
}
