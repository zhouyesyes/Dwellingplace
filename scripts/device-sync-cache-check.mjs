// 同步鉴权响应不能经过离线页面缓存，避免撤销后回放旧 GET。
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const handlers={}, deleted=[];
const keys=['https://app.test/sync/devices','https://app.test/sync/item?k=meta','https://app.test/p/old/sync/changes','https://app.test/assets/offline.js'];
const ctx={URL,console,setTimeout,location:{origin:'https://app.test'},self:{addEventListener:(n,fn)=>handlers[n]=fn,skipWaiting(){},clients:{claim:async()=>{}}},caches:{keys:async()=>['qisuo-v1'],open:async()=>({keys:async()=>keys.map(url=>({url})),delete:async req=>deleted.push(req.url)})}};
vm.runInNewContext(fs.readFileSync('public/sw.js','utf8'),ctx);
let activation;handlers.activate({waitUntil:p=>activation=p});await activation;
assert.equal(deleted.length,3);assert(!deleted.some(url=>url.includes('/assets/')));
for(const p of ['/sync/devices','/sync/item?k=meta','/.well-known/qisuo-sync','/p/old/sync/changes']){
  let handled=false;handlers.fetch({request:{url:'https://app.test'+p,method:'GET',headers:new Headers()},respondWith:()=>{handled=true;}});assert(!handled);
}
let handled=false;handlers.fetch({request:{url:'https://app.test/any',method:'GET',headers:new Headers({authorization:'Bearer fixture'})},respondWith:()=>{handled=true;}});assert(!handled);
console.log('通过：同步及鉴权 GET 绕过 Service Worker 缓存，只移除旧同步响应缓存');
