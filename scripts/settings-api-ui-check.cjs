// 只用临时浏览器和模拟接口，不读取真实配置或调用服务商。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
    let failed = false;
    await page.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.hostname === 'api.deepseek.com') return route.fulfill({status:failed ? 401 : 200,json:{is_available:true,balance_infos:[{currency:'CNY',total_balance:'12.50',topped_up_balance:'10',granted_balance:'2.50'}]}});
      if (u.pathname === '/mock/openrouter/v1/credits') return route.fulfill({json:{data:{total_credits:20,total_usage:3}}});
      if (u.pathname === '/mock/openrouter/v1/key') return route.fulfill({json:{data:{usage:3,usage_daily:1,usage_weekly:2,usage_monthly:3}}});
      if (u.pathname === '/mock/chatgpt/status') return route.fulfill({json:{connected:true,limits:{events:{limit:JSON.stringify({primary:{used_percent:25,window_minutes:300}})}}}});
      if (u.hostname !== '127.0.0.1' || u.pathname.startsWith('/sync') || u.pathname.startsWith('/.well-known')) return route.abort();
      return route.continue();
    });
    await page.goto('http://127.0.0.1:5199/');
    await page.evaluate(async () => {
      const { store, today } = await import('/src/store/index.js');
      store.apis = [
        {id:'plan',name:'官G',type:'openai',baseUrl:location.origin+'/mock/chatgpt/v1',model:'gpt-test'},
        {id:'ds',name:'deepseek',type:'openai',baseUrl:'https://api.deepseek.com',model:'deepseek-test',key:'mock'},
        {id:'or',name:'OpenRouter',type:'openai',baseUrl:location.origin+'/mock/openrouter/v1',model:'test',key:'mock'},
        {id:'noir',name:'noir',type:'openai',baseUrl:'https://example.invalid/v1',model:'test'},
        {id:'claude',name:'Claude',type:'anthropic',baseUrl:'https://example.invalid',model:'test'},
        {id:'openai',name:'OpenAI',type:'openai',baseUrl:'https://example.invalid/v1',model:'test'}
      ];
      store.apis.forEach(a => { a.models = []; a.favModels = []; });
      store.defaultApiId = 'plan';
      store.usage = {[today()]:{ds:{calls:3,input:1200,output:200,models:{'deepseek-test':{calls:3,input:1200,output:200}}}}};
      store.turnLog = [{ts:Date.now(),apiId:'ds',rounds:2,input:1200,output:200}];
      location.hash='/settings';
    });
    await page.getByRole('heading',{name:'设置',exact:true}).waitFor();
    assert.equal(await page.locator('button').filter({hasText:/工作室|工作间|用量和余额|添加 API/}).count(),0);
    assert.equal(await page.locator('.api-dot').count(),0);
    await page.locator('.helper select').selectOption('ds\u0000deepseek-test');
    for (const theme of ['light','dark']) {
      await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      await page.screenshot({path:`/tmp/settings-${theme}.png`,fullPage:true});
    }
    await page.getByRole('button',{name:'API 配置接口、查看额度和用量'}).click();
    await page.getByRole('heading',{name:'API',exact:true}).waitFor();
    const ds = page.locator('.api-item').filter({has:page.locator('.api-edit',{hasText:'deepseek'})});
    await ds.getByText(/余额 ¥12.50/).waitFor();
    await page.getByText(/账户余额 \$17.00/).waitFor();
    await page.getByText(/还剩 75%/).waitFor();
    assert.equal(await page.locator('.api-edit').count(),6);
    assert.match(await ds.textContent(),/3 次/);
    await ds.locator('.day').click();
    await ds.locator('.m-name').getByText('deepseek-test',{exact:true}).waitFor();
    await page.getByText('最近每一轮',{exact:true}).click();
    await page.getByText('请求 2 次',{exact:true}).waitFor();
    for (const theme of ['light','dark']) {
      await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      await page.screenshot({path:`/tmp/settings-api-${theme}.png`,fullPage:true});
    }
    await ds.locator('.api-edit').click();
    await page.waitForTimeout(300);
    assert.equal(errors.length,0,errors.join('\n'));
    await page.getByRole('heading',{name:'编辑 API'}).waitFor();
    await page.locator('.field').filter({has:page.locator('span',{hasText:/^名字$/})}).locator('input').fill('deepseek 已编辑');
    await page.getByRole('button',{name:'保存',exact:true}).click();
    await page.getByRole('heading',{name:'API',exact:true}).waitFor();
    await page.locator('.api-edit').getByText('deepseek 已编辑',{exact:true}).waitFor();
    failed = true;
    await page.getByRole('button',{name:'刷新',exact:true}).click();
    await page.getByText(/Key 不对或者没有权限/).waitFor();
    await page.getByRole('button',{name:'添加 API',exact:true}).click();
    await page.getByRole('heading',{name:'添加 API',exact:true}).waitFor();
    await page.locator('.sub-header .icon-btn').click();
    await page.getByRole('heading',{name:'API',exact:true}).waitFor();
    await page.locator('.sub-header .icon-btn').click();
    await page.getByRole('heading',{name:'设置',exact:true}).waitFor();
    assert.equal(await page.evaluate(async()=>(await import('/src/store/index.js')).store.settings.helper.apiId),'ds');
    await page.evaluate(()=>location.hash='/settings/billing');
    await page.waitForURL('**/#/settings/apis');
    await page.evaluate(async()=>{ (await import('/src/store/index.js')).store.apis=[]; });
    await page.getByText('还没有添加 API。',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'添加 API',exact:true}).count(),1);
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('通过：设置统一入口、API/返回/编辑保存/添加导航、会员与余额展示、日模型/每轮统计、查询错误、旧路由、手机深浅色截图');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1);});
