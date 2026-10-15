// 仅临时目录、回环 HTTP、合成口令；不读真实配置，不输出凭证或绑定码。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'qisuo-devices-'));
process.env.DATA_DIR = dir;
const { createDeviceSync } = await import('../deploy/qisuo-server/devices.mjs');
const { handleSync } = await import('../deploy/qisuo-server/sync.mjs');
const master = randomBytes(32).toString('base64url');
const nonce = () => randomBytes(32).toString('base64url');
let clock = Date.now();
const options = { dir, now: () => clock, masterMatches: t => t === master };
let service = createDeviceSync(options);
let uploadStarted;
const server = http.createServer((req,res) => {
  const u = new URL(req.url, 'http://local');
  if(u.pathname.startsWith('/legacy/')) {
    if(!service.legacyAllowed() || req.headers.authorization !== `Bearer ${master}`) {res.writeHead(401);return res.end();}
    return handleSync(req,res,u.pathname.slice(7),u.searchParams,{});
  }
  if (u.pathname === '/item' && u.searchParams.get('k') === 'slow') req.once('data', () => uploadStarted?.());
  return service.handle(req,res,u.pathname,new URL(req.url,'http://local').searchParams,{});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base = `http://127.0.0.1:${server.address().port}`;
const req = (path, {token,body,method=body?'POST':'GET'}={})=>fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
const json = async r => { assert.equal(r.status,200);return r.json(); };
try {
  // 升级前的一份数据，迁移后仍从同一目录、同一 rev 读取。
  await json(await req('/legacy/item?k=meta&base=0',{token:master,method:'PUT',body:{text:'原来的栖所'}}));
  assert.equal((await req('/changes?since=0')).status,401);
  assert.equal((await req('/item?k=meta&base=1',{method:'PUT',body:{text:'未授权'}})).status,401);
  assert.equal((await req('/item?k=meta&base=1',{method:'DELETE'})).status,401);
  assert.equal((await req('/codes',{body:{}})).status,401);
  assert.equal((await req('/devices',{token:master})).status,401);
  const firstNonce=nonce();
  const first = await json(await req('/migrate',{token:master,body:{nonce:firstNonce,name:'手机'}}));
  const again = await json(await req('/migrate',{token:master,body:{nonce:firstNonce,name:'手机'}}));
  assert(first.token===again.token && first.device.id===again.device.id);
  assert.equal((await req('/migrate',{token:master,body:{nonce:nonce(),name:'另一旧设备'}})).status,409);
  assert.equal((await req('/legacy/changes?since=0',{token:master})).status,401);
  assert.equal((await json(await req('/item?k=meta',{token:first.token}))).text,'原来的栖所');
  const oldRev=(await req('/item?k=meta',{token:first.token})).headers.get('x-rev'); assert.equal(oldRev,'1');
  assert.equal((await req('/devices',{token:'invalid'})).status,401);
  const one = await json(await req('/codes',{token:first.token,body:{}}));
  assert.match(one.code,/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(one.expiresAt-clock,300000);
  const secondNonce=nonce();
  // 并发使用同一个码，只能签发一个设备；失败方不能借码复用凭证。
  const concurrent=await Promise.all([req('/redeem',{body:{code:one.code,nonce:secondNonce,name:'平板'}}),req('/redeem',{body:{code:one.code,nonce:nonce(),name:'冒用'}})]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const second=await concurrent.find(r=>r.status===200).json();
  const repeat=await json(await req('/redeem',{body:{code:one.code,nonce:secondNonce,name:'平板'}}));
  assert(repeat.device.id===second.device.id && repeat.token===second.token);
  let list=await json(await req('/devices',{token:first.token})); assert.equal(list.devices.length,2);
  assert(list.devices.every(d=>!('hash'in d)&&!('token'in d)&&!('requestHash'in d)));
  const expired=await json(await req('/codes',{token:first.token,body:{}}));
  clock+=300001;
  assert.equal((await req('/redeem',{body:{code:expired.code,nonce:nonce()}})).status,400);
  const abandoned=await json(await req('/codes',{token:first.token,body:{}}));
  const valid=await json(await req('/codes',{token:first.token,body:{}}));
  assert.equal((await req('/redeem',{body:{code:abandoned.code,nonce:nonce()}})).status,400);
  const secondCode=await json(await req('/codes',{token:second.token,body:{}}));
  // 已经开始但尚未落盘的上传，在撤销后也必须失败。
  let client;
  const started = new Promise(resolve => { uploadStarted = resolve; });
  const uploadResult = new Promise((resolve,reject) => {
    client=http.request(base+'/item?k=slow&base=0',{method:'PUT',headers:{Authorization:`Bearer ${second.token}`,'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    client.on('error',reject);client.write('{"text":');
  });
  await started;
  await json(await req(`/devices/${second.device.id}`,{token:first.token,method:'DELETE'}));
  client.end('"撤销前开始的上传"}');
  assert.equal(await uploadResult,401);
  assert.equal((await req('/item?k=slow',{token:first.token})).status,404);
  service=createDeviceSync(options); // 模拟服务器重启：撤销和使用记录仍有效。
  assert.equal((await req('/changes?since=0',{token:second.token})).status,401);
  assert.equal((await req('/codes',{token:second.token,body:{}})).status,401);
  assert.equal((await req('/redeem',{body:{code:secondCode.code,nonce:nonce()}})).status,400);
  assert.equal((await req('/redeem',{body:{code:one.code,nonce:secondNonce}})).status,400);
  assert.equal((await req('/migrate',{token:master,body:{nonce:nonce()}})).status,409);
  const ledger=readFileSync(join(dir,'sync-devices.json'),'utf8');
  assert(!ledger.includes(first.token) && !ledger.includes(second.token) && !ledger.includes(valid.code.replaceAll('-','')) && !ledger.includes(master));
  assert.equal(statSync(join(dir,'sync-devices.json')).mode & 0o777,0o600);
  clock+=600001;
  for(let i=0;i<10;i++) assert.equal((await req('/redeem',{body:{code:'错误绑定码',nonce:nonce()}})).status,400);
  service=createDeviceSync(options);
  assert.equal((await req('/redeem',{body:{code:'错误绑定码',nonce:nonce()}})).status,429);
  clock+=600001;
  assert.equal((await req('/redeem',{body:{code:'错误绑定码',nonce:nonce()}})).status,400);
  // 账本损坏不能回到“没有设备”，主口令恢复入口仍拒绝。
  writeFileSync(join(dir,'sync-devices.json'),'{bad'); service=createDeviceSync(options);
  assert.equal((await req('/migrate',{token:master,body:{nonce:nonce()}})).status,503);
  console.log('通过：鉴权、首次无损迁移、迁移幂等、过期/单次/并发兑换、限流持久化、设备撤销与重启、摘要存储、坏账本关闭入口');
} finally { server.close(); }

// 实际 server.mjs 的路由也要检查，防止旧主口令路由绕过撤销。
const routeDir=mkdtempSync(join(tmpdir(),'qisuo-device-route-'));
const reserve=http.createServer(); await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
const port=reserve.address().port; await new Promise(r=>reserve.close(r));
const child=spawn(process.execPath,['deploy/qisuo-server/server.mjs'],{env:{...process.env,PORT:String(port),DATA_DIR:routeDir,PROXY_TOKEN:master},stdio:'ignore'});
const host=`http://127.0.0.1:${port}`;
try {
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(host+'/health')).ok){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,30));}
  assert(ready);
  assert.equal((await fetch(host+'/.well-known/qisuo-sync')).status,200);
  assert.equal((await fetch(host+'/sync/devices')).status,401);
  const body={nonce:nonce(),name:'测试设备'};
  const migrated=await json(await fetch(host+'/sync/migrate',{method:'POST',headers:{Authorization:`Bearer ${master}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));
  assert.equal((await fetch(host+`/p/${master}/sync/changes?since=0`)).status,401);
  assert.equal((await fetch(host+'/sync/changes?since=0',{headers:{Authorization:`Bearer ${migrated.token}`}})).status,200);
  await fetch(host+'/sync/devices/'+migrated.device.id,{method:'DELETE',headers:{Authorization:`Bearer ${migrated.token}`}});
  assert.equal((await fetch(host+'/sync/changes?since=0',{headers:{Authorization:`Bearer ${migrated.token}`}})).status,401);
  assert.equal((await fetch(host+'/sync/migrate',{method:'POST',headers:{Authorization:`Bearer ${master}`,'Content-Type':'application/json'},body:JSON.stringify({nonce:nonce()})})).status,409);
  console.log('通过：实际公开路由鉴权、旧主口令同步入口关闭、撤销最后一台也不能重新引导');
} finally {child.kill();}
