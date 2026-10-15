import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'qisuo-sync-'));
const { handleSync } = await import('../deploy/qisuo-server/sync.mjs');
const server = http.createServer((req,res)=>{const u=new URL(req.url,'http://local');handleSync(req,res,u.pathname,u.searchParams,{});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base = `http://127.0.0.1:${server.address().port}`;
const put = (rev,val) => fetch(`${base}/item?k=note&base=${rev}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(val)});
try {
  assert.equal((await put(0,'第一版')).status,200);
  const both=await Promise.all([put(1,'设备一'),put(1,'设备二')]);
  assert.deepEqual(both.map(r=>r.status).sort(),[200,409]);
  const del=await fetch(`${base}/item?k=note&base=2`,{method:'DELETE'});assert.equal(del.status,200);
  assert.equal((await put(0,'旧设备重新上传')).status,409);
  assert.equal((await put(2,'旧缓存')).status,409);
  const r=await fetch(`${base}/item?k=note`);assert.equal(r.status,404);assert.equal((await r.json()).rev,3);
  assert.equal((await put(3,'确认新版后修改')).status,200);
  console.log('通过：服务端并发写入仅一份成功、删除版本阻止旧缓存复活');
} finally { server.close(); }
