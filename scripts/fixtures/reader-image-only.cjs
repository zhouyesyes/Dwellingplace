// 全新浏览器中导入虚构纯插图 EPUB；最终请求只在本地拦截，不调用模型。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');
exports.prepare = async page => {
  const pictures = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 120; c.height = 60;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 120, 60);
    ctx.fillStyle = 'red'; ctx.beginPath(); ctx.moveTo(60, 5); ctx.lineTo(110, 55); ctx.lineTo(10, 55); ctx.fill();
    const red = c.toDataURL('image/png').split(',')[1];
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 120, 60);
    ctx.fillStyle = 'blue'; ctx.fillRect(25, 10, 70, 40);
    return [red, c.toDataURL('image/png').split(',')[1]];
  });
  const files = {
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
    'book.opf': '<package><metadata><title>安全纯插图测试</title></metadata><manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/><item id="a" href="a.png" media-type="image/png"/><item id="b" href="b.png" media-type="image/png"/></manifest><spine><itemref idref="c"/></spine></package>',
    'c.xhtml': '<html><body><img src="a.png" alt="标签甲"/><img src="b.png" alt="标签乙"/></body></html>',
  };
  const archive = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]));
  archive['a.png'] = Buffer.from(pictures[0], 'base64'); archive['b.png'] = Buffer.from(pictures[1], 'base64');
  await page.evaluate(async bytes => {
    const { importBook, loadBook, store, set } = await import('/image-fixture.js');
    const id = await importBook(new File([new Uint8Array(bytes)], '安全纯插图.epub'));
    const body = await loadBook(id);
    if (body.chapters[0].paras.length !== 0 || body.chapters[0].media.length !== 2) throw Error('没有得到纯插图章节');
    store.books = [{ ...store.books.find(b => b.id === id), id: 'preview-book' }];
    store.settings.readTip = true; store.tools.stream = false;
    store.apis = [{ id: 'safe-test', type: 'openai', baseUrl: location.origin + '/safe-test/v1', model: 'safe-vision-test' }];
    store.defaultApiId = 'safe-test';
    store.readerPrefs = { mode: 'page', size: 18, bg: 'paper', font: '' };
    store.bookNotes = [{ id: 'safe-existing-note', bookId: 'other-safe-book', ch: 0, p: 0, text: '安全笔记哨兵' }];
    await set('book:preview-book', body); await set('meta', JSON.parse(JSON.stringify(store)));
  }, [...zipSync(archive)]);
};
exports.verify = async page => {
  const source = fs.readFileSync(path.resolve('deploy/qisuo-server/chatgpt.mjs'), 'utf8');
  const start = source.indexOf('function toInput(messages)');
  const conversion = source.slice(start, source.indexOf('\n}', start) + 2);
  const requests = [];
  await page.route('**/safe-test/v1/chat/completions', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { choices: [{ message: { content: '这是本地模拟共读回复，不代表模型看图。' } }], usage: {} } });
  });
  await page.waitForFunction(() => [...document.querySelectorAll('.book-image img')].length === 2 && [...document.querySelectorAll('.book-image img')].every(i => i.complete && i.naturalWidth), null, { timeout: 10000 });
  // 真正点击 Vue 两个入口：一起读，以及纯插图页图片上的问问他。
  await page.locator('button.along').click();
  await page.getByRole('heading', { name: '这一页的共读' }).waitFor();
  await page.locator('.backdrop').filter({ has: page.getByRole('heading', { name: '这一页的共读', exact: true }) }).getByRole('button', { name: '关闭', exact: true }).click();
  // 按屏幕上的位置点（像手指点）：locator.click 会先把元素「滚进视野」，分栏书页会被横着挪开
  await page.waitForFunction(() => !document.querySelector('.backdrop')); // 等上一张卡片收起来
  const at = await page.locator('.book-image img').first().boundingBox();
  await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
  await page.getByRole('button', { name: '给他看', exact: true }).click();
  await page.getByRole('heading', { name: '这一页的共读' }).waitFor();
  await page.locator('.backdrop').filter({ has: page.getByRole('heading', { name: '这一页的共读', exact: true }) }).getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal(requests.length, 2, '两个真实界面入口都应发送请求');
  const result = await page.evaluate(async ({ requests, conversion }) => {
    const toInput = new Function(conversion + '; return toInput;')();
    const { loadStore, loadBook, store, captureReadingPage, readAlong, askHim } = await import('/image-fixture.js');
    await loadStore();
    const book = await loadBook('preview-book'), b = store.books[0], role = store.roles[0];
    const before = JSON.stringify({ pos: b.pos, hisPos: b.hisPos, alongTo: b.alongTo, notes: store.bookNotes, book });
    if (b.pos.ch !== 0 || b.pos.p !== 0 || b.hisPos || b.alongTo || store.bookNotes.length !== 1 || store.bookNotes[0].id !== 'safe-existing-note') throw Error('纯插图回复改动了阅读位置或笔记');
    const snapshot = captureReadingPage(document.querySelector('.page'), book, 0);
    if (snapshot.text || snapshot.images.map(m => m.id).join(',') !== '图1-1,图1-2') throw Error('纯插图当前页采集错误');
    const check = async request => {
      const content = toInput(request.messages).input.at(-1).content;
      const images = content.filter(p => p.type === 'input_image');
      if (images.length !== 2) throw Error('纯插图请求缺少 input_image');
      for (let i = 0; i < images.length; i++) {
        const at = content.indexOf(images[i]), label = content[at - 1].text;
        if (!label.startsWith(`图1-${i + 1}（`) || !label.includes(i === 0 ? '标签甲' : '标签乙')) throw Error('稳定标识与图像顺序不匹配');
        const img = new Image(); img.src = images[i].image_url; await img.decode();
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
        const center = [...ctx.getImageData(60, 30, 1, 1).data];
        const top = [...ctx.getImageData(30, 15, 1, 1).data];
        if (center.join(',') !== (i === 0 ? '255,0,0,255' : '0,0,255,255')) throw Error('图片画面和标识错配');
        if (top.join(',') !== (i === 0 ? '255,255,255,255' : '0,0,255,255')) throw Error('三角形/方形画面不符');
        if (!images[i].image_url.startsWith('data:image/png;base64,')) throw Error('不是可读图片载荷');
      }
      if (images[0].image_url === images[1].image_url) throw Error('重复使用同一图片');
    };
    for (const request of requests) await check(request);
    const captured = [], original = window.fetch;
    window.fetch = async (url, options) => {
      if (String(url) !== location.origin + '/safe-test/v1/chat/completions') throw Error('不允许外部请求');
      captured.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '本地模拟回复' } }], usage: {} }));
    };
    const from = { ch: 0, p: 0 };
    const along = page => readAlong(role, b, { from, to: from, page });
    const ask = page => askHim(role, b, { ch: 0, p: 0, paras: [], chapterTitle: '纯图', quote: '图片问题', page });
    let emptyErrors = 0;
    try {
      for (const call of [along, ask]) {
        for (const source of ['', 'data:image/png;base64,YWJj']) {
          await call({ ch: 0, text: '', images: [{ ...snapshot.images[0], source }] });
          const content = toInput(captured.at(-1).messages).input.at(-1).content;
          if (content.some(p => p.type === 'input_image') || !content.some(p => p.text?.includes('【未提供画面：'))) throw Error('失败图片没有明确占位');
        }
        const count = captured.length;
        try { await call({ ch: 0, text: '', images: [] }); throw Error('空页没有拦截'); }
        catch (e) { if (e.message !== '这几页没有字') throw e; emptyErrors++; }
        if (captured.length !== count) throw Error('空页发出了请求');
      }
      const after = JSON.stringify({ pos: b.pos, hisPos: b.hisPos, alongTo: b.alongTo, notes: store.bookNotes, book });
      if (before !== after) throw Error('图片失败/纯图共读改变位置、笔记或正文');
    } finally { window.fetch = original; }
    return { uiImages: requests.map(r => toInput(r.messages).input.at(-1).content.filter(p => p.type === 'input_image').length), failureRequests: captured.length, emptyErrors };
  }, { requests, conversion });
  assert.deepEqual(result.uiImages, [2, 2]); assert.equal(result.failureRequests, 4); assert.equal(result.emptyErrors, 2);
  console.log('纯插图双入口及不同画面对应验收通过（本地模拟请求）：', result);
};
