// 小屋的像素画：一块画布 + 几笔简单的画法 + 用字符画的小人儿、小东西
//
// 画布是二维颜色数组（和 pixel.js 一样，null 是透明），交给 PixelArt 画出来。
// 字符画：每个字符是一种颜色，"." 是透明。

export function canvas(w, h, fill = null) {
  const g = Array.from({ length: h }, () => Array(w).fill(fill));
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const api = {
    g, w, h,
    px(x, y, c) { if (c && inside(x, y)) g[y][x] = c; return api; },
    rect(x, y, rw, rh, c) { for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) api.px(i, j, c); return api; },
    hline(x, y, len, c) { return api.rect(x, y, len, 1, c); },
    vline(x, y, len, c) { return api.rect(x, y, 1, len, c); },
    // 空心框
    frame(x, y, rw, rh, c) { api.hline(x, y, rw, c); api.hline(x, y + rh - 1, rw, c); api.vline(x, y, rh, c); api.vline(x + rw - 1, y, rh, c); return api; },
    disc(cx, cy, r, c) { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r + r * 0.6) api.px(cx + i, cy + j, c); return api; },
    // 每隔几格点一下（做木纹、星星、浪花）
    dots(x, y, rw, rh, c, every = 7, seed = 1) {
      for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) if (((i * 73856093) ^ (j * 19349663) ^ seed) % every === 0) api.px(i, j, c);
      return api;
    },
    sprite(sp, x, y) { sp.forEach((row, j) => row.forEach((c, i) => c && api.px(x + i, y + j, c))); return api; },
  };
  return api;
}

// 字符画 → 颜色数组
export function sprite(rows, pal) {
  return rows.map(r => [...r].map(ch => (ch === "." || ch === " " ? null : pal[ch] || null)));
}

// ---------- 通用的小东西 ----------
const WOOD = { d: "#6e4630", m: "#8a5a3a", l: "#a8774f" };

// 小本子（摊开的）+ 笔
export function notebook({ paper = "#fbf4e2", line = "#cdb89a", cover = "#b0794c", pen = "#e3b04a", quill = false } = {}) {
  const rows = quill
    ? ["...........q", "..........q.", "ccccccccc.q.", "cppppp|pppc.", "cpLLpp|pLLpc", "cppppp|ppppc", "cpLLpp|pLLpc", "ccccccccccc."]
    : ["............", "ccccccccccc.", "cppppp|ppppc", "cpLLpp|pLLpc", "cppppp|ppppc", "cpLLpp|pLLpc", "ccccccccccc.", "..ttttT....."];
  return sprite(rows, { c: cover, p: paper, L: line, "|": "#e6d6b8", t: pen, T: "#e88f8f", q: quill ? "#f4f0e6" : pen });
}

// 上锁的小箱子
export function lockedBox({ body = "#5a3826", band = "#3e2618", lock = "#c8873e", lockHi = "#e8b06a" } = {}) {
  return sprite([
    ".bbbbbbbbbbbb.",
    "bBBBBBBBBBBBBb",
    "bBBBBBBBBBBBBb",
    "kkkkkkLLkkkkkk",
    "bBBBBBlLBBBBBb",
    "bBBBBBLLBBBBBb",
    "bbbbbbbbbbbbbb",
  ], { b: band, B: body, k: band, L: lock, l: lockHi });
}

// 花盆 + 小苗（berries：结果子）
export function plantPot({ pot = "#c47a4f", potD = "#a35f3a", leaf = "#7fb069", leafD = "#5e8f4e", berries = false } = {}) {
  return sprite(berries ? [
    "..g.G.g..",
    ".gGrgGr..",
    "gGgGrGgG.",
    ".gGgGgGr.",
    "...gG....",
    "....G....",
    ".PPPPPPP.",
    ".pPPPPPp.",
    "..pPPPp..",
    "..ppppp..",
  ] : [
    ".........",
    "...g.....",
    "..gGg.g..",
    "....Gg...",
    "....G....",
    "....G....",
    ".PPPPPPP.",
    ".pPPPPPp.",
    "..pPPPp..",
    "..ppppp..",
  ], { g: leaf, G: leafD, P: pot, p: potD, r: "#d8433b" });
}

// 火苗（三帧）
export const FLAME = [
  ["..y..", ".yoy.", ".yoy.", "yoroy", "yorry", ".rrr."],
  ["...y.", "..yo.", ".yoy.", "yoroy", "yorry", ".rrr."],
  [".y...", ".oy..", ".yoy.", "yoroy", "yrroy", ".rrr."],
].map(r => sprite(r, { y: "#ffd166", o: "#f78c3b", r: "#e8572a" }));
export const FLAME_BIG = sprite([".y.y.y.", "yoyoyoy", ".yoroy.", "yoroory", "yorrroy", "yorrrry", ".rrrrr."], { y: "#ffd166", o: "#f78c3b", r: "#e8572a" });

// 小鸡暖暖
const CHICK = { Y: "#ffd94d", y: "#f2bf2f", O: "#f08a3c", E: "#3b2a22", o: "#e07a32", B: "#f7a8a0" };
export const CHICK_WALK = [
  ["..YYY...", ".YYYYO..", ".YEYYOO.", "YYYYYY..", "YyYYYYY.", ".YYYYY..", "..o.o..."],
  ["..YYY...", ".YYYYO..", ".YEYYOO.", "YYYYYY..", "YyYYYYY.", ".YYYYY..", ".o...o.."],
].map(r => sprite(r, CHICK));
export const CHICK_TILT = sprite(["...YYY..", "..YYYYYO", "..YEYYO.", ".YYYYYY.", "YyYYYYY.", ".YYYYY..", "..o.o..."], CHICK);
export const CHICK_SLEEP = [
  ["........", "..YYYY..", ".YYYYYY.", "YYEEYYYY", "YyyYYYYY", ".YYYYYY.", "........"],
  ["........", "...YYYY.", "..YYYYYY", ".YYYEEYY", "YYYYyyYY", ".YYYYYY.", "........"],
].map(r => sprite(r, CHICK));

// 海鸥
export const GULL = sprite(["...WW.....", "..WWWWo...", "GGGWWWW...", ".GGGWWWWW.", "...WWWWW..", "....k.k..."], { W: "#f6f4ef", G: "#a7a9b3", o: "#f2b13a", k: "#e39a3a" });
export const GULL_FLY = sprite(["G........G", ".GG....GG.", "..GWWWWG..", "...WWWWo..", "....WW...."], { W: "#f6f4ef", G: "#a7a9b3", o: "#f2b13a" });

// ---------- 两个人 ----------
const SKIN = { S: "#f6d5b8", s: "#e8b896", E: "#3b2a22", B: "#f2a7a0", m: "#c56b5e" };

// 脆脆：深棕色毛毛的短发，米白色大毛衣（袖子盖住半个手掌），毛绒拖鞋，膝盖上搁着小本子
const CUI = { ...SKIN, H: "#5a3a28", h: "#7a543c", W: "#f3ecdc", w: "#dccfb5", N: "#fdf8ec", n: "#c8b89a", P: "#9c7a62", F: "#f7f1e8", f: "#e2d5c2" };
const cuiBase = [
  "....H..HHH.H....",
  "...HHHHHHHHHH...",
  "..HHHhhHHHHHHH..",
  "..HHHHHHHHHHHHH.",
  "..HSSSSSSSSSSH..",
  "..HSSSSSSSSSSH..",
  "..HSEESSSSEESH..",
  "..HSSSSSSSSSSH..",
  "...SBSSSSSSBS...",
  "...SSSSmmSSSS...",
  "....SSSSSSSS....",
  "...WWWWSSWWWW...",
  "..WWWWWWWWWWWW..",
  ".WWWWWNNNNWWWWW.",
  ".WWWWNNnnNNWWWW.",
  "WWWWNNnnnnNNWWWW",
  "wWWWNNNNNNNNWWWw",
  "SwWWWWWWWWWWWWwS",
  ".PPPPPPPPPPPPPP.",
  ".PPPPPP..PPPPPP.",
  "FFFFFF....FFFFFF",
  "fFFFFf....fFFFFf",
];
const blink = rows => rows.map((r, i) => (i === 6 ? r.replace(/EE/g, "ss") : r));
const lookUp = rows => rows.map((r, i) => (i === 6 ? "..HSSSSSSSSSSH.." : i === 5 ? "..HSEESSSSEESH.." : r)); // 抬头看海
export const CUI_SIT = [sprite(cuiBase, CUI), sprite(blink(cuiBase), CUI), sprite(lookUp(cuiBase), CUI)];
// 睡着：枕头上露出脑袋
export const CUI_SLEEP = sprite([
  "..H.HHH.H...",
  ".HHHHHHHHHH.",
  "HHHhhHHHHHHH",
  "HHSSSSSSSSHH",
  "HSssSSSSssSH",
  ".SBSSSSSSBS.",
  "..SSSSSSSS..",
], CUI);

// Rowan：有点乱的深棕色短发，藏青色宽松毛衣露出白衬衫领子，脖子上皮绳拴着银色小指南针，手里一支羽毛笔
const ROW = { ...SKIN, H: "#4a2f22", h: "#6a4634", N: "#2f3e5c", n: "#24304a", C: "#f4f2ec", r: "#7a5236", o: "#c9ced6", O: "#9aa2ad", D: "#3a3430", K: "#2a211c", q: "#f4f0e6" };
const rowBase = [
  "....HHHHHHH.....",
  "..HHHHHhHHHHH...",
  ".HHHHHHHHHHHHH..",
  ".HHHSSSSSSSHHH..",
  ".HHSSSSSSSSSSH..",
  "..HSEESSSSEESH..",
  "..HSSSSSSSSSSH..",
  "..HSBSSSSSSBS...",
  "...SSSSmmSSSS...",
  "....SSSSSSSS....",
  "...NNCCSSCCNN...",
  "..NNNNCrrCNNNN..",
  ".NNNNNNrrNNNNNN.",
  ".NNNNNNooNNNNNN.",
  ".NNNNNNOONNNNNN.",
  ".nNNNNNNNNNNNNn.",
  ".SnNNNNNNNNNNnS.",
  "..DDDDDDDDDDDD..",
  "..DDDDD..DDDDD..",
  "..DDDD....DDDD..",
  "..KKKK....KKKK..",
];
const rowBlink = rows => rows.map((r, i) => (i === 5 ? r.replace(/EE/g, "ss") : r));
const rowGlance = rows => rows.map((r, i) => (i === 5 ? "..HSSEESSSSEEH.." : r)); // 往窗外看
export const ROWAN_SIT = [sprite(rowBase, ROW), sprite(rowBlink(rowBase), ROW), sprite(rowGlance(rowBase), ROW)];
export const ROWAN_SLEEP = sprite([
  "..HHHHHHH...",
  ".HHHHHhHHHH.",
  "HHHHHHHHHHHH",
  "HHSSSSSSSSHH",
  "HSssSSSSssSH",
  ".SBSSSSSSBS.",
  "..SSSSSSSS..",
], ROW);

export { WOOD };
