// 像素画：用一格一格的小方块画表情、糖罐
//
// 一张图 = 二维数组，每格是颜色（null 是透明）。画的时候把同一行里相邻的同色格子合并成一个长方形。

export function toRects(grid) {
  const rects = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let w = 1;
      while (x + w < row.length && row[x + w] === c) w++;
      if (c) rects.push({ x, y, w, c });
      x += w;
    }
  });
  return rects;
}

const blank = (w, h) => Array.from({ length: h }, () => Array(w).fill(null));

// ---------- 表情（14 × 14） ----------
const P = {
  o: "#d9a37a", // 脸的描边
  f: "#ffe2b8", // 脸
  e: "#5b4a43", // 眼睛、眉毛
  m: "#a0584b", // 嘴
  p: "#f7a8b8", // 腮红
  h: "#f06a8a", // 爱心
  b: "#7fb4e6", // 眼泪、汗
  y: "#f2c14e", // 金色（皇冠、星星）
  r: "#e2574c", // 红（生气）
  n: "#ef9a4a", // 橙
  v: "#a993d6", // 紫
  w: "#ffffff",
};
// 有的心情脸色不一样
const FACE_TINT = { 自责: "#ece2d8", 吃醋: "#fff0a6", 生气: "#ffcbb4", 失落: "#e1e8f3", 不安: "#ece6f5" };

function baseFace(tint) {
  const g = blank(14, 14);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
    const d = Math.hypot(x - 6.5, y - 7);
    if (d <= 5.2) g[y][x] = tint || P.f;
    else if (d <= 6.2) g[y][x] = P.o;
  }
  return g;
}

const SMILE = [[5, 9, "m"], [8, 9, "m"], [6, 10, "m"], [7, 10, "m"]];
const EYES = [[4, 6, "e"], [9, 6, "e"]];
const CHEEKS = [[2, 8, "p"], [3, 8, "p"], [10, 8, "p"], [11, 8, "p"]];
const HAPPY_EYES = [[3, 6, "e"], [4, 5, "e"], [5, 6, "e"], [8, 6, "e"], [9, 5, "e"], [10, 6, "e"]];
const FROWN = [[5, 10, "m"], [6, 9, "m"], [7, 9, "m"], [8, 10, "m"]];
const FLAT = [[5, 10, "m"], [6, 10, "m"], [7, 10, "m"], [8, 10, "m"]];
const SMALL_O = [[6, 10, "m"], [7, 10, "m"]];
const WAVY = [[4, 10, "m"], [5, 9, "m"], [6, 10, "m"], [7, 9, "m"], [8, 10, "m"], [9, 9, "m"]];
const heartAt = (x, y, c = "h") => [[x, y, c], [x + 2, y, c], [x, y + 1, c], [x + 1, y + 1, c], [x + 2, y + 1, c], [x + 1, y + 2, c]];
const SWEAT = [[12, 3, "b"], [11, 4, "b"], [12, 4, "b"], [12, 5, "b"]];

const FACES = {
  心动: [...heartAt(3, 5), ...heartAt(8, 5), ...CHEEKS, ...SMILE],
  害羞: [...HAPPY_EYES, [1, 8, "p"], ...CHEEKS, [12, 8, "p"], [6, 10, "m"], [7, 10, "m"]],
  想念: [[4, 5, "e"], [9, 5, "e"], ...SMALL_O, [12, 0, "y"], [11, 1, "y"], [12, 1, "y"], [13, 1, "y"], [12, 2, "y"]],
  骄傲: [[4, 1, "y"], [6, 0, "y"], [7, 0, "y"], [9, 1, "y"], [4, 2, "y"], [5, 2, "y"], [6, 1, "y"], [7, 1, "y"], [6, 2, "y"], [7, 2, "y"], [8, 2, "y"], [9, 2, "y"], ...HAPPY_EYES, ...SMILE, [4, 9, "m"], [9, 9, "m"]],
  得意: [[4, 6, "e"], [8, 6, "e"], [9, 6, "e"], [10, 6, "e"], [6, 9, "m"], [7, 9, "m"], [8, 9, "m"], [9, 8, "m"], ...CHEEKS],
  心疼: [[3, 4, "e"], [4, 4, "e"], [9, 4, "e"], [10, 4, "e"], [5, 3, "e"], [8, 3, "e"], ...EYES, [4, 7, "b"], [4, 8, "b"], ...SMALL_O],
  委屈: [...EYES, [4, 7, "b"], [9, 7, "b"], [9, 8, "b"], [5, 10, "m"], [6, 9, "m"], [7, 10, "m"], [8, 9, "m"]],
  自责: [[4, 7, "e"], [9, 7, "e"], [3, 6, "e"], [10, 6, "e"], ...FLAT, ...SWEAT],
  吃醋: [[5, 6, "e"], [10, 6, "e"], [3, 5, "e"], [4, 5, "e"], [9, 5, "e"], [1, 8, "r"], [2, 8, "r"], [11, 8, "r"], [12, 8, "r"], [6, 9, "m"], [7, 9, "m"], [6, 10, "m"], [7, 10, "m"]],
  生气: [[3, 4, "e"], [4, 5, "e"], [10, 4, "e"], [9, 5, "e"], ...EYES, ...FROWN, [11, 1, "r"], [13, 1, "r"], [12, 2, "r"], [11, 3, "r"], [13, 3, "r"]],
  不平: [[3, 4, "e"], [4, 4, "e"], [5, 4, "e"], [9, 5, "e"], [10, 4, "e"], ...EYES, ...FLAT, [12, 1, "n"], [11, 2, "n"], [12, 2, "n"], [13, 2, "n"]],
  不安: [[4, 6, "e"], [9, 6, "e"], [3, 5, "e"], [10, 5, "e"], ...WAVY, ...SWEAT],
  失落: [[3, 6, "e"], [4, 7, "e"], [10, 6, "e"], [9, 7, "e"], ...FROWN],
  舍不得: [...HAPPY_EYES, [3, 7, "b"], [10, 7, "b"], [10, 8, "b"], ...SMILE],
  // 没有起因时的底色心情
  开心: [...HAPPY_EYES, ...CHEEKS, ...SMILE, [4, 9, "m"], [9, 9, "m"]],
  平静: [...EYES, [6, 10, "m"], [7, 10, "m"], [5, 10, "m"], [8, 10, "m"]],
  低落: [[3, 6, "e"], [4, 7, "e"], [10, 6, "e"], [9, 7, "e"], [6, 10, "m"], [7, 10, "m"]],
  睡着: [[3, 7, "e"], [4, 7, "e"], [5, 7, "e"], [8, 7, "e"], [9, 7, "e"], [10, 7, "e"], [6, 10, "m"], [11, 1, "v"], [12, 1, "v"], [12, 2, "v"], [11, 3, "v"], [12, 3, "v"]],
};

// 图例：和心潮网页一样的 14 种有起因的情绪
export const EMOTION_LEGEND = [
  ["心动", "被亲近"], ["害羞", "被夸、被戳穿"], ["想念", "想念得厉害"], ["骄傲", "对方做成了事"],
  ["得意", "自己做成了事"], ["心疼", "心疼对方或别人"], ["委屈", "被误会"], ["自责", "自己做错了"],
  ["吃醋", "对方在别处"], ["生气", "吵架"], ["不平", "替别人不平"], ["不安", "安全感很低"],
  ["失落", "期待落空"], ["舍不得", "要分开好几天"],
];

// 底色心情（没有起因时）按愉悦程度挑一张脸
const CALM_WORDS = { 平静: "平静", 安心: "开心", 满足: "开心", 雀跃: "开心", 兴奋: "开心", 开心: "开心", 低落: "低落", 疲惫: "低落", 烦躁: "不安", 紧张: "不安" };
export function faceKey(word, valence) {
  if (FACES[word]) return word;
  if (CALM_WORDS[word]) return CALM_WORDS[word];
  const v = Number(valence);
  if (!Number.isFinite(v)) return "平静";
  return v > 0.6 ? "开心" : v < 0.4 ? "低落" : "平静";
}

export function faceGrid(word, valence) {
  const key = faceKey(word, valence);
  const g = baseFace(FACE_TINT[key]);
  for (const [x, y, c] of FACES[key]) if (y >= 0 && y < 14 && x >= 0 && x < 14) g[y][x] = P[c];
  return g;
}

// ---------- 糖罐（12 × 18） ----------
export const CANDY = {
  strong: ["#f4a3bd", "#fbd0dd"], // 满一些的罐子：粉
  weak: ["#cfc9de", "#e8e4f0"], // 浅一些的：淡紫灰
};
export const STRONG_AT = 0.5; // 过了这条线就是「满」的颜色

export function jarGrid(value, lid = "#e3c39b") {
  const W = 12, H = 18;
  const g = blank(W, H);
  const glass = "#cfdde6", inside = "#f2f8fb", lidDark = "#c9a67c";
  // 盖子
  for (let x = 2; x <= 9; x++) { g[0][x] = lidDark; g[1][x] = lid; }
  g[1][2] = lidDark; g[1][9] = lidDark;
  // 瓶颈
  for (let y = 2; y <= 3; y++) { g[y][2] = glass; g[y][9] = glass; for (let x = 3; x <= 8; x++) g[y][x] = inside; }
  // 瓶身
  for (let y = 4; y < H - 1; y++) {
    const edge = y === 4 ? 1 : 0;
    for (let x = edge; x < W - edge; x++) g[y][x] = x === edge || x === W - 1 - edge ? glass : inside;
  }
  for (let x = 1; x < W - 1; x++) g[H - 1][x] = glass;
  if (g[4][0] === null) { g[4][1] = glass; g[4][10] = glass; }
  // 糖：从下往上装，至少一层
  const rows = 12; // 第 5 到 16 行
  const filled = Math.max(1, Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * rows));
  const [main, light] = Number(value) >= STRONG_AT ? CANDY.strong : CANDY.weak;
  for (let i = 0; i < filled; i++) {
    const y = H - 2 - i;
    for (let x = 1; x < W - 1; x++) g[y][x] = (x + y) % 3 === 0 ? light : main;
  }
  // 玻璃的反光
  for (let y = 6; y <= 11; y++) if (H - 2 - y >= filled) g[y][2] = "#ffffff";
  return g;
}
