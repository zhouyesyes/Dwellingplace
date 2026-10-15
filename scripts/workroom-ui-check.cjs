// 只访问本地 Vite；模拟工作间后端和流式事件，不使用真实账号。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
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
  await page.goto('http://127.0.0.1:5199/');
  await page.evaluate(async () => { const { wr } = await import('/src/lib/workroom.js'); wr.base = location.origin + '/p/mock'; });
  await page.evaluate(async () => { await (await import('/node_modules/.vite/deps/idb-keyval.js')).set('sync:conf',{url:location.origin+'/p/mock/sync'}); location.hash = '/work'; });
  await page.waitForURL('**/#/work');
  await page.waitForTimeout(200);
  await page.evaluate(async () => { const { wr, refresh } = await import('/src/lib/workroom.js'); wr.base = location.origin + '/p/mock'; await refresh(); });
  await page.getByText('测试', { exact: true }).last().click();
  await page.getByText('直接用 Codex', { exact: true }).click();
  for(let i=0;i<100;i++){ if(await page.evaluate(async()=>(await import('/src/lib/workroom.js')).thread('test').loaded)) break; await page.waitForTimeout(30); }
  // 请求仍在等待时就显示发送阶段；失败后不留下假执行状态，并恢复草稿。
  let releaseSend;
  await page.route('**/codex/threads/test/send', async route => {
    await new Promise(resolve => releaseSend = resolve);
    await route.fulfill({ status: 503, json: { error: { message: '模拟发送失败' } } });
  });
  await page.locator('textarea').fill('测试发送阶段');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '正在发送给 Codex' }).waitFor();
  while (!releaseSend) await page.waitForTimeout(10);
  releaseSend();
  await page.waitForFunction(() => !document.querySelector('.working'));
  assert.equal(await page.locator('textarea').inputValue(), '测试发送阶段');
  await page.locator('textarea').fill('');
  // 用真正的 SSE 接收入口，检查开始与首字不必等待合批定时器。
  await page.evaluate(async () => {
    const { wr, thread } = await import('/src/lib/workroom.js');
    const emit = (method, params) => window.mockSse.onmessage({ data: JSON.stringify({ seq: wr.lastSeq + 1, method, params: { threadId: 'test', ...params } }) });
    emit('turn/started', { turn: { id: 'progress-turn' } });
    if (thread('test').turnId !== 'progress-turn') throw Error('开始事件没有立即处理');
    emit('item/agentMessage/delta', { itemId: 'first', delta: '第一条进度' });
    if (thread('test').byId.first?.text !== '第一条进度') throw Error('首字没有立即处理');
  });
  await page.getByRole('status').filter({ hasText: 'Codex 正在执行' }).waitFor();
  // Vite 热更新后沿用页面实际加载的模块地址，避免测试另建一份阶段状态。
  await page.evaluate(() => {
    window.workTogetherUrl = performance.getEntriesByType('resource').map(e => e.name)
      .filter(u => new URL(u).pathname === '/src/lib/workTogether.js').at(-1) || '/src/lib/workTogether.js';
  });
  // 阶段只显示固定文案；内部交活说明不出现在页面或折叠区。
  await page.evaluate(async () => {
    const { phases, busy, workThread } = await import(window.workTogetherUrl);
    const { apply } = await import('/src/lib/workroom.js');
    workThread('test').mode = 'gpt';
    apply({ method: 'qisuo/user/message', params: { threadId: 'test', text: '内部交活说明-不展示' } });
    busy.test = true; phases.test = 'preparing';
  });
  await page.getByRole('status').filter({ hasText: '正在整理任务' }).waitFor();
  assert(!(await page.locator('.tl').innerText()).includes('内部交活说明-不展示'));
  for (const phase of ['preparing', 'checking']) {
    await page.evaluate(async phase => { (await import(window.workTogetherUrl)).phases.test = phase; }, phase);
    await page.getByRole('status').filter({ hasText: phase === 'checking' ? '正在检查结果' : '正在整理任务' }).waitFor();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
      await page.screenshot({ path: `/tmp/workroom-progress-${phase}-${theme}.png` });
    }
  }
  await page.evaluate(async () => {
    const { phases, busy, workThread } = await import(window.workTogetherUrl);
    delete phases.test; delete busy.test; workThread('test').mode = 'direct';
    const { apply } = await import('/src/lib/workroom.js');
    apply({ method: 'turn/completed', params: { threadId: 'test', turn: { status: 'completed' } } });
  });
  // 远端把待审批移到时间线末尾；阶段提示不能把它挤回历史里。
  await page.evaluate(async () => {
    const { apply } = await import('/src/lib/workroom.js');
    apply({ method: 'qisuo/approval/pending', params: { threadId: 'test', key: 'integration-ask', command: '模拟审批命令' } });
    apply({ method: 'item/completed', ts: Date.now(), params: { threadId: 'test', item: { id: 'after-ask', type: 'agentMessage', text: '审批之后的历史内容' } } });
  });
  await page.locator('.ask').waitFor();
  assert(await page.locator('.ask').evaluate(el => !!(el.previousElementSibling.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)));
  assert((await page.locator('.ask').boundingBox()).y > (await page.getByText('审批之后的历史内容', { exact: true }).boundingBox()).y);
  await page.evaluate(async () => { (await import('/src/lib/workroom.js')).apply({ method: 'qisuo/approval/cleared', params: { key: 'integration-ask' } }); });
  assert.equal(await page.locator('.ask').count(), 0);
  await page.evaluate(async () => {
    const { apply } = await import('/src/lib/workroom.js');
    for (let i = 0; i < 150; i++) apply({ method: 'item/completed', params: { threadId: 'test', item: { id: 'old'+i, type: 'agentMessage', text: '历史消息 **正文**\n'.repeat(5) } } });
    window.streamTimer = setInterval(() => apply({ method: 'item/agentMessage/delta', params: { threadId: 'test', itemId: 'live', delta: '流式正文 ' } }), 5);
  });
  await page.locator('.agent').first().waitFor();
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
  // 模拟 Safari：布局视口不变，可视区域被键盘缩短并向上平移。
  await page.setViewportSize({ width: 390, height: 844 });
  await input.fill('很长的草稿\n'.repeat(80));
  await page.evaluate(() => {
    window.mockViewport = window.visualViewport;
    Object.defineProperties(window.mockViewport, {
      height: { configurable: true, writable: true, value: 430 },
      offsetTop: { configurable: true, writable: true, value: 90 }
    });
    window.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(100);
  let rect = await page.locator('.wr').boundingBox();
  assert.equal(rect.y,90); assert.equal(rect.height,430);
  assert((await page.locator('.tl').boundingBox()).height > 100);
  assert((await input.boundingBox()).height <= 160);
  for (const theme of ['light','dark']) {
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    await page.screenshot({path:`/tmp/workroom-keyboard-${theme}.png`});
  }
  // 高度先恢复、offsetTop 还停在键盘打开时：不能在顶部留下空白。
  await page.evaluate(()=>{ window.mockViewport.height=844;window.mockViewport.offsetTop=300;window.mockViewport.dispatchEvent(new Event('resize')); });
  await page.waitForTimeout(100);
  rect=await page.locator('.wr').boundingBox();assert.equal(rect.y,0);assert.equal(rect.height,844);
  // 连续开关；部分恢复时也不能让容器底部超出布局视口。
  await page.evaluate(()=>{ window.mockViewport.height=700;window.mockViewport.offsetTop=300;window.mockViewport.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(100);
  rect=await page.locator('.wr').boundingBox();assert.equal(rect.y,144);assert.equal(rect.y+rect.height,844);
  // 最后一次 viewport 事件遗漏时，失焦后的动画收尾也会重读。
  await input.blur();
  await page.evaluate(()=>{ window.mockViewport.height=844;window.mockViewport.offsetTop=300; });
  await page.waitForTimeout(800);
  rect=await page.locator('.wr').boundingBox();assert.equal(rect.y,0);assert.equal(rect.height,844);
  await page.evaluate(()=>{ window.mockViewport.height=844;window.mockViewport.offsetTop=0;dispatchEvent(new Event('resize')); });
  await page.waitForTimeout(100);
  rect=await page.locator('.wr').boundingBox();assert.equal(rect.y,0);assert.equal(rect.height,844);
  await page.evaluate(() => {
    document.body.style.minHeight = '1800px';
    window.scrollTo(0, 200);
    window.mockViewport.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.evaluate(() => document.body.style.minHeight = '');
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.evaluate(()=>{ window.mockViewport.height=650;window.mockViewport.offsetTop=40;dispatchEvent(new Event('resize')); });
  await page.waitForTimeout(100);
  assert((await page.locator('.tl').boundingBox()).height>200);
  await page.screenshot({path:'/tmp/workroom-tablet.png'});
  await page.evaluate(() => clearInterval(window.streamTimer));
  await browser.close(); console.log('通过：发送阶段与失败恢复、SSE 开始/首字立即更新、整理/验收浅深色与内部交活隐藏、长历史流式输出、输入聚焦、附件移除、手机视口缩小、键盘分步恢复/失焦收尾/文档滚动复位、浅深色截图');
})().catch(e => { console.error(e); process.exit(1); });
