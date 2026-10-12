// 共写的书桌（像素画）：正面稍微往下看，能看见浅色的木桌面。白墙、淡木头，描边只比本色深一点，整体柔和安静。
// 180 × 300 格（格子细，线条就不粗）。白天：窗外是树荫，阳光斜照进来，墙上有一点叶影；
// 夜里：同一套东西压暗偏蓝，窗外月亮、星星和暗下去的树影，台灯亮着。
// 墙上：两层书架（第一层是你在写的书，书之间留着空、有一本斜靠着），一小盆绿萝，两幅小画（小章鱼、小螃蟹），他贴的便利贴。
import { SPINES } from "./writing.js";

export const W = 180, H = 300;

const D = {
  wall: "#f8f6f2", wallLo: "#efebe4", wallShadow: "#e8e2d8", molding: "#efeae2",
  panel: "#f2eee7", panelLo: "#e6e0d6", panelHi: "#fcfbf8",
  frame: "#fdfcf9", frameLo: "#e5ded2", frameLine: "#d8cfc1",
  sky1: "#bcdcf2", sky2: "#cbe4f5", sky3: "#dcedf8", cloud: "#ffffff",
  leaf1: "#a9cf9c", leaf2: "#8fbf86", leaf3: "#b9dbab", leaf4: "#7eaf78",
  shelfTop: "#eadbc7", shelf: "#dcc8ad", shelfLo: "#ccb597",
  leaf: "#8cc083", leafHi: "#aad69e", leafLo: "#73a86e", pot: "#e8b9a5", potLo: "#d9a690", soil: "#a38672",
  mat: "#fdfcf9", pframe: "#dcc8ad",
  oct: "#f2a9c2", octLo: "#e08cab", octHi: "#ffd9e6", crab: "#f29a7c", crabLo: "#e07f5f", crabHi: "#ffc5ae", eye: "#5a4a50",
  top: "#ead9c2", topHi: "#f1e4d1", grain: "#e2cfb5", topBack: "#ddcab0", edge: "#f3e7d6", front: "#dcc4a6", frontLo: "#cfb593", knob: "#c9a46a",
  lamp: "#f4efe7", lampLo: "#ddd5c8", lampShade: "#f1ebe1", lampShadeLo: "#e0d7c9",
  paper: "#fffdf8", paperLo: "#ece5d8", ink: "#ddd2c1", book: "#a9c6dc",
  mug: "#fbf9f5", mugLo: "#e6e0d6", stripe: "#eaa79b", coffee: "#a88a73",
  cup: "#b8d4b3", pen1: "#e8c98f", pen2: "#e6a99a", pen3: "#a9c6dc",
  noteMe: "#f8e8a6", noteHim: "#d3e8f7", tape: "rgba(255,255,255,.75)",
  shade: "rgba(120,90,60,.10)",
};

const hex = c => [16, 8, 0].map(s => (parseInt(c.slice(1), 16) >> s) & 255);
const toHex = a => `#${a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, t) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v * (1 - t) + y[i] * t)); };
// 描边：只比本色深一点点
const edgeOf = c => mix(c, "#6b5a4a", 0.32);
const night = c => (c.startsWith("#") ? mix(c, "#1a2033", 0.7) : c);
export const WALL = { day: D.wall, night: night(D.wall) };

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

export function scene({ night: N, books = [], notes = [] }) {
  const c = new Proxy(D, { get: (t, k) => (N ? night(t[k]) : t[k]) });
  const R = [];
  const r = (x, y, w, h, col) => R.push({ x, y, w, h, c: col });
  // 一个东西：本色填满，外面一圈比本色深一点的线；上沿一道亮、下沿一道暗
  const obj = (x, y, w, h, fill, { hi = true, lo = true } = {}) => {
    r(x, y, w, h, edgeOf(fill));
    r(x + 1, y + 1, w - 2, h - 2, fill);
    if (hi && h > 4) r(x + 1, y + 1, w - 2, 1, mix(fill, "#ffffff", 0.45));
    if (lo && h > 4) r(x + 1, y + h - 2, w - 2, 1, mix(fill, "#6b5a4a", 0.12));
  };
  const sprite = (x, y, rows, map) => rows.forEach((row, j) => [...row].forEach((ch, i) => { if (map[ch]) r(x + i, y + j, 1, 1, map[ch]); }));
  // clip：只画在这个框里（窗外的树荫不能跑到墙上）
  const blob = (cx, cy, rad, col, clip) => { for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) { const px = cx + x, py = cy + y; if (x * x + y * y <= rad * rad + rad && (!clip || (px >= clip.x && px < clip.x + clip.w && py >= clip.y && py < clip.y + clip.h))) r(px, py, 1, 1, col); } };

  // ---------- 墙 ----------
  r(0, 0, W, H, c.wall);
  r(0, 0, W, 5, c.molding); r(0, 5, W, 1, c.wallLo);
  // 墙裙：很浅的竖板
  const py = 168;
  r(0, py, W, 24, c.panel); r(0, py, W, 1, c.panelHi); r(0, py - 1, W, 1, c.panelLo);
  for (let x = 6; x < W; x += 22) { r(x, py + 2, 1, 22, c.panelLo); r(x + 1, py + 2, 1, 22, c.panelHi); }

  // ---------- 窗：外面是树荫 ----------
  const wx = 12, wy = 24, ww = 76, wh = 100;
  const gx = wx + 5, gy = wy + 5, gw = ww - 10, gh = wh - 10;
  r(wx, wy, ww, wh, c.frameLine); r(wx + 1, wy + 1, ww - 2, wh - 2, c.frame);
  const sky = N ? ["#1a2444", "#1e2a4e", "#243259", "#2a3963"] : [c.sky1, c.sky2, c.sky3, c.sky3];
  sky.forEach((col, i) => r(gx, gy + Math.round((gh * i) / 4), gw, Math.ceil(gh / 4) + 1, col));
  if (N) {
    const mx = gx + 46, my = gy + 22;
    for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) if (x * x + y * y <= 38 && (x - 4) * (x - 4) + (y + 2) * (y + 2) > 25) r(mx + x, my + y, 1, 1, "#f3ead0");
    for (const [x, y] of [[8, 40], [20, 52], [52, 46], [60, 60], [30, 64], [44, 72], [12, 76], [58, 80]]) r(gx + x, gy + y, 1, 1, "#d9def0");
  } else {
    const cloud = (x, y) => { r(x + 4, y, 10, 1, c.cloud); r(x + 1, y + 1, 18, 2, c.cloud); r(x, y + 3, 22, 2, c.cloud); };
    cloud(gx + 34, gy + 44);
  }
  // 树荫：从左上角垂下来的一团团叶子（不画树干）
  const lv = N ? ["#22333a", "#1d2c33", "#2a3d42", "#18252b"] : [c.leaf1, c.leaf2, c.leaf3, c.leaf4];
  for (const [x, y, rad, k] of [[0, 2, 16, 1], [14, -2, 13, 0], [30, 0, 10, 2], [42, -4, 9, 0], [4, 20, 11, 3], [18, 14, 9, 0], [-2, 34, 8, 1], [26, 12, 6, 2], [56, -2, 7, 1], [8, 44, 5, 0]]) blob(gx + x, gy + y, rad, lv[k], { x: gx, y: gy, w: gw, h: gh });
  // 叶子上的亮点
  if (!N) for (const [x, y] of [[6, 4], [18, 2], [32, 4], [10, 18], [22, 12], [3, 30], [44, 0]]) r(gx + x, gy + y, 2, 1, "#cfe8c3");
  // 玻璃外面的部分裁掉：重画窗框四边
  r(wx + 1, wy + 1, ww - 2, 4, c.frame); r(wx + 1, wy + 1, 4, wh - 2, c.frame); r(wx + ww - 5, wy + 1, 4, wh - 2, c.frame); r(wx + 1, wy + wh - 5, ww - 2, 4, c.frame);
  r(gx - 1, gy - 1, gw + 2, 1, c.frameLine); r(gx - 1, gy - 1, 1, gh + 2, c.frameLine); r(gx + gw, gy - 1, 1, gh + 2, c.frameLo); r(gx - 1, gy + gh, gw + 2, 1, c.frameLo);
  // 窗格
  r(gx + gw / 2 - 1, gy, 3, gh, c.frame); r(gx + gw / 2 + 2, gy, 1, gh, c.frameLo);
  r(gx, gy + gh / 2 - 1, gw, 3, c.frame); r(gx, gy + gh / 2 + 2, gw, 1, c.frameLo);
  // 窗台
  r(wx - 5, wy + wh, ww + 10, 4, c.frame); r(wx - 5, wy + wh + 4, ww + 10, 3, c.frameLo); r(wx - 5, wy + wh + 7, ww + 10, 1, c.frameLine);
  r(wx - 4, wy + wh + 8, ww + 8, 2, c.wallShadow);

  // ---------- 书架 ----------
  const sx = 98, sw = 74;
  const shelf = y => {
    r(sx, y, sw, 3, c.shelfTop); r(sx, y + 3, sw, 4, c.shelf); r(sx, y + 7, sw, 1, c.shelfLo);
    r(sx + 2, y + 8, sw - 4, 2, c.wallShadow);
    for (const bx of [sx + 6, sx + sw - 10]) { r(bx, y + 8, 4, 5, c.shelfLo); }
  };
  const s1 = 76, s2 = 124;
  // 第一层：你的书，站在板上，书之间留一点空；第三本斜靠着
  const slots = [];
  let x = sx + 6;
  books.slice(0, 7).forEach((b, i) => {
    const w = 7 + (i % 3 === 1 ? 1 : 0), h = 22 + ((i * 7) % 6);
    const base = mix(SPINES[b.color % SPINES.length], "#ffffff", 0.18); // 书脊也淡一点
    const col = N ? night(base) : base;
    const y = s1 - h;
    if (i === 2) {
      // 斜靠：一级级往右挪
      for (let j = 0; j < h; j++) { const off = Math.floor((h - j) / 8); r(x + off, y + j, w, 1, j === 0 || j === h - 1 ? edgeOf(col) : col); r(x + off, y + j, 1, 1, edgeOf(col)); r(x + off + w - 1, y + j, 1, 1, edgeOf(col)); }
      slots.push({ id: b.id, x, y, w: w + Math.floor(h / 8), h });
      x += w + Math.floor(h / 8) + 2;
    } else {
      obj(x, y, w, h, col, { lo: false });
      r(x + 2, y + 5, w - 4, 1, mix(col, "#ffffff", 0.5)); r(x + 2, y + h - 6, w - 4, 1, mix(col, "#ffffff", 0.5));
      slots.push({ id: b.id, x, y, w, h });
      x += w + 2;
    }
  });
  const add = { x: x + 2, y: s1 - 22, w: 8, h: 22 };
  shelf(s1);
  // 第二层：两本躺着的书，一小盆绿萝（就这一盆）
  obj(sx + 40, s2 - 6, 26, 6, N ? night("#e6c3c9") : "#e6c3c9", { lo: false });
  obj(sx + 42, s2 - 11, 22, 5, N ? night("#c7d9e6") : "#c7d9e6", { lo: false });
  obj(sx + 10, s2 - 11, 14, 11, c.pot); r(sx + 11, s2 - 10, 12, 1, c.soil);
  for (const [lx, ly, col] of [[sx + 8, s2 - 15, c.leaf], [sx + 13, s2 - 18, c.leafHi], [sx + 18, s2 - 16, c.leaf], [sx + 22, s2 - 13, c.leafLo], [sx + 7, s2 - 6, c.leafLo], [sx + 6, s2 + 1, c.leaf], [sx + 7, s2 + 8, c.leafHi]]) { r(lx, ly, 4, 3, col); r(lx + 1, ly - 1, 2, 1, col); }
  shelf(s2);

  // ---------- 两幅小画 ----------
  const frame = (fx, fy, w, h) => { obj(fx, fy, w, h, c.pframe, { hi: false, lo: false }); r(fx + 2, fy + 2, w - 4, h - 4, c.mat); r(fx + 1, fy + h, w, 1, c.wallShadow); };
  const pal = k => (N ? night(edgeOf(D[k])) : edgeOf(D[k]));
  frame(104, 140, 21, 19);
  sprite(109, 145, OCTOPUS, { o: pal("oct"), p: c.oct, d: c.octLo, h: c.octHi, k: c.eye });
  frame(132, 141, 23, 18);
  sprite(137, 146, CRAB, { o: pal("crab"), r: c.crab, d: c.crabLo, h: c.crabHi, k: c.eye });

  // ---------- 他贴的便利贴（窗下的墙上）----------
  const NOTE_AT = [[58, 140], [72, 137], [84, 143], [62, 152], [76, 151]];
  const noteSlots = notes.slice(0, NOTE_AT.length).map((n, i) => {
    const [nx, ny] = NOTE_AT[i];
    const col = n.from === "me" ? c.noteMe : c.noteHim;
    r(nx + 1, ny + 1, 11, 11, c.wallShadow);
    obj(nx, ny, 11, 11, col, { lo: false });
    r(nx + 3, ny - 1, 5, 2, c.tape);
    r(nx + 3, ny + 4, 6, 1, edgeOf(col)); r(nx + 3, ny + 7, 4, 1, edgeOf(col));
    return { id: n.id, x: nx, y: ny - 1, w: 12, h: 13 };
  });

  // ---------- 书桌 ----------
  const ty = 192;
  r(0, ty - 1, W, 1, c.frontLo);
  r(0, ty, W, 26, c.top);
  r(0, ty, W, 3, c.topBack);
  for (const [gx2, gy2, gw2] of [[8, 200, 34], [60, 204, 44], [120, 198, 40], [20, 211, 52], [96, 214, 60]]) r(gx2, gy2, gw2, 1, c.grain);
  r(0, ty + 3, W, 1, c.topHi);
  r(0, ty + 26, W, 3, c.edge); r(0, ty + 29, W, 1, c.frontLo);
  r(0, ty + 30, W, H - ty - 30, c.front);
  for (const dx of [10, 94]) {
    r(dx, 236, 76, 26, c.frontLo); r(dx + 1, 237, 74, 24, c.front);
    r(dx + 1, 237, 74, 1, N ? night(mix(D.front, "#ffffff", 0.3)) : mix(D.front, "#ffffff", 0.3)); r(dx + 1, 260, 74, 1, c.frontLo);
    obj(dx + 32, 246, 12, 5, c.knob, { lo: false });
  }
  r(0, 276, W, 1, c.frontLo);

  // ---------- 桌上的东西 ----------
  // 台灯（左）
  r(12, 210, 26, 4, c.shade);
  obj(10, 202, 22, 8, c.lamp);
  r(20, 160, 3, 43, edgeOf(D.lamp)); r(21, 160, 1, 43, c.lamp);
  for (let i = 0; i < 9; i++) { r(21 + i, 160 - i, 3, 1, edgeOf(D.lamp)); r(22 + i, 160 - i, 1, 1, c.lamp); }
  const lit = N ? "#ffe4ab" : c.lampShade, litLo = N ? "#f0c27a" : c.lampShadeLo, lit2 = N ? "#fff3d2" : c.lamp;
  // 灯罩：上窄下宽
  for (let j = 0; j < 12; j++) { const half = 7 + Math.floor(j * 0.9); r(34 - half, 140 + j, half * 2, 1, j === 0 ? edgeOf(D.lampShade) : j > 9 ? litLo : lit); r(34 - half, 140 + j, 1, 1, edgeOf(D.lampShade)); r(34 + half - 1, 140 + j, 1, 1, edgeOf(D.lampShade)); }
  r(24, 152, 20, 1, lit2);
  // 稿纸、摊开的本子、一支笔
  r(62, 210, 50, 4, c.shade);
  obj(58, 202, 50, 9, c.paperLo, { hi: false, lo: false }); obj(60, 199, 47, 10, c.paper, { lo: false });
  for (const ly of [202, 205]) r(64, ly, 38, 1, c.ink);
  obj(68, 192, 32, 9, c.book, { hi: false, lo: false }); r(69, 193, 14, 7, c.paper); r(85, 193, 14, 7, c.paper);
  for (const ly of [195, 197]) { r(71, ly, 10, 1, c.ink); r(87, ly, 10, 1, c.ink); }
  for (let i = 0; i < 14; i++) r(98 + i, 207 - Math.floor(i / 3), 1, 1, i < 2 ? edgeOf(D.pen2) : c.pen2);
  // 笔筒
  r(120, 209, 12, 3, c.shade);
  for (const [px2, h, col] of [[119, 12, c.pen1], [122, 15, c.pen3], [125, 11, c.pen2]]) r(px2 + 1, 196 - h + 6, 2, h, col);
  obj(117, 194, 12, 15, c.cup);
  // 杯子（白天有一点热气）
  r(140, 209, 16, 3, c.shade);
  obj(136, 193, 15, 16, c.mug); r(138, 195, 11, 2, c.coffee); r(138, 200, 11, 3, c.stripe);
  r(151, 197, 4, 1, edgeOf(D.mug)); r(154, 198, 1, 5, edgeOf(D.mug)); r(151, 203, 4, 1, edgeOf(D.mug));
  if (!N) for (const [sx2, sy2] of [[141, 187], [142, 184], [141, 181], [145, 186], [146, 183]]) r(sx2, sy2, 1, 1, "rgba(255,255,255,.9)");

  // 白天：窗外树叶投在墙上的一点影子
  const dapple = [];

  return {
    rects: R, slots, add, notes: noteSlots, dapple,
    lamp: { x: 34, y: 150 },
    paper: { x: 58, y: 192, w: 50, h: 20 },
    window: { x: wx, y: wy, w: ww, h: wh },
    beam: N ? null : `${gx + 4},${gy} ${gx + gw},${gy} ${gx + gw + 70},${ty + 24} ${gx + 48},${ty + 24}`,
  };
}

export const isNight = (d = new Date()) => d.getHours() < 6 || d.getHours() >= 18;
