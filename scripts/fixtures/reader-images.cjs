const assert = require('node:assert/strict');
const { zipSync, strToU8 } = require('fflate');
exports.prepare = async page => {
  // 真正走 EPUB 导入 → IndexedDB → 刷新加载，全程只用虚构测试书。
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="#a9bfa4"/><circle cx="320" cy="160" r="90" fill="#f5eddc"/></svg>';
  const files = {
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    'OPS/book.opf': '<package><metadata><title>虚构插图测试书</title></metadata><manifest><item id="c" href="text/nested/ch.xhtml" media-type="application/xhtml+xml"/><item id="s" href="images/树 影.svg" media-type="image/svg+xml"/><item id="p" href="images/p.png" media-type="image/png"/></manifest><spine><itemref idref="c"/></spine></package>',
    'OPS/images/树 影.svg': svg,
    'OPS/text/nested/ch.xhtml': '<html><body><h1>树影与书页</h1><p>这是一段足够长的虚构正文，用来检查插图与阅读分页。</p><picture><source srcset="../../images/p.png"/><img src="../../images/树%20影.svg"/></picture><p>插图之后的文字仍保持段落编号，可以照常划线和写批注。</p><svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><image href="../../images/p.png" width="200" height="100"/></svg><img src="../../../../private.png"/>' + '<p>接着翻过一页，树影落在纸上。这些文字全部是隔离测试使用的安全内容。</p>'.repeat(25) + '</body></html>',
  };
  const raster = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#a9bfa4'; ctx.fillRect(0, 0, 80, 40);
    return { jpeg: canvas.toDataURL('image/jpeg').split(',')[1], webp: canvas.toDataURL('image/webp').split(',')[1] };
  });
  const formats = { jpg: ['jpeg', raster.jpeg], jpeg: ['jpeg', raster.jpeg], webp: ['webp', raster.webp], gif: ['gif', 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'] };
  for (const [ext, [type]] of Object.entries(formats)) {
    files['OPS/book.opf'] = files['OPS/book.opf'].replace('</manifest>', `<item id="${ext}" href="images/test.${ext}" media-type="image/${type}"/></manifest>`);
    files['OPS/text/nested/ch.xhtml'] = files['OPS/text/nested/ch.xhtml'].replace('</body>', `<img src="../../images/test.${ext}"/></body>`);
  }
  const archive = Object.fromEntries(Object.entries(files).map(([k,v]) => [k,strToU8(v)]));
  archive['OPS/images/p.png'] = png;
  for (const [ext, [, data]] of Object.entries(formats)) archive['OPS/images/test.' + ext] = Buffer.from(data, 'base64');
  const bytes = [...zipSync(archive)];
  await page.evaluate(async bytes => {
    const { importBook, loadBook } = await import('/image-fixture.js');
    const { store } = await import('/image-fixture.js');
    const { get, set } = await import('/image-fixture.js');
    const id = await importBook(new File([new Uint8Array(bytes)], '测试.epub'));
    const body = await loadBook(id);
    if (body.chapters[0].media.length !== 7 || Object.keys(body.resources).length !== 7) throw Error('图片解析失败');
    if (body.chapters[0].paras.length !== 28 || body.chapters[0].paras[1] !== '这是一段足够长的虚构正文，用来检查插图与阅读分页。') throw Error('文字段落编号变化');
    const saved = await get('book:' + id);
    if (!saved.resources || saved.chapters[0].media[2].resource) throw Error('持久化或越界隔离失败');
    store.books[0] = { ...store.books.find(b => b.id === id), id: 'preview-book' };
    store.books = [store.books[0]];
    store.settings.readTip = true;
    store.readerPrefs = { mode: 'page', size: 18, bg: 'paper', font: '' };
    await set('book:preview-book', saved);
    await set('meta', JSON.parse(JSON.stringify(store)));
  }, bytes);
};
exports.verify = async page => {
  await page.waitForFunction(() => [...document.querySelectorAll('.book-image img')].every(i => i.complete && i.naturalWidth > 0));
  const result = await page.evaluate(async () => {
    const { resolveEpubPath, epubImageType, safeBookImage } = await import('/image-fixture.js');
    for (const path of ['../../../secret', '%2fetc/passwd', 'https://example.com/a', '%ZZ', '..%5csecret']) if (resolveEpubPath('OPS/',path)) throw Error('未拒绝危险路径');
    if (resolveEpubPath('OPS/text/nested/', '../../images/树%20影.svg') !== 'OPS/images/树 影.svg') throw Error('相对路径错误');
    for (const t of ['jpeg','jpg','png','gif','webp','svg+xml']) if (!epubImageType('image/' + t)) throw Error('格式遗漏');
    if (safeBookImage('/private/internal')) throw Error('内部链接泄漏');
    const el = document.querySelector('.page');
    const images = [...el.querySelectorAll('img')];
    const cs = getComputedStyle(el), column = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { count: images.length, fit: images.every(i => i.width <= column + 1 && i.height <= el.clientHeight), placeholder: el.querySelector('.image-missing')?.textContent, pages: Math.round(el.scrollWidth / el.clientWidth) };
  });
  assert.equal(result.count,6); assert.ok(result.fit); assert.equal(result.placeholder,'图片暂不可用'); assert.ok(result.pages > 1);
  // 实际点击手机两侧前后翻页，再回到插图所在页截图。
  const box = await page.locator('.page').boundingBox();
  await page.mouse.click(box.x + box.width - 5, box.y + 100);
  await page.waitForTimeout(700);
  assert.ok(await page.locator('.page').evaluate(e => e.scrollLeft > 0));
  await page.mouse.click(box.x + 5, box.y + 100);
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.page').evaluate(e => e.scrollLeft),0);
  console.log('EPUB 图片链路：',result);
};
