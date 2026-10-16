// 独立临时浏览器，不读取真实用户数据。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
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
    await page.reload();
    await page.waitForSelector('.refresh-home');
    // 浏览器真实触摸输入：下拉文案、松手和封面点击隔离。
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x:180,y:70}]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:180,y:110}]});
    await page.waitForFunction(() => document.querySelector('.pull-status').textContent.includes('下拉刷新'));
    await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:180,y:230}]});
    await page.waitForFunction(() => document.querySelector('.pull-status').textContent.includes('松开刷新'));
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
    await page.waitForFunction(() => document.querySelector('.pull-status').textContent.includes('尚未连接同步'));
    assert.equal(await page.locator('input[type="file"]').count(), 0);
    await page.waitForFunction(() => document.querySelector('.pull-space').clientHeight === 0);
    await page.locator('.refresh-home').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.refresh-home').disabled);
    assert.equal(await page.locator('.refresh-row').count(), 0);
    assert(await page.locator('.refresh-home').getAttribute('aria-label'));
    console.log('通过：阈值、方向、取消、插件/输入/滚动容器排除、在途去重、再次刷新、键盘入口');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
