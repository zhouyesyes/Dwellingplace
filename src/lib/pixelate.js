// 拾贝小票用的像素小图：打印时在手机上现算，不调 AI、不改原图、不另存
// 缩到长边约 48 格 → 减到十几种颜色（k 均值）→ 颜色再往奶油色和三人颜色上靠一点
import { imageURL } from "./images.js";

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const CREAM = hex("#fff3dc");
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// anchors：奶油色 + 三人的颜色（十六进制）；返回画好的小画布（宽高就是格数），没有图或读不出来返回 null
export async function pixelate(imgId, anchors = [], { size = 48, colors = 12 } = {}) {
  const url = await imageURL(imgId).catch(() => null);
  if (!url) return null;
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { return null; }
  const k = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data, n = w * h;

  // k 均值：初始中心均匀挑几个点
  let cent = Array.from({ length: Math.min(colors, n) }, (_, i) => { const p = Math.floor((i + .5) * n / Math.min(colors, n)) * 4; return [px[p], px[p + 1], px[p + 2]]; });
  const label = new Uint8Array(n);
  for (let it = 0; it < 6; it++) {
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const p = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
      let best = 0, bd = Infinity;
      for (let j = 0; j < cent.length; j++) { const d = d2(p, cent[j]); if (d < bd) { bd = d; best = j; } }
      label[i] = best;
      const s = sum[best]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    cent = cent.map((o, j) => sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : o);
  }
  // 往奶油色和三人颜色上靠：每个颜色找最近的一个「靠山」，掺进去三成；整体再提一点亮、饱和一点，免得灰扑扑
  const refs = [CREAM, ...anchors.filter(a => /^#[0-9a-f]{6}$/i.test(a)).map(hex)];
  const out = cent.map(col => {
    const ref = refs.reduce((a, b) => (d2(col, b) < d2(col, a) ? b : a));
    const mixed = col.map((v, i) => v * .7 + ref[i] * .3);
    const avg = (mixed[0] + mixed[1] + mixed[2]) / 3;
    return mixed.map(v => Math.max(0, Math.min(255, (avg + (v - avg) * 1.18) * 1.03 + 4)));
  });
  for (let i = 0; i < n; i++) {
    const col = out[label[i]];
    px[i * 4] = col[0]; px[i * 4 + 1] = col[1]; px[i * 4 + 2] = col[2]; px[i * 4 + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}
