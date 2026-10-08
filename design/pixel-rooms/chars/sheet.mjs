import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { sprites } from './chars.js';
// 每个小人画成 data URL（原尺寸），页面上用 image-rendering: pixelated 放大
const b = await chromium.launch(); const p = await b.newPage();
const urls = {};
for (const [k, { s }] of Object.entries(sprites)) {
  const data = []; for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const c = s.px(x, y); data.push(...(c ? [...c, 255] : [0, 0, 0, 0])); }
  urls[k] = await p.evaluate(([w, h, d]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.putImageData(new ImageData(new Uint8ClampedArray(d), w, h), 0, 0); return c.toDataURL(); }, [s.w, s.h, data]);
}
const fs = await import('node:fs');
fs.writeFileSync('out/urls.json', JSON.stringify({ urls, dims: Object.fromEntries(Object.entries(sprites).map(([k, { s, title }]) => [k, [s.w, s.h, title]])) }));
await b.close();
