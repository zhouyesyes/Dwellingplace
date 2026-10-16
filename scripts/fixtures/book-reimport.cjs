const assert = require('node:assert/strict');
const { zipSync, strToU8 } = require('fflate');
const paragraph = '清晨我们走到窗边，树影落在书页上，这是一段安全的虚构测试正文。';
function epub(version, title = '安全覆盖测试书', options = {}) {
  const chapters = version ? [['intro','新增序言','序言写着这本安全测试书的由来，这一章是新版才加入的。'],['b','第二章','傍晚我们回到屋里，灯光照亮桌子，这是另一段用来核对章节顺序的正文。'],['a','第一章',paragraph]] : [['a','第一章',paragraph],['b','第二章','傍晚我们回到屋里，灯光照亮桌子，这是另一段用来核对章节顺序的正文。']];
  const files = {
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    'OPS/book.opf': `<package><metadata><title>${title}</title><creator>${options.author || "测试作者"}</creator></metadata><manifest>${chapters.map(([id]) => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`).join('')}${version ? '<item id="pic" href="pic.svg" media-type="image/svg+xml"/>' : ''}</manifest><spine>${chapters.map(([id]) => `<itemref idref="${id}"/>`).join('')}</spine></package>`,
  };
  for (const [id, heading, text] of chapters) files[`OPS/${id}.xhtml`] = `<html><body><h1>${heading}</h1>${version && id === 'a' ? '<p>新增的段落会改变原来的段落编号。</p><figure><img src="pic.svg" alt="绿色圆形"/><figcaption>新版加入的插图</figcaption></figure>' : ''}<p>${text}</p>${!version && id === 'a' ? '<p>这段将被新版删除，但这段的批注必须完整保留，不能静默消失。</p>' : ''}</body></html>`;
  if (version) files['OPS/pic.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><circle cx="120" cy="60" r="50" fill="#63956b"/></svg>';
  if (options.fault === 'image') files['OPS/pic.svg'] = '损坏的图片';
  if (options.fault === 'missing-image') delete files['OPS/pic.svg'];
  if (options.fault === 'chapter') delete files['OPS/a.xhtml'];
  if (options.fault === 'spine') files['OPS/book.opf'] = files['OPS/book.opf'].replace('</spine>', '<itemref idref="missing-manifest-chapter"/></spine>');
  if (options.fault === 'href') files['OPS/book.opf'] = files['OPS/book.opf'].replace('href="a.xhtml"', '');
  if (options.fault === 'blank-href') files['OPS/book.opf'] = files['OPS/book.opf'].replace('href="a.xhtml"', 'href=" "');
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k,v]) => [k,strToU8(v)]))));
}
exports.install = async () => ({});
exports.prepare = async (page, origin) => {
  await page.goto(origin);
  await page.evaluate(async ({ oldBytes, bytes, wrong, wrongAuthor, broken }) => {
    const m = await import('/image-fixture.js');
    await m.loadStore();
    const file = b => new File([new Uint8Array(b)], '安全测试.epub');
    const id = await m.importBook(file(oldBytes));
    const oldBody = await m.loadBook(id);
    oldBody.chapters.forEach(c => { delete c.sourceId; delete c.sourcePath; });
    await m.set('book:' + id, oldBody);
    const b = m.store.books.find(b => b.id === id);
    b.pos = { ch: 0, p: 1 }; b.hisPos = { ch: 1, p: 1 }; b.cover = 'safe-cover'; b.readSecs = 123; b.mine = { stars: 5, text: '测试读后感' };
    b.gist = { text: '前情保留', upTo: { ch: 1, p: 1 } };
    m.store.bookNotes = [
      { id:'highlight', bookId:id, ch:0, p:1, quote:'树影落在书页上', start:11, end:18, text:'', from:'me' },
      { id:'user', bookId:id, ch:0, p:1, quote:'清晨我们走到窗边', text:'用户批注', from:'me' },
      { id:'gpt', bookId:id, ch:1, p:1, quote:'灯光照亮桌子', text:'GPT 批注', from:'ai', seen:false },
      { id:'sticky', bookId:id, ch:0, p:2, quote:'这段将被新版删除', text:'便利贴必须留着', from:'me' },
    ];
    await m.set('img:safe-cover', new Blob(['测试封面'], {type:'image/svg+xml'}));
    await m.set('meta', JSON.parse(JSON.stringify(m.store)));
    const before = JSON.stringify(m.store), bodyBefore = JSON.stringify(await m.get('book:' + id));
    const check = (ok, label) => { if (!ok) throw Error(label); };
    const changed = m.migrateReading({ id:'unit', chapters:[{title:'旧章',n:2}], pos:{ch:0,p:1} }, [{id:'ambiguous',ch:0,p:1,quote:'重复摘录',text:'保留原批注'}], {chapters:[{title:'旧章',paras:['正文开头足够长，用作章节匹配的锚点文字。','被改写的段落，重复摘录出现在这里。']}]}, {chapters:[{title:'旧章',paras:['正文开头足够长，用作章节匹配的锚点文字。','重复摘录','重复摘录']}]});
    check(changed.approximate > 0 && changed.book.pos.ch === 0 && changed.notes[0].unlocated && changed.notes[0].text === '保留原批注', '歧义摘录保留未定位，进度降级到匹配章节');
    const ambiguous = m.migrateReading({id:'unit',chapters:[],pos:{ch:0,p:0}}, [{id:'same',ch:0,p:0,quote:'相同摘录足够长以测试重复',text:'不能放到别处'}], {chapters:[{title:'重复章',paras:['相同摘录足够长以测试重复，相同摘录足够长以测试重复。']}]}, {chapters:[{title:'重复章',paras:['相同摘录足够长以测试重复，相同摘录足够长以测试重复。','相同摘录足够长以测试重复']}]});
    check(ambiguous.notes[0].unlocated, '原段落重复摘录不能误迁移到其他段落');
    let failed = false;
    try { await m.previewReimport(id, file([1,2,3])); } catch { failed = true; }
    check(failed && JSON.stringify(m.store) === before, '解析失败保留旧书');
    check(!(await m.previewReimport(id,file(wrong))).allowed, '不同书籍禁止覆盖');
    check(!(await m.previewReimport(id,file(wrongAuthor))).allowed, '不同作者禁止覆盖');
    for (const b of broken) {
      failed = false;
      try { failed = (await m.previewReimport(id,file(b))).allowed === false; } catch { failed = true; }
      check(failed && JSON.stringify(m.store) === before && JSON.stringify(await m.get('book:' + id)) === bodyBefore, '缺章或插图异常时旧书不变');
    }
    const preview = await m.previewReimport(id,file(bytes));
    check(preview.allowed && preview.moved === 3 && preview.unresolved === 1 && preview.newImages === 1, '预览统计');
    const put = IDBObjectStore.prototype.put;
    for (const failKey of ['book:' + id, 'meta', 'async-abort']) {
      IDBObjectStore.prototype.put = function(value,key) {
        if (key === failKey) throw new DOMException('构造资源保存失败','QuotaExceededError');
        const result = put.call(this,value,key);
        if (failKey === 'async-abort' && key === 'meta') queueMicrotask(() => this.transaction.abort());
        return result;
      };
      failed = false;
      try { await m.confirmReimport(preview); } catch { failed = true; } finally { IDBObjectStore.prototype.put = put; }
      check(failed && JSON.stringify(m.store) === before && JSON.stringify(await m.get('book:' + id)) === bodyBefore, '事务失败必须完整回滚：' + failKey);
      check(!await m.get('sync:book-reimport:' + id), '失败事务不留下半份快照');
    }
    await m.confirmReimport(preview);
    let book = m.store.books.find(b => b.id === id);
    check(m.store.books.length === 1 && book.id === id && book.cover === 'safe-cover' && book.readSecs === 123 && book.mine.stars === 5, '稳定ID与其他数据');
    check(book.pos.ch === 2 && book.pos.p === 2 && book.hisPos.ch === 1, '章节重排和插入段落进度迁移');
    const ns = m.store.bookNotes;
    check(ns.length === 4 && ns.find(n => n.id === 'sticky').unlocated.quote === '这段将被新版删除', '不丢笔记');
    const n = ns.find(n => n.id === 'highlight'), body = await m.loadBook(id);
    check(body.chapters[n.ch].paras[n.p].slice(n.start,n.end) === n.quote, '划线偏移准确');
    check(body.chapters[2].media.length === 1 && Object.keys(body.resources).length === 1, '新图片保存与缓存');
    check(JSON.stringify((await m.get('sync:book-reimport:' + id)).body) === bodyBefore, '完整可恢复快照');
    const covered = await m.get('book:' + id);
    check(covered.chapters[2].media[0].alt === '绿色圆形' && covered.chapters[2].media[0].caption === '新版加入的插图', '图片题注持久化');
    m.store.bookNotes.push({ id:'after-import', bookId:id, ch:2, p:2, quote:'新笔记原文', text:'覆盖后新增', from:'me' });
    await m.set('img:safe-cover', new Blob(['已改变']));
    await m.restoreReimport(id);
    check((await m.get('img:safe-cover')).size === new Blob(['测试封面']).size, '恢复封面资源');
    check(m.store.bookNotes.find(n => n.id === 'after-import')?.unlocated, '恢复保留覆盖后新增笔记');
    m.store.bookNotes = m.store.bookNotes.filter(n => n.id !== 'after-import');
    check(JSON.stringify(await m.get('book:' + id)) === bodyBefore && m.store.bookNotes.length === 4, '恢复旧书及笔记');
    const staleBody = await m.previewReimport(id,file(bytes));
    const changedBody = JSON.parse(bodyBefore); changedBody.chapters[0].title = '另一处更新的章节';
    await m.set('book:' + id, changedBody);
    failed = false;
    try { await m.confirmReimport(staleBody); } catch { failed = true; }
    check(failed && (await m.get('book:' + id)).chapters[0].title === '另一处更新的章节', '事务内校验拒绝覆盖其他来源的新正文');
    await m.set('book:' + id, JSON.parse(bodyBefore));
    const stale = await m.previewReimport(id,file(bytes));
    m.store.books[0].pos.p = 0;
    failed = false;
    try { await m.confirmReimport(stale); } catch { failed = true; }
    check(failed, '过期预览阻止覆盖');
    m.store.books[0].pos.p = 1;
    m.store.settings.readTip = true;
    await m.set('meta', JSON.parse(JSON.stringify(m.store)));
    window.testBookId = id;
  }, { oldBytes:[...epub(0)], bytes:[...epub(1)], wrong:[...epub(1,'另一本书')], wrongAuthor:[...epub(1,'安全覆盖测试书',{author:'不同作者'})], broken:['image','missing-image','chapter'].map(fault => [...epub(1,'安全覆盖测试书',{fault})]) });
  await require('./book-reimport-regressions.cjs').run(page, { valid:[...epub(1)], invalid:['spine','href','blank-href','chapter'].map(fault => [...epub(1,'安全覆盖测试书',{fault})]) });
  await page.goto(origin + '/?reimport-preview=1#/books');
  await page.waitForSelector('.cv');
};
exports.verify = async (page, fixture, state) => {
  const cover = page.locator('.cv').first();
  await cover.hover(); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
  await page.getByText('重新导入并覆盖 EPUB', { exact:true }).waitFor();
  const wrongChooser = page.waitForEvent('filechooser');
  await page.getByText('重新导入并覆盖 EPUB', { exact:true }).click();
  await (await wrongChooser).setFiles({ name:'另一本.epub', mimeType:'application/epub+zip', buffer:epub(1,'另一本书') });
  await page.getByRole('button', {name:'确认覆盖并保留笔记'}).waitFor();
  assert.equal(await page.getByRole('button', {name:'确认覆盖并保留笔记'}).isEnabled(),false);
  await page.getByRole('button', {name:'取消',exact:true}).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('重新导入并覆盖 EPUB', { exact:true }).click();
  await (await chooser).setFiles({ name:'安全新版.epub', mimeType:'application/epub+zip', buffer:epub(1) });
  await page.getByRole('button', {name:'确认覆盖并保留笔记'}).waitFor();
  assert.equal(await page.getByRole('button', {name:'确认覆盖并保留笔记'}).isEnabled(),true);
  await page.locator('.reimport-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: require('node:path').join(state.output, `preview-${state.view}-${state.theme}.png`) });
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', {name:'确认覆盖并保留笔记'}).click()]);
  await page.waitForSelector('.cv');
  await page.locator('.cv').first().click();
  await page.waitForSelector('.book-image img');
  await page.waitForFunction(() => document.querySelector('.book-image img')?.naturalWidth > 0);
  assert.ok((await page.locator('.book-image img').getAttribute('src')).startsWith('data:image/svg+xml'));
  await page.screenshot({ path: require('node:path').join(state.output, `reader-${state.view}-${state.theme}.png`) });
  const shared = await page.evaluate(async () => {
    const m = await import('/image-fixture.js');
    const meta = await m.get('meta'), b = meta.books[0], body = await m.get('book:' + b.id);
    const snapshot = m.captureReadingPage(document.querySelector('.page'), body, b.pos.ch);
    const parts = await m.readingPageParts(snapshot), images = parts.filter(p => p.type === 'image');
    if (images.length !== 1) throw Error('覆盖后当前页图片未进入共读输入');
    const image = new Image(); image.src = 'data:image/png;base64,' + images[0].data; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image,0,0);
    return { count:images.length, alt:snapshot.images[0].alt, caption:snapshot.images[0].caption, pixel:[...ctx.getImageData(120,60,1,1).data] };
  });
  assert.equal(shared.count,1); assert.equal(shared.alt,'绿色圆形'); assert.equal(shared.caption,'新版加入的插图'); assert.deepEqual(shared.pixel,[99,149,107,255]);
  // 再打开管理卡片，展示持久化结果及未定位笔记。
  await page.goto(page.url().split('#')[0] + '#/books');
  await page.waitForSelector('.cv');
  await page.locator('.cv').first().hover(); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
  await page.getByText('待重新定位 / 未定位笔记', {exact:true}).waitFor();
  await page.getByText('待重新定位 / 未定位笔记', {exact:true}).scrollIntoViewIfNeeded();
  assert.equal(await page.getByText('便利贴必须留着', {exact:true}).count(),1);
};
