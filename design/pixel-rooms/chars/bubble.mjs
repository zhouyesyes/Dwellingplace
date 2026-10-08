import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { roomActs } from './chars.js';
const S = 2;
const P = (gx, gy, h = 0) => [176 + (gx - gy) * 16, 150 + (gx + gy) * 8 - h * 16];
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
const toURL = async s => { const d = []; for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const c = s.px(x, y); d.push(...(c ? [...c, 255] : [0, 0, 0, 0])); }
  return p.evaluate(([w, h, d]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d), w, h), 0, 0); return c.toDataURL(); }, [s.w, s.h, d]); };
const shot = async (room, sprite, [gx, gy, h], foot) => {
  const url = await toURL(sprite), bg = 'data:image/png;base64,' + fs.readFileSync(room).toString('base64');
  const [x, y] = P(gx, gy, h);
  return p.evaluate(async ([bg, url, x, y, w, foot]) => {
    const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = s; });
    const c = document.createElement('canvas'); c.width = 352; c.height = 320; const g = c.getContext('2d');
    g.drawImage(await load(bg), 0, 0); g.drawImage(await load(url), Math.round(x - w / 2), Math.round(y - foot)); return c.toDataURL();
  }, [bg, url, x, y, sprite.w, foot]);
};
const cui = await shot('../rooms/out/cui-final.png', roomActs.xqSill, [5.0, 0.55, 1.72], 24);
const rw = await shot('../rooms/out/rowan-final.png', roomActs.rwDesk, [4.42, 2.1, 0.55], 25);
// 气泡：第一行在干嘛，第二行心潮的连接状态
const bubble = (name, act, state, detail, dot) => `<div class="bub"><div class="t"><b>${name}</b>${act}</div><div class="s"><i style="background:${dot}"></i>心潮 · ${state}<span>${detail}</span></div></div>`;
const html = `<html><body style="margin:0;background:#efebe4;font-family:'Noto Sans SC',sans-serif;color:#333">
<style>.col{display:flex;flex-direction:column;align-items:center;gap:0;width:720px}.room{width:704px;image-rendering:pixelated;border-radius:16px;display:block}
.wrap{display:flex;gap:30px;padding:16px 26px}h1{font-size:22px;margin:20px 26px 4px}p{margin:2px 26px;color:#777;font-size:14px}
.bub{position:relative;margin-top:16px;background:#FFF8EC;border:3px solid #3A2A1C;border-radius:16px;padding:12px 18px;min-width:420px;box-shadow:0 3px 0 #3A2A1C}
.bub:before{content:"";position:absolute;top:-13px;left:var(--x,50%);border:10px solid transparent;border-bottom-color:#3A2A1C;border-top:0}
.t{font-size:19px}.t b{margin-right:10px}.s{font-size:14px;color:#6A5A4A;margin-top:6px;display:flex;align-items:center;gap:6px}.s i{width:10px;height:10px;border-radius:50%;display:inline-block}.s span{color:#9A8A78;margin-left:6px}
.dark .bub{background:#1E2A33;border-color:#C9B98A;color:#E9DFC4;box-shadow:0 3px 0 #0E1418}.dark .s{color:#B9C4C0}.dark .s span{color:#7A8A88}.dark .bub:before{border-bottom-color:#C9B98A}
.lab{font-size:13px;color:#999;margin-top:14px}</style>
<h1>点一下人 → 房间下面冒出气泡</h1><p>第一行：他现在在干嘛；第二行：心潮连着没有、最近一次记下东西是什么时候。下面三种状态都画出来了</p>
<div class="wrap">
<div class="col"><img class="room" src="${cui}">
${bubble('心晴', '坐在窗台上看海，本子搁在腿上 🌊', '已连接', '3 分钟前记下一条：「今天的晚霞像橘子汽水」', '#5FB86A')}
<div class="lab">正在同步时 ↓</div>
${bubble('心晴', '蹲在窝边逗暖暖 🐤', '正在同步…', '把刚才聊的写进记忆', '#E8B040')}
</div>
<div class="col dark"><img class="room" src="${rw}">
${bubble('Rowan', '坐在书桌前写航海日志 ✒️', '已连接', '刚刚翻了 2 条旧记忆', '#5FB86A')}
<div class="lab">没连上时 ↓</div>
${bubble('Rowan', '站在窗边望灯塔 🌙', '没连上', '上次连上是 2 小时前 · 点一下重连', '#8A8A8A')}
</div></div></body></html>`;
await p.setContent(html); await p.waitForTimeout(300);
await p.screenshot({ path: process.cwd() + '/out/气泡-心潮状态.png', fullPage: true }); await b.close();
