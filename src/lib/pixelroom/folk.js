// 小人和暖暖的像素图（两头身 Q 版）：先写「填色」网格，外面一圈深色描边自动加。设计稿在 design/pixel-rooms/chars
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

// ---------- 心晴 ----------
const XQ_HEAD = [
  "....HHHH.HHH......",
  "..HHHHHHHHHHHH.H..",
  ".HHHhhHHHHHHHHHHH.",
  ".HHhhHHHHHHHHHHHH.",
  "HHHhHHHHHHHHHHHHHH",
  "HHHHHHHjHHHHHjHHHH",
  "HHHjSSjHHjSSSSjHHH",
  "HHjSSSSjSSSSSSSjHH",
  "HHSSSSSSSSSSSSSSHH",
  "HjSSEeSSSSSSEeSSjH",
  "HjSSEESSSSSSEESSjH",
  "jHSCCSSSMMSSSCCSHj",
  "jH.SSSSSSSSSSSS.Hj",
  "j...SSSSSSSSSS...j",
];
// 一缕蓝：靠中间偏右，上面是过渡色、往下到刘海尖变深海蓝
const STREAK = [[1, 10, "p"], [1, 11, "p"], [2, 10, "p"], [2, 11, "p"], [2, 12, "p"], [3, 10, "p"], [3, 11, "t"], [3, 12, "t"],
  [4, 10, "t"], [4, 11, "t"], [4, 12, "t"], [4, 13, "p"], [5, 11, "t"], [5, 12, "t"], [5, 13, "t"], [6, 12, "t"], [6, 13, "t"], [6, 14, "t"], [7, 14, "t"], [7, 15, "t"]];
const streak = h => h.map((r, j) => [...r].map((c, i) => (STREAK.find(([a, b]) => a === j && b === i) || [0, 0, c])[2]).join(""));
const smile = h => { const r = [...h]; r[9] = "HjSSSESSSSSSSESSjH"; r[10] = "HjSSESESSSSSESESjH"; return r; };
const lookSide = h => { const r = [...h]; r[9] = "HjSSSEeSSSSSSEeSjH"; r[10] = "HjSSSEESSSSSSEESjH"; return r; };
const XQ_STAND = [
  "....RWWWWWWR....",
  "...RRWWWWWWRR...",
  "..WRRWWWWWWRRW..",
  ".WWRRWWwWWWRRWW.",
  ".WwRRWWWWWWRRwW.",
  ".SSRRWWWWWWRRPP.",
  ".SSRrWWWWWWrRPq.",
  ".SSRrWWWWWWrRPq.",
  ".GGRRRRoRRRRRPP.",
  "GgGGNNNNNNNNS...",
  "GGGNNNNnNNNN....",
  "....NNNN.NNNN...",
  "....NNNn.nNNN...",
  "....mmmm.mmmm...",
  "....FFFF.FFFF...",
];
const XQ_SIT = [
  "....RWWWWWWR....",
  "...RRWWWWWWRR...",
  "..WRRWWWWWWRRW..",
  ".WWRRPPPPPPRRWW.",
  ".WwRPPqqqqPPRwW.",
  "..SSPqqqqqqPSS..",
  "...RPPPPPPPPR...",
  "..GRRRRoRRRRR...",
  ".GgNNNNNNNNNNN..",
  ".GGNNNNNNNNNNN..",
  "....mmmm..mmmm..",
  "....ffff..ffff..",
  ".....fff..fff...",
  ".....ff....ff...",
];
const XQ_CROUCH = [
  "....RWWWWWWR......",
  "...RRWWWWWWRR.....",
  "..WRRWWWWWWRRWW...",
  ".WWRRWWWWWWRRWWW..",
  ".WSRNNNNNNNNRRSSS.",
  ".GgNNNNNNNNNNN.SS.",
  ".GGNNNnNNnNNNN....",
  "...mmmm..mmmm.....",
  "...FFFF..FFFF.....",
];
const XQ_PAL = (tipBlue) => ({
  H: "#E4603A", h: "#F2865A", j: "#B4442C", p: tipBlue ? "#8B4A5A" : "#B4442C", t: tipBlue ? "#2E4A6B" : "#B4442C",
  S: "#F7CFA8", E: "#3A2418", e: "#6A4028", C: "#F2A08A", M: "#C0604A",
  W: "#F2E8D4", w: "#D8C8AA", R: "#B5523A", r: "#8A3C2A", o: "#E8C26A",
  N: "#2E3F66", n: "#22304E", m: "#4A5E8A", f: "#F7CFA8", F: "#B08A60",
  G: "#8A5A38", g: "#F09048", P: "#3E6A9A", q: "#F3EAD3", K: "#2A1A14",
  D: "#CFA273", d: "#7A5236",
});

// ---------- Rowan ----------
const RW_HEAD = [
  ".....HHHHHH.H.....",
  "...HHHHHHHHHHH....",
  "..HHHhhHHHHHHHH...",
  ".HHhhHHHHHHHHHHH..",
  ".HHHHHHHHHHHjHHHH.",
  ".HHHHHHHHHHjSjHHH.",
  ".HHHHHHHHjSSSSjHH.",
  ".HjHHHjjSSSSSSSSH.",
  ".HSSSjSSSSSSSSSSH.",
  ".sSSEESSSSSSEESSs.",
  ".sSSEeSSSSSSEeSSs.",
  "..SSSSSSSSSSSSSS..",
  "..SSSSSSMMSSSSSS..",
  "....SSSSSSSSSS....",
];
const RW_BACK = [
  ".....HHHHHHH......",
  "...HHHHHHHHHHHH...",
  "..HHHhhHHHHHHHHH..",
  ".HHhhHHHHHHHHHHHH.",
  ".HHHHHHhHHHHHHHHH.",
  "HHHHHHhhHHHHHHHHHH",
  "HHHHHhHHHHHHjHHHHH",
  "HHHHHHHHHHHHHjHHHH",
  ".HjHHHHHHHHHHHHjH.",
  ".sHHHHHHHHHHHHHHs.",
  ".sjHHHHHHHHHHHHjs.",
  "..jjHHHHHHHHHHjj..",
  "...jjjHHHHHHjjj...",
  ".....jjjjjjjj.....",
];
const lookDown = h => { const r = [...h]; r[9] = ".sSSSSSSSSSSSSSSs."; r[10] = ".sSSEESSSSSSEESSs."; r[12] = "..SSSSSSSSSSSSSS.."; return r; };
const lookUp = h => { const r = [...h]; r[8] = ".HSSEESSSSSSEESSH."; r[9] = ".sSSEeSSSSSSEeSSs."; r[10] = ".sSSSSSSSSSSSSSSs."; return r; };
const RW_STAND = [
  "....RWWWWWWR....",
  "...RRWWWWWWRR...",
  "..RRRWWWWWWRRR..",
  ".RRRRWWWWWWoRRR.",
  ".RrRRWWWWWWRRrR.",
  ".RrRRWWWWWWRRrR.",
  ".SSRRWWWWWWRRSS.",
  "...RRWWWWWWRR...",
  "...RRRRRRRRRR...",
  "....NNNNNNNN....",
  "....NNNNnNNN....",
  "....NNN..NNN....",
  "....NNn..nNN....",
  "....FFF..FFF....",
  "...FFFF..FFFF...",
];
const RW_WAVE = [
  "....RWWWWWWR..SS",
  "...RRWWWWWWRRRR.",
  "..RRRWWWWWWRRR..",
  ".RRRRWWWWWWoRR..",
  ".RrRRWWWWWWRRR..",
  ".RrRRWWWWWWRR...",
  ".SSRRWWWWWWRR...",
  ...RW_STAND.slice(7),
];
const RW_BACKBODY = [
  "....RRRRRRRR....",
  "...RRRRRRRRRR...",
  "..RRRRRrRRRRRR..",
  ".RRRRRRrRRRRRRR.",
  ".RrRRRRrRRRRRrR.",
  ".RrRRRRrRRRRRrR.",
  "..RRRRSSSSRRRR..",
  "...RRRRrRRRRR...",
  "...RRRRRRRRRR...",
  ...RW_STAND.slice(9),
];
const RW_DESK = [
  "....RWWWWWWR....",
  "...RRWWWWWWRR...",
  "..RRRWWWWWWoRR..",
  ".RRRRWWWWWWRRRR.",
  ".RrRRWWWWWWRRrR.",
  "..SSRRWWWWRRSS..",
];
const DESK = [
  "...............Q......",
  "..............Q.......",
  ".....qqqqqq..Q........",
  "DDDDqqqqqqqqDDDDDDDDDD",
  "DDDDDDDDDDDDDDDDDDDDDD",
  "dddddddddddddddddddddd",
  "..dd..............dd..",
  "..dd..............dd..",
];
const DECK = [
  "DDDDDDDDDDDDDDDDDDDDDDDD",
  "dddddddddddddddddddddddd",
  "dddddddddddddddddddddddd",
  "dddddddddddddddddddddddd",
];
const RW_PAL = {
  s: "#E0A47E", H: "#5A3A28", h: "#7A5238", j: "#3E2618", S: "#F2CDA8", E: "#2A2030", e: "#4A3A50", M: "#B0705A",
  W: "#F4EEDF", w: "#DCD3BE", R: "#6E8A4A", r: "#546A36", o: "#E2B44A", N: "#26304E", n: "#1C2440", F: "#6A4426", K: "#1E1612", D: "#8A6240", d: "#5E4030", q: "#F3EAD3", Q: "#F4F1EA",
};

// ---------- 暖暖 ----------
const NN = [
  "......Y.....",
  ".....YY.....",
  "...YYYYYY...",
  "..YlYYYYYY..",
  ".YllEYYEYYY.",
  ".YlYYBBYYYY.",
  "YYYCYbYCYYYY",
  "YYYYYYYYwwYY",
  "dYYYYYYYwwYd",
  ".dYYYYYYYYd.",
  "..dddddddd..",
  "...FF..FF...",
];
const NN_PAL = { Y: "#F7D04E", l: "#FFE9A0", d: "#D9A030", w: "#E8B436", E: "#2A1A10", C: "#F29A7A", B: "#F08A2A", b: "#C86A1A", F: "#E8943A", K: "#5A3A14" };

// 把几块拼起来：parts = [[rows, x, y], ...]，再加一圈描边
function build(parts, pal, w = 24, h = 34) {
  const g = Array.from({ length: h }, () => Array(w).fill(null));
  for (const [rows, ox, oy] of parts) rows.forEach((r, j) => [...r].forEach((c, i) => { if (c !== "." && c !== " ") g[oy + j][ox + i] = c; }));
  const out = g.map(r => [...r]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (g[y][x]) continue;
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx] && g[y + dy][x + dx] !== "K");
    if (n) out[y][x] = "K";
  }
  return { w, h, px: (x, y) => (out[y][x] ? hex(pal[out[y][x]]) : null) };
}

export const sprites = {
  xqA: { title: "心晴 · 站（方案 A 中间偏右一缕蓝）", s: build([[streak(XQ_HEAD), 3, 1], [XQ_STAND, 4, 15]], XQ_PAL(true)) },
  xqB: { title: "心晴 · 站（方案 B 纯橙红）", s: build([[XQ_HEAD, 3, 1], [XQ_STAND, 4, 15]], XQ_PAL(false)) },
  xqSit: { title: "① 坐在地台边，抱着本子看海", s: build([[DECK, 0, 24], [lookSide(streak(XQ_HEAD)), 3, 1], [XQ_SIT, 4, 15]], XQ_PAL(true), 24, 30) },
  xqSitRoom: { title: "", s: build([[lookSide(streak(XQ_HEAD)), 3, 1], [XQ_SIT, 4, 15]], XQ_PAL(true)) },
  xqUp: { title: "② 被点到，站起来（本子还夹着）", s: build([[smile(streak(XQ_HEAD)), 3, 1], [XQ_STAND, 4, 15]], XQ_PAL(true)) },
  xqCrouch: { title: "③ 蹲下来逗暖暖", s: build([[smile(streak(XQ_HEAD)), 3, 4], [XQ_CROUCH, 4, 18], [NN, 22, 15]], { ...XQ_PAL(true), ...NN_PAL, K: "#2A1A14", F: "#B08A60", E: "#3A2418", C: "#F2A08A" }, 36, 28) },
  nn: { title: "暖暖", s: build([[NN, 1, 1]], NN_PAL, 14, 14) },
  rwBackRoom: { title: "", s: build([[RW_BACK, 3, 1], [RW_BACKBODY, 4, 15]], RW_PAL) },
  rw: { title: "Rowan · 站", s: build([[RW_HEAD, 3, 1], [RW_STAND, 4, 15]], RW_PAL) },
  rwDesk: { title: "① 坐在书桌前写字", s: build([[lookDown(RW_HEAD), 3, 1], [RW_DESK, 4, 15], [DESK, 1, 18]], RW_PAL, 24, 27) },
  rwIdle: { title: "② 待机：抬手、抬头看窗外", s: build([[lookUp(RW_HEAD), 3, 1], [RW_WAVE, 4, 15]], RW_PAL) },
  rwBack: { title: "③ 站起来望灯塔（背影）", s: build([[RW_BACK, 3, 1], [RW_BACKBODY, 4, 15]], RW_PAL) },
};


// ================= 各个角度 + 走路 =================
const STREAK_SIDE = [[2, 10, "p"], [2, 11, "p"], [3, 10, "p"], [3, 11, "t"], [3, 12, "t"], [4, 11, "t"], [4, 12, "t"], [4, 13, "t"], [5, 12, "t"], [5, 13, "t"], [6, 12, "t"]];
const paint = (h, L) => h.map((r, j) => [...r].map((c, i) => (L.find(([a, b]) => a === j && b === i) || [0, 0, c])[2]).join(""));
const XQ_SIDE_HEAD = [
  "...HHHH.HH......",
  ".HHHHHHHHHHH....",
  "HHHhhHHHHHHHH...",
  "HHhhHHHHHHHHHH..",
  "HHHHHHHHHHHHHHH.",
  "HHHHHHHjHHjHHHH.",
  "HHHHHHjSSjSSjHH.",
  "HHHHHjSSSSSSSSS.",
  "HHHHHSSSSSSSSSS.",
  "HHHHjSSSSSSEeSS.",
  "HHHjSSSSSSSEESS.",
  "jHHjSSSSSCCSSS..",
  "jH..SSSSSSSMS...",
  "j....SSSSSSS....",
];
const XQ_BACK_HEAD = [
  "....HHHH.HHH......",
  "..HHHHHHHHHHHH.H..",
  ".HHHhhHHHHHHHHHHH.",
  ".HHhhHHHHHHHHHHHH.",
  "HHHhHHHHHHHHHHHHHH",
  "HHHHHHHhHHHHHHHHHH",
  "HHHHHHhHHHHHjHHHHH",
  "HHHHHHHHHHHHHjHHHH",
  "HHjHHHHHHHHHHHHHjH",
  "HjHHHHjHHHHjHHHHjH",
  "HjHHHHHHHHHHHHHHjH",
  "jHjHHHHHHHHHHHHjHj",
  "jH.jjHHHHHHHHjj.Hj",
  "j...jjjjjjjjjj...j",
];
const XQ_SIDE_TORSO = [
  "...RRRWWR.....",
  "..RRRRWWWR....",
  ".RRRRRWWWR....",
  ".RRWWWRWWR....",
  ".RRWWWRWWR....",
  ".RRSSSRWWR....",
  ".GRRSSRRRR....",
  "GgGRRRoRRR....",
  ".GNNNNNNNN....",
];
const XQ_BACK = [
  "....RRRRRRRR....",
  "...RRRRRRRRRR...",
  "..WRRRRRRRRRRW..",
  ".WWRRRRRRRRRRWW.",
  ".WwRRRRrRRRRRwW.",
  ".PPRRRRrRRRRRSS.",
  ".qPRRRRrRRRRRSS.",
  ".PPRRRRrRRRRRSS.",
  ".PPRRRRRRRRRRGG.",
  ".....NNNNNNNNGgG",
  "....NNNNnNNNNGGG",
  "....NNNN.NNNN...",
  "....NNNn.nNNN...",
  "....mmmm.mmmm...",
  "....FFFF.FFFF...",
];
const SIDE_LEGS = (m, f) => ({
  stand: ["..NNNNNNN.....", "..NNNNNNN.....", "..NNNNNNN.....", "..NNNNNNN.....", `..${m.repeat(7)}.....`, `..${f.repeat(8)}....`],
  walk: ["..NNNNNNN.....", ".NNNN.NNNN....", ".NNN...NNN....", "NNNN...NNNN...", `${m.repeat(4)}...${m.repeat(4)}...`, `${f.repeat(4)}...${f.repeat(5)}..`],
});
const RW_SIDE_HEAD = [
  ".....HHHHHH.H...",
  "...HHHHHHHHHH...",
  "..HHHhhHHHHHHH..",
  ".HHhhHHHHHHHHHH.",
  ".HHHHHHHHHHHHHH.",
  ".HHHHHHHHjjHHHH.",
  ".HHHHHHHjSSSjHH.",
  ".HHHHHHSSSSSSSS.",
  ".HHHHsSSSSSSSSS.",
  ".HHHsSSSSSSEESS.",
  ".HHHsSSSSSSEeSS.",
  "..HHSSSSSSSSSS..",
  "...jSSSSSSSMS...",
  ".....SSSSSSS....",
];
const RW_SIDE_TORSO = [
  "...RRRWWR.....",
  "..RRRRWWWR....",
  ".RRRRRWoWR....",
  ".RRRRRRWWR....",
  ".RRrRRRWWR....",
  ".RRrRRRWWR....",
  ".RRSSRRWWR....",
  "..RRRRRRRR....",
  "..NNNNNNNN....",
];
// 正面 / 背面走路：一条腿抬起一格（左右交替）
function stepFront(body, side) {
  const r = body.map(x => [...x]);
  const n = r.length, mid = 8;
  for (let j = n - 4; j < n; j++) for (let i = 0; i < r[j].length; i++) {
    if ((side === 0) !== (i < mid)) continue;
    r[j][i] = j + 1 < n ? body[j + 1][i] : ".";
  }
  return r.map(x => x.join(""));
}
const mirror = s => ({ w: s.w, h: s.h, px: (x, y) => s.px(s.w - 1 - x, y) });
const NN_SIDE = [
  "......Y.....",
  ".....YY.....",
  "...YYYYYY...",
  "..YYYYYYYY..",
  ".YYYYYYEYYY.",
  ".YlYYYYYYYBB",
  "YlYYYYYYCYb.",
  "YYYwwwYYYYY.",
  "YYwwwwYYYYYd",
  "dYYwwYYYYYd.",
  ".dddddddddd.",
  "....FF.FF...",
];
const NN_BACK = [
  "......Y.....",
  ".....YY.....",
  "...YYYYYY...",
  "..YYYYYYYY..",
  ".YYYYYYYYYY.",
  ".YYYYYYYYYY.",
  "YwYYYYYYYYwY",
  "YwwYYYYYYwwY",
  "dYwYYYYYYwYd",
  ".dYYYYYYYYd.",
  "..dddddddd..",
  "...FF..FF...",
];
const XA = XQ_PAL(true), XL = SIDE_LEGS("m", "F"), RL = SIDE_LEGS("N", "F");
const xqSide = legs => build([[paint(XQ_SIDE_HEAD, STREAK_SIDE), 4, 1], [[...XQ_SIDE_TORSO, ...legs], 6, 15]], XA);
const rwSide = legs => build([[RW_SIDE_HEAD, 4, 1], [[...RW_SIDE_TORSO, ...legs], 6, 15]], RW_PAL);
const NNP = { ...NN_PAL };
export const turn = {
  xq: {
    name: "心晴", pal: XA,
    front: sprites.xqA.s, side: xqSide(XL.stand), back: build([[XQ_BACK_HEAD, 3, 1], [XQ_BACK, 4, 15]], XA),
    walkFront: [0, 1].map(k => build([[streak(XQ_HEAD), 3, 1], [stepFront(XQ_STAND, k), 4, 15]], XA)),
    walkSide: [xqSide(XL.walk), xqSide(XL.stand)],
    walkBack: [0, 1].map(k => build([[XQ_BACK_HEAD, 3, 1], [stepFront(XQ_BACK, k), 4, 15]], XA)),
  },
  rw: {
    name: "Rowan", pal: RW_PAL,
    front: sprites.rw.s, side: rwSide(RL.stand), back: sprites.rwBack.s,
    walkFront: [0, 1].map(k => build([[RW_HEAD, 3, 1], [stepFront(RW_STAND, k), 4, 15]], RW_PAL)),
    walkSide: [rwSide(RL.walk), rwSide(RL.stand)],
    walkBack: [0, 1].map(k => build([[RW_BACK, 3, 1], [stepFront(RW_BACKBODY, k), 4, 15]], RW_PAL)),
  },
  nn: {
    name: "暖暖",
    front: build([[NN, 1, 2]], NNP, 14, 15), side: build([[NN_SIDE, 1, 2]], NNP, 14, 15), back: build([[NN_BACK, 1, 2]], NNP, 14, 15),
    walkFront: [build([[NN, 1, 1]], NNP, 14, 15), build([[NN, 1, 2]], NNP, 14, 15)], // 小鸡走路是一蹦一蹦的
    walkSide: [build([[NN_SIDE, 1, 1]], NNP, 14, 15), build([[NN_SIDE, 1, 2]], NNP, 14, 15)],
    walkBack: [build([[NN_BACK, 1, 1]], NNP, 14, 15), build([[NN_BACK, 1, 2]], NNP, 14, 15)],
  },
};
export { mirror };

// ================= 后面的动作 =================
const closedXQ = h => { const r = streak(h); r[9] = "HjSSSSSSSSSSSSSSjH"; r[10] = "HjSEESSSSSSSEESSjH"; return r; };
const XQ_BACK_SIT = [
  "....RRRRRRRR....",
  "...RRRRRRRRRR...",
  "..WRRRRRRRRRRW..",
  ".WWRRRRRRRRRRWW.",
  ".WwRRRRrRRRRRwW.",
  "..SRRRRrRRRRRS..",
  "...RRRRrRRRRR...",
  "..GRRRRRRRRRRR..",
  ".GgNNNNNNNNNNN..",
];
const SILL = [
  "DDDDDDDDDDDDDDDDDDDDDDDD",
  "dddddddddddddddddddddddd",
];
const XQ_CROUCH_SIDE = [
  "...RRRWWR.......",
  "..RRRRWWWR......",
  ".RRRRRWWWWWW....",
  ".RRRRRRWWRSSS...",
  ".GRRRNNNNNN.....",
  "GgGNNNNNNNNN....",
  ".G.NNN...NNN....",
  "...mmm...mmm....",
  "..FFFF...FFFF...",
];
const XQ_FIRE = [
  "....RWWWWWWR....",
  "...RRWWWWWWRR...",
  "..WRRWWWWWWRRW..",
  ".WWRRWWWWWWRRWW.",
  ".WwRRWWWWWWRRwW.",
  "..SSRWWWWWWRSS..",
  "..GRRRRoRRRRR...",
  ".GNNNNNNNNNNNN..",
  "NNNNNNNNNNNNNNNN",
  ".ffNNNNNNNNNNff.",
];
const CUSHION = [
  "IIIIIIIIIIIIIIIIIIII",
  "iiiiiiiiiiiiiiiiiiii",
];
const QUILT = [
  "QQQQQQQQQQQQQQQQQQQQ",
  "QqQQQQqQQQQQqQQQQqQQ",
  "QQQQQQQQQQQQQQQQQQQQ",
];
const ZZ = ["..ZZZ", "...Z.", "..ZZZ", "ZZ...", ".Z...", "ZZ..."];
const RW_DESK_BACK = [
  "....RRRRRRRR....",
  "...RRRRRRRRRR...",
  "..RRRRRrRRRRRR..",
  ".RRRRRRrRRRRRRR.",
  ".RrRRRRrRRRRRRRR",
  ".RrRRRRrRRRRRRS.",
  "..DDDDDDDDDDDD..",
  "..DdDdDdDdDdDD..",
  "..DDDDDDDDDDDD..",
];
const RW_DESK_BACK2 = RW_DESK_BACK.map((r, j) => (j === 4 ? ".RrRRRRrRRRRRRR." : j === 5 ? ".RrRRRRrRRRRRRRS" : r));
const DESK_FAR = [
  "........................",
  "DDDDDDDDDDDDDDDDDDDDDDDD",
  "dddddddddddddddddddddddd",
];
const RW_READ_TORSO = [
  "...RRRWWR.....",
  "..RRRRWWWR....",
  ".RRRRRWoWR....",
  ".RRRRRRWWRSS..",
  ".RRrRRRWWPqqP.",
  ".RRrRRRWWPqqP.",
  ".RRSSRRWWPPPP.",
  "..RRRRRRRR....",
  "..NNNNNNNN....",
];
const sideDown = h => { const r = [...h]; r[9] = ".HHHsSSSSSSSSSS."; r[10] = ".HHHsSSSSSSEESS."; return r; };
const closedRW = h => { const r = [...h]; r[9] = ".sSSSSSSSSSSSSSs."; r[10] = ".sSEESSSSSSEESSs."; return r; };
const NN_SLEEP = NN.map((r, j) => (j === 4 ? ".YllYYYYYYY." : j === 5 ? ".YlEEBBEEYY." : r));
const NN_PECK = [
  "............",
  "............",
  "....Y.......",
  "...YY.......",
  "..YYYYYY....",
  ".YYYYYYYYY..",
  "YlYYYYYYYYY.",
  "YlYwwwYYYEYY",
  "YYwwwwYYYYYB",
  "dYYwwYYYYYdb",
  ".dddddddddd.",
  "....FF.FF...",
];
const GRAIN = ["..............", "...y..y...y.y."];
const XQX = { ...XA, I: "#2E4A7A", i: "#1F3566", Q: "#F2B08A", q: "#E7A07A", Z: "#7FA0B8" };
const RWX = { ...RW_PAL, Q: "#26305A", q: "#3A4A78", Z: "#C9CEE8", P: "#7A2E2A" };
const NNX = { ...NN_PAL, y: "#E2B04A", Z: "#B9A47A" };
export const acts = {
  xq: [
    ["窗台上坐着看海（背影）", build([[SILL, 0, 25], [XQ_BACK_HEAD, 3, 1], [XQ_BACK_SIT, 4, 15]], XQX, 24, 28)],
    ["地台边坐着、腿垂下来", sprites.xqSit.s],
    ["坐在坐垫上烤火", build([[CUSHION, 2, 25], [streak(XQ_HEAD), 3, 1], [XQ_FIRE, 4, 15]], XQX, 24, 28)],
    ["蹲下来逗暖暖（侧面）", build([[paint(XQ_SIDE_HEAD, STREAK_SIDE), 4, 4], [XQ_CROUCH_SIDE, 6, 18], [mirror2(NN), 22, 15]], { ...XQX, ...NN_PAL, F: "#B08A60", E: "#3A2418", C: "#F2A08A" }, 36, 28)],
    ["睡觉（和暖暖一起）", build([[closedXQ(XQ_HEAD), 3, 4], [QUILT, 2, 15], [NN_SLEEP, 23, 6], [ZZ, 0, 0]], { ...XQX, ...NN_PAL, E: "#3A2418", C: "#F2A08A" }, 37, 19)],
  ],
  rw: [
    ["坐在书桌前写字（背影）1", build([[DESK_FAR, 0, 13], [RW_BACK, 3, 2], [RW_DESK_BACK, 4, 16]], RWX, 24, 26)],
    ["坐在书桌前写字（背影）2", build([[DESK_FAR, 0, 13], [RW_BACK, 3, 2], [RW_DESK_BACK2, 4, 16]], RWX, 24, 26)],
    ["站着翻书（侧面）", build([[sideDown(RW_SIDE_HEAD), 4, 1], [[...RW_READ_TORSO, ...RL.stand], 6, 15]], RWX)],
    ["躺在榻台上看星星", build([[RW_HEAD, 3, 4], [QUILT, 2, 15]], RWX, 24, 19)],
    ["睡着了", build([[closedRW(RW_HEAD), 3, 4], [QUILT, 2, 15], [ZZ, 0, 0]], RWX, 24, 19)],
  ],
  nn: [
    ["睡觉", build([[NN_SLEEP, 1, 2], [ZZ, 9, 0]], NNX, 16, 15)],
    ["啄小米 1", build([[NN_SIDE, 1, 2], [GRAIN, 0, 12]], NNX, 16, 15)],
    ["啄小米 2", build([[NN_PECK, 1, 2], [GRAIN, 0, 12]], NNX, 16, 15)],
  ],
};
function mirror2(rows) { return rows.map(r => [...r].reverse().join("")); }
// 放进屋里用的（不带示意家具）
export const roomActs = {
  xqSill: build([[XQ_BACK_HEAD, 3, 1], [XQ_BACK_SIT, 4, 15]], XQX, 24, 25),
  rwDesk: build([[RW_BACK, 3, 2], [RW_DESK_BACK, 4, 16]], RWX, 24, 26),
};


// Rowan 侧身坐在书桌前写字（斜着朝书桌，腿垂在椅子边上），两帧：握笔的手一前一后
const RW_SIT_SIDE = [
  "...RRRWWR.......",
  "..RRRRWWWR......",
  ".RRRRRWoWR......",
  ".RRRRRRWWRRRSS..",
  ".RRrRRRWWRRR....",
  ".RRrRRRWWR......",
  "..RRRRRRRR......",
  "..NNNNNNNNNNN...",
  "..NNNNNNNNNNN...",
  "........NNN.....",
  "........NNN.....",
  "........NNN.....",
  "........NNNN....",
  "........FFFFF...",
];
const RW_SIT_SIDE2 = RW_SIT_SIDE.map((r, j) => (j === 3 ? ".RRRRRRWWRRR...." : j === 4 ? ".RRrRRRWWRRRSS.." : r));

// ================= 放进屋里用的帧 =================
// foot：贴图里哪一行对准格子位置（站着就是脚底；坐着是屁股坐的那一行）
const XQ_SIDE = paint(XQ_SIDE_HEAD, STREAK_SIDE);
export const FOLK = {
  xq: {
    front: { s: sprites.xqA.s }, up: { s: sprites.xqUp.s },
    walk: { front: turn.xq.walkFront, back: turn.xq.walkBack, right: turn.xq.walkSide, left: turn.xq.walkSide.map(mirror) },
    sill: { s: roomActs.xqSill, foot: 24 },
    edge: { s: sprites.xqSitRoom.s, foot: 24 },
    fire: { s: build([[streak(XQ_HEAD), 3, 1], [XQ_FIRE, 4, 15]], XQX, 24, 27) },
    crouch: { s: build([[XQ_SIDE, 4, 4], [XQ_CROUCH_SIDE, 6, 18]], XQX, 24, 28) },
    sleep: { s: build([[closedXQ(XQ_HEAD), 3, 4], [QUILT, 2, 15], [NN_SLEEP, 23, 6], [ZZ, 0, 0]], { ...XQX, ...NN_PAL, E: "#3A2418", C: "#F2A08A" }, 37, 19) },
  },
  rw: {
    front: { s: sprites.rw.s }, up: { s: sprites.rwIdle.s },
    walk: { front: turn.rw.walkFront, back: turn.rw.walkBack, right: turn.rw.walkSide, left: turn.rw.walkSide.map(mirror) },
    desk: { frames: [build([[sideDown(RW_SIDE_HEAD), 4, 1], [RW_SIT_SIDE, 6, 15]], RWX, 24, 31), build([[sideDown(RW_SIDE_HEAD), 4, 1], [RW_SIT_SIDE2, 6, 15]], RWX, 24, 31)], foot: 23 },
    window: { s: mirror(turn.rw.side) },
    read: { s: build([[sideDown(RW_SIDE_HEAD), 4, 1], [[...RW_READ_TORSO, ...RL.stand], 6, 15]], RWX) },
    food: { s: mirror(turn.rw.side) },
    back: { s: sprites.rwBack.s },
    lie: { s: build([[RW_HEAD, 3, 4], [QUILT, 2, 15]], RWX, 24, 19) },
    sleep: { s: build([[closedRW(RW_HEAD), 3, 4], [QUILT, 2, 15], [ZZ, 0, 0]], RWX, 24, 19) },
  },
  nn: {
    front: { s: turn.nn.front }, back: { s: turn.nn.back },
    walk: { front: turn.nn.walkFront, back: turn.nn.walkBack, right: turn.nn.walkSide, left: turn.nn.walkSide.map(mirror) },
    sleep: { s: build([[NN_SLEEP, 1, 2], [ZZ, 9, 0]], NNX, 16, 15) },
    peck: { frames: [build([[NN_SIDE, 1, 2]], NNX, 14, 15), build([[NN_PECK, 1, 2]], NNX, 14, 15)] },
  },
};
