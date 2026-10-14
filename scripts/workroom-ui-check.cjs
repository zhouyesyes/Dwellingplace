// 只访问本地 Vite；模拟工作间后端和流式事件，不使用真实账号。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => console.error('页面错误：', e.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname === '/mock/codex/status') return route.fulfill({ json: { account: {}, projects: ['测试'], threads: [{ id: 'test', project: '测试', title: '测试' }] } });
    if (url.pathname.endsWith('/test/events')) return route.fulfill({ json: { thread: { id: 'test', project: '测试' }, events: [], approvals: [] } });
    if (url.pathname === '/mock/codex/events') return route.fulfill({ contentType: 'text/event-stream', body: ': mock\n\n' });
    return route.continue();
  });
  await page.goto('http://127.0.0.1:5199/');
  await page.evaluate(async () => { const { wr } = await import('/src/lib/workroom.js'); wr.base = '/mock'; });
  await page.evaluate(() => { location.hash = '/work'; });
  await page.evaluate(async () => { const { wr, refresh } = await import('/src/lib/workroom.js'); wr.base = '/mock'; await refresh(); });
  await page.getByText('测试', { exact: true }).last().click();
  await page.getByText('直接用 Codex', { exact: true }).click();
  await page.evaluate(async () => {
    const { apply } = await import('/src/lib/workroom.js');
    for (let i = 0; i < 150; i++) apply({ method: 'item/completed', params: { threadId: 'test', item: { id: 'old'+i, type: 'agentMessage', text: '历史消息 **正文**\n'.repeat(5) } } });
    window.streamTimer = setInterval(() => apply({ method: 'item/agentMessage/delta', params: { threadId: 'test', itemId: 'live', delta: '流式正文 ' } }), 5);
  });
  const input = page.locator('textarea');
  await input.click(); await input.fill('流式生成时仍能输入');
  assert.equal(await input.inputValue(), '流式生成时仍能输入');
  assert(await input.evaluate(el => el === document.activeElement));
  const box = await input.boundingBox(); assert(box.y >= 0 && box.y + box.height <= 844);
  await page.locator('input[type=file]').setInputFiles({ name: '示例.txt', mimeType: 'text/plain', buffer: Buffer.from('示例') });
  await page.getByText('移除', { exact: true }).click(); assert.equal(await page.locator('.pending').count(), 0);
  for (const theme of ['light', 'dark']) { await page.evaluate(t => document.documentElement.dataset.theme = t, theme); await page.screenshot({ path: `/tmp/workroom-${theme}.png` }); }
  await page.setViewportSize({ width: 390, height: 480 });
  await input.click(); const small = await input.boundingBox(); assert(small.y + small.height <= 480);
  await page.evaluate(() => clearInterval(window.streamTimer));
  await browser.close(); console.log('通过：长历史流式输出、输入聚焦、附件移除、手机视口缩小、浅深色截图');
})().catch(e => { console.error(e); process.exit(1); });
