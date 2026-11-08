// 不连真实服务：用内存 KV 跑新建聊天、同步、Cron 和执行中换窗的回归。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { reactive, watch, nextTick } from 'vue';

const store = reactive({ roles: [{ id: 'main', wake: { enabled: false }, lastThreadId: 'old' }], threads: [] });
const storeSource = fs.readFileSync('src/store/index.js', 'utf8');
const local = vm.createContext({ store, messageCache: {}, uid: (() => { let n = 0; return () => `t${++n}`; })() });
vm.runInContext(storeSource.slice(storeSource.indexOf('export const latestThreadOf'), storeSource.indexOf('// 小螃蟹的工作室：')).replace('export ', '') + '\nglobalThis.latestThreadOf = latestThreadOf;', local);
vm.runInContext(storeSource.slice(storeSource.indexOf('export function createThread'), storeSource.indexOf('export async function deleteThread')).replace('export ', ''), local);
const old = local.createThread('main'); old.createdAt = 1; old.updatedAt = 9999;
const newest = local.createThread('main'); newest.createdAt = 2;
store.roles[0].lastThreadId = old.id;
for (const flag of ['mail', 'studio']) { const t = local.createThread('main'); t[flag] = true; t.createdAt = 3; }
local.createThread('crab').createdAt = 4;
assert.equal(local.latestThreadOf('main').id, newest.id);
assert.equal(store.roles[0].wake.enabled, false, '新建聊天不能重开唤醒');

const wakeSource = fs.readFileSync('src/lib/wake.js', 'utf8');
// 用真实收件目的地表达式确认旧 ID 不再被采用，信箱仍独立。
const targetCode = wakeSource.slice(wakeSource.indexOf('  const thread = store.threads.find(t => t.id === item.threadId'), wakeSource.indexOf('  const all = await loadMessages(thread.id);', wakeSource.indexOf('  const thread = store.threads.find(t => t.id === item.threadId')));
Object.assign(local, { role: store.roles[0], item: { threadId: old.id }, threadFor: r => local.latestThreadOf(r.id) });
assert.equal(vm.runInContext(`{ ${targetCode} thread.id; }`, local), newest.id);
local.item.threadId = store.threads.find(t => t.mail).id;
assert.equal(vm.runInContext(`{ ${targetCode} thread.id; }`, local), local.item.threadId);

// 关闭的角色也发送状态，不依赖 wake.synced；打包中换窗时丢弃旧包。
const sent = [];
Object.assign(local, { location: { href: 'https://example.invalid/' }, relayReady: () => true,
  wakeStatus: { syncing: false }, searchEnabled: () => false,
  clearTimeout, setTimeout, scheduleSync: () => {},
  relayCall: async (path, snap) => sent.push(JSON.parse(JSON.stringify(snap))) });
store.tools = { relay: { url: 'https://relay.invalid/' } }; store.wake = { synced: false };
vm.runInContext(wakeSource.slice(wakeSource.indexOf('const wakeControl ='), wakeSource.indexOf('// 唤醒页上叫的名字：')), local);
vm.runInContext(wakeSource.slice(wakeSource.indexOf('export async function syncNow'), wakeSource.indexOf('export function scheduleSync')).replace('export ', ''), local);
await local.syncNow();
assert.equal(sent.length, 1); assert.equal(sent[0].roles[0].wake.enabled, false);
assert.equal(sent[0].roles[0].mainThreadId, newest.id);
store.roles[0].wake.enabled = true;
local.snapshotRole = async r => { local.createThread(r.id).createdAt = 10; return { id: r.id, wake: r.wake }; };
await local.syncNow(); assert.equal(sent.length, 1, '打包中建新聊天不能发送旧包');

// Vue 的普通深度监听不能把关开关/换窗的立即同步又推迟 30 秒。
const scheduled = [], stops = [];
Object.assign(local, { watch: (...args) => { const stop = watch(...args); stops.push(stop); return stop; },
  document: { addEventListener() {}, visibilityState: 'visible' }, navigator: {}, setInterval() {},
  checkInbox() {}, scheduleSync: ms => scheduled.push(ms) });
vm.runInContext(wakeSource.slice(wakeSource.indexOf('export function startWake')).replace('export ', ''), local);
local.startWake({});
store.roles[0].wake.enabled = false;
await nextTick(); assert.equal(scheduled.at(-1), 0);
for (const stop of stops) stop();

const data = new Map();
const env = { KV: {
  async get(k, type) { const v = data.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
  async put(k, v) { data.set(k, v); }, async delete(k) { data.delete(k); },
  async list({ prefix }) { return { keys: [...data.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
} };
const ctx = vm.createContext({ Response, Request, URL, crypto: globalThis.crypto, console, setTimeout, clearTimeout });
vm.runInContext(fs.readFileSync('relay/worker.js', 'utf8').replace('export default {', 'const worker = {'), ctx);
let modelCalls = 0;
ctx.callModel = async () => { modelCalls++; return { text: modelCalls === 1 ? '[去:1]' : '醒来看看', usage: { input: 1, output: 1 } }; };
ctx.pushAll = async () => ({ ok: true });
const role = { id: 'main', name: '测试角色', mainThreadId: 'new', threadId: 'new', wake: { enabled: true, intervalOn: false, freeTimes: ['17:00'] }, rooms: [{ key: 'chat', kind: 'thread', label: '主聊天' }] };
const cfg = { v: 2, roles: [role] };
const now = Date.parse('2026-11-08T09:00:00Z');
const sync = async body => ctx.wakeRoute('/wake/sync', new Request('https://relay.invalid/wake/sync', { method: 'POST', body: JSON.stringify(body) }), env);
await sync(cfg);
await ctx.tick(env, now);
let items = await ctx.pendingBox(env);
assert.equal(items.length, 1); assert.equal(items[0].threadId, 'new'); assert.equal(modelCalls, 2);
await ctx.tick(env, now + 60_000); assert.equal(modelCalls, 2, '同日同点不能重复响');

const stale = structuredClone(role); stale.mainThreadId = stale.threadId = 'old';
for (const entry of ['runWake', 'runFree', 'runEvent']) {
  await assert.rejects(ctx[entry](env, cfg, stale, [{ kind: 'free', text: '残留任务' }]), e => e.wakeCancelled);
}
await assert.rejects(ctx.deliverSay(env, cfg, stale, [{ say: '旧提醒' }]), e => e.wakeCancelled);
await assert.rejects(ctx.boxAdd(env, { id: 'stale', ts: now }, stale), e => e.wakeCancelled);
assert.equal(modelCalls, 2, '旧目标在调用模型之前跳过');

// 模型请求中换窗/关闭，返回后也不发消息、不推送、不安排错误重试。
ctx.callModel = async () => { modelCalls++; await sync({ v: 2, roles: [{ ...role, mainThreadId: 'newer', threadId: 'newer' }] }); return { text: '迟到的旧窗消息', usage: { input: 1, output: 1 } }; };
await assert.rejects(ctx.runWake(env, cfg, role, [{ kind: 'test', text: '测试' }]), e => e.wakeCancelled);
assert.equal((await ctx.pendingBox(env)).length, 1);
await env.KV.put('sched:main', JSON.stringify({ retry: { at: now, reasons: [{ kind: 'time', text: '重试' }] }, nextAt: now, fired: { 'free 17:00': '2026-11-08' } }));
await sync({ v: 2, roles: [{ ...role, wake: { enabled: false } }] });
const sched = await env.KV.get('sched:main', 'json');
assert.equal(sched.retry, undefined); assert.equal(sched.nextAt, undefined);
assert.equal(sched.fired['free 17:00'], '2026-11-08');
const before = modelCalls;
await ctx.tick(env, now); assert.equal(modelCalls, before);
await assert.rejects(ctx.runFree(env, cfg, role, []), e => e.wakeCancelled);
// Cron 在模型返回前收到关闭同步，不应把取消当失败再建重试。
await sync(cfg);
await env.KV.put('sched:main', '{}');
ctx.callModel = async () => { await sync({ v: 2, roles: [{ ...role, wake: { enabled: false } }] }); return { text: '已关闭', usage: { input: 1, output: 1 } }; };
await ctx.tick(env, now);
assert.equal((await env.KV.get('sched:main', 'json')).retry, undefined);
assert.equal((await ctx.pendingBox(env)).length, 1);
// 升级前残留配置安全停用，直到新版网页自动同步。
await env.KV.put('cfg', JSON.stringify({ v: 1, roles: [role] }));
await ctx.tick(env, now); assert.equal(modelCalls, before);
await assert.rejects(ctx.runWake(env, cfg, role, []), e => e.wakeCancelled);
console.log('通过：最新主聊天选择、关闭不重开、旧消息改投、信箱隔离、关闭状态同步、打包竞态、17:00 自由时间与去重、残留任务拦截、执行中换窗拦截、清理重试及旧版配置安全停用');
