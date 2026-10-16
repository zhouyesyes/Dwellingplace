// 独立临时浏览器，不读取真实用户数据。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    // Chromium 对 Vite 大量模块的热缓存 reload 会报 ERR_INSUFFICIENT_RESOURCES，
    // 导致应用根本不挂载。禁用测试浏览器 HTTP 缓存，仍真实 reload 并断言可见。
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const errors = [], failedRequests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') console.log('浏览器错误：', m.text()); });
    page.on('requestfailed', r => failedRequests.push({ url: r.url(), error: r.failure()?.errorText }));
    const snapshot = async label => console.log(label, JSON.stringify({
      url: page.url(), attached: await page.locator('.refresh-home').count(),
      visible: await page.locator('.refresh-home').isVisible(),
      dom: await page.locator('body').evaluate(el => ({ text: el.innerText.slice(0, 700), button: el.querySelector('.refresh-home')?.outerHTML,
        rect: el.querySelector('.refresh-home')?.getBoundingClientRect().toJSON(),
        dialogs: el.querySelectorAll('[role="dialog"]').length,
        editing: !!el.querySelector('.wdesk.editing') })), errors, failedRequests,
    }));
    await page.goto(process.env.QISUO_TEST_URL || 'http://127.0.0.1:5205/');
    await page.waitForSelector('.refresh-home');
    // 用同一手势模块挂载隔离测试台，计数在途请求，覆盖触摸事件生命周期。
    await page.evaluate(async () => {
      const { createApp, ref, h } = await import('/node_modules/.vite/deps/vue.js');
      const { useHomePullRefresh } = await import('/src/lib/homePullRefresh.js');
      const host = document.createElement('div'); document.body.prepend(host);
      window.calls = 0;
      createApp({ setup() {
        const root = ref(null), busy = ref(false);
        const { distance, armed } = useHomePullRefresh(root, busy, () => {
          window.calls++; busy.value = true;
          setTimeout(() => { busy.value = false; }, 200);
        });
        return () => h('div', { ref: root, id: 'test-pull' }, [
          h('div', {id:'surface'}, `${distance.value}:${armed.value}`),
          h('div', {class:'wdesk'}, '插件'), h('input'),
          h('div', {id:'nested', style:'height:20px;overflow:auto'}, h('div',{style:'height:100px'},'滚动'))
        ]);
      }}).mount(host);
      window.gesture = (selector, points, ending = 'touchend') => {
        const target = document.querySelector(selector);
        const emit = (type, touches) => target.dispatchEvent(new TouchEvent(type, {bubbles:true,cancelable:true,touches:touches.map(([x,y,id=1]) => new Touch({identifier:id,target,clientX:x,clientY:y}))}));
        emit('touchstart', [points[0]]);
        for (const p of points.slice(1)) emit('touchmove', [p]);
        emit(ending, []);
      };
    });
    for (const [selector, points, ending] of [
      ['#surface',[[20,20],[20,100]]], // 未达阈值
      ['#surface',[[20,20],[180,50]]], // 横向
      ['#surface',[[20,100],[20,20]]], // 上滑
      ['#surface',[[20,20],[20,180]],'touchcancel'],
      ['#test-pull .wdesk',[[20,20],[20,180]]],
      ['#test-pull input',[[20,20],[20,180]]],
      ['#nested',[[20,20],[20,180]]],
    ]) {
      await page.evaluate(([s,p,e]) => window.gesture(s,p,e), [selector,points,ending]);
    }
    await page.evaluate(() => {
      document.querySelector('#test-pull .wdesk').classList.add('editing');
      window.gesture('#surface',[[20,20],[20,180]]);
      document.querySelector('#test-pull .wdesk').classList.remove('editing');
      window.scrollTo(0, 100);
    });
    await page.evaluate(() => window.gesture('#surface',[[20,20],[20,180]]));
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await page.evaluate(() => window.calls), 0);
    await page.evaluate(() => {
      window.gesture('#surface',[[20,20],[20,180],[20,200]]);
      window.gesture('#surface',[[20,20],[20,200]]);
    });
    assert.equal(await page.evaluate(() => window.calls), 1);
    await page.waitForTimeout(250);
    await page.evaluate(() => window.gesture('#surface',[[20,20],[20,180]]));
    assert.equal(await page.evaluate(() => window.calls), 2);
    await snapshot('reload 前');
    await page.reload();
    try { await page.waitForSelector('.refresh-home'); }
    finally { await snapshot('reload 后'); }
    assert.deepEqual(errors, []);
    assert.deepEqual(failedRequests, []);
    // 模拟服务器，只替换网络响应，按钮与手势仍走真实 refreshHome/startSync/syncNow。
    let changes = 0, fail = false, hold = false, release;
    let revision = 0;
    await page.route('**/test-sync/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/changes')) {
        changes++;
        if (hold) await new Promise(resolve => { release = resolve; });
      }
      if (fail) return route.fulfill({ status: 503, json: {} });
      if (url.pathname.endsWith('/changes')) return route.fulfill({ json: { seq: 0, items: [] } });
      return route.fulfill({ json: { rev: ++revision } });
    });
    await page.evaluate(async () => {
      const { syncState } = await import('/src/lib/sync.js');
      syncState.on = true;
      syncState.url = location.origin + '/test-sync';
    });
    const status = () => page.locator('.pull-status');
    const button = page.locator('.refresh-home');
    const start = () => cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x:180,y:70}]});
    const move = y => cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:180,y}]});
    const end = () => cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
    const waitText = text => page.waitForFunction(text => document.querySelector('.pull-status').textContent.includes(text), text);
    const collapsed = () => page.waitForFunction(() => document.querySelector('.pull-space').clientHeight === 0);
    const idle = () => page.waitForFunction(() => !document.querySelector('.refresh-home').disabled);
    // 未达阈值：有指示但松手不发同步请求。
    await start(); await move(110); await waitText('下拉刷新'); await end();
    await collapsed();
    assert.equal(changes, 0);
    // 达阈值也必须等松手，多个 move 不重复；暂停网络验证刷新锁。
    hold = true;
    await start(); await move(230); await waitText('松开刷新'); await move(250);
    assert.equal(changes, 0);
    await end(); await waitText('正在刷新…');
    await page.waitForFunction(() => document.querySelector('.refresh-home').disabled);
    await start(); await move(250); await end();
    await page.waitForTimeout(120);
    assert.equal(changes, 1);
    assert.equal(await button.isDisabled(), true);
    assert.equal(typeof release, 'function');
    hold = false; release();
    await waitText('已是最新'); await idle();
    assert.equal(changes, 1);
    await collapsed();
    assert.equal(await page.locator('input[type="file"]').count(), 0);
    // 网络失败走原同步错误状态，不得误报成功，短暂提示后收起。
    fail = true;
    await start(); await move(230); await waitText('松开刷新'); await end();
    await waitText('刷新失败，请重试'); await idle();
    assert.equal(changes, 2);
    assert(!(await status().textContent()).includes('已是最新'));
    assert.match(await button.getAttribute('aria-label'), /失败/);
    await collapsed();
    // 桌面备用入口：点击、Enter、空格均必须实际产生一次同步并显示成功。
    fail = false;
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const action of ['click', 'Enter', 'Space']) {
      assert(await button.getAttribute('aria-label'));
      assert(await button.getAttribute('title'));
      const before = changes;
      if (action === 'click') await button.click();
      else { await button.focus(); await page.keyboard.press(action); }
      await waitText('已是最新'); await idle();
      assert.equal(changes, before + 1, `${action} 必须只同步一次`);
      await collapsed();
    }
    assert.equal(await page.locator('.refresh-row').count(), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(failedRequests, []);
    console.log('通过：reload 前后可见；阈值/方向/取消/编辑/容器/非顶部；真实同步松手一次、刷新锁、成功/失败与收起、重试、桌面点击/Enter/空格');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
