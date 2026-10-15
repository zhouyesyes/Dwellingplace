// 选图 input 挂在 body 上，避开页面重渲染；系统相册返回前一直保留。
import { reactive } from "vue";
import { toast } from "./toast.js";

export const fileActivity = reactive({ selecting: false, processing: 0, cropping: false, cancel: null });
let active = false;
export function pickFile(accept = "image/*", multiple = false) {
  if (active || fileActivity.processing || fileActivity.cropping) { toast("正在处理，请稍等"); return Promise.resolve([]); }
  active = true;
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    // 不用 display:none，兼容移动 Safari 的原生文件选择。
    input.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0";
    let settled = false;
    const finish = files => {
      if (settled) return;
      settled = true;
      input.removeEventListener("change", selected);
      input.removeEventListener("input", selected);
      input.removeEventListener("cancel", cancelled);
      input.remove();
      active = false;
      fileActivity.selecting = false;
      fileActivity.cancel = null;
      resolve(files);
    };
    const selected = () => {
      // 先复制 File 引用，再移除 input；input/change 可能连续到达，只接收一次。
      const files = Array.from(input.files || []);
      if (files.length) finish(files);
    };
    const cancelled = () => finish([]);
    input.addEventListener("change", selected);
    input.addEventListener("input", selected);
    input.addEventListener("cancel", cancelled);
    document.body.append(input);
    fileActivity.selecting = true;
    fileActivity.cancel = cancelled;
    try { input.click(); }
    catch { cancelled(); toast("无法打开文件选择，请再试一次", 4000); }
    // 不用 focus/visibility 推断取消：iOS 恢复焦点后可能还在准备照片。
  });
}

// Safari 不支持或无法用 createImageBitmap 解码时，交给原生图片元素。
export async function decodeImage(file) {
  if (!file?.size) throw new Error("图片为空，请重新选择");
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file); } catch { /* 继续尝试原生解码 */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("无法读取这张图片，请尝试 JPEG、PNG 或系统导出的照片"));
      img.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}
