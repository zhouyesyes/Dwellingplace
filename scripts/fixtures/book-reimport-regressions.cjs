// 复核发现的三个缺陷：必须真实经过浏览器 IndexedDB，不使用生产数据。
exports.run = async (page, cases) => {
  const result = await page.evaluate(async cases => {
    const m = await import('/image-fixture.js');
    const copy = x => JSON.parse(JSON.stringify(x));
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const file = bytes => new File([new Uint8Array(bytes)], '安全回归.epub');
    await m.prepareBookPersistence();
    const baseline = copy(m.store), id = baseline.books[0].id;
    m.store.books.unshift({id:'sort-before',title:'排序前哨兵',chapters:[],pos:{ch:0,p:0},readAt:100,addedAt:100,cover:null});
    m.store.books.push({id:'sort-after',title:'排序后哨兵',chapters:[],pos:{ch:0,p:0},readAt:1,addedAt:1,cover:null});
    await m.prepareBookPersistence();
    const orderBefore = JSON.stringify(m.store.books.map(b => ({id:b.id,readAt:b.readAt,addedAt:b.addedAt,cover:b.cover})));
    const oldBody = await m.get('book:' + id);
    const backupKey = 'sync:book-reimport:' + id;
    // 直接从数据库连接写入，模拟另一个不共享响应式内存的标签页。
    const otherInstance = async meta => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('keyval-store'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('keyval','readwrite'); tx.objectStore('keyval').put(meta,'meta');
        tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
      }); db.close();
    };
    const rejects = async operation => { try { await operation(); return false; } catch { return true; } };
    const stale = await m.previewReimport(id,file(cases.valid));
    const previousBackup = JSON.stringify(await m.get(backupKey));
    // 本页的合法待保存字段不能丢；另一实例新增阅读数据必须使原预览过期。
    m.store.settings.reviewPending = '本页未落盘设置';
    const latest = await m.get('meta');
    const remoteBook = latest.books.find(b => b.id === id);
    remoteBook.pos = {ch:1,p:1}; remoteBook.readSecs += 9;
    latest.readingLog['2026-10-16'] = (latest.readingLog['2026-10-16'] || 0) + 9;
    latest.bookNotes.push({id:'other-instance-note',bookId:id,ch:0,p:1,quote:oldBody.chapters[0].paras[1],text:'另一实例新增的 GPT 批注',from:'ai',seen:false});
    await otherInstance(latest);
    check(await rejects(() => m.confirmReimport(stale)), '持久化阅读数据变化必须拒绝旧预览');
    await new Promise(r => setTimeout(r,650));
    let protectedMeta = await m.get('meta');
    check(protectedMeta.bookNotes.some(n => n.id === 'other-instance-note'), '拒绝后定时保存不能抹掉新笔记');
    check(protectedMeta.settings.reviewPending === '本页未落盘设置' && m.store.settings.reviewPending === '本页未落盘设置', '保留本页待保存设置');
    check(protectedMeta.books.find(b => b.id === id).readSecs === remoteBook.readSecs && protectedMeta.books.find(b => b.id === id).pos.ch === 1, '保留外部进度与阅读时间');
    check(protectedMeta.readingLog['2026-10-16'] === latest.readingLog['2026-10-16'], '保留阅读统计');
    check(JSON.stringify(await m.get(backupKey)) === previousBackup && JSON.stringify(await m.get('book:' + id)) === JSON.stringify(oldBody), '拒绝不改正文及原备份');

    // 重新预览后再故障注入，回滚必须保留确认时的最新数据，而不是更早的旧副本。
    const fresh = await m.previewReimport(id,file(cases.valid));
    check(fresh.allowed && fresh.moved === 4, '新预览包含外部新增笔记的迁移');
    protectedMeta = await m.get('meta');
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value,key) { if (key === 'book:' + id) throw new DOMException('测试保存失败','QuotaExceededError'); return put.call(this,value,key); };
    let failed;
    try { failed = await rejects(() => m.confirmReimport(fresh)); } finally { IDBObjectStore.prototype.put = put; }
    check(failed && JSON.stringify(await m.get('meta')) === JSON.stringify(protectedMeta), '故障回滚保留确认时的新笔记及本页设置');
    check(JSON.stringify(await m.get(backupKey)) === previousBackup, '失败不替换既有备份');
    // 覆盖事务等待数据库时，本页又新增了笔记，也必须中止而不是写入旧坐标。
    const get = IDBObjectStore.prototype.get;
    let injected = false;
    IDBObjectStore.prototype.get = function(key) {
      const request = get.call(this,key);
      if (key === 'book:' + id && this.transaction.mode === 'readwrite' && !injected) {
        injected = true;
        queueMicrotask(() => m.store.bookNotes.push({id:'during-commit',bookId:id,ch:0,p:1,quote:oldBody.chapters[0].paras[1],text:'事务期间本页新增',from:'me'}));
      }
      return request;
    };
    try { failed = await rejects(() => m.confirmReimport(fresh)); } finally { IDBObjectStore.prototype.get = get; }
    check(injected && failed && JSON.stringify(await m.get('book:' + id)) === JSON.stringify(oldBody), '事务期间本页新修改使覆盖中止');
    check(JSON.stringify(await m.get(backupKey)) === previousBackup && m.store.bookNotes.some(n => n.id === 'during-commit'), '中止不改备份且保留本页新笔记');
    await m.prepareBookPersistence();
    check((await m.get('meta')).bookNotes.some(n => n.id === 'during-commit'), '中止后本页新笔记安全落盘');
    const finalPreview = await m.previewReimport(id,file(cases.valid));
    protectedMeta = await m.get('meta');
    await m.confirmReimport(finalPreview);
    check(JSON.stringify(m.store.books.map(b => ({id:b.id,readAt:b.readAt,addedAt:b.addedAt,cover:b.cover}))) === orderBefore, '多本书数组顺序、排序字段和封面保持不变');
    const snapshot = await m.get(backupKey);
    check(JSON.stringify(snapshot.book) === JSON.stringify(protectedMeta.books.find(b => b.id === id)), '备份基于确认时最新书籍数据');
    check(JSON.stringify(snapshot.notes) === JSON.stringify(protectedMeta.bookNotes.filter(n => n.bookId === id)), '备份包含另一实例的新笔记');
    const migrated = m.store.bookNotes.find(n => n.id === 'other-instance-note');
    check(migrated.ch === 2 && migrated.p === 2 && migrated.text === '另一实例新增的 GPT 批注', '重新预览后准确保留和迁移外部新笔记');
    await m.restoreReimport(id);
    check(m.store.bookNotes.some(n => n.id === 'other-instance-note') && m.store.books.find(b => b.id === id).pos.ch === 1, '恢复备份保留确认时的新笔记与进度');

    // 正文改写：同段两次 + 另一段一次，三个实际出现位置，不能选另一段。
    const quote = '这是一段足够长的重复摘录';
    const note = {id:'repeat',bookId:id,ch:0,p:0,quote,text:'原批注完整保留',from:'ai',seen:false};
    const old = {chapters:[{title:'重复章',paras:['旧的前文'+quote+'旧的后文']}]};
    const body = {chapters:[{title:'重复章',paras:['新的前文'+quote+'中间'+quote+'新的后文','另一个位置'+quote]}]};
    const migration = m.migrateReading({id,pos:{ch:0,p:0}},[note],old,body);
    check(migration.moved === 0 && migration.unresolved === 1, '按实际出现位置判定歧义');
    const pending = migration.notes[0];
    check(pending.unlocated.quote === quote && pending.unlocated.chapter === '重复章' && pending.text === note.text && pending.from === 'ai' && !pending.seen, '歧义笔记保留原摘录、章节、作者和批注');
    const overlapping = m.migrateReading({id,pos:{ch:0,p:0}},[{...note,quote:'甲'.repeat(8)}],{chapters:[{title:'重复章',paras:['旧'+ '甲'.repeat(8)]}]},{chapters:[{title:'重复章',paras:['新'+'甲'.repeat(9),'另一个段落'+'甲'.repeat(8)]}]});
    check(overlapping.unresolved === 1, '重叠出现也必须算多个位置');

    for (const bytes of cases.invalid) {
      const before = JSON.stringify(await m.get('meta')), backup = JSON.stringify(await m.get(backupKey));
      const preview = await m.previewReimport(id,file(bytes));
      check(preview.allowed === false && /EPUB 文件异常/.test(preview.reason), '缺 manifest、缺 href、空 href、缺章节资源必须返回禁止覆盖预览');
      check(await rejects(() => m.confirmReimport(preview)), '异常文件不能绕过预览确认');
      check(JSON.stringify(await m.get('meta')) === before && JSON.stringify(await m.get(backupKey)) === backup, '异常文件不改阅读数据和备份');
    }

    // 同字段冲突不能自动覆盖：两份数据分别留在数据库和本页待保存副本。
    const conflictPreview = await m.previewReimport(id,file(cases.valid));
    m.store.bookNotes.find(n => n.id === 'user').text = '本页修改的原批注';
    const conflicting = await m.get('meta'); conflicting.bookNotes.find(n => n.id === 'user').text = '其他实例修改的原批注';
    await otherInstance(conflicting);
    check(await rejects(() => m.confirmReimport(conflictPreview)), '同字段并发修改拒绝自动取舍');
    const draftKey = 'sync:book-pending:' + sessionStorage.getItem('qisuo-book-pending');
    check((await m.get('meta')).bookNotes.find(n => n.id === 'user').text === '其他实例修改的原批注', '冲突时不覆盖数据库的新批注');
    check((await m.get(draftKey)).local.bookNotes.find(n => n.id === 'user').text === '本页修改的原批注' && m.store.bookNotes.find(n => n.id === 'user').text === '本页修改的原批注', '冲突保留本页内存及持久化副本');
    return { baseline, id, result: { staleMeta:'通过', rollbackLatest:'通过', backupLatest:'通过', repeatedPositions:'通过', invalidSpine:cases.invalid.length, pendingConflict:'通过', multiBookOrder:'通过', inFlightChange:'通过' } };
  }, cases);
  // 新文档加载新模块实例，验证刷新后仍能找回待保存状态，不依赖原来的响应式内存。
  await page.goto(new URL('/image-fixture.js', page.url()).href);
  await page.evaluate(async ({baseline,id}) => {
    const m = await import('/image-fixture.js');
    // 即使刷新时复制副本遇到配额错误，也必须恢复原副本，不能回到空白默认数据。
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value,key) { if (String(key).startsWith('sync:book-pending:')) throw new DOMException('测试副本复制失败','QuotaExceededError'); return put.call(this,value,key); };
    try { await m.loadStore(); } finally { IDBObjectStore.prototype.put = put; }
    const check = (ok, message) => { if (!ok) throw Error(message); };
    check(m.store.bookNotes.find(n => n.id === 'user').text === '本页修改的原批注', '刷新后恢复本页冲突副本');
    check((await m.get('meta')).bookNotes.find(n => n.id === 'user').text === '其他实例修改的原批注', '刷新不覆盖另一实例的新内容');
    // 测试中明确解决冲突，再恢复安全 fixture 的起始状态供 UI 验收。
    m.store.bookNotes.find(n => n.id === 'user').text = '其他实例修改的原批注';
    await m.prepareBookPersistence();
    const draftKey = 'sync:book-pending:' + sessionStorage.getItem('qisuo-book-pending');
    check(!await m.get(draftKey), '冲突解决后保存成功并清除当前实例临时副本');
    Object.assign(m.store, baseline);
    await m.prepareBookPersistence();
  }, result);
  console.log('三项缺陷自动回归：', {...result.result, pendingReload:'通过', pendingReloadQuota:'通过'});
};
