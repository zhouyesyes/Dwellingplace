// 在临时目录验证实际服务端附件处理函数，不启动 Codex，也不联网。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qisuo-check-'));
fs.mkdirSync(path.join(root, '.qisuo-attachments'));
const source = fs.readFileSync('deploy/qisuo-server/codex/bridge.mjs', 'utf8');
// 测试进程不是 root，仅将临时附件根目录的所有权查询模拟为安装后的状态。
const fixtureFs = new Proxy(fs, { get(target, key) {
  if (key === 'statSync' || key === 'lstatSync') return file => { const st = fs[key](file); if (file.startsWith(path.join(root,'.qisuo-attachments'))) st.uid = 0; return st; };
  if (key === 'fstatSync') return fd => { const st = fs.fstatSync(fd); if (fs.readlinkSync('/proc/self/fd/'+fd).startsWith(path.join(root,'.qisuo-attachments'))) st.uid=0; return st; };
  return target[key];
} });
const context = { fs: fixtureFs, path, randomUUID, Buffer, WORK: root, DATA: path.join(root, 'data'), threads: { test: { id: 'test', project: '测试' } }, readJSON: (p, fallback) => { try { return JSON.parse(fs.readFileSync(p)); } catch { return fallback; } }, writeJSON: (p, obj) => fs.writeFileSync(p, JSON.stringify(obj)), json: (_res, code, value) => ({ code, value }) };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const FILE_MAX'), source.indexOf('async function route(')) + '\nglobalThis.upload = attachmentRoute; globalThis.lookup = fileMeta;', context);
const upload = (name, mime, data) => context.upload({ method: 'POST', headers: { 'content-type': mime }, async *[Symbol.asyncIterator]() { yield data; } }, {}, new URL('http://local/?name=' + encodeURIComponent(name)), [null, 'test']);
const ok = await upload('../测试.txt', 'text/plain', Buffer.from('hello'));
assert.equal(ok.code, 200); assert(!ok.value.name.includes('/')); assert(fs.existsSync(ok.value.path));
assert.equal(context.lookup(context.threads.test, ok.value.id).size, 5);
await assert.rejects(upload('假.png', 'image/png', Buffer.from('bad')), /内容/);
await assert.rejects(upload('图.png', 'text/plain', Buffer.from('bad')), /MIME/);
await assert.rejects(upload('危险.constructor', 'application/octet-stream', Buffer.from('bad')), /类型/);
await assert.rejects(upload('危险.__proto__', 'application/octet-stream', Buffer.from('bad')), /类型/);
await assert.rejects(upload('危险.html', 'text/html', Buffer.from('bad')), /类型/);
await assert.rejects(upload('空.txt', 'text/plain', Buffer.alloc(0)), /空/);
await assert.rejects(upload('大.txt', 'text/plain', Buffer.alloc(20 * 1024 * 1024 + 1)), /大小/);
assert.throws(() => context.lookup({ id: 'other' }, ok.value.id), /不属于/);
assert.throws(() => context.lookup(context.threads.test, '../secret'), /编号/);
console.log('通过：文件名清理、内容签名、MIME、类型、空文件、体积限制、跨任务访问、路径穿越');
// 临时测试目录保留供复核，不触碰项目或用户数据。

context.ready = true;
vm.runInContext(source.slice(source.indexOf('const projectName'), source.indexOf('const pendingList')), context);
context.cid = t => t.codex || t.id;
context.NOT_FOUND = /thread not found/i;
context.withThread = async (t, run) => run(t.id);
context.emit = (_method, params) => { context.sent = params; };
context.call = async () => ({ turn: { id: 'turn' } });
context.saveThreads = () => {};
vm.runInContext(source.slice(source.indexOf('async function body('), source.indexOf('const projectName')) + source.slice(source.indexOf('async function route('), source.indexOf('function sse(')) + '\nglobalThis.route = route;', context);
const send = ids => context.route({ method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ text: '附件消息', attachments: ids })); } }, {}, new URL('http://local/threads/test/send'));
await assert.rejects(send(Array(5).fill(ok.value.id)), /最多 4/);
await assert.rejects(send(['../secret']), /编号/);
await send([ok.value.id]); assert.equal(context.sent.attachments[0].id, ok.value.id);
console.log('通过：服务端数量限制、发送时重新检查附件归属、消息附件关联');

// 双通道验收：使用无敏感信息的 1×1 PNG，真实落盘/硬链接；仅替换 Codex RPC。
fs.mkdirSync(path.join(root,'测试'));
fs.mkdirSync(path.join(root,'其他项目'));
context.json = (res, code, value) => { res.end?.(JSON.stringify(value)); return {code,value}; };
const request = (method, url, value, type = 'application/json') => context.route({ method, headers:{'content-type':type}, async *[Symbol.asyncIterator]() { if(value) yield Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)); } }, {}, new URL('http://local' + url));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const attached = await request('POST','/threads/test/attachments?name=测试原图.png&purpose=统一调色',png,'image/png');
assert.equal(attached.value.purpose,'统一调色');
assert(attached.value.path.includes('/tasks/test/'));
assert.deepEqual(fs.readFileSync(attached.value.path),png);
let rpc;
context.call = async (method, params) => { rpc = {method,params}; return {turnId:'active',turn:{id:'active'}}; };
context.threads.test.turnId = 'active';
await request('POST','/threads/test/send',{text:'运行中追加',attachments:[attached.value.id]});
assert.equal(rpc.method,'turn/steer');
assert.equal(rpc.params.expectedTurnId,'active');
assert(rpc.params.input[0].text.includes(attached.value.path));
assert(rpc.params.input[0].text.includes('统一调色'));
assert(rpc.params.input.some(i => i.type === 'localImage' && i.path === attached.value.path));
assert.equal(context.lookup(context.threads.test,attached.value.id).notification,'delivered');
const saved = await request('POST',`/threads/test/attachments/${attached.value.id}/material`,{});
assert.equal(fs.statSync(saved.value.path).ino, fs.statSync(attached.value.path).ino);
const again = await request('POST',`/threads/test/attachments/${attached.value.id}/material`,{});
assert.equal(again.value.path,saved.value.path);
const inbox = await request('POST','/projects/测试/materials?name=测试原图.png&purpose=贴纸原件',png,'image/png');
assert.deepEqual(fs.readFileSync(inbox.value.path),png);
assert.notEqual(inbox.value.path,saved.value.path);
const materialId = inbox.value.id;
await request('POST','/threads/test/send',{text:`请读取 ${inbox.value.path}`,attachments:[]});
let materials = (await request('GET','/projects/测试/materials')).value.materials;
assert.equal(materials.find(m=>m.id===materialId).status,'used');
assert(materials.find(m=>m.id===materialId).tasks.includes('test'));
await request('POST',`/projects/测试/materials/${materialId}/rename`,{name:'统一调色.png'});
await assert.rejects(request('POST',`/projects/测试/materials/${materialId}/rename`,{name:'../../危险.png'}),/名称/);
await assert.rejects(request('POST',`/projects/测试/materials/${materialId}/rename`,{name:'危险.sh'}),/名称/);
const archived = await request('POST',`/projects/测试/materials/${materialId}/archive`,{});
assert.equal(archived.value.status,'archived');
assert.deepEqual(fs.readFileSync(inbox.value.path),png);
assert.deepEqual(fs.readFileSync(archived.value.libraryPath),png);
assert.equal(fs.statSync(inbox.value.path).ino,fs.statSync(archived.value.libraryPath).ino);
await request('POST',`/projects/测试/materials/${materialId}/archive`,{});
const linked = await request('POST',`/projects/测试/materials/${materialId}/attach`,{taskId:'test'});
assert.equal(linked.value.path,inbox.value.path);
await assert.rejects(request('GET',`/projects/其他项目/materials/${materialId}`),/不属于/);
context.threads.other = {id:'other',project:'其他项目'};
await assert.rejects(request('POST',`/projects/测试/materials/${materialId}/attach`,{taskId:'other'}),/同项目/);
context.call = async () => { throw new Error('模拟通知失败'); };
await assert.rejects(request('POST','/threads/test/send',{text:'追加',attachments:[linked.value.id]}),/模拟通知失败/);
assert.equal(context.lookup(context.threads.test,linked.value.id).notification,'pending');
// 预览和下载使用真实读取流，检查响应头及字节。
const { PassThrough } = await import('node:stream');
for (const endpoint of [`/threads/test/attachments/${attached.value.id}`,`/projects/测试/materials/${materialId}`]) {
  for (const download of [false,true]) {
    const res = new PassThrough(); let headers; const chunks=[];
    res.writeHead = (_status,h) => {headers=h;};
    res.on('data',c=>chunks.push(c));
    const done = new Promise((resolve,reject)=>{res.on('end',resolve);res.on('error',reject);});
    await context.route({method:'GET'},res,new URL('http://local'+endpoint+(download?'?download=1':'')));
    await done;
    assert.deepEqual(Buffer.concat(chunks),png);
    assert.equal(headers['X-Content-Type-Options'],'nosniff');
    assert(headers['Content-Disposition'].startsWith(download?'attachment':'inline'));
  }
}
const sourceFile = attached.value.path;
const renamed = sourceFile+'.saved';
fs.renameSync(sourceFile,renamed); fs.symlinkSync(renamed,sourceFile);
assert.throws(()=>context.lookup(context.threads.test,attached.value.id),/不安全/);
fs.unlinkSync(sourceFile); fs.renameSync(renamed,sourceFile);
console.log('通过：PNG 原件读取、用途/路径/localImage、运行中 steer 及确认、失败保留待通知、同名隔离、收件箱上传/引用、路径派单标记使用、重命名/归档硬链接、跨项目拒绝、预览/下载字节一致、符号链接拒绝');
