import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { turn, mirror } from './chars.js';
const S = 2, FPS = 10;
const P = (gx, gy, h = 0) => [176 + (gx - gy) * 16, 150 + (gx + gy) * 8 - h * 16];
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 760, height: 700 } });
const toURL = async s => { const d = []; for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const c = s.px(x, y); d.push(...(c ? [...c, 255] : [0, 0, 0, 0])); }
  return p.evaluate(([w, h, d]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d), w, h), 0, 0); return c.toDataURL(); }, [s.w, s.h, d]); };
// 每个角色的帧：front/back/side 各两帧走路 + 站着
const sheets = {};
for (const k of ['xq', 'rw', 'nn']) {
  const t = turn[k], o = {};
  o.front = [await toURL(t.walkFront[0]), await toURL(t.walkFront[1])];
  o.back = [await toURL(t.walkBack[0]), await toURL(t.walkBack[1])];
  o.right = [await toURL(t.walkSide[0]), await toURL(t.walkSide[1])];
  o.left = [await toURL(mirror(t.walkSide[0])), await toURL(mirror(t.walkSide[1]))];
  o.idleFront = await toURL(t.front); o.idleBack = await toURL(t.back); o.w = t.front.w; o.h = t.front.h;
  sheets[k] = o;
}
// 路线：一段段走，最后停下、被点、冒气泡
function plan(path, speed) { // path: [[gx,gy], ...]，返回每帧的位置和朝向
  const out = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [a, c] = [path[i], path[i + 1]], n = Math.max(1, Math.round(Math.hypot(c[0] - a[0], c[1] - a[1]) / speed));
    const dx = (c[0] - a[0] - (c[1] - a[1])) * 16, dy = (c[0] - a[0] + c[1] - a[1]) * 8;
    const dir = Math.abs(dx) > Math.abs(dy) * 1.5 ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'front' : 'back';
    for (let k = 0; k < n; k++) out.push({ g: [a[0] + (c[0] - a[0]) * k / n, a[1] + (c[1] - a[1]) * k / n], dir, walk: true });
  }
  return out;
}
const scenes = [
  { room: '../rooms/out/cui-final.png', bg: '#4a3d35', file: 'cui',
    who: [['xq', plan([[2.6, 6.0], [3.6, 7.6], [6.6, 7.7], [6.6, 7.4]], 0.12), 'back', '心晴', '走到地台边，准备坐下看海 🌊'],
          ['nn', [...Array(14).fill({ g: [9.2, 9.0], dir: 'front', walk: false }), ...plan([[9.2, 9.0], [8.0, 8.4], [7.4, 8.0]], 0.08)], 'front', '暖暖', '']] },
  { room: '../rooms/out/rowan-final.png', bg: '#141a22', file: 'rowan',
    who: [['rw', plan([[4.6, 6.6], [4.0, 4.0], [3.4, 3.2], [2.8, 3.0]], 0.12), 'back', 'Rowan', '起身望一眼窗外的灯塔 🗼']] },
];
const html = `<html><body style="margin:0;background:#222"><canvas id="c" width="${352 * S}" height="${320 * S + 70}"></canvas></body></html>`;
for (const sc of scenes) {
  await p.setContent(html);
  const len = Math.max(...sc.who.map(w => w[1].length)) + 25;
  const dir = `out/frames-${sc.file}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  const roomURL = 'data:image/png;base64,' + fs.readFileSync(sc.room).toString('base64');
  for (let f = 0; f < len; f++) {
    const items = sc.who.map(([k, steps, endDir, name, say]) => {
      const st = steps[Math.min(f, steps.length - 1)], done = f >= steps.length;
      const o = sheets[k];
      const url = done ? (endDir === 'back' ? o.idleBack : o.idleFront) : st.walk ? o[st.dir][Math.floor(f / 2) % 2] : o.idleFront;
      const [x, y] = P(...st.g);
      return { url, x, y, w: o.w, h: o.h, depth: st.g[0] + st.g[1], name, say: done && f > steps.length + 4 ? say : '', tap: done && f > steps.length && f <= steps.length + 4 };
    });
    const png = await p.evaluate(async ([items, roomURL, S, bg]) => {
      const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = s; });
      const c = document.getElementById('c'), x = c.getContext('2d'); x.imageSmoothingEnabled = false;
      x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(await load(roomURL), 0, 0, 352 * S, 320 * S);
      for (const it of [...items].sort((a, b) => a.depth - b.depth)) x.drawImage(await load(it.url), Math.round(it.x - it.w / 2) * S, Math.round(it.y - it.h + 1) * S, it.w * S, it.h * S);
      for (const it of items) {
        if (it.tap) { x.strokeStyle = '#fff'; x.lineWidth = 3; x.beginPath(); x.arc(it.x * S, (it.y - 16) * S, 22, 0, 7); x.stroke(); }
        if (it.say) { // 房间下面的气泡：说明在干嘛
          const t = `${it.name}：${it.say}`; x.font = '22px "Noto Sans SC", sans-serif';
          const w = x.measureText(t).width + 36, bx = (352 * S - w) / 2, by = 320 * S + 8;
          x.fillStyle = '#FFF8EC'; x.strokeStyle = '#3A2A1C'; x.lineWidth = 3;
          x.beginPath(); x.roundRect(bx, by, w, 52, 14); x.fill(); x.stroke();
          x.beginPath(); x.moveTo(it.x * S - 10, by + 1); x.lineTo(it.x * S, by - 14); x.lineTo(it.x * S + 10, by + 1); x.fill();
          x.fillStyle = '#3A2A1C'; x.fillText(t, bx + 18, by + 34);
        }
      }
      return c.toDataURL();
    }, [items, roomURL, S, sc.bg]);
    fs.writeFileSync(`${dir}/${String(f).padStart(3, '0')}.png`, Buffer.from(png.split(',')[1], 'base64'));
  }
}
await b.close();
