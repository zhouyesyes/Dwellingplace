// 第三版：脆脆「海边渔村的日式慵懒」（抬高的地台 + 地炉），Rowan「夜航书房」（左墙观星窗 + 观星榻台）
import { planks, dither, mix } from "./iso.js";
import { bar, sunOn } from "./light.js";
import { cuiFurnish, cuiLights, rowanFurnish, rowanLights, rowanRug } from "./furniture.js";

const inRect = (u, v, u0, u1, v0, v1) => u >= u0 && u < u1 && v >= v0 && v < v1;
const clamp = t => Math.max(0, Math.min(0.999, t));

// 窗：u 沿墙、h 高度（后墙 u=gx，左墙 u=gy，两面墙都一样）。view(s, t) 画窗外，t 已经抵消了墙的斜度
function windowPx(u, h, w, C, view, x, y) {
  if (!inRect(u, h, w.u0, w.u1, w.h0, w.h1)) return null;
  const fu = w.frame ?? 0.16, fh = w.frame ?? 0.2;
  const inU = u - w.u0, inH = h - w.h0, U = w.u1 - w.u0, V = w.h1 - w.h0;
  if (inH < 0.32) return inH < 0.1 ? C.sillDark : C.sill;
  if (inU < fu || inU > U - fu || inH > V - fh) return C.frame;
  const s = (inU - fu) / (U - 2 * fu), tv = (inH - 0.32) / (V - 0.32 - fh);
  const midH = inH - (u - (w.u0 + w.u1) / 2) * 0.5;
  const t = w.planeView ? clamp(tv) : clamp((midH - 0.32) / (V - 0.32 - fh)); // planeView：窗外的景顺着窗框走，海面和窗台平行
  const b = bar(w, s, tv);
  if (b) return b === 2 ? C.frame : C.frameIn;
  if (inH > V - fh - 0.1) return C.frameIn; // 窗楣下面一道阴影
  if (w.slide && s >= 0.5 && s < 0.52) return C.frameIn; // 叠着的那两扇有厚度
  return view(s, t, x, y);
}

// 墙脚和墙角磨旧一点：住久了的痕迹
function wear(c, u, h, x, y, opt, C) {
  if (!opt?.furniture) return c;
  const r = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  if (h > 0.35 && h < 0.9 && r % 23 === 0) return mix(c, C.wearC, 0.3);
  if (u < 0.5 && r % 17 === 0) return mix(c, C.wearC, 0.22);
  return c;
}

// 门洞里的走廊：下面亮上面暗
function hallPx(h, h1, C, x, y) {
  const k = h / h1;
  return k < 0.35 ? C.hall[0] : k < 0.7 ? (dither(x, y) && k < 0.42 ? C.hall[0] : C.hall[1]) : C.hall[2];
}

// ======================= 脆脆 =======================
const cuiWin = {
  wall: "back", u0: 4.3, u1: 9.75, h0: 1.4, h1: 6.8, lattice: [2, 3], slide: true, planeView: true,
  k: 0.8, sh: 0.32, lit: ["#FFD08A", "#FFB86A", "#FF9E4A"], ls: 0.7,
};
// 地台：后墙右半边，抬高一格
export const cuiDeck = { x: 4.2, y: 0, w: 5.8, d: 6.6, h: 1 };
// 下层地板上的光：先被地台挡住的那一条不亮
cuiWin.block = (gx, gy, hp, dh) => {
  if (hp >= cuiDeck.h) return false;
  const up = cuiDeck.h - hp; // 往窗那边走、升到地台面的高度时，在哪
  return gx + cuiWin.sh * up >= cuiDeck.x && gy - cuiWin.k * up < cuiDeck.d;
};

export const cui = {
  name: "脆脆",
  colors: {
    wood: "#C89A6B", woodDark: "#8A6240", woodMid: "#B88A5C",
    wall: "#EFE0C4", wallL: "#E4D2B2", wallLow: "#D9C39E", base: "#8A6240", wearC: "#B79A72",
    wain: "#CDB089", wainL: "#C3A57E", wainSeam: "#A88A62", rail: "#9A7550",
    cap: "#F6EBD6", capSide: "#C9B08A", edge: "#CDB592",
    frame: "#7A5638", frameIn: "#8C6844", sill: "#A27650", sillDark: "#6E4D30",
    sky: ["#6F6AA0", "#8C79A8", "#B285A0", "#D99A8C", "#F2B080", "#FFC888", "#FFD8A0"], sun: "#FFE9B8",
    sea: "#4A6B96", seaDark: "#3B577E", glint: "#FFC27A", boat: "#3A3448", bird: "#4A3F55", sail: "#E8DCC8",
    doorFrame: "#6A4A30", paper: "#FBE7BE", paperDim: "#EED7AA", kumiko: "#9A7550", koshi: "#8A6240",
    hall: ["#FFD9A0", "#E9B57A", "#B88758"],
  },
  win: cuiWin,
  // 推拉格子门：左墙，u0–u1 整个门框；靠里那扇推开了（open 段），两扇纸门叠在靠外那段
  door: { u0: 7.45, open: 8.65, u1: 9.85, h1: 4.4 },
  furnish: cuiFurnish,
  lights: cuiLights,
  floor(f, C) { return planks(f, C.wood, C.woodDark, C.woodMid, 3); },
  backWall(b, C, x, y) {
    const w = windowPx(b.gx, b.h, this.win, C, (s, t, px, py) => {
      const horizon = 0.26;
      if (t > horizon) {
        const k = (t - horizon) / (1 - horizon);
        const ds = Math.hypot((s - 0.3) * 1.6, t - horizon);
        if (ds < 0.11) return C.sun;
        if (ds < 0.14 && dither(px, py)) return C.sun;
        for (const [bs, bt] of [[0.62, 0.72], [0.7, 0.8]]) {
          const dx = (s - bs) * 60, dy = (t - bt) * 50;
          if (Math.abs(dy - Math.abs(dx) * 0.5) < 0.6 && Math.abs(dx) < 2.2) return C.bird;
        }
        return C.sky[Math.min(C.sky.length - 1, Math.floor((1 - k) * C.sky.length))];
      }
      // 远处一只小帆船（在开着的那半扇里）
      if (s > 0.08 && s < 0.18 && t > horizon - 0.03 && t < horizon) return C.boat;
      if (Math.abs(s - 0.13) < 0.008 && t >= horizon && t < horizon + 0.12) return C.boat;
      if (s > 0.132 && s < 0.17 && t >= horizon + 0.02 && t < horizon + 0.11 - (s - 0.132) * 2) return C.sail;
      const k = t / horizon;
      if (Math.abs(s - 0.3) < 0.04 + (1 - k) * 0.1 && (px * 3 + py * 5) % 7 < 2) return C.glint;
      return k > 0.55 ? C.sea : C.seaDark;
    }, x, y);
    if (w) return w;
    return wear(cuiWain(b.gx, b.h, C, C.wall, C.wain), b.gx, b.h, x, y, this.opt, C);
  },
  leftWall(l, C, x, y) {
    const d = this.door;
    if (inRect(l.gy, l.h, d.u0 - 0.14, d.u1 + 0.14, 0, d.h1 + 0.16)) {
      if (!inRect(l.gy, l.h, d.u0, d.u1, 0, d.h1)) return C.doorFrame;
      if (l.gy < d.open) return hallPx(l.h, d.h1, C, x, y); // 推开的那一段：看得到走廊
      // 两扇纸门叠着：木格 + 被走廊的光照暖的纸，下面一截木板
      const u = (l.gy - d.open) / (d.u1 - d.open), v = l.h / d.h1;
      if (u < 0.05 || u > 0.95 || v > 0.96) return C.kumiko;
      if (v < 0.16) return v > 0.14 ? C.kumiko : C.koshi;
      if (near(u * 3, 0.06) || near((v - 0.16) / 0.8 * 6, 0.09)) return C.kumiko;
      return v < 0.5 ? C.paper : C.paperDim;
    }
    return wear(cuiWain(l.gy, l.h, C, C.wallL, C.wainL), l.gy, l.h, x, y, this.opt, C);
  },
  // 晚霞的光：开着的半扇是一整块亮，关着的半扇带木格影子
  floorLight(f, c, C, x, y) { return sunOn(c, this.win, f.gx, f.gy, 0, x, y); },
};
const near = (m, bw) => Math.abs(m - Math.round(m)) < bw;

// 腰板：墙下半截一圈深一档的木板（竖缝），上面压一条横木
function cuiWain(u, h, C, wall, wain) {
  if (h < 0.3) return C.base;
  if (h < 1.45) return (u * 2.5) % 1 < 0.06 ? C.wainSeam : wain;
  if (h < 1.58) return C.rail;
  return h < 1.66 ? mix(wall, C.rail, 0.25) : wall;
}

// ======================= Rowan =======================
const rowanWin = {
  wall: "left", u0: 1.0, u1: 6.0, h0: 2.6, h1: 6.7, frame: 0.22, lattice: [3, 1], planeView: true,
  k: 0.9, sh: -0.15, lit: ["#6F86D6", "#5A6FC0", "#4B5CA8"], litUp: true, ls: 0.5, soft: 0.24,
};
export const rowan = {
  name: "Rowan",
  colors: {
    wood: "#6E4D35", woodDark: "#3E2A1C", woodMid: "#5E412C",
    wall: "#2F4B3C", wallL: "#283F33", panel: "#4A3424", panelDark: "#33231A", rail: "#6B4C33", base: "#2A1C13", wearC: "#1E2E25",
    cap: "#46624F", capSide: "#1E3027", edge: "#1F332A",
    frame: "#33241A", frameIn: "#3E2C1F", sill: "#5E432D", sillDark: "#3A2A1C",
    sky: ["#121731", "#171D3C", "#1D2448", "#242D57", "#2C3663"], star: "#E6E9FF", starDim: "#8F97C9",
    land: "#0E1426", sea: "#1C2A4A", seaLight: "#2E4370", moonDisc: "#F2EBCF",
    tower: "#E9E3D2", towerRed: "#B5473A", lamp: "#FFE7A6", beam: "#C9B98A",
    doorFrame: "#2A1C13", hall: ["#E8B070", "#B98454", "#7A5636"],
  },
  win: rowanWin,
  door: { u0: 8.55, u1: 9.6, h1: 4.4 }, // 后墙右头，窄门
  furnish: rowanFurnish,
  lights: rowanLights,
  rug: rowanRug,
  floor(f, C) { return planks(f, C.wood, C.woodDark, C.woodMid, 1); },
  backWall(b, C, x, y) {
    const d = this.door;
    if (inRect(b.gx, b.h, d.u0 - 0.14, d.u1 + 0.14, 0, d.h1 + 0.16)) {
      if (!inRect(b.gx, b.h, d.u0, d.u1, 0, d.h1)) return C.doorFrame;
      return hallPx(b.h, d.h1, C, x, y);
    }
    return wear(wainscot(b.gx, b.h, C, C.wall), b.gx, b.h, x, y, this.opt, C);
  },
  leftWall(l, C, x, y) {
    const w = windowPx(l.gy, l.h, this.win, C, (s, t, px, py) => {
      // 左墙上 s 往屏幕左边走：灯塔放在 s 小的那头（靠墙角），光往右扫、刚擦到窗框就停
      const horizon = 0.32;
      if (t > horizon) {
        const coast = horizon + 0.07 + 0.05 * Math.sin(s * 9);
        if (t < coast && s > 0.45) return C.land;
        const ts = 0.18, tw = 0.035, top = horizon + 0.36;
        if (s > ts - 0.02 && s < ts + tw + 0.02 && t < horizon + 0.05) return C.land;
        if (s > ts && s < ts + tw && t < top) return Math.floor((t - horizon) * 28) % 2 ? C.towerRed : C.tower;
        if (s > ts - 0.008 && s < ts + tw + 0.008 && t >= top && t < top + 0.07) return C.lamp;
        if (s > ts + 0.004 && s < ts + tw - 0.004 && t >= top + 0.07 && t < top + 0.1) return C.towerRed;
        const bx = ts - s, by = t - (top + 0.035);
        if (bx > 0 && Math.abs(by) < 0.012 + bx * 0.06 && (px + py) % 3 === 0) return C.beam; // 往窗框那边扫，到框就没了
        // 月亮：窗的右上，一弯
        const md = Math.hypot((s - 0.72) * 2.4, t - 0.78);
        if (md < 0.1 && Math.hypot((s - 0.745) * 2.4, t - 0.8) > 0.085) return C.moonDisc;
        const k = (t - horizon) / (1 - horizon);
        const hsh = (px * 73856093) ^ (py * 19349663);
        if ((hsh & 255) === 7) return C.star;
        if ((hsh & 127) === 3) return C.starDim;
        return C.sky[Math.min(C.sky.length - 1, Math.floor((1 - k) * C.sky.length))];
      }
      const k = t / horizon;
      if ((px * 5 + py * 3) % 11 === 0 && k > 0.3) return C.seaLight;
      if (Math.abs(s - 0.72) < 0.03 && (px + 2 * py) % 4 === 0) return C.moonDisc; // 月亮在海上的倒影
      return C.sea;
    }, x, y);
    if (w) return w;
    return wear(wainscot(l.gy, l.h, C, C.wallL), l.gy, l.h, x, y, this.opt, C);
  },
  // 月光：从左墙的窗斜照进来，冷蓝紫，带三格窗的影子
  floorLight(f, c, C, x, y) { return sunOn(c, this.win, f.gx, f.gy, 0, x, y); },
};

function wainscot(u, h, C, wall) {
  if (h < 0.3) return C.base;
  if (h < 2.2) return (u * 2) % 1 < 0.09 ? C.panelDark : C.panel;
  if (h < 2.4) return C.rail;
  return wall;
}
