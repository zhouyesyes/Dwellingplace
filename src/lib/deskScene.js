// 像素书桌（还在做）：正面稍微往下看，能看见浅木桌面。白墙、淡木头，格子大一点（96 × 160）。
// 每样东西都不是一个颜色：上亮、中间本色、下沉一点，右边一道暗，边线只比本色深一点——有层次、但柔和。
// 白天：窗外树荫，阳光斜照进来；夜里：同一套东西压暗偏蓝，窗外月亮星星，台灯罩子是亮的（不加发光）。
// 墙上：两层书架（第一层是你在写的书，书之间留空、一本斜靠），一小盆绿萝，两幅小画（小章鱼、小螃蟹），他贴的便利贴。
import { SPINES } from "./writing.js";

export const W = 96, H = 160;

const D = {
  wall: "#f8f6f2", wallTop: "#fbfaf7", wallLow: "#f2eee7", wallShadow: "#e9e3d9",
  frame: "#fdfcf9", frameLine: "#ddd4c6",
  sky1: "#b9daf1", sky2: "#c9e3f5", sky3: "#dbedf8", cloud: "#ffffff",
  leaf1: "#a7cf9b", leaf2: "#8ebf86", leaf3: "#bcdcae", leaf4: "#7fb079",
  shelf: "#e3cfb4",
  leaf: "#8cc083", leafHi: "#acd8a0", leafLo: "#72a86c", pot: "#e9bba6", soil: "#a88a76",
  mat: "#fdfcf9", pframe: "#dfccb2",
  oct: "#f2a9c2", octLo: "#e08cab", octHi: "#ffd9e6", crab: "#f29a7c", crabLo: "#e07f5f", crabHi: "#ffc5ae", eye: "#5a4a50",
  top: "#ecdcc6", front: "#e0caad", knob: "#cfaa70",
  lamp: "#f2ede5", lampShade: "#f1ebe1",
  paper: "#fffdf8", ink: "#ddd2c1", book: "#aac7dd",
  mug: "#fbf9f5", stripe: "#eaa79b", coffee: "#a88a73",
  cup: "#b8d4b3", pen1: "#e8c98f", pen2: "#e6a99a", pen3: "#a9c6dc",
  noteMe: "#f8e8a6", noteHim: "#d3e8f7",
  shade: "#00000014",
};

const hex = c => [16, 8, 0].map(s => (parseInt(c.slice(1, 7), 16) >> s) & 255);
const toHex = a => `#${a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, t) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v * (1 - t) + y[i] * t)); };
const DARK = "#6b5a4a";
const night = c => (c.length === 7 ? mix(c, "#1a2033", 0.68) : c);
export const WALL = { day: D.wall, night: night(D.wall) };

const OCTOPUS = [
  "..ooooo..",
  ".ohhpppo.",
  "ohpppppo.",
  "opkpppkpo",
  "opppppppo",
  "oddpppddo",
  "opopopopo",
  "o.o.o.o.o",
];
const CRAB = [
  "oo.......oo",
  "ro.......or",
  ".o.o...o.o.",
  "..okooko...",
  ".orrrrrrro.",
  "orhrrrrrrro",
  ".odrdrdrdo.",
  "..o.o.o.o..",
];

export function scene({ night: N, books = [], notes = [] }) {
  const T = c => (N ? night(c) : c); // 白天 / 夜里的颜色
  const R = [];
  const r = (x, y, w, h, col) => R.push({ x, y, w, h, c: T(col) });
  const raw = (x, y, w, h, col) => R.push({ x, y, w, h, c: col }); // 不跟着夜里变（发亮的东西）
  // 有层次的一块：边线（深一点）、上沿亮、中间本色、下半截沉一点、右边一道暗
  const soft = (x, y, w, h, base, { edge = true } = {}) => {
    if (edge) r(x, y, w, h, mix(base, DARK, 0.28));
    const ix = edge ? x + 1 : x, iy = edge ? y + 1 : y, iw = edge ? w - 2 : w, ih = edge ? h - 2 : h;
    if (iw <= 0 || ih <= 0) return;
    r(ix, iy, iw, ih, base);
    if (ih >= 3) r(ix, iy, iw, 1, mix(base, "#ffffff", 0.5));
    if (ih >= 5) r(ix, iy + Math.ceil(ih * 0.6), iw, ih - Math.ceil(ih * 0.6), mix(base, DARK, 0.07));
    if (iw >= 4) r(ix + iw - 1, iy + 1, 1, ih - 1, mix(base, DARK, 0.12));
  };
  const sprite = (x, y, rows, map) => rows.forEach((row, j) => [...row].forEach((ch, i) => { if (map[ch]) r(x + i, y + j, 1, 1, map[ch]); }));
  const blob = (cx, cy, rad, col, clip) => { for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) { const px = cx + x, py = cy + y; if (x * x + y * y <= rad * rad + rad && px >= clip.x && px < clip.x + clip.w && py >= clip.y && py < clip.y + clip.h) r(px, py, 1, 1, col); } };

  // ---------- 墙：上面亮一点、下面暖一点（没有墙裙）----------
  r(0, 0, W, H, D.wall);
  r(0, 0, W, 20, D.wallTop);
  r(0, 82, W, 20, D.wallLow);
  r(0, 0, W, 2, mix(D.wall, DARK, 0.06));

  // ---------- 窗 ----------
  const wx = 5, wy = 12, ww = 42, wh = 54;
  const g = { x: wx + 3, y: wy + 3, w: ww - 6, h: wh - 6 };
  r(wx, wy, ww, wh, D.frameLine); r(wx + 1, wy + 1, ww - 2, wh - 2, D.frame);
  const sky = N ? ["#1b2546", "#202b51", "#26335c", "#2c3a66"] : [D.sky1, D.sky2, D.sky3, D.sky3];
  sky.forEach((col, i) => raw(g.x, g.y + Math.round((g.h * i) / 4), g.w, Math.ceil(g.h / 4) + 1, col));
  if (N) {
    const mx = g.x + 25, my = g.y + 11;
    for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) if (x * x + y * y <= 18 && (x - 2) * (x - 2) + (y + 1) * (y + 1) > 11) raw(mx + x, my + y, 1, 1, "#f3ead0");
    for (const [x, y] of [[5, 22], [11, 29], [28, 25], [32, 33], [16, 36], [24, 40], [6, 41]]) raw(g.x + x, g.y + y, 1, 1, "#d9def0");
  } else {
    raw(g.x + 19, g.y + 25, 8, 1, D.cloud); raw(g.x + 17, g.y + 26, 13, 2, D.cloud);
  }
  // 树荫：左上角垂下来的叶子团，几层颜色
  const lv = N ? ["#24353b", "#1e2d33", "#2c3f44", "#19262c"] : [D.leaf1, D.leaf2, D.leaf3, D.leaf4];
  for (const [x, y, rad, k] of [[0, 1, 9, 3], [8, -1, 8, 1], [16, 0, 6, 0], [23, -2, 5, 1], [2, 11, 6, 1], [10, 8, 5, 0], [-1, 19, 4, 3], [14, 6, 3, 2], [30, -1, 4, 0]]) blob(g.x + x, g.y + y, rad, lv[k], g);
  if (!N) for (const [x, y] of [[3, 2], [10, 1], [17, 2], [6, 9], [12, 7], [24, 0]]) raw(g.x + x, g.y + y, 2, 1, "#d2eac6");
  // 窗框的厚度（上、左一道浅影）
  raw(g.x, g.y, g.w, 1, N ? "#0f162b" : "#7a6a5a22"); raw(g.x, g.y + 1, 1, g.h - 1, N ? "#0f162b" : "#7a6a5a18");
  // 窗格
  r(g.x + g.w / 2 - 1, g.y, 2, g.h, D.frame); r(g.x + g.w / 2 + 1, g.y, 1, g.h, mix(D.frame, DARK, 0.08));
  r(g.x, g.y + g.h / 2 - 1, g.w, 2, D.frame); r(g.x, g.y + g.h / 2 + 1, g.w, 1, mix(D.frame, DARK, 0.08));
  // 窗台：板面亮、正面暗一点，墙上一道影子
  r(wx - 3, wy + wh, ww + 6, 2, mix(D.frame, "#ffffff", 0.5));
  r(wx - 3, wy + wh + 2, ww + 6, 2, mix(D.frame, DARK, 0.1));
  r(wx - 2, wy + wh + 4, ww + 4, 1, D.wallShadow);

  // ---------- 书架 ----------
  const sx = 52, sw = 42;
  const shelf = y => {
    r(sx, y, sw, 1, mix(D.shelf, "#ffffff", 0.45));
    r(sx, y + 1, sw, 2, D.shelf);
    r(sx, y + 3, sw, 1, mix(D.shelf, DARK, 0.18));
    r(sx + 1, y + 4, sw - 2, 1, D.wallShadow);
    for (const bx of [sx + 3, sx + sw - 5]) r(bx, y + 4, 2, 3, mix(D.shelf, DARK, 0.15));
  };
  const s1 = 40, s2 = 64;
  // 第一层：你的书，书之间留一格空；第三本斜靠着
  const slots = [];
  let x = sx + 3;
  books.slice(0, 6).forEach((b, i) => {
    const base = mix(SPINES[b.color % SPINES.length], "#ffffff", 0.15);
    const w = 4 + (i % 3 === 1 ? 1 : 0), h = 13 + ((i * 5) % 4);
    const y = s1 - h;
    if (i === 2) {
      // 斜靠：往右一级级歪过去
      for (let j = 0; j < h; j++) {
        const off = Math.floor((h - 1 - j) / 6);
        const col = j === 0 ? mix(base, "#ffffff", 0.45) : j < h * 0.6 ? base : mix(base, DARK, 0.07);
        r(x + off, y + j, w, 1, col);
        r(x + off, y + j, 1, 1, mix(base, DARK, 0.28)); r(x + off + w - 1, y + j, 1, 1, mix(base, DARK, 0.28));
      }
      slots.push({ id: b.id, x, y, w: w + 2, h });
      x += w + 3;
    } else {
      soft(x, y, w, h, base);
      r(x + 1, y + 3, w - 2, 1, mix(base, "#ffffff", 0.45));
      slots.push({ id: b.id, x, y, w, h });
      x += w + 1;
    }
  });
  const add = { x: x + 1, y: s1 - 13, w: 5, h: 13 };
  shelf(s1);
  // 第二层：两本躺着的书、一小盆绿萝
  soft(sx + 22, s2 - 4, 16, 4, "#e8c6cc");
  soft(sx + 24, s2 - 7, 13, 3, "#c9dae7", { edge: false });
  soft(sx + 5, s2 - 7, 8, 7, D.pot); r(sx + 6, s2 - 6, 6, 1, D.soil);
  for (const [lx, ly, col] of [[sx + 4, s2 - 9, D.leaf], [sx + 7, s2 - 11, D.leafHi], [sx + 10, s2 - 10, D.leaf], [sx + 12, s2 - 8, D.leafLo], [sx + 3, s2 - 4, D.leafLo], [sx + 3, s2, D.leaf], [sx + 4, s2 + 4, D.leafHi]]) { r(lx, ly, 3, 2, col); r(lx + 1, ly + 1, 1, 1, mix(col, DARK, 0.15)); }
  shelf(s2);

  // ---------- 两幅小画 ----------
  const frame = (fx, fy, w, h) => { soft(fx, fy, w, h, D.pframe); r(fx + 2, fy + 2, w - 4, h - 4, D.mat); r(fx + 1, fy + h, w, 1, D.wallShadow); };
  frame(54, 74, 15, 13);
  sprite(57, 76, OCTOPUS, { o: mix(D.oct, DARK, 0.3), p: D.oct, d: D.octLo, h: D.octHi, k: D.eye });
  frame(72, 75, 17, 12);
  sprite(75, 77, CRAB, { o: mix(D.crab, DARK, 0.3), r: D.crab, d: D.crabLo, h: D.crabHi, k: D.eye });

  // ---------- 他贴的便利贴（窗下的墙上）----------
  const NOTE_AT = [[28, 74], [36, 72], [43, 76], [31, 82], [39, 81]];
  const noteSlots = notes.slice(0, NOTE_AT.length).map((n, i) => {
    const [nx, ny] = NOTE_AT[i];
    const col = n.from === "me" ? D.noteMe : D.noteHim;
    r(nx + 1, ny + 1, 6, 6, D.wallShadow);
    soft(nx, ny, 6, 6, col);
    raw(nx + 2, ny - 1, 2, 1, "#ffffffcc");
    return { id: n.id, x: nx, y: ny - 1, w: 7, h: 8 };
  });

  // ---------- 书桌：桌面从后往前一层层亮起来 ----------
  const ty = 100;
  r(0, ty - 1, W, 1, mix(D.top, DARK, 0.2));
  const bands = [0.12, 0.08, 0.05, 0.02, 0, -0.03];
  bands.forEach((k, i) => r(0, ty + i * 3, W, 3, k >= 0 ? mix(D.top, DARK, k) : mix(D.top, "#ffffff", -k * 3)));
  r(0, ty + 18, W, 1, mix(D.top, "#ffffff", 0.45));
  r(0, ty + 19, W, 2, mix(D.front, "#ffffff", 0.15));
  r(0, ty + 21, W, 1, mix(D.front, DARK, 0.2));
  for (let y = ty + 22, i = 0; y < H; y += 8, i++) r(0, y, W, 8, mix(D.front, DARK, 0.02 * i));
  for (const dx of [5, 50]) {
    r(dx, 128, 41, 14, mix(D.front, DARK, 0.18));
    r(dx + 1, 129, 39, 12, D.front);
    r(dx + 1, 129, 39, 1, mix(D.front, "#ffffff", 0.35));
    r(dx + 1, 135, 39, 6, mix(D.front, DARK, 0.04));
    soft(dx + 17, 133, 7, 3, D.knob);
  }

  // ---------- 桌上的东西（先画影子）----------
  // 台灯（左）
  r(7, 112, 14, 2, D.shade);
  soft(5, 107, 12, 5, D.lamp);
  r(10, 86, 2, 21, mix(D.lamp, DARK, 0.25)); r(10, 86, 1, 21, D.lamp);
  for (let i = 0; i < 5; i++) r(11 + i, 86 - i, 2, 1, mix(D.lamp, DARK, 0.25));
  // 灯罩：上窄下宽；夜里是亮的
  const sh = N ? ["#fff1cc", "#ffe2a8", "#f5cd85"] : [mix(D.lampShade, "#ffffff", 0.5), D.lampShade, mix(D.lampShade, DARK, 0.1)];
  for (let j = 0; j < 7; j++) {
    const half = 4 + j;
    const col = j < 2 ? sh[0] : j < 5 ? sh[1] : sh[2];
    raw(19 - half, 73 + j, half * 2, 1, col);
    raw(19 - half, 73 + j, 1, 1, N ? "#c9a46a" : mix(D.lampShade, DARK, 0.3)); raw(19 + half - 1, 73 + j, 1, 1, N ? "#c9a46a" : mix(D.lampShade, DARK, 0.3));
  }
  raw(15, 72, 8, 1, N ? "#c9a46a" : mix(D.lampShade, DARK, 0.3));
  // 稿纸、摊开的本子、一支笔
  r(33, 112, 28, 2, D.shade);
  soft(30, 106, 28, 6, mix(D.paper, DARK, 0.06));
  soft(31, 104, 26, 6, D.paper);
  r(34, 107, 20, 1, D.ink);
  soft(36, 99, 17, 6, D.book);
  r(37, 100, 7, 4, D.paper); r(45, 100, 7, 4, D.paper);
  r(38, 101, 5, 1, D.ink); r(46, 101, 5, 1, D.ink); r(38, 103, 4, 1, D.ink); r(46, 103, 5, 1, D.ink);
  for (let i = 0; i < 8; i++) r(51 + i, 110 - Math.floor(i / 2.5), 1, 1, i < 1 ? mix(D.pen2, DARK, 0.3) : D.pen2);
  // 笔筒
  r(63, 111, 8, 2, D.shade);
  r(62, 95, 1, 9, D.pen1); r(64, 93, 1, 11, D.pen3); r(66, 96, 1, 8, D.pen2);
  soft(61, 101, 7, 10, D.cup);
  // 杯子（白天有一点热气）
  r(73, 111, 10, 2, D.shade);
  soft(70, 101, 9, 10, D.mug); r(71, 102, 7, 1, D.coffee); r(71, 105, 7, 2, D.stripe);
  r(79, 103, 2, 1, mix(D.mug, DARK, 0.3)); r(80, 104, 1, 3, mix(D.mug, DARK, 0.3)); r(79, 107, 2, 1, mix(D.mug, DARK, 0.3));
  if (!N) for (const [sx2, sy2] of [[73, 98], [74, 96], [73, 94], [76, 97]]) raw(sx2, sy2, 1, 1, "#ffffffcc");

  return {
    rects: R, slots, add, notes: noteSlots,
    paper: { x: 30, y: 99, w: 28, h: 13 },
    window: { x: wx, y: wy, w: ww, h: wh },
    beam: N ? null : `${g.x + 2},${g.y} ${g.x + g.w},${g.y} ${g.x + g.w + 38},${ty + 17} ${g.x + 24},${ty + 17}`,
  };
}

export const isNight = (d = new Date()) => d.getHours() < 6 || d.getHours() >= 18;
