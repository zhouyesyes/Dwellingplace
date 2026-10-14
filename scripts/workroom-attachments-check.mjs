// 在临时目录验证实际服务端附件处理函数，不启动 Codex，也不联网。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qisuo-check-'));
const source = fs.readFileSync('deploy/qisuo-server/codex/bridge.mjs', 'utf8');
const context = { fs, path, randomUUID, Buffer, WORK: root, DATA: path.join(root, 'data'), threads: { test: { id: 'test', project: '测试' } }, readJSON: (p, fallback) => { try { return JSON.parse(fs.readFileSync(p)); } catch { return fallback; } }, writeJSON: (p, obj) => fs.writeFileSync(p, JSON.stringify(obj)), json: (_res, code, value) => ({ code, value }) };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const FILE_MAX'), source.indexOf('async function route(')) + '\nglobalThis.upload = attachmentRoute; globalThis.lookup = fileMeta;', context);
const upload = (name, mime, data) => context.upload({ method: 'POST', headers: { 'content-type': mime }, async *[Symbol.asyncIterator]() { yield data; } }, {}, new URL('http://local/?name=' + encodeURIComponent(name)), [null, 'test']);
const ok = await upload('../测试.txt', 'text/plain', Buffer.from('hello'));
assert.equal(ok.code, 200); assert(!ok.value.name.includes('/')); assert(fs.existsSync(ok.value.path));
assert.equal(context.lookup(context.threads.test, ok.value.id).size, 5);
await assert.rejects(upload('假.png', 'image/png', Buffer.from('bad')), /内容/);
await assert.rejects(upload('图.png', 'text/plain', Buffer.from('bad')), /MIME/);
await assert.rejects(upload('危险.html', 'text/html', Buffer.from('bad')), /类型/);
await assert.rejects(upload('空.txt', 'text/plain', Buffer.alloc(0)), /空/);
await assert.rejects(upload('大.txt', 'text/plain', Buffer.alloc(20 * 1024 * 1024 + 1)), /大小/);
assert.throws(() => context.lookup({ id: 'other' }, ok.value.id), /不属于/);
assert.throws(() => context.lookup(context.threads.test, '../secret'), /编号/);
console.log('通过：文件名清理、内容签名、MIME、类型、空文件、体积限制、跨任务访问、路径穿越');
// 临时测试目录保留供复核，不触碰项目或用户数据。

context.ready = true;
context.emit = (_method, params) => { context.sent = params; };
context.call = async () => ({ turn: { id: 'turn' } });
context.saveThreads = () => {};
vm.runInContext(source.slice(source.indexOf('async function body('), source.indexOf('const projectName')) + source.slice(source.indexOf('async function route('), source.indexOf('function sse(')) + '\nglobalThis.route = route;', context);
const send = ids => context.route({ method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ text: '附件消息', attachments: ids })); } }, {}, new URL('http://local/threads/test/send'));
await assert.rejects(send(Array(5).fill(ok.value.id)), /最多 4/);
await assert.rejects(send(['../secret']), /编号/);
await send([ok.value.id]); assert.equal(context.sent.attachments[0].id, ok.value.id);
console.log('通过：服务端数量限制、发送时重新检查附件归属、消息附件关联');
