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
await assert.rejects(upload('危险.exe', 'application/octet-stream', Buffer.from('MZbad')), /类型/);
await assert.rejects(upload('危险.sh', 'text/plain', Buffer.from('#!/bin/sh')), /类型/);
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
    assert.equal(headers['Content-Type'],'image/png'); assert.equal(headers['Content-Length'],png.length);
    if(endpoint.includes('/projects/')) assert(headers['Content-Disposition'].includes(encodeURIComponent('统一调色.png')));
    assert(headers['Content-Disposition'].startsWith(download?'attachment':'inline'));
  }
}
const sourceFile = attached.value.path;
const renamed = sourceFile+'.saved';
fs.renameSync(sourceFile,renamed); fs.symlinkSync(renamed,sourceFile);
assert.throws(()=>context.lookup(context.threads.test,attached.value.id),/不安全/);
fs.unlinkSync(sourceFile); fs.renameSync(renamed,sourceFile);
console.log('通过：PNG 原件读取、用途/路径/localImage、运行中 steer 及确认、失败保留待通知、同名隔离、收件箱上传/引用、路径派单标记使用、重命名/归档硬链接、跨项目拒绝、预览/下载字节一致、符号链接拒绝');

// 最终验收：复制出来的相对路径由当前 Codex uid 的独立进程从项目 cwd 读取。
const { spawnSync } = await import('node:child_process');
for (const relative of [inbox.value.projectPath, archived.value.libraryProjectPath]) {
  const reader = spawnSync(process.execPath, ['-e','process.stdout.write(require("node:fs").readFileSync(process.argv[1]))',relative], { cwd:path.join(root,'测试') });
  assert.equal(reader.status,0); assert.deepEqual(reader.stdout,png);
}
console.log(`通过：实际 uid ${process.getuid()} 从项目 cwd 读取收件箱/素材库相对路径（未模拟文件读取权限；仅 bridge 的 root 所有权查询为替身）`);

// 慢请求先等待 body，与归档/任务使用交错，不能覆盖新状态和引用。
let releaseBody;
const gate = new Promise(resolve => releaseBody=resolve);
const slowRename = context.route({method:'POST',async *[Symbol.asyncIterator]() { await gate; yield Buffer.from(JSON.stringify({name:'并发重命名.png'})); }},{},new URL(`http://local/projects/测试/materials/${saved.value.id}/rename`));
await Promise.resolve();
const during = await request('POST',`/projects/测试/materials/${saved.value.id}/archive`,{});
context.call = async () => ({turnId:'active',turn:{id:'active'}});
await request('POST','/threads/test/send',{text:`读取 ${saved.value.projectPath}`,attachments:[]});
releaseBody(); await slowRename;
const getMaterial = async id => (await request('GET','/projects/测试/materials')).value.materials.find(a=>a.id===id);
let current = await getMaterial(saved.value.id);
assert.equal(current.status,'archived'); assert.equal(current.libraryPath,during.value.libraryPath);
assert(current.usedTasks.includes('test'));

// 仅挂接、通知失败也登记引用；失败后重试同一附件，字节与 inode 保持不变。
context.threads.reference = {id:'reference',project:'测试',turnId:'reference-turn'};
const reference = await request('POST',`/projects/测试/materials/${saved.value.id}/attach`,{taskId:'reference',purpose:'失败重试验收'});
current = await getMaterial(saved.value.id);
assert(current.tasks.includes('reference')); assert(!current.usedTasks.includes('reference'));
const beforeRetry = fs.statSync(reference.value.path);
const eventsBefore = context.sent;
context.call = async () => {throw Error('明确的通知拒绝');};
await assert.rejects(request('POST','/threads/reference/send',{text:'追加',attachments:[reference.value.id]}),/通知拒绝/);
assert.equal(context.lookup(context.threads.reference,reference.value.id).notification,'pending');
assert.equal(context.sent,eventsBefore);
context.call = async (method,params) => { rpc={method,params}; return {turnId:'reference-turn',turn:{id:'reference-turn'}}; };
await request('POST','/threads/reference/send',{text:'重试追加',attachments:[reference.value.id]});
assert.equal(rpc.method,'turn/steer');
assert.equal(context.lookup(context.threads.reference,reference.value.id).notification,'delivered');
assert.equal(fs.statSync(reference.value.path).ino,beforeRetry.ino);
assert((await getMaterial(saved.value.id)).usedTasks.includes('reference'));
assert(rpc.params.input[0].text.includes(reference.value.name));
assert(rpc.params.input[0].text.includes(reference.value.type));
assert(rpc.params.input[0].text.includes(`${reference.value.size} 字节`));
assert(rpc.params.input[0].text.includes('失败重试验收'));

// 挂接状态不能误报使用；任务结束/归档不删除路径或元数据，重新读取仍可恢复。
const pending = await request('POST','/projects/测试/materials?name=未通知.png',png,'image/png');
await request('POST',`/projects/测试/materials/${pending.value.id}/attach`,{taskId:'reference'});
assert.equal((await getMaterial(pending.value.id)).status,'pending');
assert((await getMaterial(pending.value.id)).tasks.includes('reference'));
await request('POST','/threads/reference/archive',{});
for (const a of (await request('GET','/threads/reference/attachments')).value.attachments) assert.deepEqual(fs.readFileSync(a.path),png);
assert.deepEqual(fs.readFileSync(current.path),png);
assert.deepEqual(fs.readFileSync(during.value.libraryPath),png);

// 文件系统链接成功而元数据写入失败，重试不覆盖、不丢原件且可恢复。
const write = context.writeJSON;
const recovery = await request('POST','/threads/test/attachments?name=恢复.png',png,'image/png');
let failMetadata = true;
context.writeJSON = (file,value) => { if(failMetadata && file.includes('/materials/')) { failMetadata=false; throw Error('模拟元数据写入失败'); } return write(file,value); };
await assert.rejects(request('POST',`/threads/test/attachments/${recovery.value.id}/material`,{}),/元数据写入失败/);
const recovered = await request('POST',`/threads/test/attachments/${recovery.value.id}/material`,{});
assert.equal(fs.statSync(recovered.value.path).ino,fs.statSync(recovery.value.path).ino);
failMetadata = true;
await assert.rejects(request('POST',`/projects/测试/materials/${recovery.value.id}/archive`,{}),/元数据写入失败/);
const recoveredArchive = await request('POST',`/projects/测试/materials/${recovery.value.id}/archive`,{});
context.writeJSON = write;
assert.equal(fs.statSync(recoveredArchive.value.libraryPath).ino,fs.statSync(recovery.value.path).ino);
// 不同的目标文件不能作为成功链接吞掉。
const wrongTarget = path.join(path.dirname(recovered.value.path),'不同原件.png');
fs.writeFileSync(wrongTarget,Buffer.from('无敏感信息的冲突文件'));
assert.throws(()=>context.linkOriginal(recovery.value.path,wrongTarget),/不是同一原件/);
assert.equal(fs.readFileSync(wrongTarget,'utf8'),'无敏感信息的冲突文件');

// 路径穿越/跨归属被 API 拒绝；目录符号链接不能借另一任务/项目或外部文件越权。
await assert.rejects(request('GET','/projects/%2e%2e%2f其他项目/materials'),/没有这个项目/);
assert.equal((await request('GET','/threads/%2e%2e%2fother/attachments')).code,405);
assert.throws(()=>context.openOriginal(path.join(root,'outside.png')),/不安全/);
const parent = path.dirname(recovery.value.path), moved = parent+'.held';
const otherTask = path.dirname(attached.value.path);
const outside = path.join(root,'外部测试目录'); fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside,path.basename(recovery.value.path)),Buffer.from('外部假数据，不是用户素材'));
for (const target of [otherTask,path.dirname(inbox.value.path),outside]) {
  fs.renameSync(parent,moved); fs.symlinkSync(target,parent);
  try { assert.throws(()=>context.lookup(context.threads.test,recovery.value.id),/不安全/); }
  finally { fs.unlinkSync(parent); fs.renameSync(moved,parent); }
}
// 目录在打开后被替换时，真正读取使用固定 fd，不能跟随新目录。
const originalOpen = fixtureFs.openSync;
let swapped = false;
context.fs = new Proxy(fixtureFs,{get(target,key) {
  if(key==='openSync') return (file,flags,...args) => {
    const fd = originalOpen(file,flags,...args);
    if (!swapped && String(file).endsWith('/'+recovery.value.id) && (flags & fs.constants.O_DIRECTORY)) {
      swapped=true; fs.renameSync(parent,moved); fs.symlinkSync(outside,parent);
    }
    return fd;
  };
  return target[key];
}});
let fixed;
try {
  fixed=context.openOriginal(recovery.value.path);
  assert(swapped); assert.deepEqual(fs.readFileSync(fixed),png);
  assert.throws(()=>context.openOriginal(recovery.value.path),/不安全/);
} finally { if(fixed!==undefined) fs.closeSync(fixed); context.fs=fixtureFs; if(swapped){fs.unlinkSync(parent);fs.renameSync(moved,parent);} }

// 只在隔离副本模拟未来清理：保留其他硬链接能保住字节，但删除仍被元数据引用的路径会悬空。
const cleanRoom = path.join(root,'清理演示'); fs.mkdirSync(cleanRoom);
const originalCopy = path.join(cleanRoom,'原件.png'), retained = path.join(cleanRoom,'仍被引用.png');
fs.copyFileSync(recovery.value.path,originalCopy); fs.linkSync(originalCopy,retained);
fs.unlinkSync(originalCopy); assert.deepEqual(fs.readFileSync(retained),png);
assert(!fs.existsSync(originalCopy)); // 硬链接不是路径重定向，文档必须禁止删除仍登记的任何路径。
console.log('通过：并发归档/重命名保留引用、挂接未通知引用、明确拒绝与重试/状态、任务归档保留、链接中断恢复、不覆盖冲突、相对路径、穿越/目录符号链接/打开后目录替换、隔离清理语义');

// 精确大小边界和生产所有权/权限拒绝分支；仍只操作本脚本的临时目录。
const atLimit = await request('POST','/threads/test/attachments?name=边界.txt',Buffer.alloc(20*1024*1024,120),'text/plain');
assert.equal(atLimit.value.size,20*1024*1024);
context.fs=fs;
try { assert.throws(()=>context.openOriginal(recovery.value.path),/不安全/); } finally { context.fs=fixtureFs; }
fs.chmodSync(parent,0o777);
try { assert.throws(()=>context.openOriginal(recovery.value.path),/不安全/); } finally { fs.chmodSync(parent,0o755); }
console.log('通过：恰好 20 MiB 接受、超过限制拒绝、可执行扩展名拒绝、非 root/可组写目录拒绝');

// 已在途的旧通知不能覆盖后来挂接的新用途；新通知失败仍保持新版本待通知。
let releaseNotice;
const noticeGate = new Promise(resolve => releaseNotice=resolve);
context.call = async () => { await noticeGate; return {turnId:'active',turn:{id:'active'}}; };
await request('POST',`/projects/测试/materials/${saved.value.id}/attach`,{taskId:'test',purpose:'旧用途'});
const oldNotice = request('POST','/threads/test/send',{text:'旧通知',attachments:[saved.value.id]});
for(let i=0;i<10;i++) await Promise.resolve();
await request('POST',`/projects/测试/materials/${saved.value.id}/attach`,{taskId:'test',purpose:'新用途未通知'});
releaseNotice(); await oldNotice;
let latest=context.lookup(context.threads.test,saved.value.id);
assert.equal(latest.notification,'pending'); assert.equal(latest.purpose,'新用途未通知');
context.call = async () => {throw Error('新通知被拒绝');};
await assert.rejects(request('POST','/threads/test/send',{text:'新通知',attachments:[saved.value.id]}),/新通知被拒绝/);
latest=context.lookup(context.threads.test,saved.value.id);
assert.equal(latest.notification,'pending'); assert.equal(latest.purpose,'新用途未通知');
context.call = async () => ({turnId:'active',turn:{id:'active'}});
await request('POST','/threads/test/send',{text:'重试新通知',attachments:[saved.value.id]});
assert.equal(context.lookup(context.threads.test,saved.value.id).notification,'delivered');
assert.equal(context.lookup(context.threads.test,saved.value.id).purpose,'新用途未通知');
console.log('通过：旧通知晚返回不能覆盖新用途/待通知状态，新版本失败后可准确重试');
// 删除仅修改当前项目的收件箱可见性，历史任务与归档原件不受影响。
const deletion = await request('POST','/projects/测试/materials?name=删除验收.png',png,'image/png');
const deletionId=deletion.value.id;
await assert.rejects(request('POST',`/projects/其他项目/materials/${deletionId}/delete`,{}),/不属于/);
await request('POST',`/projects/测试/materials/${deletionId}/attach`,{taskId:'test'});
await request('POST',`/projects/测试/materials/${deletionId}/archive`,{});
const beforeDelete=context.materialMeta('测试',deletionId);
await request('POST',`/projects/测试/materials/${deletionId}/delete`,{});
await request('POST',`/projects/测试/materials/${deletionId}/delete`,{});
assert(!(await request('GET','/projects/测试/materials')).value.materials.some(a=>a.id===deletionId));
assert.deepEqual(fs.readFileSync(beforeDelete.path),png);
assert.deepEqual(fs.readFileSync(beforeDelete.libraryPath),png);
assert.equal(context.lookup(context.threads.test,deletionId).id,deletionId);
await assert.rejects(request('POST',`/projects/测试/materials/${deletionId}/attach`,{taskId:'test'}),/已从收件箱删除/);
console.log('通过：收件箱删除幂等、项目隔离、列表移除、原件/素材库/历史任务附件保留');

await request('POST',`/threads/test/attachments/${deletionId}/material`,{});
assert((await request('GET','/projects/测试/materials')).value.materials.some(a=>a.id===deletionId));
console.log('通过：主动重新保存任务附件可恢复收件箱入口，沿用原件与 ID');
