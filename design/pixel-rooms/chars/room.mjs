import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const { urls, dims } = JSON.parse(fs.readFileSync('out/urls.json'));
const room = n => 'data:image/png;base64,' + fs.readFileSync(`../rooms/out/${n}.png`).toString('base64');
const P = (gx, gy, h = 0) => [176 + (gx - gy) * 16, 150 + (gx + gy) * 8 - h * 16];
// 每个人：精灵名、格子位置、脚底在精灵里哪一行
const scenes = {
  cui: { bg: room('cui-final'), put: [['xqSitRoom', 6.3, 6.55, 1, 24], ['nn', 9.2, 9.1, 0.3, 12], ['xqUp', 2.6, 6.2, 0, 30]] },
  rowan: { bg: room('rowan-final'), put: [['rwIdle', 3.9, 3.7, 0, 30], ['rwBackRoom', 4.4, 2.2, 0, 30]] },
};
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
const out = {};
for (const [k, sc] of Object.entries(scenes)) {
  out[k] = await p.evaluate(async ([sc, urls, dims, pos]) => {
    const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = s; });
    const c = document.createElement('canvas'); c.width = 352; c.height = 320; const x = c.getContext('2d');
    x.drawImage(await load(sc.bg), 0, 0);
    for (const [i, [name]] of sc.put.entries()) {
      const [px, py] = pos[i], [w] = dims[name];
      x.drawImage(await load(urls[name]), Math.round(px - w / 2), Math.round(py));
    }
    return c.toDataURL();
  }, [sc, urls, dims, sc.put.map(([n, gx, gy, h, foot]) => { const [x, y] = P(gx, gy, h); return [x, y - foot]; })]);
}
const html = `<html><body style="margin:0;background:#f4f1ea;font-family:'Noto Sans SC',sans-serif">
<style>img{image-rendering:pixelated;width:1056px;display:block;border-radius:14px}h1{font-size:22px;margin:20px 26px 10px;color:#333}p{margin:0 26px 8px;color:#777;font-size:14px}.r{display:flex;gap:24px;padding:0 26px 24px}</style>
<h1>放进屋里看看大小和颜色（原尺寸 × 3）</h1>
<p>脆脆：一个坐在地台边，一个站在地炉边；暖暖在右前角的草窝里；Rowan：一个站在月光里抬手，一个背影（以后转身望窗）。同一屋里出现两个只是为了对比，实际一次只有一个</p>
<div class="r"><img src="${out.cui}"></div><div class="r"><img src="${out.rowan}"></div></body></html>`;
await p.setContent(html); await p.waitForTimeout(300);
await p.screenshot({ path: process.cwd() + '/out/人物-放进屋里.png', fullPage: true }); await b.close();
