// 共写的书桌（像素画）：正面看，墙上一扇窗、两层书架，下面一张书桌，桌上台灯、稿纸、杯子。
// 120 × 200 格。白天暖、夜里静：同一张画，换一套颜色；夜里窗外有月亮和星星，台灯亮着。
// 墙上第一层书架的书 = 你的书（项目），每本的位置交给页面，好在上面放可以点的按钮。
import { SPINES } from "./writing.js";

export const W = 120, H = 200;

const DAY = {
  wall: "#ece7df", wall2: "#e4ded5", trim: "#d8d0c4",
  frame: "#f7f4ef", frame2: "#d9d2c7", sky: ["#c7d9e8", "#d3e2ec", "#dee9ef", "#e8eff2"], cloud: "#f7f9fa", cloud2: "#e9f0f3",
  sill: "#f3efe8", sill2: "#d6cec2",
  shelf: "#dcd5cb", shelf2: "#bfb7ab", bracket: "#cfc7bb",
  top: "#cdbda8", edge: "#b7a690", front: "#ad9c85", front2: "#a08f78", knob: "#8c7c66",
  lampBody: "#ebe7e0", lampDark: "#c9c3b9", shade: "#f2eee7", shade2: "#dcd6cc",
  paper: "#fbf9f5", paper2: "#ece7df", ink: "#cfc8bd", pen: "#7d8a96",
  mug: "#c9d5da", mug2: "#b2c0c6", pot: "#d8cbbb", pot2: "#c4b6a4", leaf: "#a3b69d", leaf2: "#879b81",
  frameArt: "#e9e3da", art: "#c9d3d8", art2: "#b8c6b3",
  note: "#f4e7a8", note2: "#e7d88f",
  dim: 1,
};
const NIGHT = {
  wall: "#2d313c", wall2: "#282c36", trim: "#353a46",
  frame: "#3c4151", frame2: "#30343f", sky: ["#121828", "#172034", "#1c2740", "#222f4a"], cloud: "#2b3650", cloud2: "#26304a",
  sill: "#3a3f4d", sill2: "#2c303b",
  shelf: "#3e4351", shelf2: "#30343f", bracket: "#383d4a",
  top: "#4d4641", edge: "#433c37", front: "#3a3430", front2: "#332e2a", knob: "#5b524a",
  lampBody: "#5b5751", lampDark: "#47443f", shade: "#f2d7a2", shade2: "#d9b77c",
  paper: "#e3d6bd", paper2: "#cbbfa7", ink: "#b8ab92", pen: "#55606b",
  mug: "#59636d", mug2: "#4b545d", pot: "#5c534b", pot2: "#4c443d", leaf: "#566a57", leaf2: "#465747",
  frameArt: "#3a3f4c", art: "#46536a", art2: "#3f4f45",
  note: "#cfc18a", note2: "#b8aa75",
  moon: "#f1e6c6", star: "#d7dbea",
  dim: 0.62,
};

// 书脊的颜色：夜里压暗一点
const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.round(c * k).toString(16).padStart(2, "0");
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
};

export function scene({ night, books = [], fresh = 0 }) {
  const c = night ? NIGHT : DAY;
  const R = [];
  const r = (x, y, w, h, col) => R.push({ x, y, w, h, c: col });

  // 墙：上浅下深一点点
  r(0, 0, W, H, c.wall);
  r(0, 120, W, 22, c.wall2);
  r(0, 119, W, 1, c.trim);

  // 窗
  const wx = 12, wy = 22, ww = 44, wh = 62;
  r(wx - 2, wy - 2, ww + 4, wh + 4, c.frame2);
  r(wx - 1, wy - 1, ww + 2, wh + 2, c.frame);
  c.sky.forEach((col, i) => r(wx, wy + Math.round((wh * i) / 4), ww, Math.ceil(wh / 4), col));
  if (night) {
    // 月亮（弯的）和几颗星
    const mx = wx + 31, my = wy + 12;
    for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
      if (x * x + y * y <= 17 && !((x - 2) * (x - 2) + (y + 1) * (y + 1) <= 12)) r(mx + x, my + y, 1, 1, c.moon);
    }
    for (const [x, y] of [[5, 6], [14, 18], [9, 33], [24, 28], [38, 40], [19, 46], [33, 52], [6, 50], [40, 22]]) r(wx + x, wy + y, 1, 1, c.star);
  } else {
    const cloud = (x, y) => { r(x + 2, y, 8, 1, c.cloud); r(x, y + 1, 13, 2, c.cloud); r(x + 1, y + 3, 11, 1, c.cloud2); };
    cloud(wx + 5, wy + 12);
    cloud(wx + 24, wy + 30);
  }
  // 窗格
  r(wx + ww / 2 - 1, wy, 2, wh, c.frame);
  r(wx, wy + wh / 2 - 1, ww, 2, c.frame);
  // 窗台
  r(wx - 4, wy + wh + 2, ww + 8, 3, c.sill);
  r(wx - 4, wy + wh + 5, ww + 8, 1, c.sill2);

  // 墙上一幅小画（书架下面）
  r(76, 100, 22, 15, c.frame2);
  r(77, 101, 20, 13, c.frameArt);
  r(79, 108, 4, 4, c.art2); r(83, 105, 5, 7, c.art); r(88, 107, 6, 5, c.art2);

  // 书架：第一层放你的书
  const sx = 64, sw = 50;
  const shelfAt = y => { r(sx, y, sw, 2, c.shelf); r(sx, y + 2, sw, 1, c.shelf2); r(sx + 4, y + 3, 2, 3, c.bracket); r(sx + sw - 6, y + 3, 2, 3, c.bracket); };
  const s1 = 58, s2 = 92;
  shelfAt(s1);
  shelfAt(s2);
  const slots = [];
  let x = sx + 3;
  books.slice(0, 8).forEach((b, i) => {
    const w = 5 + (i % 3 === 1 ? 1 : 0), h = 14 + ((i * 5) % 5);
    const col = shade(SPINES[b.color % SPINES.length], night ? 0.6 : 1);
    r(x, s1 - h, w, h, col);
    r(x, s1 - h + 3, w, 1, shade(col, 1.12));
    r(x, s1 - 4, w, 1, shade(col, 0.88));
    slots.push({ id: b.id, x, y: s1 - h, w, h });
    x += w + 1;
  });
  // 空位：放一本新书
  const add = { x, y: s1 - 14, w: 6, h: 14 };
  // 第二层：一盆小草、几本躺着的书
  r(sx + 6, s2 - 6, 8, 6, c.pot); r(sx + 6, s2 - 6, 8, 1, c.pot2);
  r(sx + 7, s2 - 11, 2, 5, c.leaf); r(sx + 10, s2 - 13, 2, 7, c.leaf2); r(sx + 12, s2 - 10, 2, 4, c.leaf);
  [["#c8b9a5", 18], ["#a9b7c2", 16], ["#bba9b9", 19]].forEach(([col, w], i) => r(sx + 26 + (i % 2), s2 - 3 * (i + 1), w, 3, shade(col, night ? 0.6 : 1)));

  // 新便利贴：贴在书架旁边的墙上
  if (fresh) { r(sx - 9, 66, 7, 7, c.note); r(sx - 9, 72, 7, 1, c.note2); r(sx - 7, 65, 3, 1, c.frame); }

  // 书桌
  r(0, 142, W, 5, c.top);
  r(0, 147, W, 2, c.edge);
  r(0, 149, W, H - 149, c.front);
  for (const dx of [8, 64]) { r(dx, 157, 48, 16, c.front2); r(dx + 1, 158, 46, 14, c.front); r(dx + 22, 164, 4, 2, c.knob); }
  r(0, 186, W, 1, c.front2);

  // 台灯（左）
  r(10, 138, 14, 4, c.lampDark); r(11, 137, 12, 1, c.lampBody);
  r(16, 116, 2, 21, c.lampBody);
  for (let i = 0; i < 6; i++) r(17 + i, 116 - i, 2, 1, c.lampBody);
  r(19, 104, 14, 2, c.shade2); r(20, 106, 14, 4, c.shade); r(21, 110, 14, 2, c.shade2);
  // 稿纸（中间一摞）+ 一支笔
  r(44, 139, 34, 3, c.paper2);
  r(45, 137, 32, 3, c.paper);
  for (const ly of [138]) r(48, ly, 24, 1, c.ink);
  for (let i = 0; i < 12; i++) r(62 + i, 135 - Math.floor(i / 3), 1, 1, c.pen);
  // 杯子（右）
  r(88, 131, 9, 11, c.mug); r(88, 131, 9, 1, c.mug2); r(97, 134, 2, 5, c.mug2); r(99, 135, 1, 3, c.mug2);
  // 一本合着的本子
  r(102, 139, 14, 3, c.edge); r(102, 138, 14, 1, c.paper2);

  return { rects: R, slots, add, lamp: { x: 27, y: 110 }, paper: { x: 44, y: 135, w: 34, h: 7 }, window: { x: wx, y: wy, w: ww, h: wh } };
}

export const isNight = (d = new Date()) => d.getHours() < 6 || d.getHours() >= 18;
