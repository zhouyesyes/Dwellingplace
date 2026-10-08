import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const { urls, dims } = JSON.parse(fs.readFileSync('out/urls.json'));
const im = (k, s, bg) => `<div class="c" style="background:${bg}"><img src="${urls[k]}" style="width:${dims[k][0] * s}px;height:${dims[k][1] * s}px"></div>`;
const fig = (k, s, bg, cap = dims[k][2]) => `<figure>${im(k, s, bg)}<figcaption>${cap}</figcaption></figure>`;
const CREAM = '#EFE0C4', GREEN = '#2F4B3C';
const html = `<html><body style="margin:0;background:#f4f1ea;font-family:'Noto Sans SC',sans-serif;color:#333">
<style>img{image-rendering:pixelated;display:block}.row{display:flex;gap:22px;padding:10px 26px;align-items:flex-end;flex-wrap:wrap}
figure{margin:0}.c{padding:14px;border-radius:12px;display:flex;align-items:flex-end;justify-content:center}figcaption{font-size:14px;color:#666;margin-top:6px;text-align:center;max-width:220px}
h1{font-size:24px;margin:22px 26px 4px}h2{font-size:17px;margin:18px 26px 0;color:#444}p{margin:4px 26px;color:#888;font-size:14px}</style>
<h1>人物 · 第二版（只是图）</h1>
<h2>心晴 · 发梢 A / B 对比</h2><p>左边两组是原尺寸（小于 32×32），右边放大 6 倍；奶油墙和深绿墙前各放一次</p>
<div class="row">
${fig('xqA', 1, CREAM, 'A 原尺寸')}${fig('xqB', 1, CREAM, 'B 原尺寸')}${fig('xqA', 1, GREEN, 'A 深绿墙前')}${fig('xqB', 1, GREEN, 'B 深绿墙前')}
${fig('xqA', 2, CREAM, 'A ×2')}${fig('xqB', 2, CREAM, 'B ×2')}
${fig('xqA', 6, CREAM)}${fig('xqB', 6, CREAM)}
</div>
<h2>心晴 · 三个动作 + 暖暖</h2>
<div class="row">${fig('xqSit', 6, CREAM)}${fig('xqUp', 6, CREAM)}${fig('xqCrouch', 6, CREAM)}${fig('nn', 6, CREAM, '暖暖（小鸡）')}${fig('xqUp', 6, GREEN, '深绿墙前也看得清')}</div>
<h2>Rowan · 三个动作</h2>
<div class="row">${fig('rw', 1, GREEN, '原尺寸')}${fig('rw', 2, GREEN, '×2')}${fig('rw', 6, GREEN)}${fig('rwDesk', 6, GREEN)}${fig('rwIdle', 6, GREEN)}${fig('rwBack', 6, GREEN)}</div>
</body></html>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
await p.setContent(html); await p.waitForTimeout(200);
await p.screenshot({ path: process.cwd() + '/out/人物-设定.png', fullPage: true }); await b.close();
