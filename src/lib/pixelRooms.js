// 主页往下拉露出来的两间像素小屋（正面看进去的小房间，36 × 28 格）：章鱼的、螃蟹的
// 颜色照她给的那幅画调得很淡；深蓝只用来勾线
const C = {
  K: "#3a3d5c", W: "#e4edf7", w: "#d5e1ef", F: "#f1e7da", f: "#e5d6c3", G: "#f8fbff", g: "#d6e6f5",
  L: "#a9bf94", l: "#86a078", P: "#e8bcac", B: "#dcc0a2", b: "#c7a585", S: "#fbf8f2", s: "#f2cfc9",
  r: "#ebbdb4", u: "#bccfe8", y: "#f0dfae", n: "#bcd3b4", Q: "#f7eadf", q: "#eddacb",
  A: "#eaa792", d: "#d4887a", M: "#e1eaf3", m: "#9fb6d3", Y: "#f6e3a6", H: "#fffaf0", E: "#24263a",
};
const W = 36, H = 28;
const canvas = fill => Array.from({ length: H }, () => Array(W).fill(fill));
function rect(g, x, y, w, h, c) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (g[j] && i < W) g[j][i] = c;
}
function box(g, x, y, w, h, fill) { rect(g, x, y, w, h, "K"); rect(g, x + 1, y + 1, w - 2, h - 2, fill); }
function sprite(g, x, y, rows) { rows.forEach((r, j) => [...r].forEach((c, i) => { if (c !== ".") g[y + j][x + i] = c; })); }
const paint = g => g.map(row => row.map(c => C[c]));
// 地板上的小格子
function floor(g, wall, line, x0) {
  rect(g, 0, 18, W, 10, "F"); rect(g, 0, 18, W, 1, wall);
  for (let x = x0; x < W; x += 6) { rect(g, x, 20 + (x0 % 2), 1, 1, line); rect(g, x + 3, 24, 1, 1, line); }
}

// 章鱼的：淡蓝的墙、窗台上一盆小草、吊灯、书架、小床、地毯（小章鱼本人坐在外面白色区域的边上）
export function octopusRoom() {
  const g = canvas("W");
  floor(g, "w", "f", 3);
  box(g, 4, 4, 11, 9, "G"); rect(g, 9, 5, 1, 7, "K"); rect(g, 5, 8, 9, 1, "K"); rect(g, 5, 5, 4, 3, "g"); rect(g, 10, 9, 4, 3, "g"); rect(g, 3, 13, 13, 1, "b");
  sprite(g, 6, 10, [".LL.", "LlLL", ".PP."]);
  box(g, 24, 7, 9, 12, "B"); rect(g, 25, 11, 7, 1, "b"); rect(g, 25, 15, 7, 1, "b");
  sprite(g, 25, 8, ["ruyyn.u", "ruyyn.u", "ruyyn.u"]); sprite(g, 25, 12, ["n.urryu", "nyurryu", "nyurryu"]); sprite(g, 26, 16, [".LL.", "LlLL"]);
  rect(g, 2, 15, 2, 8, "b"); rect(g, 2, 15, 2, 1, "K"); box(g, 4, 18, 14, 4, "S"); rect(g, 9, 19, 8, 2, "s"); rect(g, 5, 19, 3, 1, "H"); rect(g, 4, 22, 1, 1, "K"); rect(g, 17, 22, 1, 1, "K");
  rect(g, 17, 24, 12, 2, "u"); rect(g, 18, 23, 10, 1, "u");
  rect(g, 19, 0, 1, 3, "K"); sprite(g, 17, 3, [".KKK.", "KYYYK"]);
  return paint(g);
}

// 螃蟹的（cc 的）：暖米色的墙、圆窗外一朵云、贝壳小画、书桌上一台写着代码的电脑、台灯和杯子、角落一盆草、小螃蟹坐在地毯上
export function crabRoom() {
  const g = canvas("Q");
  floor(g, "q", "f", 2);
  sprite(g, 4, 4, ["..KKKKK..", ".KGGGGGK.", "KGGHHGGGK", "KGHHHHGGK", "KGGGGGGgK", "KGGGgggGK", ".KGGGGGK.", "..KKKKK.."]);
  box(g, 15, 5, 6, 5, "H"); sprite(g, 16, 6, [".rr.", "rrrr", ".rr."]);
  rect(g, 18, 16, 17, 1, "K"); rect(g, 18, 17, 17, 1, "B"); rect(g, 19, 18, 1, 6, "b"); rect(g, 33, 18, 1, 6, "b");
  box(g, 24, 9, 9, 6, "M"); rect(g, 25, 10, 4, 1, "m"); rect(g, 26, 11, 4, 1, "n"); rect(g, 25, 12, 3, 1, "u"); rect(g, 25, 13, 5, 1, "m"); rect(g, 28, 15, 1, 1, "K");
  sprite(g, 19, 10, [".YYY.", "YYYYY", "..K..", "..K..", "..K..", ".KKK."]); sprite(g, 33, 14, ["uu", "uu"]);
  rect(g, 4, 24, 13, 2, "s"); rect(g, 5, 23, 11, 1, "s");
  sprite(g, 5, 17, ["A..E..E..A", "AA.K..K.AA", ".AAAAAAAA.", "AAdAAAAdAA", ".AAAAAAAA.", "A.A.AA.A.A"]);
  sprite(g, 1, 13, [".L.L.", "LlLlL", ".LlL.", "..L..", ".PPP.", ".PPP."]);
  return paint(g);
}
