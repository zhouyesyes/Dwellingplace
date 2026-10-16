// 只访问本地 Vite；模拟工作间后端和流式事件，不使用真实账号。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const deadline = setTimeout(() => browser.close(), 90000).unref();
  try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => console.error('页面错误：', e.message));
  await page.addInitScript(() => {
    window.EventSource = class {
      static CONNECTING = 0;
      static OPEN = 1;
      constructor() { window.mockSse = this; this.readyState = 1; queueMicrotask(() => this.onopen?.()); }
      close() { this.readyState = 2; }
    };
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname.startsWith('/p/mock/sync')) return route.fulfill({status:503,json:{}});
    if (url.pathname === '/p/mock/codex/status') return route.fulfill({ json: { account: {}, projects: ['测试'], threads: [{ id: 'test', project: '测试', title: '测试' }] } });
    if (url.pathname.endsWith('/test/events')) return route.fulfill({ json: { thread: { id: 'test', project: '测试' }, events: [], approvals: [] } });
    if (url.pathname === '/p/mock/codex/events') return route.fulfill({ contentType: 'text/event-stream', body: ': mock\n\n' });
    return route.continue();
  });
  await page.goto((process.env.QISUO_TEST_URL || 'http://127.0.0.1:5199/'));
  await page.evaluate(async () => { const { wr } = await import('/src/lib/workroom.js'); wr.base = location.origin + '/p/mock'; });
  await page.evaluate(async () => { await (await import('/node_modules/.vite/deps/idb-keyval.js')).set('sync:conf',{url:location.origin+'/p/mock/sync'}); location.hash = '/work'; });
  await page.waitForURL('**/#/work');
  await page.waitForTimeout(200);
  await page.evaluate(async () => { const { wr, refresh } = await import('/src/lib/workroom.js'); wr.base = location.origin + '/p/mock'; await refresh(); });
  await page.getByText('测试', { exact: true }).last().click();
  await page.getByText('直接用 Codex', { exact: true }).click();
  for(let i=0;i<100;i++){ if(await page.evaluate(async()=>(await import('/src/lib/workroom.js')).thread('test').loaded)) break; await page.waitForTimeout(30); }
  const fs = require('node:fs');
  const path = require('node:path');
  const runs = fs.readdirSync('.qisuo-previews/manual');
  const run = runs.find(r => fs.existsSync(path.join('.qisuo-previews/manual', r, 'manifest.json')));
  assert(run, '先运行 ui-preview.cjs');
  const png = fs.readFileSync(path.join('.qisuo-previews/manual', run, 'phone-light.png'));
  const id = '12345678-1234-1234-1234-123456789abc';
  await page.route('**/attachments/' + id, r => r.fulfill({ contentType:'image/png', body:png }));
  const preview = {route:'/settings',width:390,height:844,theme:'light',generatedAt:new Date().toISOString()};
  await page.evaluate(({id,preview,size}) => {
    window.mockSse.onmessage({data:JSON.stringify({seq:9000,ts:Date.now(),method:'qisuo/preview/ready',params:{threadId:'test',attachments:[{id,name:'phone-light.png',type:'image/png',size,preview}]}})});
  }, {id,preview,size:png.length});
  const link = page.locator('.tl .attachments a');
  await link.waitFor();
  assert((await link.innerText()).includes('/settings · 390×844'));
  assert((await link.getAttribute('href')).endsWith('/threads/test/attachments/' + id));
  await page.waitForFunction(() => document.querySelector('.tl .attachments img')?.naturalWidth === 390);
  for (const theme of ['light','dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme=theme,theme);
    await page.waitForTimeout(300);
    await page.screenshot({path:path.join('.qisuo-previews/manual',run,`workroom-${theme}.png`)});
  }
  console.log('通过：真实 PNG 经 SSE 任务产物事件显示缩略图、带任务归属的附件链接、路由/尺寸/时间标注，浅深色截图');
  } finally { clearTimeout(deadline); await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
