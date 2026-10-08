// 两间屋子的骨架和光：只有地板、两面墙、窗（脆脆还有门），家具下一步
import { planks, dither, mix, glow } from "./engine.js";

const inRect = (u, v, u0, u1, v0, v1) => u >= u0 && u < u1 && v >= v0 && v < v1;

// 窗：在墙面坐标（u 沿墙，h 高度）里画。frame 是框，view(u01, v01) 画窗外
function windowPx(u, h, w, C, view) {
  if (!inRect(u, h, w.u0, w.u1, w.h0, w.h1)) return null;
  const fu = 0.16, fh = 0.2; // 框的粗细（格）
  const inU = u - w.u0, inH = h - w.h0, U = w.u1 - w.u0, V = w.h1 - w.h0;
  // 外框（下框是窗台，厚一点）
  if (inH < 0.32) return inH < 0.1 ? C.sillDark : C.sill;
  if (inU < fu || inU > U - fu || inH > V - fh) return C.frame;
  // 竖棂、横棂
  if (Math.abs(inU - U / 2) < 0.07 || Math.abs(inH - (V * 0.58)) < 0.06) return C.frame;
  // 框内侧一圈暗边，像窗洞有深度
  if (inU < fu + 0.08 || inH > V - fh - 0.1) return C.frameIn;
  // 窗外的景按屏幕横着画（海平线是水平的），不跟着墙斜
  const s = (inU - fu) / (U - 2 * fu);
  const midH = inH - (u - (w.u0 + w.u1) / 2) * 0.5; // 抵消墙面的斜度
  return view(s, Math.max(0, Math.min(0.999, (midH - 0.32) / (V - 0.32 - fh))));
}

// ---------------- 脆脆：傍晚的海 ----------------
export const cui = {
  name: "脆脆",
  bg: "#4a3d35", // 房子外面的底色（以后可以换成四季的背景）
  colors: {
    wood: "#C89A6B", woodDark: "#8A6240", woodMid: "#B88A5C",
    wall: "#EFE0C4", wallL: "#E4D2B2", wallLow: "#D9C39E", base: "#8A6240",
    cap: "#F6EBD6", capSide: "#C9B08A", edge: "#CDB592",
    frame: "#7A5638", frameIn: "#5E412A", sill: "#9C7148", sillDark: "#6E4D30",
    sky: ["#7D6FA3", "#B07FA0", "#E59A86", "#FFB878", "#FFD08A"], sun: "#FFE9B8",
    sea: "#4A6B96", seaDark: "#3B577E", glint: "#FFC27A",
    door: "#8A6240", doorDark: "#6A4A30", doorLight: "#A47852", knob: "#E8C26A",
    lit: ["#FFD08A", "#FFB86A", "#FF9E4A"], // 靠窗 → 远处
  },
  win: { u0: 3.2, u1: 7.2, h0: 2.2, h1: 6.6 },
  door: { u0: 5.6, u1: 7.6, h0: 0, h1: 4.6 },
  floor(f, C) { return planks(f, C.wood, C.woodDark, C.woodMid, 3); },
  backWall(b, C, x, y, light) {
    const w = windowPx(b.gx, b.h, this.win, C, (s, t) => {
      // 窗外：上面是渐变的晚霞（分成几条色带，像素画不用平滑渐变），下面是海
      const horizon = 0.42;
      if (t > horizon) {
        const k = (t - horizon) / (1 - horizon);
        const band = Math.min(C.sky.length - 1, Math.floor((1 - k) * C.sky.length));
        // 太阳：一半沉在海平线下
        const ds = Math.hypot((s - 0.62) * 1.6, t - horizon);
        if (ds < 0.13) return C.sun;
        if (ds < 0.17 && dither(x, y)) return C.sun;
        return C.sky[band];
      }
      // 海：两层蓝，太阳下面一条碎光
      const k = t / horizon;
      if (Math.abs(s - 0.62) < 0.05 + (1 - k) * 0.12 && (x * 3 + y * 5) % 7 < 2) return C.glint;
      if (k > 0.85 && (x + y * 3) % 9 === 0) return C.glint;
      return k > 0.55 ? C.sea : C.seaDark;
    });
    if (w) return w;
    if (b.h < 0.35) return C.base; // 踢脚线
    return b.h < 0.45 ? C.wallLow : C.wall;
  },
  leftWall(l, C, x, y) {
    // 门：在左墙上
    const d = this.door;
    if (inRect(l.gy, l.h, d.u0 - 0.15, d.u1 + 0.15, d.h0, d.h1 + 0.15)) {
      if (!inRect(l.gy, l.h, d.u0, d.u1, d.h0, d.h1)) return C.doorDark; // 门框
      const u = l.gy - d.u0, h = l.h - d.h0;
      if (Math.abs(u - 1.55) < 0.12 && Math.abs(h - 2.2) < 0.12) return C.knob;
      // 两块门板
      const inP = (h > 0.4 && h < 2.0) || (h > 2.4 && h < 4.2);
      if (inP && u > 0.25 && u < 1.75) return (u < 0.32 || h > 4.12 || (h > 1.93 && h < 2.0)) ? C.doorDark : C.doorLight;
      return C.door;
    }
    if (l.h < 0.35) return C.base;
    return l.h < 0.45 ? C.wallLow : C.wallL;
  },
  // 窗里斜切进来的晚霞光：窗洞往屋里投到地板上，越远越橙
  floorLight(f, c, C, x, y) {
    const k = 0.78, sh = 0.32; // 光往屋里斜下来、往左偏一点
    const h = f.gy / k, gx = f.gx + sh * h;
    const w = this.win;
    const inside = h > w.h0 + 0.3 && h < w.h1 - 0.2 && gx > w.u0 + 0.16 && gx < w.u1 - 0.16;
    if (!inside) return null;
    const U = w.u1 - w.u0, inU = gx - w.u0, inH = h - w.h0, V = w.h1 - w.h0;
    // 窗棂的影子
    if (Math.abs(inU - U / 2) < 0.1 || Math.abs(inH - V * 0.58) < 0.09) return null;
    // 边缘一像素抖动，光斑边才是软的
    const edge = Math.min(gx - w.u0 - 0.16, w.u1 - 0.16 - gx, h - w.h0 - 0.3, w.h1 - 0.2 - h);
    if (edge < 0.12 && !dither(x, y)) return null;
    const t = (h - w.h0) / V; // 0 = 靠窗，1 = 最远
    const lc = C.lit[Math.min(2, Math.floor((1 - t) * 3))];
    return glow(c, lc, 0.75);
  },
};

// ---------------- Rowan：夜里写字的小屋 ----------------
export const rowan = {
  name: "Rowan",
  bg: "#141a22",
  figure: "#6f7f8f",
  colors: {
    wood: "#6E4D35", woodDark: "#3E2A1C", woodMid: "#5E412C",
    wall: "#2F4B3C", wallL: "#283F33", wallLight: "#3A5A48",
    panel: "#4A3424", panelDark: "#33231A", rail: "#6B4C33", base: "#2A1C13",
    cap: "#46624F", capSide: "#1E3027", edge: "#1F332A",
    frame: "#4F3826", frameIn: "#33241A", sill: "#5E432D", sillDark: "#3A2A1C",
    sky: ["#141A33", "#1A2141", "#222B52", "#2C3663"], star: "#E6E9FF", starDim: "#8F97C9",
    land: "#10162A", sea: "#1C2A4A", seaLight: "#2A3D66",
    tower: "#D9D3C4", towerDark: "#8C8678", beam: "#FFE7A6",
    moon: ["#6F86D6", "#5A6FC0", "#4B5CA8"],
  },
  win: { u0: 3.4, u1: 7.8, h0: 2.6, h1: 7.0 },
  floor(f, C) { return planks(f, C.wood, C.woodDark, C.woodMid, 1); },
  backWall(b, C, x, y) {
    const w = windowPx(b.gx, b.h, this.win, C, (s, t) => {
      const horizon = 0.3;
      if (t > horizon) {
        // 远处的海岸线和灯塔
        const coast = horizon + 0.06 + 0.05 * Math.sin(s * 9) * (s < 0.7 ? 1 : 0.3);
        if (t < coast && s < 0.78) return C.land;
        // 灯塔：右边一小座，顶上一点光，光束往左上扫
        if (s > 0.8 && s < 0.86 && t < horizon + 0.24) return t > horizon + 0.2 ? C.beam : ((x + y) % 4 < 2 ? C.tower : C.towerDark);
        const bx = s - 0.83, by = t - (horizon + 0.22);
        if (bx < 0 && bx > -0.3 && Math.abs(by - bx * -0.12) < 0.01 - bx * 0.06 && dither(x, y)) return C.beam;
        // 星空：几条深蓝色带 + 零星的星星
        const k = (t - horizon) / (1 - horizon);
        const band = Math.min(C.sky.length - 1, Math.floor((1 - k) * C.sky.length));
        const h = (x * 73856093) ^ (y * 19349663);
        if ((h & 255) === 7) return C.star;
        if ((h & 127) === 3) return C.starDim;
        return C.sky[band];
      }
      // 海：月光碎在上面
      const k = t / horizon;
      if ((x * 5 + y * 3) % 11 === 0 && k > 0.3) return C.seaLight;
      return C.sea;
    });
    if (w) return w;
    return wainscot(b.gx, b.h, C, C.wall);
  },
  leftWall(l, C, x, y) {
    return wainscot(l.gy, l.h, C, C.wallL);
  },
  // 窗里落进来的月光：偏冷的蓝紫，淡淡一块（提灯是家具，下一步再加）
  floorLight(f, c, C, x, y) {
    const k = 0.62, sh = -0.15;
    const h = f.gy / k, gx = f.gx + sh * h;
    const w = this.win;
    if (!(h > w.h0 + 0.3 && h < w.h1 - 0.2 && gx > w.u0 + 0.16 && gx < w.u1 - 0.16)) return null;
    const U = w.u1 - w.u0, inU = gx - w.u0, inH = h - w.h0, V = w.h1 - w.h0;
    if (Math.abs(inU - U / 2) < 0.1 || Math.abs(inH - V * 0.58) < 0.09) return null;
    const edge = Math.min(gx - w.u0 - 0.16, w.u1 - 0.16 - gx, h - w.h0 - 0.3, w.h1 - 0.2 - h);
    if (edge < 0.12 && !dither(x, y)) return null;
    const t = (h - w.h0) / V;
    return glow(c, C.moon[Math.min(2, Math.floor(t * 3))], 0.55);
  },
};

// 下半截木护墙板 + 上面的深绿墙
function wainscot(u, h, C, wall) {
  if (h < 0.3) return C.base;
  if (h < 2.2) return (u * 2) % 1 < 0.09 ? C.panelDark : C.panel; // 竖着的护墙木板
  if (h < 2.4) return C.rail;
  return wall;
}

export const ISO_ROOMS = { cui, rowan };
