// 第三版：窗的格子、从窗进来的光（后墙窗、左墙窗都能用；地板、台面、床面都能接光）
import { dither, hex, glow } from "./iso.js";

const near = (m, bw) => Math.abs(m - Math.round(m)) < bw;

// 窗格：s 横向 0–1，tv 竖向 0–1。返回 0 = 透光，1 = 细格，2 = 粗框。k 是加粗倍数（投到地上的影子粗一点）
export function bar(w, s, tv, k = 1) {
  const [nu, nh] = w.lattice || [2, 2];
  if (w.slide) {
    // 推拉窗：左半扇推开了（空着），右半是两扇叠在一起的木格
    if (Math.abs(s - 0.5) < 0.022 * k) return 2;
    if (s < 0.5) return 0;
    const m = (s - 0.5) * 2 * nu;
    if (m > 0.3 && m < nu - 0.3 && near(m, 0.05 * nu * k)) return 1;
    const n = tv * nh;
    if (n > 0.3 && n < nh - 0.3 && near(n, 0.035 * nh * k)) return 1;
    return 0;
  }
  const m = s * nu, n = tv * nh;
  if (m > 0.3 && m < nu - 0.3 && near(m, 0.025 * nu * k)) return 2;
  if (n > 0.3 && n < nh - 0.3 && near(n, 0.03 * nh * k)) return 1;
  return 0;
}

// 地上（或台面上，高 hp）的一点，顺着光往回找到窗上的哪一点；穿过窗格就亮
export function winSample(w, gx, gy, hp, x, y) {
  const d = w.wall === "left" ? gx : gy, a = w.wall === "left" ? gy : gx;
  const dh = d / w.k;
  const u = a + w.sh * dh, h = hp + dh;
  const fr = w.frame ?? 0.16, top = w.frame ?? 0.2;
  const U0 = w.u0 + fr, U1 = w.u1 - fr, H0 = w.h0 + 0.32, H1 = w.h1 - top;
  if (!(u > U0 && u < U1 && h > H0 && h < H1)) return null;
  if (bar(w, (u - U0) / (U1 - U0), (h - H0) / (H1 - H0), 2.2)) return null;
  const edge = Math.min(u - U0, U1 - u, h - H0, H1 - h);
  if (edge < (w.soft ?? 0.12) && !dither(x, y)) return null;
  return { t: (h - w.h0) / (w.h1 - w.h0), dh };
}

// 把窗光加到颜色 c 上（c 是 [r,g,b]）；s 是额外的倍数（台面比地板亮一档）
export function sunOn(c, w, gx, gy, hp, x, y, s = 1) {
  const r = winSample(w, gx, gy, hp, x, y);
  if (!r || (w.block && w.block(gx, gy, hp, r.dh))) return c;
  const n = w.lit.length, t = w.litUp ? r.t : 1 - r.t;
  return glow(c, hex(w.lit[Math.min(n - 1, Math.floor(t * n))]), w.ls * s);
}

// 给 box 的顶面用：base 是颜色或 fn，这个面在 (x0,y0) 起、w×d 大、高 hp
export const litTop = (base, x0, y0, w, d, hp, win, s = 1) => (u, v, px, py, info) => {
  let c = typeof base === "function" ? base(u, v, px, py, info) : base;
  if (!c) return c;
  if (typeof c === "string") c = hex(c);
  return sunOn(c, win, x0 + u * w, y0 + v * d, hp, px, py, s);
};
