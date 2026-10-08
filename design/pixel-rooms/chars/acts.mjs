import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { acts } from './chars.js';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
const toURL = async s => { const d = []; for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const c = s.px(x, y); d.push(...(c ? [...c, 255] : [0, 0, 0, 0])); }
  return [await p.evaluate(([w, h, d]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d), w, h), 0, 0); return c.toDataURL(); }, [s.w, s.h, d]), s.w, s.h]; };
const S = 6;
let html = `<html><body style="margin:0;background:#f4f1ea;font-family:'Noto Sans SC',sans-serif;color:#333">
<style>img{image-rendering:pixelated;display:block}.row{display:flex;gap:14px;padding:6px 26px;align-items:flex-end;flex-wrap:wrap}
figure{margin:0}.c{padding:10px;border-radius:12px;display:flex;align-items:flex-end;justify-content:center}figcaption{font-size:13px;color:#666;margin-top:5px;text-align:center}
h1{font-size:24px;margin:22px 26px 4px}h2{font-size:17px;margin:16px 26px 0;color:#444}p{margin:4px 26px;color:#888;font-size:14px}</style>
<h1>后面的动作（只是图）</h1><p>家具（窗台、坐垫、被子、书桌）只是示意，放进屋里时用屋里的</p>`;
for (const [k, name, bg] of [['xq', '心晴', '#EFE0C4'], ['rw', 'Rowan', '#2F4B3C'], ['nn', '暖暖', '#EFE0C4']]) {
  html += `<h2>${name}</h2><div class="row">`;
  for (const [cap, s] of acts[k]) { const [u, w, h] = await toURL(s); html += `<figure><div class="c" style="background:${bg}"><img src="${u}" style="width:${w * S}px;height:${h * S}px"></div><figcaption>${cap}</figcaption></figure>`; }
  html += '</div>';
}
await p.setContent(html + '</body></html>'); await p.waitForTimeout(200);
await p.screenshot({ path: process.cwd() + '/out/人物-后面的动作.png', fullPage: true }); await b.close();
