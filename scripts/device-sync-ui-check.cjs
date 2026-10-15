// 两个隔离浏览器设备 + 临时目录真实鉴权服务，只连接回环地址。
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), http=require('node:http'), crypto=require('node:crypto');
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qisuo-binding-ui-'));
  process.env.DATA_DIR=dir;
  const master=crypto.randomBytes(32).toString('base64url');
  const {createDeviceSync}=await import('../deploy/qisuo-server/devices.mjs');
  const {handleSync}=await import('../deploy/qisuo-server/sync.mjs');
  const service=createDeviceSync({dir,masterMatches:t=>t===master});
  const server=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://local');
    const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Expose-Headers':'*'};
    if(u.pathname==='/.well-known/qisuo-sync'){res.writeHead(200,{'Content-Type':'application/json',...cors});return res.end(JSON.stringify({version:1,endpoint:'/sync'}));}
    if(u.pathname.startsWith(`/p/${master}/sync/`)){
      if(!service.legacyAllowed()){res.writeHead(401,cors);return res.end('{}');}
      return handleSync(req,res,u.pathname.slice(`/p/${master}/sync`.length),u.searchParams,cors);
    }
    return service.handle(req,res,u.pathname.slice(5),u.searchParams,cors);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const backend=`http://127.0.0.1:${server.address().port}`;
  const front=process.env.QISUO_TEST_URL||'http://127.0.0.1:5199';
  const browser=await chromium.launch();
  const errors=[], legacyRequests=[];
  const contexts=[];
  const makePage=async()=>{
    const context=await browser.newContext({viewport:{width:390,height:844}});contexts.push(context);
    const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
    p.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/p/'))legacyRequests.push(true);});
    await p.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.hostname!=='127.0.0.1'&&u.hostname!=='localhost')return route.abort();
      if(u.origin===new URL(front).origin&&(u.pathname==='/.well-known/qisuo-sync'||u.pathname.startsWith('/sync/')||u.pathname.startsWith('/p/'))){
        const response=await route.fetch({url:backend+u.pathname+u.search});
        return route.fulfill({response});
      }
      return route.continue();
    });
    await p.goto(front);return p;
  };
  const until=async fn=>{const end=Date.now()+15000;while(!await fn()){if(Date.now()>end)throw Error('等待设备同步超时');await new Promise(r=>setTimeout(r,50));}};
  try{
    const old=[{id:'kept',text:'原来云端的聊天',ts:1}];
    assert((await fetch(backend+`/p/${master}/sync/item?k=msgs:kept&base=0`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(old)})).ok);
    const a=await makePage();
    // 已配置设备自动迁移，保留本地内容和云端 rev。
    await a.evaluate(async ({front,master})=>{
      const db=await import('/node_modules/.vite/deps/idb-keyval.js');
      await db.set('note:local','旧设备离线内容');
      await db.set('sync:conf',{url:front+'/p/'+master+'/sync'});
      await db.set('sync:dirty',['note:local']);
      await (await import('/src/lib/sync.js')).startSync();
    },{front,master});
    const first=await a.evaluate(async()=>{const c=await(await import('/node_modules/.vite/deps/idb-keyval.js')).get('sync:conf');return {id:c.device?.id,url:c.url,hasToken:!!c.device?.token};});
    assert(first.hasToken);assert.equal(first.url,front+'/sync');
    assert.equal(await a.evaluate(async()=>(await import('/src/lib/kv.js')).get('note:local')),'旧设备离线内容');
    assert.equal((await a.evaluate(async()=>(await import('/src/lib/kv.js')).get('msgs:kept')))[0].text,'原来云端的聊天');
    await a.goto(front+'/#/settings/sync');
    await a.getByRole('heading',{name:'这台设备已绑定',exact:true}).waitFor();
    await a.getByRole('button',{name:'生成绑定码',exact:true}).click();
    const output=a.getByLabel('一次性绑定码');await output.waitFor();const code=await output.innerText();
    const b=await makePage();
    await b.evaluate(async()=>{await(await import('/src/lib/kv.js')).set('note:new','新设备离线内容');});
    await b.goto(front+'/#/settings/sync');
    await b.getByLabel('这台设备的名字').fill('我的平板');await b.getByLabel('绑定码',{exact:true}).fill(code);
    await b.getByRole('button',{name:'绑定这台设备',exact:true}).click();
    await b.getByRole('heading',{name:'这台设备已绑定',exact:true}).waitFor();
    await until(()=>b.evaluate(async()=>(await import('/src/lib/kv.js')).get('msgs:kept').then(v=>v?.[0]?.text==='原来云端的聊天')));
    assert.equal(await b.evaluate(async()=>(await import('/src/lib/kv.js')).get('note:new')),'新设备离线内容');
    const confs=await Promise.all([a,b].map(p=>p.evaluate(async()=>{const c=await(await import('/node_modules/.vite/deps/idb-keyval.js')).get('sync:conf');return {token:c.device.token,id:c.device.id};})));
    assert(confs[0].token!==confs[1].token);
    for(const p of [a,b])assert(!p.url().includes(master));
    await a.getByRole('button',{name:'刷新',exact:true}).click();
    await a.getByText('我的平板',{exact:true}).waitFor();
    for(const theme of ['light','dark']){await a.evaluate(t=>document.documentElement.dataset.theme=t,theme);await a.screenshot({path:`/tmp/device-sync-${theme}.png`,fullPage:true});}
    await a.setViewportSize({width:820,height:1180});await a.screenshot({path:'/tmp/device-sync-tablet.png',fullPage:true});
    // UI 撤销另一台，原设备仍能读，新设备无法同步，也不能从旧 API 配置绕回主口令。
    a.once('dialog',d=>d.accept());
    await a.locator('.device').filter({hasText:'我的平板'}).getByRole('button',{name:'撤销'}).click();
    await until(()=>a.locator('.device').filter({hasText:'我的平板'}).innerText().then(s=>s.includes('已撤销')));
    await b.evaluate(async()=>{await(await import('/src/lib/sync.js')).syncNow();});
    assert(await b.evaluate(async()=>(await import('/src/lib/sync.js')).syncState.revoked));
    assert.equal(await b.evaluate(async()=>(await import('/src/lib/kv.js')).get('note:new')),'新设备离线内容');
    // 普通备份、同步状态都不能包含新设备凭证。
    const backup=await a.evaluate(async()=>JSON.parse(await(await(await import('/src/lib/backup.js')).exportAll()).text()));
    assert(!Object.keys(backup.data).some(k=>k.startsWith('sync:')));
    assert(!JSON.stringify(backup).includes(confs[0].token));
    assert(!await a.evaluate(async token=>JSON.stringify((await import('/src/lib/sync.js')).syncState).includes(token),confs[0].token));
    // 另一台仍持有旧配置的设备不会重新引导、不会删除本地内容。
    const c=await makePage();
    await c.evaluate(async({front,master})=>{const db=await import('/node_modules/.vite/deps/idb-keyval.js');await db.set('note:keep','旧设备保留');await db.set('sync:conf',{url:front+'/p/'+master+'/sync'});await(await import('/src/lib/sync.js')).startSync();},{front,master});
    assert.equal(await c.evaluate(async()=>(await import('/src/lib/kv.js')).get('note:keep')),'旧设备保留');
    assert(await c.evaluate(async()=>(await import('/src/lib/sync.js')).syncState.error.includes('绑定码')));
    // 协议探测失败不得降级请求带主口令的旧 URL。
    await c.route('**/.well-known/qisuo-sync',r=>r.fulfill({status:503,json:{error:{message:'暂时离线'}}}));
    await c.evaluate(async()=>{await(await import('/src/lib/sync.js')).startSync();});
    assert.equal(await c.evaluate(async()=>(await import('/src/lib/kv.js')).get('note:keep')),'旧设备保留');
    assert.equal(legacyRequests.length,0);
    assert.deepEqual(errors,[]);
    console.log('通过：旧配置自动迁移、双设备绑定同一云端、各自独立凭证、离线内容保留、界面撤销、旧配置不可绕过、备份排除凭证、手机浅深色和平板截图');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1)});
