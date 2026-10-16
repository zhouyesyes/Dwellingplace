// 仅供隔离预览：虚构章节，不经过导入，不访问生产数据。
const assert = require('node:assert/strict');
exports.install = async () => ({});
exports.prepare = async (page, origin, mode) => {
  await page.goto(origin);
  await page.evaluate(async mode => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('keyval-store', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('keyval');
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const chapters = [
      { title: '短章节', paras: ['清晨的窗边，放着一本翻开的书。', '风吹过树梢，今天从这里开始。'] },
      { title: '长章节', paras: Array.from({ length: 51 }, (_, i) => `第${i + 1}段。` + '窗外的树影落在书页上，我们静静读着这一段虚构的文字。'.repeat(i % 5 + 1)) },
    ];
    await new Promise((resolve, reject) => {
      const tx = db.transaction('keyval', 'readwrite'), kv = tx.objectStore('keyval');
      kv.put({ books: [{ id: 'preview-book', title: '末页边距验收', chapters: chapters.map(c => ({ title: c.title, n: c.paras.length })), pos: { ch: mode === 'reader-long' ? 1 : 0, p: 0 } }], readerPrefs: { mode: 'page', size: 18, bg: 'paper', font: '' }, settings: { readTip: true } }, 'meta');
      kv.put({ chapters }, 'book:preview-book');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, mode);
  if (mode === 'reader-images') await require('./reader-images.cjs').prepare(page);
  await page.goto(origin + '/?reader-preview=1#/read/preview-book');
  await page.waitForSelector('.page > p');
};
exports.verify = async (page, mode) => {
  if (mode === 'reader-images') return require('./reader-images.cjs').verify(page);
  // 比较栏的盒子，避免首行缩进或段落跨栏影响测量。
  const result = await page.evaluate(async () => {
    const el = document.querySelector('.page');
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await frame();
    el.scrollTo({ left: 0, behavior: 'instant' });
    const first = el.querySelector('p').getClientRects()[0];
    const box = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const width = el.clientWidth, count = Math.round(el.scrollWidth / width);
    el.scrollTo({ left: (count - 1) * width, behavior: 'instant' });
    await frame();
    const last = el.querySelector('.ch-nav').getBoundingClientRect();
    return { count, width, scroll: el.scrollLeft, total: el.scrollWidth,
      firstLeft: first.left - box.left, firstWidth: first.width,
      lastLeft: last.left - box.left, lastWidth: last.width,
      left: parseFloat(cs.paddingLeft), right: parseFloat(cs.paddingRight),
      spacer: parseFloat(getComputedStyle(el.querySelector('.ch-nav'), '::after').width) };
  });
  if (mode === 'reader-short') assert.equal(result.count, 1);
  else assert.ok(result.count > 1, '长章节必须跨页');
  const near = (a, b, message) => assert.ok(Math.abs(a - b) <= 1, `${message}: ${a} / ${b}`);
  near(result.lastLeft, result.firstLeft, '末页与首页左边距一致');
  near(result.lastWidth, result.firstWidth, '末页与首页栏宽一致');
  near(result.lastLeft, result.left, '末页保留左留白');
  near(result.width - result.lastLeft - result.lastWidth, result.right, '末页保留右留白');
  near(result.scroll, (result.count - 1) * result.width, '末页完整滚动');
  near(result.spacer, result.right, '显式补齐末栏右留白');
  // 回到首栏再翻到末栏，确保反复翻页仍对齐。
  await page.evaluate(() => { const el = document.querySelector('.page'); el.scrollLeft = 0; el.scrollLeft = el.scrollWidth; });
  await page.waitForTimeout(650);
  console.log(JSON.stringify(result));
};
