// 小世界的等距像素小屋：32×16 菱形格，地板 10×10，墙高 8 格（128px）。按像素算好再整张画出来，放大时不糊
// 所有东西都按「格子坐标」画：gx 沿后墙往右下，gy 沿左墙往左下，h 是离地高度（1 格 = 16px）
const TW = 32, TH = 16, N = 10, WALL = 8;
export const W = 352, H = 320;
const OX = 176, OY = 150; // 地板最靠后的那个角在画布上的位置

const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
// 光：用「滤色」提亮，不会像混颜色那样发灰
const glow = (a, l, t) => a.map((v, i) => Math.round(v + ((255 - (255 - v) * (255 - l[i]) / 255) - v) * t));

export function makeCanvas() {
  const buf = new Uint8ClampedArray(W * H * 4);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
  };
  const get = (x, y) => { const i = (y * W + x) * 4; return [buf[i], buf[i + 1], buf[i + 2]]; };
  return { buf, set, get };
}

// 屏幕像素 → 格子坐标（三个面各一个）
const floorAt = (x, y) => { const a = (x + 0.5 - OX) / 16, b = (y + 0.5 - OY) / 8; return { gx: (a + b) / 2, gy: (b - a) / 2 }; };
const backAt = (x, y) => { const gx = (x + 0.5 - OX) / 16; return { gx, h: (OY + 8 * gx - (y + 0.5)) / 16 }; }; // 后墙 gy=0
const leftAt = (x, y) => { const gy = (OX - (x + 0.5)) / 16; return { gy, h: (OY + 8 * gy - (y + 0.5)) / 16 }; }; // 左墙 gx=0
export const P = (gx, gy, h = 0) => [OX + (gx - gy) * 16, OY + (gx + gy) * 8 - h * 16];

// ---------- 画一间屋 ----------
export function drawRoom(cv, room, { grid = false, light = false, figure = false } = {}) {
  const C = Object.fromEntries(Object.entries(room.colors).map(([k, v]) => [k, Array.isArray(v) ? v.map(hex) : hex(v)]));
  const { set } = cv;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = null;
    // 地板
    const f = floorAt(x, y);
    if (f.gx >= 0 && f.gy >= 0 && f.gx < N && f.gy < N) {
      c = room.floor(f, C, x, y);
      if (light && room.floorLight) c = room.floorLight(f, c, C, x, y) || c;
      if (grid && (Math.abs(f.gx - Math.round(f.gx)) < 0.035 || Math.abs(f.gy - Math.round(f.gy)) < 0.07)) c = mix(c, [255, 255, 255], 0.35);
    }
    // 后墙（gy = 0 那一面）
    const b = backAt(x, y);
    if (b.gx >= 0 && b.gx < N && b.h >= 0 && b.h < WALL && f.gy < 0.001) c = room.backWall(b, C, x, y, light);
    // 左墙（gx = 0 那一面）
    const l = leftAt(x, y);
    if (l.gy >= 0 && l.gy < N && l.h >= 0 && l.h < WALL && f.gx < 0.001) c = room.leftWall(l, C, x, y, light);
    if (c) set(x, y, c);
  }
  // 墙顶的厚度和两头的截面：切开的房子才看得出墙有多厚
  const T = 0.35; // 墙厚（格）
  capTop(cv, C.cap, T);
  capEnds(cv, C.capSide, T);
  // 墙角那条竖线、墙脚线
  line(cv, P(0, 0, 0), P(0, 0, WALL), C.edge);
  if (figure) drawFigure(cv, ...P(6.2, 6.2), room.figure);
}

function poly(cv, pts, c) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) cv.set(x, y, c);
    }
}
function line(cv, [x0, y0], [x1, y1], c) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (;;) { cv.set(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
}
function capTop(cv, c, t) {
  // 后墙顶：在墙外侧（gy<0）那一条
  poly(cv, [P(-t, -t, WALL), P(N, -t, WALL), P(N, 0, WALL), P(0, 0, WALL), P(0, N, WALL), P(-t, N, WALL)], c);
}
function capEnds(cv, c, t) {
  poly(cv, [P(N, -t, WALL), P(N, 0, WALL), P(N, 0, 0), P(N, -t, 0)], c); // 后墙右端截面
  poly(cv, [P(-t, N, WALL), P(0, N, WALL), P(0, N, 0), P(-t, N, 0)], c); // 左墙前端截面
}

// 比例参考：一个 32px 高、2.5 头身的小人剪影（正式的人物以后画）
function drawFigure(cv, fx, fy, col = "#7a6f8c") {
  const c = hex(col), d = mix(c, [0, 0, 0], 0.35);
  const x0 = Math.round(fx) - 8, y0 = Math.round(fy) - 31;
  const rows = [
    ".....######.....", "....########....", "...##########...", "...##########...", "...##########...", "...##########...",
    "...##########...", "...##########...", "....########....", ".....######.....", "......####......", "....########....",
    "...##########...", "..############..", "..############..", "..##.######.##..", "..##.######.##..", "....########....",
    "....########....", "....###..###....", "....###..###....", "....###..###....", "....###..###....", "....###..###....",
  ];
  rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === "#") cv.set(x0 + i, y0 + 7 + j, j > 18 ? d : c); }));
  // 脚下一小块影子
  for (let i = -6; i <= 6; i++) cv.set(Math.round(fx) + i, Math.round(fy) + 1, mix(c, [0, 0, 0], 0.6));
}

// ---------- 小工具：木地板、抖动 ----------
export const dither = (x, y) => ((x + y) & 1) === 0;
export function planks(f, base, dark, mid, seed = 1) {
  // 木板沿后墙方向铺，每条半格宽；接缝错开
  const row = Math.floor(f.gy * 2);
  const v = f.gy * 2 - row;
  if (v < 0.13) return dark; // 板缝（往下 1 像素 = 0.125，再细就断成虚线了）
  const off = ((row * 7 + seed) % 5) * 0.7;
  const u = (f.gx + off) % 3.5;
  if (u < 0.07) return dark; // 板头接缝
  // 一点木纹
  const g = Math.sin((f.gx + row * 1.7) * 9.3) + Math.sin((f.gx * 2.1 + row) * 4.1);
  if (g > 1.75 && v > 0.3 && v < 0.7) return mid;
  return base;
}
export { hex, mix, glow };
