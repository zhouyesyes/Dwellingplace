// 共写的书桌（像素画）：正面稍微往下看——能看见书桌的桌面、书架的板面，东西都有描边和明暗，桌上有影子。
// 120 × 200 格。白天：阳光从窗户斜照进来，窗外蓝天、树；夜里：同一套东西压暗偏蓝，窗外月亮星星，台灯亮着。
// 墙上：两层书架（第一层是你在写的书），一盆垂下来的绿萝，两幅小画（小章鱼、小螃蟹），他贴的便利贴。
import { SPINES } from "./writing.js";

export const W = 120, H = 200;

// 白天的颜色；夜里用 night() 压暗偏蓝（发光的东西单独给）
const D = {
  line: "#4b3a2e",
  wall: "#f1e7d6", wall2: "#e7dbc7", wallShadow: "#dccdb5", molding: "#e2d3bb", panel: "#e8dac3", panelHi: "#f6eedf", panelLo: "#d4c2a6",
  frame: "#fbf6ec", frameLo: "#d9ccb6", recess: "#c9b99e",
  sky1: "#94c8ef", sky2: "#a9d4f3", sky3: "#c3e2f7", cloud: "#ffffff", cloudLo: "#dcecf7",
  hill: "#93c391", tree: "#4f9a5a", treeHi: "#78bb6c", treeLo: "#3a7c48", trunk: "#7a5a40",
  shelfTop: "#dcab78", shelf: "#b9875a", shelfLo: "#946541",
  leaf: "#5fae5a", leafHi: "#8fd276", leafLo: "#3c8645", pot: "#d9876a", potLo: "#b5654a", potHi: "#eba387", soil: "#6b4a35",
  mat: "#fbf6ec", pframe: "#b9875a",
  oct: "#f29bb8", octLo: "#d06f93", octHi: "#ffd3e2", crab: "#ef7a53", crabLo: "#c45a37", crabHi: "#ffb08f", eye: "#2b2230", white: "#ffffff",
  top: "#cf955f", topHi: "#dda56f", grain: "#bf8550", topBack: "#ad7647", edge: "#e2ae7a", front: "#a8693f", frontLo: "#8e5734", bevelHi: "#bd7d4f", bevelLo: "#74452a", knob: "#e8c66a",
  shade: "rgba(60,30,10,.18)",
  lamp: "#f1e8da", lampLo: "#cfc3b1", lampShade: "#ece2d2", lampShadeLo: "#d3c6b2",
  paper: "#fffaf0", paperLo: "#e9dfcd", ink: "#cdbfa8", book: "#6fa3c7", bookLo: "#4f84a8",
  mug: "#f6f2ea", mugLo: "#d8d0c3", stripe: "#e07a6a", coffee: "#6b4a35",
  cup: "#7fb07a", cupLo: "#5f9160", pen1: "#e2b45c", pen2: "#d9826f", pen3: "#6fa3c7",
  noteMe: "#f9e27d", noteHim: "#bfe0f7", noteLo: "rgba(60,40,20,.18)", tape: "rgba(255,255,255,.7)",
};

const mix = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = s => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${[16, 8, 0].map(s => ch(s).toString(16).padStart(2, "0")).join("")}`;
};
const night = c => (c.startsWith("#") ? mix(c, "#171c2e", 0.72) : c);
export const WALL = { day: D.wall, night: night(D.wall) }; // 页面空出来的地方用同一个颜色

// 小画：一个字一格，. 是空
const OCTOPUS = [
  "...ooooo...",
  "..ophhppo..",
  ".ophhppppo.",
  ".opkpppkpo.",
  ".opppppppo.",
  ".oddpppddo.",
  "opodopodopo",
  "op.op.po.po",
  "o..o...o..o",
];
const CRAB = [
  ".oo.......oo.",
  "orro.....orro",
  "o.ro.o.o.or.o",
  ".oo.okook.oo.",
  "..orrrrrrro..",
  ".orrhrrrrrro.",
  "orrrrrrrrrrro",
  ".odrdrdrdrdo.",
  "..o.o...o.o..",
];

export function scene({ night: isN, books = [], notes = [] }) {
  const N = isN;
  const c = new Proxy(D, { get: (t, k) => (N ? night(t[k]) : t[k]) });
  const R = [];
  const r = (x, y, w, h, col) => R.push({ x, y, w, h, c: col });
  const box = (x, y, w, h, fill, line = c.line) => { r(x, y, w, h, line); r(x + 1, y + 1, w - 2, h - 2, fill); };
  const sprite = (x, y, rows, map) => rows.forEach((row, j) => [...row].forEach((ch, i) => { if (map[ch]) r(x + i, y + j, 1, 1, map[ch]); }));

  // ---------- 墙 ----------
  r(0, 0, W, H, c.wall);
  r(0, 0, W, 3, c.molding); r(0, 3, W, 1, c.wall2);
  // 墙裙：一格格的木板
  r(0, 112, W, 16, c.panel); r(0, 112, W, 1, c.panelHi); r(0, 111, W, 1, c.panelLo);
  for (let x = 0; x < W; x += 15) { r(x, 113, 1, 15, c.panelLo); r(x + 1, 113, 1, 15, c.panelHi); }

  // ---------- 窗 ----------
  const wx = 8, wy = 16, ww = 50, wh = 66;
  const gx = wx + 4, gy = wy + 4, gw = ww - 8, gh = wh - 8; // 玻璃
  box(wx, wy, ww, wh, c.frame);
  r(wx + 1, wy + wh - 2, ww - 2, 1, c.frameLo); r(wx + ww - 2, wy + 1, 1, wh - 2, c.frameLo);
  // 天
  const sky = N ? ["#0e1630", "#14204a", "#1c2c5c", "#24386a"] : [c.sky1, c.sky1, c.sky2, c.sky3];
  sky.forEach((col, i) => r(gx, gy + Math.round((gh * i) / 4), gw, Math.ceil(gh / 4) + 1, col));
  if (N) {
    const mx = gx + 30, my = gy + 10;
    for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) if (x * x + y * y <= 26 && (x - 3) * (x - 3) + (y + 1) * (y + 1) > 16) r(mx + x, my + y, 1, 1, "#f6ebc8");
    for (const [x, y] of [[4, 5], [13, 16], [8, 27], [22, 22], [36, 30], [18, 34], [3, 38], [39, 20], [27, 8]]) r(gx + x, gy + y, 1, 1, "#e3e7f5");
    r(gx + 12, gy + 10, 1, 1, "#ffffff"); r(gx + 11, gy + 11, 3, 1, "#c9cfe6"); r(gx + 12, gy + 12, 1, 1, "#ffffff");
  } else {
    const cloud = (x, y) => { r(x + 3, y, 7, 1, c.cloud); r(x + 1, y + 1, 12, 2, c.cloud); r(x, y + 3, 15, 2, c.cloud); r(x + 1, y + 5, 13, 1, c.cloudLo); };
    cloud(gx + 4, gy + 6); cloud(gx + 24, gy + 18);
  }
  // 远山和一棵树（窗外下半截）
  const hill = N ? "#1f2e44" : c.hill;
  for (let x = 0; x < gw; x++) { const h = 6 + Math.round(3 * Math.sin(x / 6)); r(gx + x, gy + gh - 14 - h + 6, 1, h + 8, hill); }
  const tr = N ? { a: "#1a2a30", b: "#22363a", c: "#142226" } : { a: c.tree, b: c.treeHi, c: c.treeLo };
  const blob = (cx, cy, rad, col) => { for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad + rad) r(cx + x, cy + y, 1, 1, col); };
  r(gx + 9, gy + gh - 14, 3, 14, N ? "#1a2226" : c.trunk);
  blob(gx + 10, gy + gh - 20, 8, tr.c); blob(gx + 9, gy + gh - 22, 7, tr.a); blob(gx + 7, gy + gh - 25, 4, tr.b);
  blob(gx + 34, gy + gh - 8, 6, tr.c); blob(gx + 33, gy + gh - 9, 5, tr.a); blob(gx + 31, gy + gh - 11, 2, tr.b);
  // 窗户的深度：上面和左边一道窗框的影子
  r(gx, gy, gw, 2, N ? "#0a1022" : "rgba(60,40,20,.22)"); r(gx, gy + 2, 2, gh - 2, N ? "#0a1022" : "rgba(60,40,20,.16)");
  // 窗格
  r(gx + gw / 2 - 1, gy, 2, gh, c.frame); r(gx, gy + gh / 2 - 1, gw, 2, c.frame);
  r(gx + gw / 2 + 1, gy, 1, gh, c.frameLo); r(gx, gy + gh / 2 + 1, gw, 1, c.frameLo);
  // 窗台：板面、正面、墙上的影子
  r(wx - 4, wy + wh, ww + 8, 3, c.frame); r(wx - 4, wy + wh, ww + 8, 1, c.white);
  r(wx - 4, wy + wh + 3, ww + 8, 3, c.frameLo); r(wx - 4, wy + wh + 6, ww + 8, 1, c.line);
  r(wx - 3, wy + wh + 7, ww + 6, 2, c.wallShadow);
  // 窗台上一盆小草
  const px = wx + ww - 14, py = wy + wh - 7;
  box(px, py, 9, 8, c.pot); r(px + 1, py + 1, 7, 1, c.soil); r(px + 6, py + 2, 2, 5, c.potLo); r(px + 1, py + 2, 1, 5, c.potHi);
  for (const [x, y, h, col] of [[1, -6, 7, c.leafLo], [3, -9, 10, c.leaf], [5, -7, 8, c.leafHi], [7, -5, 6, c.leaf], [2, -4, 5, c.leafHi]]) r(px + x, py + y, 2, h, col);

  // ---------- 书架 ----------
  const sx = 64, sw = 52;
  const shelf = y => {
    r(sx, y, sw, 2, c.shelfTop); r(sx, y + 2, sw, 3, c.shelf); r(sx, y + 5, sw, 1, c.line);
    r(sx + 1, y + 6, sw - 2, 2, c.wallShadow);
    for (const bx of [sx + 4, sx + sw - 7]) { r(bx, y + 6, 3, 4, c.shelfLo); r(bx, y + 10, 3, 1, c.line); }
  };
  const s1 = 50, s2 = 82;
  // 第一层：你的书（站在板面上，各有描边、左亮右暗）
  const slots = [];
  let x = sx + 3;
  books.slice(0, 8).forEach((b, i) => {
    const w = 5 + (i % 3 === 1 ? 1 : 0), h = 15 + ((i * 7) % 5);
    const base = SPINES[b.color % SPINES.length];
    const col = N ? night(base) : base;
    const y = s1 + 1 - h;
    box(x, y, w, h, col);
    r(x + 1, y + 1, 1, h - 2, N ? night(mix(base, "#ffffff", 0.35)) : mix(base, "#ffffff", 0.35));
    r(x + w - 2, y + 1, 1, h - 2, N ? night(mix(base, "#000000", 0.2)) : mix(base, "#000000", 0.2));
    r(x + 1, y + 4, w - 2, 1, N ? night(mix(base, "#ffffff", 0.5)) : mix(base, "#ffffff", 0.5));
    slots.push({ id: b.id, x, y, w, h });
    x += w;
  });
  const add = { x: x + 1, y: s1 + 1 - 15, w: 6, h: 15 };
  shelf(s1);
  // 第二层：躺着的书、一盆垂下来的绿萝
  [["#e39aa8", 18], ["#6fa3c7", 16], ["#e2b45c", 20]].forEach(([col, w], i) => box(sx + 28 + (i % 2), s2 + 1 - 4 * (i + 1), w, 4, N ? night(col) : col));
  box(sx + 6, s2 - 7, 10, 8, c.pot); r(sx + 7, s2 - 6, 8, 1, c.soil); r(sx + 13, s2 - 5, 2, 5, c.potLo);
  const vine = [[sx + 6, s2 - 9], [sx + 4, s2 - 6], [sx + 3, s2 - 2], [sx + 3, s2 + 3], [sx + 2, s2 + 8], [sx + 3, s2 + 13], [sx + 2, s2 + 17]];
  vine.forEach(([vx, vy], i) => { r(vx, vy, 3, 2, i % 2 ? c.leaf : c.leafHi); r(vx + 1, vy + 2, 1, 2, c.leafLo); });
  for (const [vx, vy, col] of [[sx + 10, s2 - 12, c.leaf], [sx + 13, s2 - 10, c.leafHi], [sx + 16, s2 - 8, c.leafLo], [sx + 17, s2 - 3, c.leaf], [sx + 18, s2 + 2, c.leafHi], [sx + 17, s2 + 7, c.leaf]]) r(vx, vy, 3, 2, col);
  shelf(s2);

  // ---------- 两幅小画：小章鱼、小螃蟹 ----------
  const frame = (x, y, w, h) => { box(x, y, w, h, c.pframe); r(x + 2, y + 2, w - 4, h - 4, c.mat); r(x + 1, y + h, w, 1, c.wallShadow); };
  frame(70, 93, 17, 15);
  sprite(73, 96, OCTOPUS, { o: c.line, p: c.oct, d: c.octLo, h: c.octHi, k: c.eye });
  frame(92, 94, 19, 14);
  sprite(95, 97, CRAB, { o: c.line, r: c.crab, d: c.crabLo, h: c.crabHi, k: c.eye });

  // ---------- 他贴在墙上的便利贴（窗下那块墙上，最多 5 张）----------
  const NOTE_AT = [[34, 92], [44, 90], [52, 96], [36, 102], [46, 101]];
  const noteSlots = notes.slice(0, NOTE_AT.length).map((n, i) => {
    const [nx, ny] = NOTE_AT[i];
    r(nx + 1, ny + 1, 8, 8, c.noteLo);
    box(nx, ny, 8, 8, n.from === "me" ? c.noteMe : c.noteHim, N ? night("#8a7a5a") : "#c9b37a");
    r(nx + 2, ny - 1, 4, 2, c.tape);
    r(nx + 2, ny + 3, 4, 1, N ? night("#8f8a7a") : "#9c927c"); r(nx + 2, ny + 5, 3, 1, N ? night("#8f8a7a") : "#9c927c");
    return { id: n.id, x: nx, y: ny - 1, w: 9, h: 10 };
  });

  // ---------- 书桌：能看见桌面 ----------
  const ty = 128;
  r(0, ty - 1, W, 1, c.line);
  r(0, ty, W, 18, c.top);
  r(0, ty, W, 2, c.topBack);
  for (const [gx2, gy2, gw2] of [[6, 133, 22], [40, 136, 30], [80, 132, 26], [14, 141, 34], [64, 143, 40]]) r(gx2, gy2, gw2, 1, c.grain);
  r(0, ty + 2, W, 1, c.topHi);
  r(0, ty + 18, W, 2, c.edge); r(0, ty + 20, W, 1, c.line);
  r(0, ty + 21, W, H - ty - 21, c.front);
  for (const dx of [6, 62]) {
    box(dx, 156, 52, 18, c.front, c.frontLo);
    r(dx + 1, 157, 50, 1, c.bevelHi); r(dx + 1, 157, 1, 16, c.bevelHi); r(dx + 1, 172, 50, 1, c.bevelLo); r(dx + 50, 157, 1, 16, c.bevelLo);
    box(dx + 22, 163, 8, 4, c.knob, c.bevelLo);
  }
  r(0, 184, W, 1, c.frontLo); r(0, 185, W, 1, c.bevelHi);

  // ---------- 桌上的东西（先画影子）----------
  // 台灯（左）
  r(9, 139, 18, 3, c.shade);
  box(7, 134, 16, 6, c.lamp); r(8, 138, 14, 1, c.lampLo);
  r(14, 108, 3, 27, c.line); r(15, 108, 1, 27, c.lamp);
  for (let i = 0; i < 7; i++) { r(15 + i, 108 - i, 3, 1, c.line); r(16 + i, 108 - i, 1, 1, c.lamp); }
  const lit = N ? "#ffe2a6" : c.lampShade, litLo = N ? "#e8b96a" : c.lampShadeLo;
  // 灯罩：上窄下宽
  r(22, 95, 10, 1, c.line); r(20, 96, 14, 2, c.line); r(18, 98, 18, 2, c.line); r(17, 100, 20, 4, c.line);
  r(23, 96, 8, 1, lit); r(21, 97, 12, 2, lit); r(19, 99, 16, 2, lit); r(18, 101, 18, 2, lit); r(18, 102, 18, 1, litLo);
  r(19, 104, 16, 1, N ? "#fff3cf" : c.lampLo);
  // 稿纸、摊开的本子、一支笔
  r(40, 140, 34, 3, c.shade);
  box(38, 134, 34, 7, c.paperLo); box(39, 132, 32, 7, c.paper);
  for (const ly of [134, 136]) r(42, ly, 26, 1, c.ink);
  box(46, 129, 22, 6, c.book); r(47, 130, 9, 4, c.paper); r(58, 130, 9, 4, c.paper); r(56, 130, 2, 4, c.bookLo);
  for (const ly of [131, 133]) { r(48, ly, 7, 1, c.ink); r(59, ly, 7, 1, c.ink); }
  for (let i = 0; i < 10; i++) r(66 + i, 138 - Math.floor(i / 2.5), 1, 1, i < 2 ? c.line : c.pen2);
  // 笔筒
  r(79, 139, 9, 2, c.shade);
  for (const [px2, h, col] of [[79, 9, c.pen1], [81, 11, c.pen3], [83, 8, c.pen2]]) r(px2 + 1, 132 - h + 4, 1, h, col);
  box(78, 130, 8, 10, c.cup); r(84, 131, 1, 8, c.cupLo);
  // 杯子（白天有一点热气）
  r(93, 139, 12, 2, c.shade);
  box(91, 129, 10, 11, c.mug); r(92, 130, 8, 2, c.coffee); r(92, 134, 8, 2, c.stripe); r(99, 132, 1, 7, c.mugLo);
  r(101, 132, 3, 1, c.line); r(103, 133, 1, 3, c.line); r(101, 136, 3, 1, c.line);
  if (!N) for (const [sx2, sy2] of [[94, 125], [95, 123], [94, 121], [97, 124], [98, 122]]) r(sx2, sy2, 1, 1, "rgba(255,255,255,.75)");
  // 一盆多肉（右）
  r(109, 139, 10, 2, c.shade);
  box(107, 132, 10, 8, c.pot); r(108, 133, 8, 1, c.soil); r(114, 134, 2, 5, c.potLo);
  for (const [lx, ly, col] of [[108, 129, c.leaf], [110, 127, c.leafHi], [112, 128, c.leaf], [114, 129, c.leafLo], [110, 130, c.leafLo]]) r(lx, ly, 3, 3, col);

  return {
    rects: R, slots, add, notes: noteSlots,
    lamp: { x: 27, y: 100 },
    paper: { x: 38, y: 129, w: 34, h: 12 },
    window: { x: wx, y: wy, w: ww, h: wh },
    // 白天：阳光从窗户斜着照到桌上
    beam: N ? null : `${gx},${gy} ${gx + gw},${gy} ${gx + gw + 46},${ty + 16} ${gx + 34},${ty + 16}`,
  };
}

export const isNight = (d = new Date()) => d.getHours() < 6 || d.getHours() >= 18;
