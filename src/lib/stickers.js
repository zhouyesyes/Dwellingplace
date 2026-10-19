// 表情包：你上传、起名字；他在回复里写 [表情:名字] 就显示成那张图。你也能从「＋」里发
import { reactive } from "vue";
import { decodeImage, fileActivity } from "./filePicker.js";
import { store, uid, MAIN } from "../store/index.js";
import { set } from "./kv.js";
import { imageURL, deleteImage } from "./images.js";

export const STICKER_RE = /\[表情[:：]\s*([^\]\n]{1,30})\]/g;
const ONLY_RE = /^\s*\[表情[:：]\s*([^\]\n]{1,30})\]\s*$/;
// 每张表情是谁的：owner 是某个人的 id，或 "both"（共用）；以前没分的算他的
export const BOTH = "both";
export const ownerOf = s => s.owner || MAIN;
export const stickersOf = roleId => (store.stickers || []).filter(s => ownerOf(s) === roleId || ownerOf(s) === BOTH);
export const stickerByName = name => (store.stickers || []).find(s => s.name === String(name || "").trim());

// 图片地址（异步取，取到了页面自己刷新）
const urls = reactive({});
export function stickerUrl(s) {
  if (!s?.img) return null;
  if (!(s.img in urls)) { urls[s.img] = null; imageURL(s.img).then(u => (urls[s.img] = u)); }
  return urls[s.img];
}
// 整条（或整个气泡）只是一张表情
export function onlySticker(text) {
  const m = String(text || "").match(ONLY_RE);
  return m ? stickerByName(m[1]) || null : null;
}
// 夹在文字里的表情：换成小图（html 已经转义过）
export function withStickers(html) {
  return html.replace(STICKER_RE, (all, name) => {
    const s = stickerByName(name);
    const u = s && stickerUrl(s);
    return u ? `<img class="sticker-inline" src="${u}" alt="${s.name}">` : all;
  });
}

// 存图：小的原样存（动图还会动、透明底保留），大的缩到 512 存成 webp
export async function addSticker(file, name, owner = MAIN) {
  fileActivity.processing++;
  let bmp;
  try {
    let blob = file;
    if (file.size > 1_500_000 || !/^image\/(gif|png|webp|jpeg)$/.test(file.type)) {
      bmp = await decodeImage(file);
      const k = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      blob = await new Promise(r => c.toBlob(r, "image/webp", 0.85));
    }
    if (!blob) throw new Error("图片压缩失败，请重试");
    const id = uid();
    await set("img:" + id, blob);
    store.stickers ??= [];
    let n = String(name || "").trim().slice(0, 20) || "表情";
    for (let i = 2; stickerByName(n); i++) n = `${String(name || "表情").trim().slice(0, 16)}${i}`;
    store.stickers.push({ id, name: n, img: id, owner });
  } finally { bmp?.close?.(); fileActivity.processing--; }
}
export function removeSticker(s) {
  store.stickers.splice(store.stickers.indexOf(s), 1);
  deleteImage(s.img);
}

// 给他看的说明（名字列表不常变，放在系统提示里也能命中缓存）
export function stickersForAI(role) {
  const list = stickersOf(role?.id || MAIN); // 只给看他自己的和共用的
  if (!list.length) return "";
  return [
    `\n# 表情包`,
    `你可以发表情包：单独一行写 [表情:名字]，会显示成那张图。现在有：${list.map(s => s.name).join("、")}。`,
    `想发的时候再发，别每条都带。对方发来的 [表情:名字] 就是对方发了那张表情。`,
  ].join("\n");
}
