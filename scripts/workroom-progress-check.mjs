// 离线模拟伙伴与 SSE；不调用模型、不碰真实任务或账号。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const store = { workThreads: {}, workProjects: {}, memories: [] };
const threads = {};
let dispatchedAttachments;
let model, read, attachment, dispatched = 0, failSend = false;
const thread = id => threads[id] ??= { items: [], meta: { project: '测试' } };
const context = vm.createContext({
  reactive: x => x, store, uid: () => 'mock', wr: {}, thread,
  get: async () => { if (read) return read.promise; return []; }, set: async () => {},
  say: async (id, text, files) => { dispatchedAttachments = files; dispatched++; if (failSend) throw Error('交活失败'); thread(id).turnId = 'turn'; },
  interrupt: async () => {}, pinnedOf: () => [], newMemory: () => ({}), tail: x => x,
  seeFiles: async () => attachment.promise,
  chat: { meName: () => '她', visibleText: x => x, oneShot: async () => model.promise },
});
let source = fs.readFileSync('src/lib/workTogether.js', 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export \{ wr \};/gm, '').replace(/^export /gm, '')
  .replaceAll('import("./chat.js")', 'Promise.resolve(chat)');
vm.runInContext(source + '\nglobalThis.api = { talk, report, wrapUp, phases, busy, loadTalk, workThread };', context);
const { talk, report, wrapUp, phases, busy, loadTalk, workThread } = context.api;
const role = { id: 'main', name: '他' };

// 提交后连本地读取和附件处理阶段都有反馈；没有半截原始模型内容进入对话。
read = deferred(); attachment = deferred(); model = deferred();
const inputAttachment = { id:'test-image',name:'测试.png',type:'image/png',path:'/work/原图.png',purpose:'调色' };
let pending = talk(role, 'a', '做一件事', [inputAttachment], [{}]);
assert.equal(phases.a, 'preparing'); assert.equal(busy.a, true);
read.resolve([]); read = null; await tick();
assert.equal(phases.a, 'preparing');
attachment.resolve({ parts: [], seen: [] }); await tick();
assert.equal((await loadTalk('a')).length, 1); assert.equal(dispatched, 0);
model.resolve('可以。<交给Codex>内部交活说明</交给Codex>'); await pending;
assert.equal(dispatched, 1); assert.equal(thread('a').turnId, 'turn');
assert.equal(dispatchedAttachments[0].id,inputAttachment.id);
assert.equal(dispatchedAttachments[0].purpose,'调色');
assert.equal(phases.a, undefined); assert.equal(busy.a, undefined);
assert.equal((await loadTalk('a')).at(-1).text, '可以。');
assert(!JSON.stringify(await loadTalk('a')).includes('内部交活说明'));

// 验收的真实调用设置检查阶段；完成或错误都清掉瞬态状态。
thread('a').turnId = null; model = deferred();
pending = report(role, 'a'); assert.equal(phases.a, 'checking');
model.resolve('检查完成。'); await pending; assert.equal(phases.a, undefined);
model = deferred(); pending = talk(role, 'b', '只商量');
model.resolve('先商量。'); await pending; assert.equal(dispatched, 1); assert.equal(phases.b, undefined);
model = deferred(); pending = talk(role, 'c', '失败'); await tick();
model.reject(Error('模型失败')); await assert.rejects(pending, /模型失败/);
assert.equal(phases.c, undefined); assert.equal(busy.c, undefined);
read = deferred(); pending = talk(role, 'd', '读取失败');
read.reject(Error('读取失败')); await assert.rejects(pending, /读取失败/); read = null;
assert.equal(phases.d, undefined); assert.equal(busy.d, undefined);
attachment = deferred(); pending = talk(role, 'e', '附件失败', [], [{}]); await tick();
attachment.reject(Error('附件失败')); await assert.rejects(pending, /附件失败/);
assert.equal(phases.e, undefined); assert.equal(busy.e, undefined);
failSend = true; model = deferred(); pending = talk(role, 'f', '交活失败');
model.resolve('<交给Codex>内部说明</交给Codex>'); await pending;
assert((await loadTalk('f')).at(-1).notes.some(x => x.includes('没交成')));
assert.equal(phases.f, undefined); assert.equal(workThread('f').awaiting, false);

// 自动续交仍沿用原链数；收工不会冒充验收或执行。
failSend = false; workThread('a').awaiting = true; model = deferred();
pending = report(role, 'a'); assert.equal(phases.a, 'checking');
model.resolve('<交给Codex>继续下一步</交给Codex>'); await pending;
assert.equal(workThread('a').chain, 2); assert.equal(phases.a, undefined);
model = deferred(); pending = wrapUp(role, 'a'); assert.equal(phases.a, 'wrapping');
model.resolve('收工了。'); await pending; assert.equal(phases.a, undefined);

// 不靠真实计时：首条立即应用，后续高频增量只挂一个 50ms 定时器。
const events = [], timers = new Map(); let timerId = 0;
const batch = vm.createContext({ apply: ev => events.push(ev), ITEM_KIND: { commandExecution: 'command', agentMessage: 'agent', reasoning: 'reasoning' },
  setTimeout: (fn, ms) => { assert.equal(ms, 50); timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) });
source = fs.readFileSync('src/lib/workroom.js', 'utf8');
vm.runInContext(source.slice(source.indexOf('let pendingEvents'), source.indexOf('let es =')) + '\nglobalThis.queue = queueEvent; globalThis.flush = flushEvents;', batch);
const ev = (method, id = 'a', params = {}) => ({ method, params: { threadId: id, ...params } });
batch.queue(ev('turn/started')); assert.equal(events.length, 1);
batch.queue(ev('thread/tokenUsage/updated')); assert.equal(timers.size, 1);
batch.queue(ev('item/started', 'a', { item: { type: 'agentMessage', text: '' } }));
assert.equal(events.length, 1); // 空消息壳不能抢走首字的立即更新机会
batch.queue(ev('item/agentMessage/delta', 'a', { delta: '首字' }));
assert.equal(events.length, 4); assert.equal(timers.size, 0);
for (let i = 0; i < 100; i++) batch.queue(ev('item/agentMessage/delta', 'a', { delta: '字' }));
assert.equal(events.length, 4); assert.equal(timers.size, 1);
batch.queue(ev('qisuo/approval/pending')); assert.equal(events.length, 105); assert.equal(timers.size, 0);
batch.queue(ev('item/agentMessage/delta', 'a', { delta: '尾字' }));
batch.queue(ev('turn/completed')); assert.equal(events.at(-2).params.delta, '尾字'); assert.equal(timers.size, 0);
batch.queue(ev('turn/started')); batch.queue(ev('item/started', 'a', { item: { type: 'commandExecution' } }));
assert.equal(events.at(-1).params.item.type, 'commandExecution');
batch.queue(ev('item/agentMessage/delta', 'b', { delta: '另一任务首字' })); assert.equal(timers.size, 0);
batch.queue(ev('item/agentMessage/delta', 'a', { delta: '后续' }));
[...timers.values()][0](); assert.equal(events.at(-1).params.delta, '后续');
console.log('通过：整理/验收真实阶段、完整回复过滤、无交活/模型/读取/附件/交活失败清理，SSE 首条立即/后续合批/跨任务/完成与审批顺序');

// 整合远端后仍保留重启状态纠正：历史开始事件不能使已停止的线程复活。
const lifecycle = vm.createContext({ reactive: x => x, store: { settings: {} },
  setTimeout, clearTimeout, serverBase: async () => 'http://mock',
  fetch: async () => ({ ok: true, json: async () => ({ thread: { id: 'old' }, approvals: [], events: [
    { method: 'turn/started', params: { threadId: 'old', turn: { id: 'stale' } } }
  ] }) }) });
vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, '') + '\nglobalThis.testApi = { apply, loadThread, thread, wr };', lifecycle);
await lifecycle.testApi.loadThread('old'); assert.equal(lifecycle.testApi.thread('old').turnId, null);
lifecycle.testApi.apply(ev('turn/started', 'old', { turn: { id: 'live' } }));
lifecycle.testApi.apply(ev('qisuo/approval/pending', 'old', { key: 'ask' }));
lifecycle.testApi.apply({ method: 'qisuo/approval/cleared', params: { key: 'ask' } });
assert.equal(lifecycle.testApi.thread('old').byId['ap:ask'].state, 'answered');
lifecycle.testApi.apply({ method: 'qisuo/codex/exited', params: {} });
assert.equal(lifecycle.testApi.thread('old').turnId, null);
console.log('通过：保留远端的历史执行状态纠正、重启清理和失效审批清理');

// 同一轮多次截图回传合并、去重，下一轮保留独立产物组。
const output = (ids) => lifecycle.testApi.apply(ev('qisuo/preview/ready','outputs',{attachments:ids.map(id=>({id,name:id+'.png'}))}));
output(['one','two']); output(['two','three']);
assert.equal(lifecycle.testApi.thread('outputs').items.length,1);
assert.equal(lifecycle.testApi.thread('outputs').items[0].attachments.length,3);
lifecycle.testApi.apply(ev('turn/completed','outputs',{turn:{id:'first'}}));
output(['four']);
assert.equal(lifecycle.testApi.thread('outputs').items.filter(i=>i.kind==='preview').length,2);
console.log('通过：同轮多次截图合组/去重，跨轮产物独立保留');
