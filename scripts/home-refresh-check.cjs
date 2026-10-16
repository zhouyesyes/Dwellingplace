// 临时浏览器验证远端图片落盘通知、手动刷新及响应式布局。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto((process.env.QISUO_TEST_URL || 'http://127.0.0.1:5199/'));
  await page.waitForSelector('.refresh-home');
  await page.evaluate(async () => {
    const { store } = await import('/src/store/index.js');
    const db = await import('/node_modules/.vite/deps/idb-keyval.js');
    store.profile.cover = 'late-cover';
    await new Promise(r => setTimeout(r, 100));
    await db.set('img:late-cover', new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="pink"/></svg>'], { type: 'image/svg+xml' }));
    (await import('/src/lib/kv.js')).notifyRemoteChange('img:late-cover');
  });
  await page.waitForFunction(() => document.querySelector('.cover').style.backgroundImage.includes('blob:'));
  const old = await page.locator('.cover').getAttribute('style');
  await page.evaluate(async () => {
    const { store } = await import('/src/store/index.js');
    store.profile.bioSelf = '保留本地编辑';
    (await import('/src/lib/kv.js')).notifyRemoteChange('img:late-cover');
  });
  await page.waitForFunction(old => document.querySelector('.cover').getAttribute('style') !== old, old);
  await page.locator('.refresh-home').click();
  await page.waitForFunction(() => !document.querySelector('.refresh-home').disabled);
  assert(await page.getByText('保留本地编辑', {exact:true}).count());
  for (const [name, width, height] of [['phone',390,844],['ipad',820,1180],['desktop',1440,1000]]) {
    await page.setViewportSize({width,height});
    for (const theme of ['light','dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.waitForTimeout(350);
      await page.screenshot({path:`/tmp/home-refresh-${name}-${theme}.png`});
      assert(await page.locator('.refresh-home').isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
  }
  await browser.close();
  console.log('通过：图片迟到/同 ID 更新、保留本地编辑、手机/平板/桌面浅深色入口与溢出检查');
})().catch(e => {console.error(e);process.exit(1)});
