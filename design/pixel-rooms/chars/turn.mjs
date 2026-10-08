import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { turn, mirror } from './chars.js';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
const toURL = async s => { const d = []; for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const c = s.px(x, y); d.push(...(c ? [...c, 255] : [0, 0, 0, 0])); }
  return [await p.evaluate(([w, h, d]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d), w, h), 0, 0); return c.toDataURL(); }, [s.w, s.h, d]), s.w, s.h]; };
const S = 6;
const cell = async (s, cap, bg) => { const [u, w, h] = await toURL(s); return `<figure><div class="c" style="background:${bg}"><img src="${u}" style="width:${w * S}px;height:${h * S}px"></div><figcaption>${cap}</figcaption></figure>`; };
let html = `<html><body style="margin:0;background:#f4f1ea;font-family:'Noto Sans SC',sans-serif;color:#333">
<style>img{image-rendering:pixelated;display:block}.row{display:flex;gap:14px;padding:6px 26px;align-items:flex-end;flex-wrap:wrap}
figure{margin:0}.c{padding:10px;border-radius:12px;display:flex;align-items:flex-end;justify-content:center;min-height:${34 * S}px}figcaption{font-size:13px;color:#666;margin-top:5px;text-align:center}
h1{font-size:24px;margin:22px 26px 4px}h2{font-size:17px;margin:16px 26px 0;color:#444}p{margin:4px 26px;color:#888;font-size:14px}.sep{width:18px}</style>
<h1>各个角度 + 走路的帧（只是图）</h1><p>正面 · 右侧 · 背面 · 左侧（左侧是右侧镜像）；后面是走路用的两帧，来回换就是在走</p>`;
for (const [k, bg] of [['xq', '#EFE0C4'], ['rw', '#2F4B3C'], ['nn', '#EFE0C4']]) {
  const t = turn[k];
  html += `<h2>${t.name}</h2><div class="row">`;
  html += await cell(t.front, '正面', bg) + await cell(t.side, '右侧', bg) + await cell(t.back, '背面', bg) + await cell(mirror(t.side), '左侧', bg) + '<div class="sep"></div>';
  for (const [key, lab] of [['walkFront', '往前走'], ['walkSide', '往旁边走'], ['walkBack', '往里走']]) for (const [i, f] of t[key].entries()) html += await cell(f, `${lab} ${i + 1}`, bg);
  html += '</div>';
}
await p.setContent(html + '</body></html>'); await p.waitForTimeout(200);
await p.screenshot({ path: process.cwd() + '/out/人物-各个角度.png', fullPage: true }); await b.close();
