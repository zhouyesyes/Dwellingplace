// 本地浏览器 + 模拟同步服务，不访问真实数据或账号。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let seq = 0, failures = false, changes = 0, hook = null;
  const items = new Map();
  const put = (k, val) => items.set(k, { rev: ++seq, val });
  await page.route('**/p/test/sync/**', async route => {
    const u = new URL(route.request().url()), method = route.request().method();
    if (failures) return route.fulfill({ status: 503, json: {} });
    if (u.pathname.endsWith('/changes')) {
      changes++;
      return route.fulfill({ json: { seq, items: [...items].filter(([,v]) => v.rev > Number(u.searchParams.get('since'))).map(([k,v]) => ({k, rev:v.rev})) } });
    }
    const k = u.searchParams.get('k'), old = items.get(k);
    if (hook) { const fn = hook; hook = null; await fn(method, k); }
    if (method === 'GET') return route.fulfill(old ? { headers: {'Content-Type':'application/json','X-Rev':String(old.rev)}, body:JSON.stringify(old.val) } : {status:404,json:{rev:0}});
    if (Number(u.searchParams.get('base')) !== (old?.rev || 0)) return route.fulfill({status:409,json:{rev:old.rev}});
    put(k, method === 'DELETE' ? undefined : route.request().postDataJSON());
    return route.fulfill({json:{rev:seq}});
  });
  await page.goto('http://127.0.0.1:5199/');
  await page.evaluate(async () => {
    const db = await import('/node_modules/.vite/deps/idb-keyval.js');
    await db.set('sync:conf', {url:location.origin+'/p/test/sync'});
  });
  put('msgs:test', [{id:'a',text:'云端新正文',ts:1}]);
  await page.evaluate(async () => { const s=await import('/src/lib/sync.js'); await s.startSync(); });
  const until = async fn => { const end=Date.now()+12000; while(!await fn()) { if(Date.now()>end) throw new Error('等待同步超时'); await page.waitForTimeout(50); } };
  const get = k => page.evaluate(async k => (await import('/src/lib/kv.js')).get(k), k);
  const set = (k,v) => page.evaluate(async ([k,v]) => (await import('/src/lib/kv.js')).set(k,v), [k,v]);
  const sync = () => page.evaluate(async () => (await import('/src/lib/sync.js')).syncNow());
  assert.equal((await get('msgs:test'))[0].text, '云端新正文');
  // 离线旧缓存不能覆盖云端同一条消息的新正文。
  put('msgs:test', [{id:'a',text:'另一设备修改',ts:1}]);
  await set('msgs:test', [{id:'a',text:'旧正文',ts:1},{id:'b',text:'离线新增',ts:2}]);
  await sync();
  assert.equal(items.get('msgs:test').val[0].text, '另一设备修改');
  assert.equal(items.get('msgs:test').val.length, 2);
  // 上传在途继续编辑：不能把新编辑误记为已上传。
  await set('note', '第一版');
  hook = async (method,k) => { assert.equal(method,'PUT'); assert.equal(k,'note'); await set('note','第二版'); };
  await sync(); await sync();
  assert.equal(items.get('note').val,'第二版');
  // 下载在途继续编辑：本地编辑保留并进入冲突合并。
  put('msgs:test', [{id:'a',text:'云端再次修改',ts:1}]);
  hook = async (method,k) => { assert.equal(method,'GET'); await set(k,[{id:'local',text:'下载期间新增',ts:3}]); };
  await sync(); await sync();
  assert(items.get('msgs:test').val.some(m=>m.id==='local'));
  assert(items.get('msgs:test').val.some(m=>m.text==='云端再次修改'));
  failures = true; await set('retry','失败仍保留'); await sync();
  assert.equal(await get('retry'),'失败仍保留');
  assert(await page.evaluate(async ()=>(await import('/src/lib/sync.js')).syncState.pending>0));
  await page.reload();
  await until(()=>page.evaluate(async () => !!(await import('/src/lib/sync.js')).syncState.error));
  assert.equal(await get('retry'),'失败仍保留');
  failures = false;
  await until(()=>page.evaluate(async () => !(await import('/src/lib/sync.js')).syncState.pending));
  assert.equal(items.get('retry').val,'失败仍保留');
  for (const event of ['pageshow','focus','online']) {
    const n=changes; put('foreground',event);
    await page.evaluate(event=>dispatchEvent(new Event(event)),event);
    await until(async()=>await get('foreground')===event);
    assert(changes>n);
  }
  put('foreground','visible');
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await until(async()=>await get('foreground')==='visible');
  assert((await page.evaluate(async () => (await import('/node_modules/.vite/deps/idb-keyval.js')).keys())).some(k=>String(k).startsWith('sync:conflict:')));
  // 关闭后不能被配置监听自动重开；保留数据，再用已有 API 配置自动发现。
  await page.evaluate(async () => {
    await (await import('/src/lib/sync.js')).disableSync();
    const {store}=await import('/src/store/index.js');
    store.apis.push({id:'mock',baseUrl:location.origin+'/p/test/chatgpt/v1'});
  });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(async()=>(await import('/src/lib/sync.js')).syncState.on),false);
  assert.equal(await get('retry'),'失败仍保留');
  await page.evaluate(async()=>{
    await (await import('/node_modules/.vite/deps/idb-keyval.js')).del('sync:disabled');
    await (await import('/src/lib/sync.js')).startSync();
  });
  assert.equal(await page.evaluate(async()=>(await import('/src/lib/sync.js')).syncState.url),'http://127.0.0.1:5199/p/test/sync');
  assert.equal(await get('retry'),'失败仍保留');
  await browser.close();
  console.log('通过：启动拉取、回前台拉取、旧缓存冲突、上传/下载期间编辑、失败保留及自动重试、冲突副本');
})().catch(e=>{console.error(e);process.exit(1)});
