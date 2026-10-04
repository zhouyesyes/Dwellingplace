// 图片：压缩后以 Blob 存进 IndexedDB，显示时生成临时 URL。
import { ref, watchEffect } from "vue";
import { get, set, del } from "idb-keyval";
import { uid } from "../store/index.js";

const urlCache = new Map();

export async function saveImage(file, { maxSize = 1600, quality = 0.85, square = false } = {}) {
  const bmp = await createImageBitmap(file);
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
  if (square) {
    const s = Math.min(sw, sh);
    sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s;
  }
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d");
  // 透明图片转 JPEG 会变黑，先铺一层底色
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", quality));
  const id = uid();
  await set("img:" + id, blob);
  return id;
}

export async function imageURL(id) {
  if (!id) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  const blob = await get("img:" + id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export async function imageBase64(id) {
  const blob = await get("img:" + id);
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { data: btoa(bin), mime: blob.type || "image/jpeg" };
}

export async function deleteImage(id) {
  if (!id) return;
  await del("img:" + id);
  if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
}

// 在组件里用：const url = useImage(() => role.avatar)
export function useImage(getId) {
  const url = ref(null);
  watchEffect(async () => {
    const id = getId();
    url.value = id ? await imageURL(id) : null;
  });
  return url;
}

export function pickFile(accept = "image/*", multiple = false) {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}
