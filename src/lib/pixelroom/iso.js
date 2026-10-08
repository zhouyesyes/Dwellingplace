// 等距像素小屋：32×16 菱形格，地板 10×10，墙高 8 格（128px）
// 所有东西都按「格子坐标」画：gx 沿后墙往右下，gy 沿左墙往左下，h 是离地高度（1 格 = 16px）
const TW = 32, TH = 16, N = 10, WALL = 8;
export const W = 352, H = 320;
const OX = 176, OY = 150; // 地板最靠后的那个角在画布上的位置

const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
// 光：用「滤色」提亮，不会像混颜色那样发灰
const glow = (a, l, t) => a.map((v, i) => Math.round(v + ((255 - (255 - v) * (255 - l[i]) / 255) - v) * t));

// 画布：颜色 + 每个像素的「深度」（gx+gy，越大越靠前，小人走到家具后面就会被挡住）+ 点到的是什么东西（tag）
export const TAGS = [""];
export const tagId = name => { let i = TAGS.indexOf(name); if (i < 0) { i = TAGS.length; TAGS.push(name); } return i; };
export function makeCanvas(buf = new Uint8ClampedArray(W * H * 4)) {
  const depth = new Float32Array(W * H).fill(-99), tags = new Uint8Array(W * H);
  const cv = { buf, depth, tags, z: -99, tag: 0 };
  cv.set = (x, y, c, d = cv.z) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = y * W + x, i = p * 4;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
    depth[p] = d; tags[p] = cv.tag;
  };
  cv.get = (x, y) => { const i = (y * W + x) * 4; return [buf[i], buf[i + 1], buf[i + 2]]; };
  return cv;
}

// 屏幕像素 → 格子坐标（三个面各一个）
const floorAt = (x, y) => { const a = (x + 0.5 - OX) / 16, b = (y + 0.5 - OY) / 8; return { gx: (a + b) / 2, gy: (b - a) / 2 }; };
const backAt = (x, y) => { const gx = (x + 0.5 - OX) / 16; return { gx, h: (OY + 8 * gx - (y + 0.5)) / 16 }; }; // 后墙 gy=0
const leftAt = (x, y) => { const gy = (OX - (x + 0.5)) / 16; return { gy, h: (OY + 8 * gy - (y + 0.5)) / 16 }; }; // 左墙 gx=0
export const P = (gx, gy, h = 0) => [OX + (gx - gy) * 16, OY + (gx + gy) * 8 - h * 16];

// ---------- 画一间屋 ----------
export function drawRoom(cv, room, { grid = false, light = false, figure = false, furniture = false, state = {} } = {}) {
  const C = Object.fromEntries(Object.entries(room.colors).map(([k, v]) => [k, Array.isArray(v) ? v.map(hex) : hex(v)]));
  const { set } = cv;
  room.opt = { grid, light, furniture };
  room.state = state;
  room.C = C;
  room.win.px = []; // 窗外看得到的那些像素：窗外的景会动，每一帧只重画这些
  const lights = typeof room.lights === "function" ? room.lights(state) : room.lights;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = null, pt = null;
    // 地板
    const f = floorAt(x, y);
    if (f.gx >= 0 && f.gy >= 0 && f.gx < N && f.gy < N) {
      c = room.floor(f, C, x, y); pt = [f.gx, f.gy, 0];
      if (furniture && room.rug) c = room.rug(f, c, C, x, y) || c; // 地毯在光下面，窗光、灯光照得到
      if (light && room.floorLight) c = room.floorLight(f, c, C, x, y) || c;
      if (grid && (Math.abs(f.gx - Math.round(f.gx)) < 0.035 || Math.abs(f.gy - Math.round(f.gy)) < 0.07)) c = mix(c, [255, 255, 255], 0.35);
    }
    // 后墙（gy = 0 那一面）、左墙（gx = 0 那一面）。room.hit 由墙的着色器设：窗、门
    room.hit = "";
    const b = backAt(x, y);
    if (b.gx >= 0 && b.gx < N && b.h >= 0 && b.h < WALL && f.gy < 0.001) { c = room.backWall(b, C, x, y, light); pt = [b.gx, 0, b.h]; }
    const l = leftAt(x, y);
    if (l.gy >= 0 && l.gy < N && l.h >= 0 && l.h < WALL && f.gx < 0.001) { room.hit = ""; c = room.leftWall(l, C, x, y, light); pt = [0, l.gy, l.h]; }
    if (c && light && furniture && lights) {
      // 屋里的光源（火塘、提灯）：照在地板和墙上，分几圈、边上抖动，像素画的光
      c = applyLights(c, pt, lights, x, y, pt[2] > 0);
    }
    cv.tag = room.hit ? tagId(room.hit) : 0;
    if (c) set(x, y, c, pt[0] + pt[1]);
    cv.tag = 0;
  }
  // 墙顶的厚度和两头的截面：切开的房子才看得出墙有多厚
  const T = 0.35; // 墙厚（格）
  capTop(cv, C.cap, T);
  capEnds(cv, C.capSide, T);
  // 墙角那条竖线、墙脚线
  line(cv, P(0, 0, 0), P(0, 0, WALL), C.edge);
  if (furniture && room.furnish) room.furnish(cv, light ? lights : null, state);
  cv.tag = 0; cv.z = -99;
  if (figure) drawFigure(cv, ...P(6.2, 6.2), room.figure);
}

// 光源：{ at: [gx, gy, h], r: 半径（格）, color, s: 强度 }。分三圈，圈和圈之间抖动
export function applyLights(c, [px, py, ph], lights, x, y, wall = false) {
  for (const L of lights) {
    if (wall && L.noWall) continue;
    const d = Math.hypot(px - L.at[0], py - L.at[1], (ph - L.at[2]) * 1.2) / L.r;
    if (d >= 1) continue;
    // 分五圈，越外越淡；每圈交界用棋盘格抖动，看起来是柔的光而不是一个圆圈
    const steps = [0.2, 0.4, 0.6, 0.8, 1];
    let i = steps.findIndex(e => d < e);
    if (i > 0 && d - steps[i - 1] < 0.05 && dither(x, y)) i -= 1;
    const k = [1, 0.7, 0.45, 0.25, 0.1][i];
    c = glow(c, hex(L.color), L.s * k * (wall ? 0.3 : 1));
  }
  return c;
}

// 一个平面四边形：起点 O、两条边 A、B（都是格子坐标 [gx, gy, h]），fn(u, v, x, y) 返回颜色（u, v 在 0–1）
// 墙上的画、家具的每个面都用它画；lights 给了的话顺便打光
export function quad(cv, O, A, B, fn, lights) {
  const pr = ([a, b, h]) => [(a - b) * 16, (a + b) * 8 - h * 16];
  const [ox, oy] = P(...O), [ax, ay] = pr(A), [bx, by] = pr(B);
  const det = ax * by - ay * bx;
  if (Math.abs(det) < 1e-6) return;
  const xs = [ox, ox + ax, ox + bx, ox + ax + bx], ys = [oy, oy + ay, oy + by, oy + ay + by];
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by); // 两条边在屏幕上有多长（像素）
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      const dx = x + 0.5 - ox, dy = y + 0.5 - oy;
      const u = (dx * by - dy * bx) / det, v = (ax * dy - ay * dx) / det;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      let c = fn(u, v, x, y, { la, lb, edge: Math.min(u * la, (1 - u) * la, v * lb, (1 - v) * lb) });
      if (!c) continue;
      if (typeof c === "string") c = hex(c);
      const p0 = O[0] + u * A[0] + v * B[0], p1 = O[1] + u * A[1] + v * B[1];
      if (lights) c = applyLights(c, [p0, p1, O[2] + u * A[2] + v * B[2]], lights, x, y);
      cv.set(x, y, c, p0 + p1);
    }
}

// 一个方块（家具的基本形状）：位置 x,y,z（格），大小 w（沿 gx）d（沿 gy）h（高）
// col = { top, left, right, line }：left 是朝左下的那面（+gy），right 是朝右下的那面（+gx）
// 每个面可以是颜色，也可以是 fn(u, v, x, y, info) 自己画花纹
export function box(cv, { x, y, z = 0, w, d, h }, col, lights) {
  const face = (paint, base) => (u, v, px, py, info) => {
    if (col.line && info.edge < 1) return col.line; // 一像素的描边，家具才立得住
    return typeof paint === "function" ? paint(u, v, px, py, info) : paint;
  };
  quad(cv, [x, y + d, z], [w, 0, 0], [0, 0, h], face(col.left), lights); // 朝左下
  quad(cv, [x + w, y, z], [0, d, 0], [0, 0, h], face(col.right), lights); // 朝右下
  quad(cv, [x, y, z + h], [w, 0, 0], [0, d, 0], face(col.top), lights); // 顶
}

// 照着字符画放一张小贴图（火苗、叶子、羽毛笔这些），左下角对准 P(gx, gy, h)
export function sprite(cv, [gx, gy, h], rows, pal, lights) {
  const [sx, sy] = P(gx, gy, h);
  const H0 = rows.length;
  rows.forEach((r, j) => [...r].forEach((ch, i) => {
    if (ch === "." || ch === " ") return;
    let c = hex(pal[ch]);
    if (lights) c = applyLights(c, [gx, gy, h + (H0 - j) / 16], lights, 0, 0);
    cv.set(Math.round(sx) + i, Math.round(sy) - H0 + j, c, gx + gy);
  }));
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
  // 几块深浅不同的板：地板不是一个颜色铺到底
  const seg = Math.floor((f.gx + off) / 3.5);
  const hsh = ((row * 92821) ^ (seg * 68917) ^ (seed * 31)) >>> 0;
  if (hsh % 5 === 0) return mix(base, dark, 0.22);
  if (hsh % 7 === 1) return mix(base, [255, 255, 255], 0.07);
  return base;
}
export { hex, mix, glow };

// ---------- 第二版加的：地上的东西、阴影、整片的光 ----------
// 地上的一块（地毯、光带）：x,y 起点，w 沿 gx、d 沿 gy
export const floorQuad = (cv, x, y, w, d, fn, lights) => quad(cv, [x, y, 0.002], [w, 0, 0], [0, d, 0], fn, lights);

// 家具脚下的接触阴影：把已经画好的地板压暗一圈，边上抖一下
export function shadow(cv, x, y, w, d, k = 0.3, m = 0.18) {
  floorQuad(cv, x - m, y - m * 0.4, w + m * 1.6, d + m * 1.6, (u, v, px, py, info) => {
    const edge = Math.min(u * (w + m * 1.6), (1 - u) * (w + m * 1.6), v * (d + m * 1.6), (1 - v) * (d + m * 1.6));
    if (edge < 0.12 && dither(px, py)) return null;
    return mix(cv.get(px, py), [20, 12, 8], k);
  });
}

// 一片光照在地上（门缝漏进来的光）：inside(gx, gy) 返回 0–1 的强度
export function floorGlow(cv, x, y, w, d, color, inside) {
  const c = hex(color);
  floorQuad(cv, x, y, w, d, (u, v, px, py) => {
    const gx = x + u * w, gy = y + v * d;
    if (gx < 0 || gy < 0 || gx >= 10 || gy >= 10) return null; // 只照在屋里的地板上
    const k = inside(gx, gy, px, py);
    if (!k) return null;
    return glow(cv.get(px, py), c, k);
  });
}
