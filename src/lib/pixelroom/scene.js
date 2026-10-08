// 小屋的「活」的部分：底图画一次（开关灯、开关门、有信时再重画），
// 每一帧在底图上加会动的东西（窗外、火苗、窗帘），再把小人和暖暖画上去（被家具挡住的地方不画）
import { makeCanvas, drawRoom, W, H, P, TAGS, tagId } from "./iso.js";
import { cui, rowan } from "./rooms.js";
import { FOLK } from "./folk.js";

// 每间屋：能走的点（nodes + edges）、TA 会待的地方（spots）
// spot：at 格子位置 [gx, gy, h]，node 从哪个点走过去，pose 用哪张图，mood 心情里有这些字就更常去
const PLACES = {
  cui: {
    room: cui, who: "xq", pet: true,
    nodes: { A: [2.8, 5.6, 0], B: [2.9, 8.4, 0], C: [6.6, 8.1, 0], D: [6.6, 7.0, 0.5], E: [6.6, 6.2, 1], F: [7.0, 4.6, 1], G: [7.0, 1.4, 1], H: [5.7, 1.4, 1], I: [3.2, 4.4, 0], J: [7.6, 8.9, 0] },
    edges: ["AB", "BC", "CD", "DE", "EF", "FG", "GH", "AI", "CJ", "BJ"],
    spots: {
      sill: { at: [5.7, 0.55, 1.72], node: "H", pose: "sill", short: "窗台", label: "坐在窗台上看海，本子搁在腿上 🌊", mood: "平静 安静 想 思念 发呆 惆怅 难过 低落 孤单 温柔" },
      edge: { at: [6.3, 6.55, 1], node: "E", pose: "edge", short: "地台边", label: "坐在地台边，抱着本子发呆", mood: "平静 放松 慵懒 懒 满足 惬意" },
      fire: { at: [2.5, 3.2, 0.14], node: "I", pose: "fire", short: "地炉边", label: s => (s.fire === false ? "坐在地炉边发呆（火灭了，有点凉）" : "坐在地炉边烤火，看着水壶冒热气 ♨️"), mood: "累 困 疲 冷 安心 温暖 放松" },
      chick: { at: [7.85, 9.25, 0], node: "J", pose: "crouch", short: "暖暖的窝", label: "蹲在窝边逗暖暖 🐤", mood: "开心 愉快 兴奋 雀跃 高兴 俏皮 好奇" },
      wander: { at: [2.8, 6.4, 0], node: "A", pose: "front", tap: "up", short: "屋子中间", label: "在屋里转转", mood: "好奇 无聊 开心" },
      sleep: { at: [8.55, 0.95, 1.55], node: "G", pose: "sleep", z: 1.5, label: "和暖暖一起睡着了 💤", sleep: true },
    },
    nest: [9.15, 9.1, 0.32], dish: [8.05, 9.05, 0],
  },
  rowan: {
    room: rowan, who: "rw",
    nodes: { R1: [4.6, 6.0, 0], R2: [4.4, 3.0, 0], R3: [1.6, 5.4, 0], R4: [7.1, 1.8, 0], R5: [1.6, 7.9, 0], R6: [3.4, 2.9, 0] },
    edges: ["R1R2", "R1R3", "R1R4", "R1R5", "R3R5", "R2R6", "R2R4"],
    spots: {
      desk: { at: [4.42, 2.1, 0.55], node: "R2", pose: "desk", short: "书桌", label: s => (s.lamp === false ? "坐在书桌前，借着月光写字 ✒️" : "坐在书桌前写航海日志 ✒️"), mood: "专注 认真 思考 平静 充实" },
      window: { at: [1.4, 5.0, 0], node: "R3", pose: "window", short: "窗边", label: "站在窗边望灯塔 🌙", mood: "想 思念 安静 惆怅 温柔 孤单" },
      read: { at: [7.1, 1.3, 0], node: "R4", pose: "read", short: "书架", label: "站在书架前翻书 📖", mood: "好奇 平静 专注" },
      food: { at: [1.3, 7.9, 0], node: "R5", pose: "food", short: "吃的柜子", label: "在柜子前找吃的 🍞", mood: "饿 开心 馋 放松" },
      lie: { at: [0.95, 1.2, 0.95], node: "R6", pose: "lie", z: 1.5, short: "榻台", label: "躺在榻台上看星星 ✨", mood: "累 放松 慵懒 安静 满足" },
      wander: { at: [4.6, 6.0, 0], node: "R1", pose: "up", short: "屋子中间", label: "在屋里走走", mood: "开心 好奇" },
      sleep: { at: [0.95, 1.2, 0.95], node: "R6", pose: "sleep", z: 1.5, label: "睡着了 💤", sleep: true },
    },
  },
};

// 把小人图转成 RGBA，存起来
const baked = new WeakMap();
function bake(s) {
  if (baked.has(s)) return baked.get(s);
  const data = new Uint8ClampedArray(s.w * s.h * 4);
  let foot = 0;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const c = s.px(x, y);
    if (!c) continue;
    data.set([c[0], c[1], c[2], 255], (y * s.w + x) * 4);
    foot = y;
  }
  const b = { w: s.w, h: s.h, data, foot };
  baked.set(s, b);
  return b;
}
const WALK_SPEED = 1.4; // 格/秒
const dirOf = (a, b) => {
  const dx = (b[0] - a[0] - (b[1] - a[1])) * 16, dy = (b[0] - a[0] + b[1] - a[1]) * 8 - (b[2] - a[2]) * 16;
  return Math.abs(dx) > Math.abs(dy) * 1.5 ? (dx > 0 ? "right" : "left") : dy > 0 ? "front" : "back";
};
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export class Scene {
  constructor(kind, canvas, { onDoing = () => {} } = {}) {
    this.kind = kind;
    this.P = PLACES[kind];
    this.room = this.P.room;
    this.ctx = canvas.getContext("2d");
    this.img = new ImageData(W, H);
    this.frame = makeCanvas(this.img.data);
    this.state = { fire: true, lamp: true, door: true, mail: false };
    this.mood = "";
    this.asleep = false;
    this.onDoing = onDoing;
    this.base = null;
    this.winTag = tagId("window");
    const first = this.pickSpot();
    this.me = { pos: [...this.P.spots[first].at], spot: first, path: [], dir: "front", t: 0, until: -1, tapUntil: 0 }; // -1：刚打开，先待一会儿
    if (this.P.pet) this.pet = { pos: [...this.P.nest], at: "nest", path: [], dir: "front", until: 0 };
    this.last = 0;
  }

  // ---------- 底图 ----------
  render() {
    const cv = makeCanvas();
    drawRoom(cv, this.room, { light: true, furniture: true, state: this.state });
    this.base = cv;
  }
  set(patch) { // 开关火/灯/门、有信：改了就重画底图
    const changed = Object.keys(patch).some(k => this.state[k] !== patch[k]);
    Object.assign(this.state, patch);
    if (changed && this.base) this.render();
    return changed;
  }

  // ---------- TA 在哪、在干嘛 ----------
  pickSpot() {
    const S = this.P.spots, words = this.mood || "";
    if (this.asleep) return "sleep";
    const cands = Object.keys(S).filter(k => !S[k].sleep && k !== this.me?.spot);
    const w = cands.map(k => 1 + 3 * (S[k].mood || "").split(" ").filter(m => m && words.includes(m)).length);
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cands.length; i++) if ((r -= w[i]) <= 0) return cands[i];
    return cands[0];
  }
  route(from, spotKey) { // 从现在的位置走到某个地方：最近的点 → 图上最短的一串点 → 那个地方
    const { nodes, edges, spots } = this.P, sp = spots[spotKey];
    const startNode = Object.keys(nodes).sort((a, b) => near(nodes[a], from) - near(nodes[b], from))[0];
    const prev = { [startNode]: null }, q = [startNode];
    while (q.length) {
      const n = q.shift();
      if (n === sp.node) break;
      for (const e of edges) {
        const [a, b] = e.length === 2 ? [e[0], e[1]] : [e.slice(0, 2), e.slice(2)];
        const m = a === n ? b : b === n ? a : null;
        if (m && !(m in prev)) { prev[m] = n; q.push(m); }
      }
    }
    const chain = [];
    for (let n = sp.node; n; n = prev[n]) chain.unshift(nodes[n]);
    // 要是本来就在这个地方的点附近，就别先绕回去
    if (chain.length > 1 && near(chain[1], from) < near(chain[0], from)) chain.shift();
    return [...chain, sp.at].map(p => [...p]);
  }
  goTo(spotKey, now) {
    const me = this.me;
    me.spot = spotKey;
    const sp = this.P.spots[spotKey];
    if (sp.sleep || this.asleep) { // 睡觉就直接躺下，不在屋里走
      me.pos = [...sp.at]; me.path = []; me.until = Infinity;
    } else {
      me.path = this.route(me.pos, spotKey);
      me.until = 0;
    }
    this.onDoing(this.doing());
  }
  setMind({ mood = "", asleep = false } = {}) {
    const wasAsleep = this.asleep;
    this.mood = mood;
    this.asleep = asleep;
    if (asleep && this.me.spot !== "sleep") this.goTo("sleep");
    else if (!asleep && wasAsleep) this.goTo(this.pickSpot());
  }
  doing() {
    const me = this.me, sp = this.P.spots[me.spot];
    if (me.path.length) return `正在走去${sp.short}`;
    return typeof sp.label === "function" ? sp.label(this.state) : sp.label;
  }

  update(dt, t) {
    const me = this.me;
    if (me.path.length) {
      const target = me.path[0], d = Math.hypot(target[0] - me.pos[0], target[1] - me.pos[1], (target[2] - me.pos[2]) * 0.6);
      const step = WALK_SPEED * dt;
      if (d <= step) {
        me.pos = target; me.path.shift();
        if (!me.path.length) { me.until = t + 25 + Math.random() * 30; this.onDoing(this.doing()); }
      } else {
        me.dir = dirOf(me.pos, target);
        me.pos = me.pos.map((v, i) => v + (target[i] - v) * step / d);
      }
    } else if (me.until === -1) me.until = t + 15 + Math.random() * 15;
    else if (t > me.until && !this.asleep) this.goTo(this.pickSpot(), t);
    if (this.pet) this.updatePet(dt, t);
  }
  updatePet(dt, t) { // 暖暖：平时窝在窝里，偶尔蹦去碟子那里啄小米
    const p = this.pet;
    if (p.path.length) {
      const target = p.path[0], d = near(target, p.pos), step = 0.9 * dt;
      if (d <= step) { p.pos = [...target]; p.path.shift(); if (!p.path.length) p.until = t + (p.at === "dish" ? 6 : 15 + Math.random() * 20); }
      else { p.dir = dirOf(p.pos, target); p.pos = p.pos.map((v, i) => v + (target[i] - v) * step / d); }
    } else if (t > p.until) {
      if (p.until === 0) { p.until = t + 8 + Math.random() * 10; return; }
      p.at = p.at === "nest" ? "dish" : "nest";
      p.path = [p.at === "dish" ? this.P.dish : this.P.nest];
    }
  }

  // ---------- 一帧 ----------
  tick(now) {
    if (!this.base) return;
    const t = now / 1000, dt = this.last ? Math.min(0.25, t - this.last) : 0;
    this.last = t;
    this.update(dt, t);
    const f = this.frame, buf = f.buf, base = this.base;
    buf.set(base.buf);
    // 窗外：只重画没被家具挡住的那些像素
    for (const [x, y, s, tt] of this.room.win.px) {
      const p = y * W + x;
      if (base.tags[p] !== this.winTag) continue;
      const c = this.room.view(s, tt, x, y, t), i = p * 4;
      buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
    }
    this.room.anim(f, this.state, t);
    // 小人、暖暖：按远近排，近的后画
    const ents = [];
    const me = this.me, sp = this.P.spots[me.spot], F = FOLK[this.P.who];
    let img, foot;
    if (me.path.length) { const fr = F.walk[me.dir]; img = fr[Math.floor(t * 4) % 2]; }
    else {
      const pose = t < me.tapUntil && sp.tap ? F[sp.tap] : F[sp.pose];
      img = pose.frames ? pose.frames[Math.floor(t / 0.7) % pose.frames.length] : pose.s;
      foot = pose.foot;
    }
    ents.push({ who: "me", img, foot, pos: me.pos, z: me.path.length ? 0 : sp.z || 0 });
    if (this.pet && !(this.asleep && this.kind === "cui")) {
      const p = this.pet, N = FOLK.nn;
      let pimg;
      if (p.path.length) pimg = N.walk[p.dir][Math.floor(t * 6) % 2];
      else if (p.at === "dish") pimg = N.peck.frames[Math.floor(t * 2.5) % 2];
      else pimg = me.spot === "chick" ? N.front.s : (t % 9 < 6 ? N.sleep.s : N.front.s);
      ents.push({ who: "pet", img: pimg, pos: p.pos, z: 0 });
    }
    ents.sort((a, b) => a.pos[0] + a.pos[1] - (b.pos[0] + b.pos[1]));
    this.hits = [];
    for (const e of ents) this.hits.push({ who: e.who, ...this.blit(bake(e.img), e.pos, e.foot, e.z) });
    this.ctx.putImageData(this.img, 0, 0);
  }
  blit(sp, [gx, gy, h], foot = sp.foot, z = 0) {
    const [px, py] = P(gx, gy, h), x0 = Math.round(px - sp.w / 2), y0 = Math.round(py) - foot;
    const depth = gx + gy + 0.3 + z, buf = this.frame.buf, dep = this.base.depth;
    for (let y = 0; y < sp.h; y++) for (let x = 0; x < sp.w; x++) {
      const k = (y * sp.w + x) * 4;
      if (!sp.data[k + 3]) continue;
      const X = x0 + x, Y = y0 + y;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const p = Y * W + X;
      if (dep[p] > depth) continue; // 家具在 TA 前面：挡住
      buf[p * 4] = sp.data[k]; buf[p * 4 + 1] = sp.data[k + 1]; buf[p * 4 + 2] = sp.data[k + 2]; buf[p * 4 + 3] = 255;
    }
    return { x0, y0, w: sp.w, h: sp.h, sp };
  }

  // 点到了什么：先看人和暖暖，再看家具
  hit(x, y) {
    for (const h of [...(this.hits || [])].reverse()) {
      const lx = Math.floor(x - h.x0), ly = Math.floor(y - h.y0);
      if (lx >= -2 && ly >= -2 && lx < h.w + 2 && ly < h.h + 2) return h.who;
    }
    if (!this.base || x < 0 || y < 0 || x >= W || y >= H) return "";
    return TAGS[this.base.tags[Math.floor(y) * W + Math.floor(x)]] || "";
  }
  tapMe(t) { this.me.tapUntil = t / 1000 + 3; }
}
