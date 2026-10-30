// 同步按板块拆开存：迁移核对、恢复备份、新旧设备同时在线。本地浏览器 + 模拟同步服务，不访问真实数据。
// 用法：先 npx vite --port 5199 起新版；要测旧版同时在线，再用旧版代码起 5198，QISUO_OLD_URL=http://127.0.0.1:5198/
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const NEW = process.env.QISUO_TEST_URL || 'http://127.0.0.1:5199/', OLD = process.env.QISUO_OLD_URL || '';
const mkMeta = () => ({
  version: 10, profile: { name: '栖所', userName: '', color: '#aaa', avatar: null, cover: null, bioSelf: '', bios: {} }, settings: { fontSize: 'standard', privacy: '' },
  books: Array.from({ length: 5 }, (_, i) => ({ id: 'b' + i, title: '书' + i, chapters: [{ title: '一', n: 1 }], pos: { ch: 0, p: 0 }, readSecs: 0 })),
  bookNotes: Array.from({ length: 50 }, (_, i) => ({ id: 'n' + i, bookId: 'b' + (i % 5), ch: 0, p: i, quote: 'q', text: '笔记' + i, from: 'me', ts: i })),
  memories: Array.from({ length: 20 }, (_, i) => ({ id: 'm' + i, roleId: 'main', title: '记忆' + i, content: 'c', author: 'me', ts: i })),
  letters: [{ id: 'l0', roleId: 'main', from: 'me', title: '信', body: 'b', ts: 1 }],
  usage: { '2026-10-30': { a: { input: 1, output: 1, calls: 1 } } }, readingLog: { '2026-10-30': 60 },
  roles: [{ id: 'main', name: 'TA', wake: { enabled: false }, wakeLog: [] }], threads: [{ roleId: 'main' }],
});
(async () => {
  const browser = await chromium.launch();
  let seq = 0; const items = new Map();
  const put = (k, val) => { items.set(k, { rev: ++seq, body: JSON.stringify(val) }); };
  const original = mkMeta();
  put('meta', original); put('msgs:t1', [{ id: 'g1', text: '你好', ts: 1 }]);
  const legacyBody = items.get('meta').body;
  async function device(url, seedLocal = false) {
    const ctx = await browser.newContext();
    await ctx.route('**/p/test/sync/**', async route => {
      const u = new URL(route.request().url()), m = route.request().method();
      if (u.pathname.endsWith('/changes')) return route.fulfill({ json: { seq, items: [...items].filter(([, v]) => v.rev > Number(u.searchParams.get('since'))).map(([k, v]) => ({ k, rev: v.rev, ...(v.del ? { del: true } : {}) })).sort((a, b) => a.rev - b.rev) } });
      const k = u.searchParams.get('k'), old = items.get(k);
      if (m === 'GET') return route.fulfill(old && !old.del ? { headers: { 'Content-Type': 'application/json', 'X-Rev': String(old.rev) }, body: old.body } : { status: 404, json: { rev: old?.rev || 0 } });
      if (Number(u.searchParams.get('base')) !== (old?.rev || 0)) return route.fulfill({ status: 409, json: { rev: old?.rev || 0 } });
      items.set(k, m === 'DELETE' ? { rev: ++seq, del: true } : { rev: ++seq, body: route.request().postData() });
      return route.fulfill({ json: { rev: seq } });
    });
    const page = await ctx.newPage();
    await page.goto(url);
    await page.evaluate(async () => { const db = await import('/node_modules/.vite/deps/idb-keyval.js'); await db.set('sync:conf', { url: location.origin + '/p/test/sync' }); });
    // 升级前已经同步好的设备：本机就是完整的旧数据
    if (seedLocal) await page.evaluate(async m => { const db = await import('/node_modules/.vite/deps/idb-keyval.js'); await db.set('meta', m); }, original);
    if (seedLocal) await page.reload();
    await page.evaluate(async () => { const s = await import('/src/lib/sync.js'); await s.startSync(); });
    return page;
  }
  const until = async (fn, what) => { const end = Date.now() + 20000; while (!await fn()) { if (Date.now() > end) throw new Error('等待超时：' + what); await new Promise(r => setTimeout(r, 100)); } };
  const meta = p => p.evaluate(async () => JSON.parse(JSON.stringify((await import('/src/store/index.js')).store)));
  const sync = async (p, n = 3) => { for (let i = 0; i < n; i++) await p.evaluate(async () => (await import('/src/lib/sync.js')).syncNow(true)); };
  const server = name => JSON.parse(items.get('meta:' + name).body);
  const serverMeta = () => Object.assign({}, ...[...items].filter(([k, v]) => k.startsWith('meta:') && !v.del).map(([, v]) => JSON.parse(v.body)));

  // 1. 迁移：带笔记的旧数据，迁移后各板块数量一致，旧的整份原样留着，本机有备份
  const n1 = await device(NEW, true);
  await until(() => items.has('meta:notes') && items.has('meta:memories'), '迁移');
  await sync(n1);
  const sm = serverMeta();
  assert.equal(sm.bookNotes.length, 50); assert.equal(sm.memories.length, 20); assert.equal(sm.books.length, 5); assert.equal(sm.letters.length, 1);
  assert.deepEqual(Object.keys(original).sort().filter(k => !(k in sm)), [], '每个字段都在板块里');
  assert.equal(items.get('meta').body, legacyBody, '旧的整份大文件原样保留');
  const mig = await n1.evaluate(async () => { const db = await import('/node_modules/.vite/deps/idb-keyval.js'); return { m: await db.get('sync:migration'), b: !!(await db.get('sync:backup:premigrate')), s: !!(await db.get('sync:sections')) }; });
  if (!mig.s) console.log(JSON.stringify(mig), await n1.evaluate(async () => (await import('/src/lib/sync.js')).syncState.error));
  assert(mig.m?.ok && mig.b && mig.s, '迁移核对通过、备份在、已切到板块');
  assert.equal(mig.m.counts.bookNotes, 50);
  console.log('迁移：核对通过，板块', [...items.keys()].filter(k => k.startsWith('meta:')).join(' '));

  // 2. 恢复备份能回原样
  await n1.evaluate(async () => { const { store } = await import('/src/store/index.js'); store.bookNotes.push({ id: 'x', bookId: 'b0', ch: 0, p: 0, quote: '', text: '迁移后新写', from: 'me', ts: 99 }); store.memories.length = 3; });
  await sync(n1);
  assert.equal(server('notes').bookNotes.length, 51);
  await n1.evaluate(async () => (await import('/src/lib/sync.js')).restoreMigrationBackup());
  const back = await meta(n1);
  assert.equal(back.bookNotes.length, 50); assert.equal(back.memories.length, 20);
  const pre = await n1.evaluate(async () => { const db = await import('/node_modules/.vite/deps/idb-keyval.js'); return (await db.get('sync:backup:premigrate')).entries.find(([k]) => k === 'meta')[1]; });
  assert.deepEqual(back, JSON.parse(JSON.stringify(pre)), '恢复后和迁移前的备份一模一样');
  assert.deepEqual(back.bookNotes, original.bookNotes);
  await sync(n1);
  assert.equal(server('notes').bookNotes.length, 50, '恢复后同步回云端');
  console.log('恢复备份：回到原样（50 条笔记、20 张记忆）');

  // 3. 两台新设备同时改：各加一条，都不丢
  const n2 = await device(NEW);
  await until(async () => (await meta(n2)).bookNotes?.length === 50, '第二台拿到数据');
  await n1.evaluate(async () => { const { store } = await import('/src/store/index.js'); store.bookNotes.push({ id: 'A', bookId: 'b0', ch: 0, p: 1, quote: '', text: '一号写的', from: 'me', ts: 100 }); store.memories.push({ id: 'mA', roleId: 'main', title: 'A', content: 'c', author: 'me', ts: 100 }); });
  await n2.evaluate(async () => { const { store } = await import('/src/store/index.js'); store.bookNotes.push({ id: 'B', bookId: 'b1', ch: 0, p: 2, quote: '', text: '二号写的', from: 'me', ts: 101 }); store.letters.push({ id: 'lB', roleId: 'main', from: 'me', title: 'B', body: 'b', ts: 101 }); });
  await Promise.all([sync(n1, 4), sync(n2, 4)]); await sync(n1); await sync(n2);
  console.log(JSON.stringify(await n1.evaluate(async () => { const db = await import('/node_modules/.vite/deps/idb-keyval.js'); const st = (await import('/src/lib/sync.js')).syncState; return { st: { err: st.error, def: st.deferred, pend: st.pending }, seq: await db.get('sync:seq'), kn: (await db.get('sync:known'))['meta:notes'], dirty: await db.get('sync:dirty'), local: (await db.get('meta')).bookNotes.length }; })), [...items].map(([k, v]) => k + '@' + v.rev).join(' '));
  for (const p of [n1, n2]) { const m = await meta(p); console.log('设备笔记', m.bookNotes.length, m.bookNotes.filter(x => ['A', 'B', 'x'].includes(x.id)).map(x => x.id).join(), '服务器', server('notes').bookNotes.length); assert.equal(m.bookNotes.length, 52); assert(m.memories.some(x => x.id === 'mA')); assert(m.letters.some(x => x.id === 'lB')); }
  assert.equal(server('notes').bookNotes.length, 52);
  console.log('两台新设备同时改：笔记 52 条都在，记忆和信也都在');

  // 4. 旧设备同时在线：旧设备改旧整份，新设备合进来；新设备的更新旧设备暂时看不到，但旧设备自己的数据不丢
  if (OLD) {
    const o = await device(OLD);
    await until(async () => (await meta(o)).bookNotes?.length === 50, '旧设备拿到旧整份');
    await o.evaluate(async () => { const { store } = await import('/src/store/index.js'); store.bookNotes.push({ id: 'O', bookId: 'b2', ch: 0, p: 3, quote: '', text: '旧设备写的', from: 'me', ts: 102 }); });
    await sync(o, 3);
    await until(async () => { await sync(n1, 1); return (await meta(n1)).bookNotes.some(x => x.id === 'O'); }, '新设备合进旧设备的笔记');
    await sync(n1, 3); await sync(n2, 3);
    for (const p of [n1, n2]) { const m = await meta(p); assert.equal(m.bookNotes.length, 53); assert(m.bookNotes.some(x => x.id === 'A') && m.bookNotes.some(x => x.id === 'B')); }
    const om = await meta(o); assert(om.bookNotes.some(x => x.id === 'O'));
    console.log('新旧同时在线：新设备 53 条（含旧设备写的），旧设备自己的数据还在');
  }
  await browser.close();
  console.log('OK');
})().catch(e => { console.error(e); process.exit(1); });
