// 第四版家具：东西放大到一眼看得出是什么；脆脆地炉贴左墙、地台床头贴后墙；Rowan 榻台进墙角、书桌贴墙
import { box, quad, sprite, dither, hex, mix, glow, shadow, floorQuad, floorGlow, planks, P, applyLights, tagId } from "./iso.js";
const T = tagId;
import { litTop, sunOn } from "./light.js";
import { cui, cuiDeck, rowan } from "./rooms.js";
import { HEADS, LYING } from "./folk.js";

const shade = (c, k) => "#" + hex(c).map(v => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, "0")).join("");
const wood = (c, line) => ({ top: shade(c, 1.12), left: c, right: shade(c, 0.78), line: line || shade(c, 0.55) });
const soft = (c) => ({ top: shade(c, 1.06), left: shade(c, 0.94), right: shade(c, 0.8), line: shade(c, 0.62) });
const legs = (cv, x, y, w, d, h, c, L, t = 0.14, z = 0) => {
  for (const [a, b] of [[x, y], [x + w - t, y], [x, y + d - t], [x + w - t, y + d - t]]) box(cv, { x: a, y: b, z, w: t, d: t, h }, wood(c), L);
};
const onLeft = (cv, gy0, gy1, h0, h1, fn, L, gx = 0.02) => quad(cv, [gx, gy0, h0], [0, gy1 - gy0, 0], [0, 0, h1 - h0], fn, L);
const onBack = (cv, gx0, gx1, h0, h1, fn, L, gy = 0.02) => quad(cv, [gx0, gy, h0], [gx1 - gx0, 0, 0], [0, 0, h1 - h0], fn, L);
const framed = (border, inner) => (u, v, x, y, i) => (i.edge < 1.2 ? border : inner(u, v, x, y, i));
const litBox = (cv, b, col, win, L, s = 1) => box(cv, b, { ...col, top: litTop(col.top, b.x, b.y, b.w, b.d, (b.z || 0) + b.h, win, s) }, L);
// 一根棍子（三脚架、望远镜筒）：沿着 a→b 一路叠小方块
function rod(cv, a, b, r, col, L) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 22);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    box(cv, { x: a[0] + (b[0] - a[0]) * t - r / 2, y: a[1] + (b[1] - a[1]) * t - r / 2, z: a[2] + (b[2] - a[2]) * t, w: r, d: r, h: r }, col, L);
  }
}
// 一片叶子：屏幕上从 (x0,y0) 往 ang 方向长，尖头、带描边和叶脉
function leaf(cv, x0, y0, ang, len, hw, [dk, md, lt]) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  for (let y = Math.floor(y0 - len - 2); y <= y0 + len + 2; y++) for (let x = Math.floor(x0 - len - 2); x <= x0 + len + 2; x++) {
    const dx = x + 0.5 - x0, dy = y + 0.5 - y0, a = dx * ca + dy * sa, b = -dx * sa + dy * ca;
    if (a < 0 || a > len) continue;
    const w = hw * Math.sin(Math.PI * Math.pow(a / len, 0.8));
    if (Math.abs(b) > w) continue;
    cv.set(x, y, hex(Math.abs(b) > w - 1 ? dk : Math.abs(b) < 0.5 && a < len - 2 ? dk : b < 0 ? lt : md));
  }
}
// 一盆植物：陶盆 + 一丛叶子（叶子在屏幕上画，看得清是叶子）
function plant(cv, gx, gy, z, { s = 1, pot = "#B8673A", leaves = ["#24502F", "#3F8A4C", "#74C06E"], tall = 1 } = {}, L) {
  const pw = 0.5 * s, ph = 0.45 * s;
  shadow(cv, gx, gy, pw, pw, 0.25, 0.08);
  box(cv, { x: gx, y: gy, z, w: pw, d: pw, h: ph }, { top: "#4A3020", left: pot, right: shade(pot, 0.75), line: shade(pot, 0.5) }, L);
  box(cv, { x: gx - 0.03, y: gy - 0.03, z: z + ph - 0.08 * s, w: pw + 0.06, d: pw + 0.06, h: 0.08 * s }, soft(shade(pot, 1.1)), L);
  const [bx, by] = P(gx + pw / 2, gy + pw / 2, z + ph);
  const z0 = cv.z; cv.z = gx + gy + pw; // 叶子挡在花盆那个位置
  const L1 = 13 * s * tall, W1 = 3.6 * s;
  const fan = [[-2.6, 0.75], [-0.55, 0.75], [-2.15, 1], [-1.0, 1], [-1.6, 1.1], [-2.85, 0.6], [-0.3, 0.6], [-1.85, 0.85], [-1.3, 0.9]];
  fan.forEach(([a, k], i) => {
    const bx2 = bx + Math.cos(a) * 2, by2 = by + Math.sin(a) * 2;
    for (let t = 0; t < 4 * s; t++) cv.set(Math.round(bx + Math.cos(a) * t), Math.round(by - 1 + Math.sin(a) * t), hex(leaves[0]));
    leaf(cv, bx2 + Math.cos(a) * 2 * s, by2 + Math.sin(a) * 2 * s, a, L1 * k, W1 * (0.8 + 0.2 * k), i < 3 ? [leaves[0], shade(leaves[1], 0.85), leaves[1]] : leaves);
  });
  cv.z = z0;
}
// 平铺在地上的一张纸（报纸、地图），可以转个角度；接窗光
function sheet(cv, x, y, w, d, ang, paint, win, L) {
  const c = Math.cos(ang), s = Math.sin(ang);
  quad(cv, [x, y, 0.004], [w * c, w * s, 0], [-d * s, d * c, 0], (u, v, px, py, i) => {
    let col = paint(u, v, px, py, i);
    if (!col) return null;
    col = typeof col === "string" ? hex(col) : col;
    return win ? sunOn(col, win, x + u * w * c - v * d * s, y + u * w * s + v * d * c, 0, px, py) : col;
  }, L);
}
// 把一个小人图（folk.js 拼好的）底边居中放到 P(gx, gy, h)
function drawBuilt(cv, s, gx, gy, h) {
  const [px, py] = P(gx, gy, h), x0 = Math.round(px - s.w / 2), y0 = Math.round(py) - s.h;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const c = s.px(x, y); if (c) cv.set(x0 + x, y0 + y, c, gx + gy); }
}
// 把转过的小人图中心放到 P(gx, gy, h)
function drawCentered(cv, s, gx, gy, h) {
  const [px, py] = P(gx, gy, h), x0 = Math.round(px - s.w / 2), y0 = Math.round(py - s.h / 2);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const c = s.px(x, y); if (c) cv.set(x0 + x, y0 + y, c, gx + gy); }
}
// 铺开的被子：盖住整张床，上面鼓起一个人形，靠枕头那头翻过来一道被里
function spreadQuilt(cv, { x, y, w, d, z }, { top, side, dark, fold, stripe }, L, win) {
  const paint = (u, v, px, py) => {
    let c = v < 0.1 ? fold : stripe && Math.abs((u * 4) % 1 - 0.5) < 0.04 ? stripe : top;
    if (v >= 0.1 && Math.abs(Math.sin(u * 7 + v * 2)) < 0.12 && dither(px, py)) c = shade(top, 0.92); // 几道软软的褶
    return c;
  };
  box(cv, { x, y, w, d, z, h: 0.16 }, { top: win ? litTop(paint, x, y, w, d, z + 0.16, win) : paint, left: side, right: dark, line: shade(dark, 0.75) }, L);
  // 身体把被子顶起来一点
  box(cv, { x: x + w * 0.22, y: y + 0.1, w: w * 0.56, d: d * 0.7, z: z + 0.16, h: 0.12 }, { top: win ? litTop(top, x + w * 0.22, y + 0.1, w * 0.56, d * 0.7, z + 0.28, win) : top, left: side, right: dark }, L);
  box(cv, { x: x + w * 0.3, y: y + 0.3, w: w * 0.4, d: d * 0.45, z: z + 0.28, h: 0.07 }, { top: win ? litTop(top, x + w * 0.3, y + 0.3, w * 0.4, d * 0.45, z + 0.35, win) : top, left: side, right: dark }, L); // 腿那里再鼓一点
  // 被角垂到床边
  quad(cv, [x + 0.2, y + d + 0.01, z - 0.3], [w - 0.4, 0, 0], [0, 0, 0.46], (u, v) => (v < 0.15 - Math.sin(u * 3.1) * 0.1 ? null : side), L);
}

// 门口漏进来的光
function doorSpill(cv, a0, a1, reach, color, dir) {
  const spill = (d, a, px, py) => {
    const lo = a0 - d * 0.28, hi = a1 + d * 0.5;
    if (a < lo || a > hi) return 0;
    const k = 1 - d / reach;
    if (k <= 0) return 0;
    if (Math.min(a - lo, hi - a) < 0.12 && dither(px, py)) return 0;
    return k > 0.66 ? 0.5 : k > 0.33 ? (dither(px, py) && k < 0.4 ? 0.18 : 0.34) : 0.18;
  };
  if (dir === "left") floorGlow(cv, 0, a0 - 1.2, reach, a1 - a0 + 3, color, (gx, gy, px, py) => spill(gx, gy, px, py));
  else floorGlow(cv, a0 - 1.2, 0, a1 - a0 + 3, reach, color, (gx, gy, px, py) => spill(gy, gx, px, py));
}
const netTex = (u, v, x, y) => {
  const a2 = (x + y * 2) % 5, b2 = (x - y * 2 + 500) % 5;
  return a2 === 0 || b2 === 0 ? "#C2AA74" : (x * 3 + y) % 7 === 0 ? "#5A4C34" : "#7A6A4A";
};

// ---------- 放大了的小贴图 ----------
const KETTLE = [ // 铁壶：提梁、壶盖、壶嘴
  "....######......",
  "...#......#.....",
  "..#........#....",
  "..#..####..#....",
  ".....#hh#.......",
  "...##########...",
  "..#ohhoooooood#.",
  ".#ohhoooooooood##",
  "#oohooooooooood#.",
  "#ooooooooooooodd.",
  "#oooooooooooood#.",
  ".#ooooooooooodd#.",
  "..#ddddddddddd#..",
  "...###########...",
];
const TEAPOT = [ // 陶茶壶：侧把、壶嘴
  ".......##.......",
  "......#hh#......",
  "....########....",
  "...#hhoooooo#...",
  ".###hoooooooo#.##",
  "#.#hoooooooooo##.",
  "#.#hoooooooood#..",
  "#.#ooooooooood#..",
  ".##ooooooooood#..",
  "...#ooooooodd#...",
  "....#########....",
];
const JAR = [ // 赭色陶罐
  "...######...",
  "...#hdd#....",
  "..########..",
  ".#hhooooood#",
  "#hhoooooooo#",
  "#hooooooood#",
  "#hooooooood#",
  "#hooooooood#",
  ".#oooooood#.",
  "..#ddddddd#.",
  "...#######..",
];
const CROCK = [ // 腌菜坛：盖子歪着、压一块石头、扎着绳
  "....##...........",
  "...#ss#..........",
  "..########.......",
  ".#hhhhhhhh###....",
  "..#.#oooooooo#...",
  "..#hhrrrrrrrrr#..",
  ".#hooooooooood#..",
  "#hoooooooooood#..",
  "#hoooooooooood#..",
  "#hoooooooooood#..",
  ".#ooooooooodd#...",
  "..###########....",
];
const HAT = [ // 草帽
  "......######......",
  ".....#hhhhhh#.....",
  "....#hhoooooo#....",
  "....#rrrrrrrr#....",
  "..###oooooooo###..",
  ".#hhhhhhhhhhhhhh#.",
  "#hhoooooooooooood#",
  ".##oooooooooood##.",
  "...############...",
];
const WISH = [ // 许愿瓶：软木塞、玻璃、半瓶东西
  "..cc..",
  ".cccc.",
  ".#gg#.",
  "#gwggg#".slice(0, 6),
  "#wggg#",
  "#wggg#",
  "#aaaa#",
  "#abab#",
  "#baba#",
  "#aaaa#",
  ".####.",
];
const BAG = [ // 暖暖的粮袋：麻布袋子、口子扎着绳，正面印一条大鱼
  "......#..#......",
  ".......##.......",
  "......####......",
  ".....#oooo#.....",
  "....#oooooo#....",
  "...#oooooooo#...",
  "..#oooooooooo#..",
  ".#oooooooooooo#.",
  "#oooooyoyoooooo#",
  "#oooooyyyoooooo#",
  "#ooooooyoyooooo#",
  "#ooooooovoooooo#",
  "#oooooooooooooo#",
  "#dooooooooooood#",
  ".#dddddddddddd#.",
  "..############..",
];


// 挂在左墙上的信箱：一个小木箱从墙上凸出来，正面一条投信口、侧面一面小旗。
// 有新信（globalThis.MAIL）：旗子竖起来、投信口露出半封信、周围亮一圈
function mailbox(cv, gy0, z0, { body, dark, trim, flag, letter, seal, glow: halo }, L) {
  const has = !!cv.mail, w = 0.42, d = 0.85, h = 0.75;
  if (has) onLeft(cv, gy0 - 0.25, gy0 + d + 0.25, z0 - 0.2, z0 + h + 0.35, (u, v, x, y) => {
    const e = Math.hypot((u - 0.5) * 1.3, (v - 0.5) * 1.1);
    return e < 0.5 && (e < 0.38 || dither(x, y)) ? glow(cv.get(x, y), hex(halo), 0.35) : null;
  });
  box(cv, { x: 0.15, y: gy0 + 0.25, z: z0 - 0.25, w: 0.1, d: 0.35, h: 0.25 }, wood(dark), L); // 托架
  box(cv, { x: 0.02, y: gy0, z: z0, w, d, h }, {
    line: shade(dark, 0.7),
    top: (u, v) => (v < 0.12 || v > 0.88 ? trim : body),
    left: (u, v) => (v > 0.85 ? trim : shade(body, 0.92)),
    right: (u, v) => { // 正面（朝屋里）：投信口 + 一个小信封图案
      if (v > 0.85 || u < 0.06 || u > 0.94) return trim;
      if (v > 0.6 && v < 0.72 && u > 0.2 && u < 0.8) return "#1A120C";
      if (v > 0.18 && v < 0.45 && u > 0.32 && u < 0.68) return Math.abs((v - 0.18) / 0.27 - 1 + Math.abs(u - 0.5) * 3.7) < 0.18 ? trim : shade(trim, 1.15);
      return shade(body, 0.8);
    },
  }, L);
  if (has) quad(cv, [w + 0.03, gy0 + 0.2, z0 + h * 0.66], [0, 0.45, 0], [0, 0, 0.3], (u, v) => (Math.hypot((u - 0.5) * 2, v - 0.45) < 0.2 ? seal : v < 0.12 ? shade(letter, 0.85) : letter), L);
  // 小旗：有信时竖起来，没信时放平
  if (has) { box(cv, { x: w * 0.5, y: gy0 + d + 0.02, z: z0 + 0.3, w: 0.05, d: 0.05, h: 0.7 }, wood(dark)); box(cv, { x: w * 0.5, y: gy0 + d + 0.02, z: z0 + 0.75, w: 0.05, d: 0.32, h: 0.22 }, soft(flag)); }
  else box(cv, { x: w * 0.5, y: gy0 + d + 0.02, z: z0 + 0.3, w: 0.05, d: 0.55, h: 0.08 }, soft(flag));
}

// ============================ 脆脆 ============================
const W = "#A9784E", WD = "#7A5236";
const INDIGO = ["#1F3566", "#18294F", "#2C4A80"];
const IRORI = { x: 0.35, y: 2.4, S: 1.5 };
const ICX = IRORI.x + IRORI.S / 2, ICY = IRORI.y + IRORI.S / 2;
export const cuiLights = [
  { at: [ICX, ICY, 0.4], r: 3.9, color: "#FFB35C", s: 0.62 }, // 地炉
];

export function cuiFurnish(cv, L, state = {}) {
  cv.mail = state.mail;
  const win = cui.win, D = cuiDeck, top = D.h;

  // ---- 左墙：大一点的海图、「记得喝水」便签、三格贝壳标本 ----
  cv.tag = T("chart");
  onLeft(cv, 0.4, 2.3, 3.0, 4.9, framed("#7A5638", (u, v, x, y) => {
    const land = 0.25 * Math.sin(u * 7) + 0.3 - v;
    if (Math.abs(land) < 0.03) return "#8A6A48";
    if (land > 0) return (x + y) % 9 === 0 ? "#B9A47A" : "#D8C49A";
    if (Math.abs(Math.hypot(u - 0.75, v - 0.75) - 0.1) < 0.02) return "#8A6A48"; // 小罗盘
    if ((x * 7 + y * 3) % 23 === 0) return "#7FA0B8";
    if (Math.abs(u - 0.45 - Math.sin(v * 6) * 0.05) < 0.02 && v > 0.35 && v < 0.85 && (y % 3)) return "#C64A3A";
    return "#EDE3CC";
  }), L);
  cv.tag = T("note");
  onBack(cv, 2.2, 3.3, 4.2, 5.2, (u, v, x, y, i) => {
    if (i.edge < 1) return "#D9B860";
    if (v > 0.86 && Math.abs(u - 0.5) < 0.08) return "#C64A3A"; // 图钉
    // 「记得喝水」：两行四个小方块字 + 一个水滴
    const row = v > 0.5 ? 0 : 1, cu = (u - 0.12) / 0.76 * 4, ci = Math.floor(cu), fu = cu - ci;
    const rv = row === 0 ? (v - 0.55) / 0.25 : (v - 0.18) / 0.25;
    if (ci >= 0 && ci < 4 && fu > 0.15 && fu < 0.85 && rv > 0 && rv < 1 && (row === 0 || ci < 2)) {
      if (((x * 3 + y * 5 + ci) % 4 !== 0) && (fu < 0.3 || fu > 0.7 || Math.abs(rv - 0.5) < 0.15 || rv > 0.8)) return "#4A4A7A";
    }
    if (row === 1 && Math.hypot((u - 0.72) * 1.5, v - 0.3) < 0.09) return "#5A8AC8";
    return "#FFF2B8";
  }, L);
  cv.tag = T("shells");
  onLeft(cv, 3.6, 5.6, 3.25, 4.25, (u, v, x, y, i) => {
    if (i.edge < 1.2) return "#6E4D30";
    const cell = Math.floor(u * 3), cu = u * 3 - cell;
    if (cu < 0.05 || cu > 0.95) return "#6E4D30";
    const sh = [["#F4D9CC", "#E2B8A8"], ["#FFF3E6", "#D9C9AE"], ["#E8C9A0", "#C9A27A"]][cell];
    // 扇贝 / 海螺 / 扇贝
    if (cell === 1) {
      const d = Math.hypot((cu - 0.5) * 1.3, (v - 0.5) * 1.0);
      if (d < 0.3 && Math.atan2(v - 0.5, cu - 0.5) * 3 % 1 > 0.1) return Math.floor(d * 14) % 2 ? sh[0] : sh[1];
    } else {
      const dx = cu - 0.5, dy = v - 0.32;
      if (dy > 0 && Math.hypot(dx * 1.2, dy) < 0.42 && Math.abs(dx) < 0.4) return Math.floor((Math.atan2(dy, dx) * 6) % 1 * 2) ? sh[0] : sh[1];
      if (dy > -0.1 && dy <= 0 && Math.abs(dx) < 0.12) return sh[1];
    }
    if (Math.abs(v - 0.14) < 0.05 && Math.abs(cu - 0.5) < 0.2) return "#EDE3CC";
    return "#2E4A5E";
  }, L);

  // ---- 后墙左边：墙角一大盆植物、带靠背的小凳挂草帽 ----
  cv.tag = T("plant");
  plant(cv, 0.3, 0.3, 0, { s: 1.5, tall: 1.2 }, L);
  cv.tag = T("hat");
  shadow(cv, 2.6, 0.35, 0.65, 0.65, 0.22);
  legs(cv, 2.6, 0.35, 0.65, 0.65, 0.55, WD, L, 0.1);
  box(cv, { x: 2.6, y: 0.35, z: 0.55, w: 0.65, d: 0.65, h: 0.08 }, wood(W), L);
  box(cv, { x: 2.6, y: 0.35, z: 0.63, w: 0.65, d: 0.08, h: 0.8 }, wood(W), L);
  sprite(cv, [2.5, 0.48, 0.95], HAT, { "#": "#8A6A30", h: "#F0D48C", o: "#D9B868", r: "#C64A3A", d: "#B8964A" }, L);

  // ---- 地炉：贴着左墙；木框、灰、石头、火；三个靛蓝坐垫围着另外三边 ----
  const { x: ix, y: iy, S } = IRORI, cx = ICX, cy = ICY;
  cv.tag = T("cushion");
  box(cv, { x: ix + 0.3, y: iy - 0.95, w: 0.9, d: 0.8, h: 0.14 }, soft(INDIGO[0]), L); // 后
  shadow(cv, ix, iy, S, S, 0.2);
  cv.tag = T("fire");
  box(cv, { x: ix, y: iy, w: S, d: S, h: 0.1 }, {
    line: "#4A3020", left: "#6A4630", right: "#5A3A26",
    top: (u, v) => (u < 0.12 || u > 0.88 || v < 0.12 || v > 0.88 ? "#7A5236" : ((u * 13 + v * 7) % 1 < 0.5 ? "#9A9086" : "#8A8076")),
  }, L);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    box(cv, { x: cx + Math.cos(a) * 0.4 - 0.1, y: cy + Math.sin(a) * 0.4 - 0.1, z: 0.1, w: 0.2, d: 0.2, h: 0.12 }, { top: "#B9B2A6", left: "#8E877C", right: "#766F65", line: "#5A544C" }, L);
  }
  // 火苗和热气会动，画在 cuiAnim 里；灭了就只剩一堆暗红的炭
  if (state.fire === false) sprite(cv, [cx - 0.05, cy + 0.15, 0.12], [".#.#..", "#@##@#"], { "#": "#5A2E22", "@": "#8A3A28" });
  cv.tag = T("cushion");
  box(cv, { x: ix + S + 0.25, y: iy + 0.35, w: 0.8, d: 0.9, h: 0.14 }, soft(INDIGO[2]), L); // 右
  // 铁壶 + 从墙上伸出来的横木上垂下来的绳
  cv.tag = T("kettle");
  const armZ = 5.0;
  for (let h = 1.45; h < armZ; h += 1 / 16) sprite(cv, [cx, cy, h], ["#"], { "#": "#5A4632" });
  sprite(cv, [cx - 0.1, cy, 2.1], ["#####"], { "#": "#3A2A1C" }); // 自在钩的横木
  { // 铁壶正挂在火上：贴图按绳子的位置居中
    const [kx, ky] = P(cx, cy, 0.62), pal = { "#": "#141416", o: "#34343A", h: "#5A5A64", d: "#24242A" };
    cv.z = cx + cy;
    KETTLE.forEach((r, j) => [...r].forEach((ch, i) => { if (pal[ch]) cv.set(Math.round(kx) - 7 + i, Math.round(ky) - KETTLE.length + j, hex(pal[ch])); }));
    cv.z = -99;
  }
  box(cv, { x: 0, y: cy - 0.15, z: armZ, w: cx + 0.35, d: 0.3, h: 0.26 }, wood("#6A4630", "#3A2416"), L);
  for (let i = 0; i < 8; i++) box(cv, { x: 0.02 + i * 0.07, y: cy - 0.1, z: armZ - 0.62 + i * 0.075, w: 0.1, d: 0.2, h: 0.1 }, wood("#5E3E28"), L); // 斜撑
  for (let i = 0; i < 6; i++) sprite(cv, [cx + 0.2 + (i % 2) * 0.06, cy - 0.12 + i * 0.07, armZ - 0.2 - i * 0.12], ["##", "@@", "@@", ".@"], { "#": "#3E5A2A", "@": i % 3 ? "#C8382A" : "#E0503A" }); // 干辣椒
  cv.tag = T("cushion");
  box(cv, { x: ix + 0.3, y: iy + S + 0.25, w: 0.9, d: 0.8, h: 0.14 }, soft(INDIGO[1]), L); // 前

  // ---- 左墙：矮柜（收音机、陶罐、腌菜坛、暖暖的粮袋），推拉门，门边一盆植物 ----
  const ky = 5.25, kd = 1.55;
  cv.tag = T("cabinet");
  shadow(cv, 0, ky, 0.85, kd);
  box(cv, { x: 0, y: ky, w: 0.85, d: kd, h: 1.15 }, {
    top: shade(W, 1.12), left: shade(W, 0.92), line: shade(W, 0.55),
    right: (u, v) => (Math.abs(u - 0.5) < 0.02 || v > 0.92 || v < 0.06 ? shade(W, 0.6) : (Math.abs(u - 0.42) < 0.03 || Math.abs(u - 0.58) < 0.03) && Math.abs(v - 0.55) < 0.06 ? "#4A2E18" : shade(W, 0.8)),
  }, L);
  box(cv, { x: 0.1, y: ky + 0.08, z: 1.15, w: 0.55, d: 0.75, h: 0.5 }, { top: "#7A5236", left: "#6A4528", right: "#8A5A38", line: "#3A2416" }, L); // 收音机
  quad(cv, [0.65, ky + 0.08, 1.2], [0, 0.75, 0], [0, 0, 0.4], (u, v, x, y) => (u > 0.42 ? ((x + y) % 2 ? "#D9C49A" : "#A8956E") : Math.hypot(u - 0.22, v - 0.62) < 0.12 || Math.hypot(u - 0.22, v - 0.25) < 0.09 ? "#E8C26A" : "#8A5A38"), L);
  sprite(cv, [0.3, ky + 0.3, 1.65], ["#", "#", "#", "#", "#", "#"], { "#": "#5A5A5A" });
  sprite(cv, [0.3, ky + 1.15, 1.15], JAR, { "#": "#6A3A18", o: "#C07A3A", h: "#E2A060", d: "#9A5A28" }, L);
  sprite(cv, [0.45, ky + 1.6, 1.15], CROCK, { "#": "#3A2418", o: "#7A5238", h: "#A27A58", d: "#5A3A28", r: "#C9A97A", s: "#9A9A94" }, L);
  cv.tag = T("bag");
  sprite(cv, [0.95, ky + 1.75, 0], BAG, { "#": "#7A6040", o: "#E8D8B4", d: "#C9B48A", y: "#D9A030", v: "#6A9A4A" }, L); // 袋子上印一束谷穗
  sprite(cv, [1.55, ky + 1.95, 0], ["y.y..", "..y.y"], { y: "#E2B04A" }); // 撒出来几粒小米 // 粮袋放在柜子脚边地上
  // 推拉门
  const d = cui.door;
  cv.tag = 0;
  if (state.door !== false) doorSpill(cv, d.u0, d.open, 3.2, "#FFC878", "left"); // 暖帘会被风吹，画在 cuiAnim 里
  cv.tag = T("plant");
  plant(cv, 0.2, 6.85, 0, { s: 1.1, pot: "#7A8A9A" }, L);
  cv.tag = T("mailbox");
  // 门边墙上的信箱：浅海蓝的木箱、白边、红旗
  mailbox(cv, 6.25, 2.85, { body: "#6E9AB8", dark: "#5A3C26", trim: "#F2EEE6", flag: "#C64A3A", letter: "#FFF6E2", seal: "#C64A3A", glow: "#FFE2A0" }, L);

  // ---- 地台：后墙右边一大片，抬高一格，上面铺一层暖暖的毯子 ----
  cv.tag = T("deck");
  shadow(cv, D.x, D.y, D.w, D.d, 0.25, 0.12);
  box(cv, D, {
    line: "#5A3C26",
    top: (u, v, px, py) => {
      const gx = D.x + u * D.w, gy = D.y + v * D.d;
      if ((1 - v) * D.d < 0.12 || u * D.w < 0.1) return "#6E4A30";
      const c = planks({ gx, gy: gy + 0.25 }, hex("#CFA273"), hex("#8A6240"), hex("#BE9064"), 5);
      return sunOn(c, win, gx, gy, top, px, py, 1.25);
    },
    left: (u, v, x, y) => (v > 0.84 ? "#5E3E26" : (u * D.w * 2) % 1 < 0.05 ? "#5A3C26" : "#7A5236"),
    right: (u, v) => (v > 0.84 ? "#4E3420" : "#5E4028"),
  }, L);
  // 毯子：米白底、橘红格子、两头流苏
  const rx = 4.55, ry = 0.95, rw = 2.75, rd = 5.25;
  quad(cv, [rx, ry, top + 0.004], [rw, 0, 0], [0, rd, 0], (u, v, px, py) => {
    const e = Math.min(u * rw, (1 - u) * rw);
    if ((v * rd < 0.12 || (1 - v) * rd < 0.12) && px % 2) return null; // 流苏
    let c = "#F4E6CC";
    const gu = (u * rw * 2.2) % 1, gv = (v * rd * 2.2) % 1;
    if (gu < 0.18 || gv < 0.18) c = gu < 0.18 && gv < 0.18 ? "#C9583E" : "#E8946A";
    if (e < 0.1) c = "#C9583E";
    if (dither(px, py) && (px * 3 + py) % 5 === 0) c = shade(c, 0.94); // 毛绒
    return sunOn(hex(c), win, rx + u * rw, ry + v * rd, top, px, py, 1.1);
  }, L);
  // 窗台：左半宽，能坐；四个许愿瓶；右头一盆垂下来的绿萝
  cv.tag = T("sill");
  litBox(cv, { x: 4.25, y: 0, z: win.h0 + 0.2, w: 3.0, d: 0.85, h: 0.12 }, wood("#A27650"), win, L);
  box(cv, { x: 7.25, y: 0, z: win.h0 + 0.2, w: 2.55, d: 0.3, h: 0.12 }, wood("#A27650"), L);
  const sillTop = win.h0 + 0.32;
  cv.tag = T("jars");
  [["#E2C28A", "#D4B07A"], ["#F4D9CC", "#FFFFFF"], ["#C98AA0", "#E7B2C0"], ["#F6F4EE", "#DADCE2"]].forEach(([a, b], k) => {
    sprite(cv, [4.55 + k * 0.4, 0.5, sillTop], WISH.map(r => r.replace(/#/g, "#")), { "#": "#7FA4AE", c: "#A07850", g: "#DCEDEE", w: "#FFFFFF", a, b }, L);
  });
  cv.tag = T("pothos");
  box(cv, { x: 6.55, y: 0.3, z: sillTop, w: 0.5, d: 0.5, h: 0.4 }, soft("#C07A3A"), L);
  { // 绿萝：盆里一小丛，藤从窗台边垂下来，一路挂着小叶子
    const [vx, vy] = P(6.8, 0.8, sillTop + 0.4);
    cv.z = 7.6;
    const pal = ["#24502F", "#3F8A4C", "#74C06E"];
    for (const [ox, len] of [[-3, 26], [2, 18], [5, 30]]) {
      for (let t = 0; t < len; t++) {
        const x = vx + ox + Math.sin(t / 5) * 1.5 + (ox > 0 ? t * 0.25 : -t * 0.2), y = vy + t;
        cv.set(Math.round(x), Math.round(y), hex(pal[0]));
        if (t % 5 === 2) leaf(cv, x, y, t % 10 < 5 ? 0.4 : Math.PI - 0.4, 6, 2.6, pal);
      }
    }
    for (const a of [-2.4, -1.6, -0.9, -0.3, -2.9]) leaf(cv, vx, vy - 1, a, 8, 3, pal);
    cv.z = -99;
  }

  // ---- 地台上：床头贴着后墙 ----
  cv.tag = T("bed");
  const bx = 7.35, by = 0.25, bw = 2.45, bd = 3.4;
  box(cv, { x: bx, y: 0.03, z: top, w: bw, d: 0.22, h: 0.62 }, wood("#8A5A38"), L);
  shadow(cv, bx, by, bw, bd, 0.25);
  box(cv, { x: bx, y: by, z: top, w: bw, d: bd, h: 0.28 }, wood("#8A5A38"), L);
  box(cv, { x: bx + 0.05, y: by + 0.05, z: top + 0.28, w: bw - 0.1, d: bd - 0.1, h: 0.26 }, { top: "#FBF3E4", left: "#EDE1CB", right: "#D9CBB0", line: "#B7A688" }, L);
  box(cv, { x: bx + 0.3, y: by + 0.12, z: top + 0.54, w: 1.7, d: 0.62, h: 0.22 }, { top: litTop("#FFFFFF", bx + 0.3, by + 0.12, 1.7, 0.62, top + 0.76, win), left: "#F2ECE2", right: "#DDD5C8", line: "#B9AE9E" }, L);
  const qy = by + 1.0, qz = top + 0.54;
  if (state.bed) { // 睡着了：顺着床躺好，被子铺开盖到下巴，暖暖窝在枕头边
    drawCentered(cv, LYING.xq, bx + 1.25, by + 0.7, top + 1.08);
    spreadQuilt(cv, { x: bx + 0.04, y: by + 0.82, w: bw - 0.08, d: bd - 0.87, z: top + 0.54 }, { top: "#F2B08A", side: "#E89A72", dark: "#C97E58", fold: "#FFE6D2" }, L, win);
    drawBuilt(cv, HEADS.nn, bx + 2.05, by + 0.5, top + 0.72);
  } else {
  box(cv, { x: bx + 0.02, y: qy, z: top + 0.28, w: bw - 0.04, d: bd - 0.95, h: 0.32 }, {
    top: litTop((u, v, x, y) => (Math.abs(Math.sin(u * 9 + v * 3)) < 0.18 ? "#D98E68" : (Math.floor(u * 6) + Math.floor(v * 8)) % 2 && dither(x, y) ? "#E7A07A" : "#F2B08A"), bx, qy, bw, bd - 0.95, top + 0.6, win),
    left: "#E89A72", right: "#C97E58", line: "#9A5638",
  }, L);
  box(cv, { x: bx + 0.9, y: qy, z: qz + 0.06, w: 1.5, d: 0.6, h: 0.14 }, { top: litTop("#FFE6D2", bx + 0.9, qy, 1.5, 0.6, qz + 0.2, win), left: "#F7D2B5", right: "#E6BC9C", line: "#C99A78" }, L);
  box(cv, { x: bx + 0.1, y: qy + 0.8, z: qz + 0.06, w: 1.2, d: 0.85, h: 0.18 }, { top: "#EFA580", left: "#E3966E", right: "#C97E58", line: "#9A5638" }, L);
  quad(cv, [bx + 0.5, by + bd + 0.01, top], [1.1, 0, 0], [0, 0, 0.58], (u, v) => (v > 0.92 - Math.sin(u * 3.1) * 0.3 ? null : Math.floor(u * 6) % 2 ? "#E89A72" : "#D98A64"), L);
  // 扣着的书：放大，书脊朝上
  sprite(cv, [bx + 0.85, qy + 1.6, qz + 0.3], [
    "........##gg##........",
    "......##@@gg@@##......",
    "....##@@@@##@@@@##....",
    "..##@@@@@@##@@@@@@##..",
    "##@@@@@@@@##@@@@@@@@##",
    "#ppppppppp##ppppppppp#",
    "#,,,,,,,,,##,,,,,,,,,#",
  ], { "#": "#1E3450", "@": "#3E6A9A", g: "#E2C27A", p: "#FFF8E8", ",": "#D9CDB0" }, L);
  }
  // 床尾地台上：TA 的黑匣子（深木小箱子，铜包角、铜锁）
  cv.tag = T("blackbox");
  shadow(cv, 8.95, 4.05, 0.85, 0.6, 0.25, 0.06);
  box(cv, { x: 8.95, y: 4.05, z: top, w: 0.85, d: 0.6, h: 0.45 }, {
    line: "#1E120A", top: (u, v) => (u < 0.08 || u > 0.92 || v < 0.1 || v > 0.9 ? "#C9A24E" : "#4A2E1C"),
    left: (u, v) => (Math.abs(u - 0.5) < 0.07 && v > 0.45 && v < 0.75 ? "#E8C26A" : u < 0.07 || u > 0.93 || v > 0.9 || v < 0.1 ? "#B08A3A" : Math.abs(v - 0.62) < 0.03 ? "#2E1C10" : "#3E2616"),
    right: (u, v) => (u < 0.1 || u > 0.9 || v > 0.9 ? "#8A6A2A" : "#2E1C10"),
  }, L);

  // ---- 地台上：毯子上的矮桌，大一点的茶壶、半杯茶、摊开的本子 ----
  cv.tag = T("table");
  const tx = 4.85, ty = 2.9;
  box(cv, { x: tx + 0.35, y: ty + 1.3, z: top, w: 0.9, d: 0.85, h: 0.13 }, soft(INDIGO[0]), L);
  shadow(cv, tx, ty, 1.8, 1.1, 0.22);
  legs(cv, tx + 0.08, ty + 0.08, 1.64, 0.94, 0.45, WD, L, 0.14, top);
  litBox(cv, { x: tx, y: ty, z: top + 0.45, w: 1.8, d: 1.1, h: 0.12 }, wood(W), win, L);
  const tt = top + 0.57;
  litBox(cv, { x: tx + 0.12, y: ty + 0.45, z: tt, w: 0.75, d: 0.55, h: 0.04 }, { top: (u) => (Math.abs(u - 0.5) < 0.04 ? "#CDBF9F" : "#F3EAD3"), left: "#E1D6BC", right: "#CFC2A3", line: "#9C8E70" }, win, L);
  sprite(cv, [tx + 0.95, ty + 0.45, tt], TEAPOT, { "#": "#2E4A3E", o: "#5E8A72", h: "#8ABAA0", d: "#456E5A" }, L);
  sprite(cv, [tx + 1.25, ty + 1.0, tt], [ // 半杯茶
    "#######",
    "#tttttt#".slice(0, 7),
    "#ooooo#",
    "#hoooo#",
    "#hoooo#",
    ".#####.",
  ], { "#": "#9C8A70", t: "#B98A3A", o: "#F2E6D2", h: "#FFFFFF" }, L);

  // ---- 台阶、木屐、台阶旁一团渔网（一角搭在地台边上，带几个浮子） ----
  cv.tag = T("deck");
  box(cv, { x: 5.3, y: D.d, w: 2.6, d: 0.7, h: 0.5 }, {
    top: litTop("#C99A6A", 5.3, D.d, 2.6, 0.7, 0.5, win),
    left: (u, v) => (v > 0.8 ? "#6E4A30" : "#8A6240"), right: "#6A4630", line: "#5A3C26",
  }, L);
  cv.tag = T("net");
  quad(cv, [4.3, D.d + 0.01, 0.15], [0.85, 0, 0], [0, 0, 0.86], (u, v, x, y) => (v < 0.1 + Math.sin(u * 3) * 0.12 ? null : netTex(u, v, x, y)), L);
  quad(cv, [4.3, D.d - 0.5, top + 0.005], [0.85, 0, 0], [0, 0.5, 0], (u, v, x, y) => (v < 0.4 - u * 0.3 ? null : netTex(u, v, x, y)), L);
  for (const [x, y, w, d, h] of [[3.1, 6.75, 1.25, 1.0, 0.32], [3.35, 6.95, 0.85, 0.7, 0.5], [4.15, 6.7, 0.5, 0.75, 0.22]])
    box(cv, { x, y, w, d, h }, { top: netTex, left: netTex, right: (u, v, px, py) => shade(netTex(u, v, px, py), 0.8) }, L);
  for (const [x, y, z] of [[3.3, 7.75, 0.12], [3.9, 7.7, 0.3], [4.35, 7.45, 0.1], [3.6, 7.1, 0.5]])
    sprite(cv, [x, y, z], [".##.", "#oo#", "#ho#", ".##."], { "#": "#9A6A1A", o: "#E2A83A", h: "#FFD87A" }, L);
  // ---- 右前角：暖暖的草窝（铺着软布），旁边一小碟小米和一碟水 ----
  {
    const nx = 8.55, ny = 8.45, ns = 1.25;
    cv.tag = T("nest");
    shadow(cv, nx, ny, ns, ns, 0.25, 0.1);
    box(cv, { x: nx, y: ny, w: ns, d: ns, h: 0.38 }, {
      line: "#8A6A30",
      top: (u, v, x, y) => {
        const d = Math.hypot(u - 0.5, v - 0.5);
        if (d > 0.52) return null;
        if (d > 0.3) return (x * 2 + y) % 4 === 0 ? "#E8C878" : (x + y * 3) % 5 === 0 ? "#A8843E" : "#D2AC5C"; // 草编的边
        if (d > 0.26) return "#9A7A38";
        return (Math.floor(u * 6) + Math.floor(v * 6)) % 2 ? "#F4E2C8" : "#E9D3B2"; // 软布
      },
      left: (u, v, x, y) => ((x + y * 2) % 4 < 2 ? "#C9A15A" : "#B08A48"),
      right: (u, v, x, y) => ((x * 2 + y) % 4 < 2 ? "#A8843E" : "#8E6E34"),
    }, L);
    for (const [a, b] of [[8.3, 9.9], [8.45, 8.3], [9.9, 9.05], [8.2, 9.2]]) sprite(cv, [a, b, 0.01], ["#..#", ".##.", "#..."], { "#": "#D2AC5C" }); // 散落的草
    box(cv, { x: 7.75, y: 9.35, w: 0.45, d: 0.45, h: 0.1 }, { top: (u, v, x, y) => (Math.hypot(u - 0.5, v - 0.5) < 0.34 ? ((x + y) % 2 ? "#E2B04A" : "#C9902A") : "#E9E3D6"), left: "#D6CFC0", right: "#B9B2A2", line: "#8A8478" }, L); // 小米
    box(cv, { x: 8.25, y: 9.55, w: 0.42, d: 0.42, h: 0.1 }, { top: (u, v) => (Math.hypot(u - 0.5, v - 0.5) < 0.34 ? "#8AB4D0" : "#E9E3D6"), left: "#D6CFC0", right: "#B9B2A2", line: "#8A8478" }, L); // 水
  }
  cv.tag = T("geta");
  box(cv, { x: 8.5, y: 6.95, w: 0.4, d: 0.66, h: 0.1 }, wood("#B08A60"), L);
  box(cv, { x: 9.1, y: 7.2, w: 0.66, d: 0.4, h: 0.1 }, wood("#B08A60"), L);
  sprite(cv, [8.66, 7.3, 0.1], ["##"], { "#": "#C64A3A" });
  sprite(cv, [9.45, 7.42, 0.1], ["##"], { "#": "#C64A3A" });
  cv.tag = 0;
}

// 脆脆屋里会动的：地炉的火苗、壶嘴的热气、门口被风吹的暖帘。每一帧画在已经画好的屋子上面
const FLAMES = [
  ["...#.....", "..#@#.#..", ".#@o@##..", "#@oo@@#..", "#@owo@@#.", ".#@oo@#.."],
  ["....#....", "..#.#@#..", ".##@o@#..", "#@@oo@#..", "#@owo@@#.", ".#@oo@#.."],
  ["..#......", ".#@#..#..", ".#@o@#@..", "#@oo@@#..", "#@oow@@#.", ".#@oo@#.."],
];
const STEAM = [
  ["...#..", "..#...", ".#..#.", "..#.#.", "...#..", "..#...", ".#..#.", "..##.."],
  ["..#...", "...#..", "..#.#.", ".#..#.", "..#...", "...#..", "..#.#.", "..##.."],
  ["....#.", "...#..", "..#...", "..#.#.", "...#..", "..#...", ".#....", "..##.."],
];
export function cuiAnim(cv, state, time) {
  const cx = ICX, cy = ICY, f = Math.floor(time * 6) % 3;
  if (state.fire !== false) {
    sprite(cv, [cx - 0.05, cy + 0.15, 0.12], FLAMES[f], { "#": "#E8642C", "@": "#FFB35C", o: "#FFE08A", w: "#FFF6D6" });
    sprite(cv, [cx + 0.35, cy - 0.1, 1.45 + (time % 1) * 0.15], STEAM[Math.floor(time * 3) % 3], { "#": "#F4EEE6" });
  }
  if (state.door !== false) { // 暖帘：下摆被风吹得一摆一摆
    const d = cui.door, sw = Math.sin(time * 1.6) * 0.06;
    onLeft(cv, d.u0, d.open, 3.3, 4.4, (u, v) => {
      const uu = u + (1 - v) * sw * (u < 0.5 ? -1 : 1);
      if (Math.abs(uu - 0.5) < 0.03 + (1 - v) * 0.04 || uu < 0 || uu > 1) return null;
      if (Math.abs(v - 0.55 - Math.sin(uu * 14) * 0.08) < 0.07) return "#F2EEE6";
      return v > 0.9 ? INDIGO[1] : INDIGO[0];
    }, null, 0.08);
  }
}

// ============================ Rowan ============================
const DW = "#5E4030", WN = "#6E4D33", GOLD = "#C9A24E", PAPER = "#E9DFC4", RUST = "#9A4A32", PINE = "#2E4A3A";
export const rowanLights = [
  { at: [5.3, 0.5, 2.15], r: 3.6, color: "#FFC06A", s: 0.55 }, // 书桌上的台灯
];
export function rowanRug(f, c, C, x, y) {
  const x0 = 2.9, x1 = 6.9, y0 = 4.3, y1 = 7.5;
  if (f.gx < x0 || f.gx > x1 || f.gy < y0 || f.gy > y1) return null;
  const e = Math.min(f.gx - x0, x1 - f.gx, f.gy - y0, y1 - f.gy);
  if (e < 0.07) return hex("#2A3044");
  if (e < 0.36) {
    if (e > 0.14 && e < 0.21) return hex("#8A7A4E");
    return hex(((x * 73856093) ^ (y * 19349663)) % 41 === 0 ? "#B8BEDA" : "#3A4260");
  }
  const route = Math.abs((f.gy - y0) - 0.8 - (f.gx - x0) * 0.4 - Math.sin(f.gx * 1.5) * 0.35);
  if (route < 0.06 && Math.floor(f.gx * 5) % 2) return hex("#A9B1D6");
  if ((((x * 73856093) ^ (y * 19349663)) >>> 0) % 131 === 0) return hex("#C9CEE8");
  return hex((Math.floor(f.gx * 5) + Math.floor(f.gy * 5)) % 2 ? "#454E6E" : "#414A68");
}
const bookRow = (cv, x0, x1, y, z, h, cols, L, gap = []) => { // 一排立着的书（在架子上），朝 +gy 那面看得到书脊
  let x = x0, i = 0;
  while (x < x1 - 0.12) {
    const w = 0.13 + ((i * 37) % 5) * 0.025, hh = h * (0.75 + ((i * 53) % 4) * 0.08);
    if (!gap.includes(i)) box(cv, { x, y, z, w, d: 0.42, h: hh }, { top: shade(cols[i % cols.length], 1.1), left: cols[i % cols.length], right: shade(cols[i % cols.length], 0.7), line: shade(cols[i % cols.length], 0.5) }, L);
    x += w + 0.01; i++;
  }
};

export function rowanFurnish(cv, L, state = {}) {
  cv.mail = state.mail;
  const win = rowan.win;
  const BOOKS = ["#7A2E2A", PINE, GOLD, "#3E4A6A", "#5A3A2A", RUST, "#2E4F6A", "#8A5A38"];

  // ---- 后墙：大星图（墙角榻台上方）、手稿、告示板 ----
  cv.tag = T("starchart");
  onBack(cv, 0.25, 3.0, 2.7, 6.3, framed("#7A6440", (u, v, x, y) => {
    const h = (x * 73 + y * 31) % 97;
    if (Math.abs(Math.hypot(u - 0.5, (v - 0.5) * 0.85) - 0.38) < 0.01) return "#9A8A5A";
    if (Math.abs(Math.hypot(u - 0.5, (v - 0.5) * 0.85) - 0.25) < 0.008 && (x + y) % 2) return "#5A6488";
    if (Math.abs(u - 0.5) < 0.008 || Math.abs(v - 0.5) < 0.007) return "#4A5470";
    const st = [[0.22, 0.72], [0.34, 0.64], [0.47, 0.68], [0.58, 0.5], [0.7, 0.38], [0.8, 0.44]];
    const st2 = [[0.3, 0.3], [0.38, 0.22], [0.48, 0.27]];
    for (const [a, b] of [...st, ...st2]) if (Math.hypot(u - a, (v - b) * 0.85) < 0.022) return "#F6E9BE";
    for (const S of [st, st2]) for (let i = 0; i < S.length - 1; i++) {
      const [a, b] = S[i], [c, d] = S[i + 1], t = Math.max(0, Math.min(1, ((u - a) * (c - a) + (v - b) * (d - b)) / ((c - a) ** 2 + (d - b) ** 2)));
      if (Math.hypot(u - a - t * (c - a), v - b - t * (d - b)) < 0.007) return "#B9A26E";
    }
    if (v > 0.9 && v < 0.95 && u > 0.2 && u < 0.8 && x % 3) return "#C9B88A"; // 标题
    if (h === 3 || h === 41) return "#D9CDA8";
    return "#1E2840";
  }), L);
  cv.tag = T("manuscripts");
  onBack(cv, 3.1, 5.9, 3.9, 5.0, (u, v, x) => {
    const sag = 0.94 - Math.sin(u * Math.PI) * 0.08;
    if (Math.abs(v - sag) < 0.03) return "#8A7A5A";
    for (let k = 0; k < 4; k++) {
      const a = 0.06 + k * 0.235, w = 0.19;
      const s2 = 0.94 - Math.sin((a + w / 2) * Math.PI) * 0.08;
      if (u > a && u < a + w && v < s2 && v > s2 - 0.78 + (k % 2) * 0.1) {
        if (Math.abs(u - a - w / 2) < 0.03 && v > s2 - 0.1) return GOLD;
        if (k === 1 && Math.hypot((u - a - w / 2) * 3, v - s2 + 0.4) < 0.12) return "#8A7A62"; // 一张画着船的草图
        return Math.floor(v * 18) % 2 && u > a + 0.02 && u < a + w - 0.02 && x % 4 ? "#8A7A62" : k === 2 ? "#E4D6B4" : PAPER;
      }
    }
    return null;
  }, L, 0.04);
  cv.tag = T("board");
  onBack(cv, 6.2, 8.0, 3.2, 4.7, (u, v, x, y, i) => {
    if (i.edge < 1.4) return "#4A3424";
    for (const [a, b, w, h, c] of [[0.08, 0.5, 0.36, 0.42, PAPER], [0.5, 0.56, 0.4, 0.34, "#E8D9A8"], [0.52, 0.1, 0.4, 0.38, PAPER], [0.1, 0.08, 0.32, 0.34, "#C9D6D0"]]) {
      if (u > a && u < a + w && v > b && v < b + h) {
        if (Math.abs(u - a - w / 2) < 0.03 && v > b + h - 0.08) return RUST;
        return Math.floor((v - b) * 16) % 3 === 0 && u > a + 0.04 && u < a + w - 0.05 && x % 3 ? "#7A6A55" : c;
      }
    }
    return (x * 7 + y * 3) % 5 ? "#9A7A52" : "#8A6A44";
  }, L);

  // ---- 左墙：观星窗的深窗台，杯子、罗盘放大；只挂一侧的窗帘 ----
  const sz = win.h0 + 0.2;
  cv.tag = T("sill");
  box(cv, { x: 0, y: 0.85, z: sz, w: 0.8, d: 5.3, h: 0.12 }, wood("#4A3424"), L);
  const st = sz + 0.12;
  sprite(cv, [0.35, 1.7, st], ["#######.", "#ooooo###", "#hoooo#.#", "#hoooo###", "#ooooo#..", ".#####..."], { "#": "#8A8068", o: "#E9DFC4", h: "#FFFFFF" }, L); // 杯子
  sprite(cv, [0.4, 1.66, st + 0.4], [".#..", "..#.", ".#..", "#..."], { "#": "#9AA2B8" });
  { // 罗盘：黄铜圆盒，盖子立着打开；盘面白底、红白指针、N 字
    cv.tag = T("compass");
    const [ox, oy] = P(0.45, 3.3, st);
    const X = Math.round(ox), Y = Math.round(oy) - 3;
    for (let dy = -14; dy <= -4; dy++) for (let dx = -6; dx <= 6; dx++) { // 盖子
      const e = Math.abs(dx) === 6 || dy === -14 || dy === -4 || (Math.abs(dx) === 5 && (dy === -13 || dy === -5));
      if (Math.abs(dx) === 6 && (dy === -14 || dy === -4)) continue;
      cv.set(X + dx, Y + dy, hex(e ? "#6E5428" : Math.abs(dx) === 5 || dy === -13 || dy === -5 ? GOLD : (dx + dy) % 5 === 0 ? "#4A5470" : "#2A3550"));
    }
    for (let dy = -5; dy <= 5; dy++) for (let dx = -9; dx <= 9; dx++) {
      const d = (dx / 9) ** 2 + (dy / 5) ** 2;
      if (d > 1) continue;
      let c = d > 0.72 ? (d > 0.86 ? "#6E5428" : GOLD) : "#F4EEDC";
      if (d <= 0.72) {
        const t = dx / 6;
        if (Math.abs(dy + t * 2.5) < 0.7 && Math.abs(dx) <= 6) c = dx > 0 ? RUST : "#8A8478";
        if (dx === 0 && dy === 0) c = "#3A2A1C";
        if (dx === 0 && dy === -3) c = "#3A2A1C"; // N
      }
      cv.set(X + dx, Y + dy, hex(c));
    }
    for (let dx = -8; dx <= 8; dx++) cv.set(X + dx, Y + 6, hex("#6E5428"));
  }
  cv.tag = 0; // 窗帘会被风吹，画在 rowanAnim 里
  box(cv, { x: 0, y: 0.15, z: 6.85, w: 0.12, d: 0.85, h: 0.08 }, wood("#3A2A1C"));

  // ---- 观星榻台：塞进窗下那个墙角，两面贴墙；下面抽屉，窄垫、深蓝毯子；侧面两级台阶；大衣搭在床尾 ----
  const kw = 2.0, kd = 3.5, kh = 0.7;
  cv.tag = T("daybed");
  shadow(cv, 0, 0, kw, kd, 0.3);
  box(cv, { x: 0, y: 0, w: kw, d: kd, h: kh }, {
    top: shade(WN, 1.1), left: shade(DW, 0.9), line: "#2A1C13",
    right: (u, v) => { // 朝屋里那面：三个抽屉
      const cell = u * 3 % 1;
      if (cell < 0.03 || cell > 0.97 || v < 0.08 || v > 0.92) return shade(DW, 0.6);
      if (Math.abs(cell - 0.5) < 0.08 && Math.abs(v - 0.55) < 0.08) return GOLD;
      return shade(DW, 0.8);
    },
  }, L);
  box(cv, { x: 0.08, y: 0.08, z: kh, w: kw - 0.16, d: kd - 0.16, h: 0.22 }, { top: litTop("#D6CBB0", 0.08, 0.08, kw - 0.16, kd - 0.16, kh + 0.22, win), left: "#C4B89C", right: "#A99E84", line: "#7A705C" }, L);
  box(cv, { x: 0.15, y: 0.12, z: kh + 0.22, w: 1.6, d: 0.7, h: 0.2 }, { top: "#E9DFC4", left: "#D6CBB0", right: "#BDB196", line: "#8A8068" }, L); // 枕头靠墙角
  if (state.bed) { // 躺下了：头枕在枕头上，深蓝毯子铺开盖好（看星星时睁着眼，睡着了闭眼）
    drawCentered(cv, state.bed === "gaze" ? LYING.rwGaze : LYING.rw, 0.95, 0.85, kh + 0.62);
    spreadQuilt(cv, { x: 0.12, y: 0.86, w: 1.76, d: 2.54, z: kh + 0.22 }, { top: "#26305A", side: "#222A50", dark: "#1A2040", fold: "#D6CBB0", stripe: "#3A4A78" }, L, win);
  } else
  box(cv, { x: 0.15, y: 2.1, z: kh + 0.22, w: 1.65, d: 1.15, h: 0.24 }, { top: (u, v) => (Math.abs(u - 0.2) < 0.04 || Math.abs(u - 0.8) < 0.04 ? "#3A4A78" : "#26305A"), left: (u, v) => (Math.abs(v - 0.5) < 0.08 ? "#1A2040" : "#222A50"), right: "#1A2040", line: "#10142A" }, L); // 叠好的深蓝毯子
  box(cv, { x: kw, y: 0.9, w: 0.55, d: 1.5, h: kh * 0.66 }, wood(WN), L); // 上一级（能坐）
  box(cv, { x: kw + 0.55, y: 0.9, w: 0.5, d: 1.5, h: kh * 0.33 }, wood(WN), L);
  quad(cv, [0.6, kd + 0.02, 0.1], [0.9, 0, 0], [0, 0, kh + 0.15], (u, v) => { // 大衣
    if (v < 0.06 + Math.abs(u - 0.5) * 0.3) return null;
    if (u > 0.46 && u < 0.53) return "#4A2A1E";
    if (u > 0.2 && u < 0.27 && v > 0.4 && v < 0.5) return GOLD;
    if (u > 0.2 && u < 0.27 && v > 0.65 && v < 0.75) return GOLD;
    return v > 0.86 ? "#5A3424" : "#6A3A28";
  }, L);
  box(cv, { x: 0.6, y: kd - 0.5, z: kh + 0.22, w: 0.9, d: 0.5, h: 0.08 }, { top: "#6A3A28", left: "#5A3424", right: "#4A2A1E", line: "#2E1A12" }, L);

  // ---- 后墙：书桌贴墙，上面一层架子放书；台灯、摊开的本子、羽毛笔、墨水瓶 ----
  // 榻台边、靠后墙：TA 的黑匣子（黄铜包边的铁皮箱，一把很沉的锁）
  cv.tag = T("blackbox");
  shadow(cv, 2.12, 0.08, 0.85, 0.65, 0.3, 0.06);
  box(cv, { x: 2.12, y: 0.08, w: 0.85, d: 0.65, h: 0.5 }, {
    line: "#12100E", top: (u, v) => (u < 0.08 || u > 0.92 || v < 0.1 || v > 0.9 ? GOLD : "#3A4048"),
    left: (u, v) => (Math.abs(u - 0.5) < 0.08 && v > 0.4 && v < 0.72 ? "#E8C26A" : u < 0.07 || u > 0.93 || v > 0.9 || v < 0.1 ? "#A8843E" : Math.abs(u - 0.25) < 0.03 || Math.abs(u - 0.75) < 0.03 ? "#5A6068" : "#2E3238"),
    right: (u, v) => (u < 0.1 || u > 0.9 || v > 0.9 ? "#8A6A2A" : "#24282E"),
  }, L);
  const dx = 3.1, dw = 2.8, dd = 1.2, dz = 1.45;
  cv.tag = T("desk");
  shadow(cv, dx, 0, dw, dd, 0.3);
  legs(cv, dx, 0.02, dw, dd, dz, DW, L);
  box(cv, { x: dx + dw - 1.0, y: 0.1, z: dz - 0.5, w: 0.9, d: dd - 0.2, h: 0.5 }, { ...wood(DW), left: (u, v) => (Math.abs(u - 0.5) < 0.1 && Math.abs(v - 0.5) < 0.12 ? GOLD : DW) }, L);
  litBox(cv, { x: dx, y: 0, z: dz, w: dw, d: dd, h: 0.16 }, wood(WN), win, L, 1.1);
  const tz = dz + 0.16;
  // 架子：两边立板 + 两层板，书不满
  onBack(cv, dx + 0.05, dx + dw - 0.05, tz, tz + 2.0, () => shade(DW, 0.7), L, 0.03);
  for (const z of [tz + 0.9, tz + 1.8]) box(cv, { x: dx, y: 0, z, w: dw, d: 0.5, h: 0.08 }, wood(WN), L);
  bookRow(cv, dx + 0.12, dx + 1.7, 0.04, tz + 0.98, 0.7, BOOKS, L, [3, 7]);
  sprite(cv, [dx + 2.0, 0.3, tz + 0.98], [".##.", "#oo#", "#gg#", "#gg#", "#gg#", ".##."], { "#": "#6A8090", o: "#9A7050", g: "#C9DCE0" }, L); // 一个装着贝壳的玻璃罐
  bookRow(cv, dx + 0.12, dx + 1.2, 0.04, tz + 1.88, 0.62, BOOKS.slice(3), L);
  box(cv, { x: dx + 1.6, y: 0.05, z: tz + 1.88, w: 0.6, d: 0.4, h: 0.3 }, { top: GOLD, left: "#6A4A2A", right: "#4A3420", line: "#2A1C13" }, L); // 罗盘盒
  box(cv, { x: dx, y: 0, z: tz, w: 0.08, d: 0.5, h: 1.9 }, wood(DW), L);
  box(cv, { x: dx + dw - 0.08, y: 0, z: tz, w: 0.08, d: 0.5, h: 1.9 }, wood(DW), L);
  // 桌面
  cv.tag = T("notebook");
  litBox(cv, { x: dx + 0.5, y: 0.55, z: tz, w: 1.05, d: 0.6, h: 0.05 }, {
    top: (u, v, x) => (Math.abs(u - 0.5) < 0.03 ? "#CDBF9F" : (Math.floor(v * 7) % 2 && u > 0.08 && u < 0.92 && Math.abs(u - 0.5) > 0.07 && x % 3 ? "#CFC3A4" : PAPER)),
    left: "#D6CBB0", right: "#C4B89C", line: "#8A8068",
  }, win, L);
  cv.tag = T("desk");
  sprite(cv, [dx + 1.75, 0.65, tz], ["..###..", ".#ooo#.", "#ooooo#", "#ohooo#", "#ohooo#", ".#####."], { "#": "#12162A", o: "#2E3550", h: "#5A6488" }, L); // 墨水瓶
  sprite(cv, [dx + 1.95, 0.75, tz + 0.3], ["........##", ".......###", "......###.", ".....###..", "....###...", "...###....", "..##......", ".#........", "#........."], { "#": "#F4F1EA" }); // 羽毛笔
  // 台灯：桌子右头，黄铜杆、绿灯罩
  { // 绿罩铜台灯（像图书馆那种）：灯罩下沿亮着
    const LAMP = [
      "....##########......",
      "...#hGGGGGGGGG#.....",
      "..#hGGGGGGGGGGG#....",
      ".#hGGGGGGGGGGGGG#...",
      "#hGGGGGGGGGGGGGGG#..",
      "#yyyyyyyyyyyyyyyy#..",
      ".################...",
      "........#bb#........",
      "........#bb#.c......",
      "........#bb#.c......",
      "........#bb#.o......",
      "........#bb#........",
      "........#bb#........",
      "....###########.....",
      "...#bbbbbbbbbbb#....",
      "....###########.....",
    ];
    cv.tag = T("lamp");
    const on = state.lamp !== false;
    sprite(cv, [4.9, 0.85, tz], LAMP, { "#": "#2A1C13", G: on ? "#2E6A4A" : "#244A38", h: on ? "#5AA27A" : "#3E6A52", y: on ? "#FFE7A6" : "#4A4A3A", b: GOLD, c: "#B9A26E", o: GOLD });
  }
  cv.tag = T("chair");
  // 椅子：拉出来一点，跟着 TA 的坐姿斜过来
  const cx = 4.0, cy = 1.5;
  shadow(cv, cx, cy, 0.85, 0.85, 0.25);
  legs(cv, cx, cy, 0.85, 0.85, 0.85, DW, L, 0.11);
  litBox(cv, { x: cx, y: cy, z: 0.85, w: 0.85, d: 0.85, h: 0.12 }, wood(WN), win, L);
  box(cv, { x: cx, y: cy, z: 0.97, w: 0.12, d: 0.85, h: 1.0 }, wood(WN), L); // 椅背转到侧面：TA 侧身朝书桌坐，椅背在 TA 背后
  box(cv, { x: 3.0, y: 1.45, w: 0.45, d: 0.45, h: 0.55 }, { top: "#2A1E15", left: (u, v, x) => (x % 3 ? "#7A6A55" : "#6A5A45"), right: "#5A4A38", line: "#3A2E22" }, L); // 废纸篓
  sprite(cv, [3.12, 1.65, 0.55], [".##.##", "######"], { "#": PAPER });

  // ---- 后墙右边：另一个书架挪到这里，靠门；告示板在它上面 ----
  cv.tag = T("bookshelf");
  const sx = 6.2, sw = 1.8, sh = 2.6;
  shadow(cv, sx, 0, sw, 0.8, 0.3);
  box(cv, { x: sx, y: 0, w: sw, d: 0.8, h: sh }, {
    top: shade(DW, 1.15), right: shade(DW, 0.8), line: shade(DW, 0.5),
    left: (u, v) => {
      if (u < 0.05 || u > 0.95) return shade(DW, 0.75);
      const row = Math.floor(v * 3), shelf = v * 3 % 1;
      if (shelf < 0.09) return shade(DW, 0.7);
      if (shelf > 0.92) return shade(DW, 0.35);
      const inner = shade(DW, 0.42);
      if (row === 2) {
        if (u > 0.07 && u < 0.5) { const b = Math.floor((u - 0.07) / 0.072); return shelf < 0.7 + (b % 3) * 0.08 ? BOOKS[b % 8] : inner; }
        if (u > 0.5 && u < 0.62 && shelf < 0.2 + (u - 0.5) * 5) return RUST;
        return inner;
      }
      if (row === 1) {
        if (u > 0.1 && u < 0.4 && shelf < 0.5) return Math.abs(shelf - 0.3) < 0.05 ? GOLD : "#4A3424"; // 罗盘盒
        if (u > 0.58 && u < 0.72 && shelf < 0.45) return shelf > 0.32 ? "#B9AE96" : Math.abs(u - 0.65) < 0.05 && shelf > 0.12 ? "#8A6A3A" : PAPER; // 半杯
        return inner;
      }
      if (u > 0.08 && u < 0.5 && shelf < 0.4) return ["#2E4F6A", PAPER, "#7A2E2A", GOLD][Math.floor(shelf / 0.1)];
      if (u > 0.6 && u < 0.88) return shelf < 0.75 ? BOOKS[Math.floor((u - 0.6) / 0.07) + 2] : inner;
      return inner;
    },
  }, L);

  // ---- 门：后墙右头，开一半，走廊的暖光 ----
  const dr = rowan.door;
  cv.tag = 0;
  if (state.door !== false) doorSpill(cv, dr.u0, dr.u1, 3.0, "#FFC070", "back");
  cv.tag = T("door");
  const a = 0.62, DWd = dr.u1 - dr.u0;
  if (state.door !== false) quad(cv, [dr.u1, 0.02, 0], [-Math.cos(a) * DWd, Math.sin(a) * DWd, 0], [0, 0, dr.h1], (u, v, x, y, i) => {
    if (i.edge < 1) return "#2E1F15";
    const inP = (v > 0.1 && v < 0.45) || (v > 0.55 && v < 0.92);
    if (inP && u > 0.16 && u < 0.84) return (u < 0.2 || v > 0.89 || (v > 0.42 && v < 0.45)) ? "#2E1F15" : "#6E4D33";
    if (Math.abs(u - 0.82) < 0.05 && Math.abs(v - 0.48) < 0.03) return GOLD;
    return "#5E4030";
  }, L);

  // ---- 地上：摊开的海图、几张报纸 ----
  cv.tag = T("map");
  sheet(cv, 4.3, 2.75, 2.0, 1.35, 0.12, (u, v, x, y, i) => {
    if (i.edge < 1) return "#9A8458";
    if (Math.abs(u - 0.333) < 0.006 || Math.abs(u - 0.666) < 0.006 || Math.abs(v - 0.5) < 0.01) return "#B9A57A"; // 折痕
    const coast = 0.55 + 0.18 * Math.sin(u * 8) + 0.06 * Math.sin(u * 23);
    if (Math.abs(v - coast) < 0.025) return "#7A6440";
    if (v > coast) return (x + y) % 7 === 0 ? "#B9A57A" : "#D8C49A";
    if (Math.abs(v - 0.2 - u * 0.25) < 0.02 && Math.floor(u * 20) % 2) return RUST; // 航线
    if (Math.abs(Math.hypot((u - 0.82) * 1.5, v - 0.22) - 0.1) < 0.02) return "#7A6440";
    return "#C9D2C0";
  }, win, L);
  const paper = (u, v, x, y, i) => {
    if (i.edge < 0.8) return "#B9B2A0";
    if (v < 0.2) return v > 0.04 && u > 0.08 && u < 0.92 && x % 4 ? "#3A3A3A" : "#E6E1D3"; // 报头
    if (u > 0.55 && u < 0.92 && v > 0.28 && v < 0.6) return (x + y) % 3 ? "#9A968C" : "#7A766C"; // 一张小图
    const col = u * 2 % 1;
    if (col > 0.06 && col < 0.94 && Math.floor(v * 22) % 2 && x % 5) return "#A8A498";
    return "#E6E1D3";
  };
  cv.tag = T("papers");
  sheet(cv, 3.7, 7.7, 1.0, 1.25, -0.3, paper, win, L);
  sheet(cv, 6.8, 5.5, 1.25, 0.95, 0.4, paper, win, L);
  sheet(cv, 2.2, 5.4, 0.9, 1.1, 0.15, paper, win, L);

  // ---- 望远镜：架在榻台边，镜筒对着窗 ----
  cv.tag = T("telescope");
  const TOP3 = [2.75, 4.05, 1.25];
  for (const f of [[2.45, 3.75, 0], [3.1, 3.85, 0], [2.75, 4.5, 0]]) rod(cv, f, TOP3, 0.06, { top: "#4A3424", left: "#3A2A1C", right: "#2A1C13" }, L);
  rod(cv, [3.25, 4.35, 1.05], [2.05, 3.75, 1.85], 0.2, { top: "#E8C880", left: "#C9A24E", right: "#A8843E" }, L);
  rod(cv, [3.35, 4.4, 1.0], [3.25, 4.35, 1.05], 0.12, { top: "#3A2A1C", left: "#2A1C13", right: "#1A120C" }, L);
  box(cv, { x: 1.95, y: 3.65, z: 1.8, w: 0.26, d: 0.26, h: 0.26 }, { top: "#E8C880", left: "#B88A3A", right: "#8A6A2A", line: "#5A4418" }, L);

  // ---- 左墙前段：一排吃的柜子 + 墙上一块小搁板 ----
  cv.tag = T("food");
  const fy = 6.25, fd = 3.5;
  shadow(cv, 0, fy, 0.85, fd, 0.3);
  box(cv, { x: 0, y: fy, w: 0.85, d: fd, h: 1.15 }, {
    top: shade(WN, 1.15), left: shade(WN, 0.95), line: "#2A1C13",
    right: (u, v) => {
      const cell = u * 3 % 1;
      if (cell < 0.025 || cell > 0.975 || v < 0.07 || v > 0.9) return shade(WN, 0.6);
      if (Math.abs(cell - 0.88) < 0.05 && Math.abs(v - 0.62) < 0.06) return GOLD;
      return shade(WN, 0.85);
    },
  }, L);
  const ft = 1.15;
  const FJAR = [
    "..####..",
    ".#llll#.",
    "#gggggg#",
    "#wgffff#",
    "#wfffff#",
    "#gfffff#",
    "#gfffff#",
    "#gfffff#",
    ".######.",
  ];
  const big = r => r.map(row => [...row].map(c => c + c).join("")).flatMap(row => [row, row]); // 放大一倍
  sprite(cv, [0.12, fy + 1.15, ft], [ // 一整条面包
    "......########......",
    "...###hhhhhhhh###...",
    "..#hhh#hhh#hhh#hhh#.",
    ".#oooooooooooooooo#.",
    "#oooooooooooooooooo#",
    "#doooooooooooooooood#",
    ".##################.",
  ], { "#": "#6A3A18", o: "#C08040", h: "#E8B070", d: "#9A6030" }, L);
  sprite(cv, [0.2, fy + 1.6, ft], FJAR, { "#": "#5A2020", l: "#E8D8B0", g: "#F2DCD0", w: "#FFFFFF", f: "#B02A3A" }, L); // 果酱
  for (let k = 0; k < 3; k++) box(cv, { x: 0.12 + (k % 2) * 0.08, y: fy + 1.95 + k * 0.42, z: ft, w: 0.38, d: 0.38, h: 0.42 }, { top: "#C9CCD4", left: (u, v) => (v > 0.2 && v < 0.75 ? ["#C64A3A", "#2E4F6A", GOLD][k] : "#9A9CA4"), right: (u, v) => (v > 0.2 && v < 0.75 ? shade(["#C64A3A", "#2E4F6A", GOLD][k], 0.75) : "#7A7C84"), line: "#4A4C54" }, L); // 罐头
  box(cv, { x: 0.08, y: fy + 2.95, z: ft, w: 0.68, d: 0.5, h: 0.1 }, soft("#8A6A4A"), L); // 一碗苹果
  for (const [x, y] of [[0.15, 3.0], [0.42, 3.02], [0.28, 3.25], [0.5, 3.3]]) sprite(cv, [x, fy + y + 0.12, ft + 0.08], ["..#..", ".rrr.", "rhrrr", "rrrrr", ".rrr."], { "#": "#4A3A1A", r: "#B8382E", h: "#F08070" }, L);
  box(cv, { x: 0.02, y: fy + 0.1, z: 2.2, w: 0.5, d: 3.3, h: 0.08 }, wood(WN), L); // 墙上搁板
  [["#C9A05A", "#E8D8B0"], ["#8A5A2A", "#C9A97A"], ["#E8D8B0", "#9A7050"], ["#5A3A2A", "#D9B86A"]].forEach(([f, l], k) =>
    sprite(cv, [0.08, fy + 0.85 + k * 0.82, 2.28], FJAR, { "#": "#4A6070", l, g: "#CFE0E4", w: "#FFFFFF", f }, L)); // 一排装吃的的玻璃罐（米、咖啡豆、饼干、茶叶）

  // 门口这边墙上的信箱：深绿铁皮、黄铜边、红旗，信上一枚火漆
  cv.tag = T("mailbox");
  mailbox(cv, 8.55, 3.5, { body: "#3E5E4A", dark: "#2A1C13", trim: GOLD, flag: RUST, letter: PAPER, seal: "#A8322A", glow: "#FFD27A" }, L);
  // ---- 植物：窗前地上一盆，叶子大一点 ----
  cv.tag = T("plant");
  plant(cv, 0.25, 4.15, 0, { s: 1.4, pot: "#8A5A3A", leaves: ["#1E3E28", "#3A6E46", "#62A066"] }, L);
  // 地毯上：矮坐垫、一摞书
  cv.tag = T("rug");
  box(cv, { x: 3.4, y: 5.1, w: 0.95, d: 0.95, h: 0.2 }, soft("#3A5A4A"), L);
  for (let i = 0; i < 3; i++) box(cv, { x: 5.0 + i * 0.03, y: 6.0 - i * 0.02, z: i * 0.1, w: 0.6 - i * 0.04, d: 0.42, h: 0.1 }, soft(["#7A2E2A", GOLD, "#2E4F6A"][i]), L);
  cv.tag = 0;
}

// Rowan 屋里会动的：窗帘被夜风吹得一摆一摆（窗外的灯塔、星星由 rooms.js 的 view 负责）
export function rowanAnim(cv, state, time) {
  const sw = Math.sin(time * 1.3) * 0.08 + Math.sin(time * 3.1) * 0.02;
  onLeft(cv, 0.2, 0.95, 2.45, 6.85, (u, v) => {
    u = 1 - u; // 窗帘挂在靠墙角那边
    const wid = 0.8 + Math.sin(v * 9 + time * 2) * 0.05 + (1 - v) * (0.12 + sw);
    if (u > wid) return null;
    return Math.floor((u + Math.sin(v * 5 + time) * 0.03) * 6) % 2 ? "#26384A" : "#2E4458";
  }, null, 0.06);
}
