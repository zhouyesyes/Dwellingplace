const assert = require('node:assert/strict');
exports.verify = async page => {
  const server = require('node:fs').readFileSync(require('node:path').resolve('deploy/qisuo-server/chatgpt.mjs'), 'utf8');
  const start = server.indexOf('function toInput(messages)');
  const conversion = server.slice(start, server.indexOf('\n}', start) + 2);
  const result = await page.evaluate(async conversion => {
    const toInput = new Function(conversion + '; return toInput;')();
    const { captureReadingPage, readingPageParts, loadBook, store, readAlong, askHim } = await import('/image-fixture.js');
    const book = await loadBook('preview-book'), el = document.querySelector('.page');
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const pages = [];
    for (let n = 0; n < Math.round(el.scrollWidth / el.clientWidth); n++) {
      el.scrollTo({ left: n * el.clientWidth, behavior: 'instant' }); await frame();
      const captured = captureReadingPage(el, book, 0);
      const actual = [...el.querySelectorAll('[data-media]')].filter(f => {
        const r = f.querySelector('img, .image-missing').getBoundingClientRect(), b = el.getBoundingClientRect();
        return r.right > b.left + 1 && r.left < b.right - 1 && r.bottom > b.top + 1 && r.top < b.bottom - 1;
      }).map(f => `图1-${Number(f.dataset.media) + 1}`);
      if (JSON.stringify(actual) !== JSON.stringify(captured.images.map(m => m.id))) throw Error('采集与实际显示不一致');
      pages.push(captured);
    }
    const withImage = pages.find(p => p.images.some(m => m.source));
    const without = pages.find(p => !p.images.length);
    if (!withImage || !without) throw Error('缺少有图或无图页');
    const parts = await readingPageParts(withImage);
    for (const part of parts.filter(p => p.type === 'image')) {
      const img = new Image(); img.src = `data:${part.mime};base64,${part.data}`; await img.decode();
      if (!img.naturalWidth || Math.max(img.naturalWidth, img.naturalHeight) > 1600) throw Error('模型图片不可解码');
    }
    const source = book.resources[book.chapters[0].media[0].resource];
    const multi = await readingPageParts({ ch: 0, text: '安全多图页', images: Array.from({ length: 6 }, (_, i) => ({ id: `图1-${i+1}`, p: i, source: i === 1 ? '/internal/private' : source })) });
    const labels = multi.filter(p => p.type === 'text').slice(1).map(p => p.text.split('（')[0]);
    const placeholders = multi.filter(p => p.type === 'text' && p.text.includes('【未提供画面：')).length;
    // 使用共读真实函数和 provider 序列化，只在最终 fetch 边界替换成内存响应。
    const requests = [], original = window.fetch;
    store.settings.stream = false; store.tools.stream = false;
    const api = { id: 'safe-test', type: 'openai', baseUrl: location.origin + '/safe-test/v1', model: 'safe-vision-test' };
    store.apis = [api]; store.defaultApiId = api.id;
    const role = { id: 'main', name: '测试伙伴', apiId: api.id };
    const b = { id: 'preview-book', title: '安全共读测试', chapters: book.chapters.map(c => ({ title: c.title, n: c.paras.length })) };
    store.books = [b];
    window.fetch = async (url, options) => {
      if (String(url) !== api.baseUrl + '/chat/completions') throw Error('不允许的测试请求');
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '[贴:1.1|安全测试批注]' } }], usage: {} }), { headers: { 'Content-Type': 'application/json' } });
    };
    try {
      await readAlong(role, b, { from: { ch: 0, p: 0 }, to: { ch: 0, p: 1 }, page: withImage });
      await askHim(role, b, { ch: 0, p: 1, paras: book.chapters[0].paras, chapterTitle: '测试', page: withImage });
      await readAlong(role, b, { from: { ch: 0, p: 0 }, to: { ch: 0, p: 1 }, page: without });
    } finally { window.fetch = original; }
    for (const request of requests) {
      const responseInput = toInput(request.messages).input.at(-1).content;
      const originalImages = (Array.isArray(request.messages.at(-1).content) ? request.messages.at(-1).content : []).filter(c => c.type === 'image_url').map(c => c.image_url.url);
      if (JSON.stringify(responseInput.filter(c => c.type === 'input_image').map(c => c.image_url)) !== JSON.stringify(originalImages)) throw Error('Responses 图像输入丢失');
    }
    const broken = await readingPageParts({ ch: 0, text: '', images: [{ id: '坏图', source: 'data:image/png;base64,YWJj' }] });
    if (broken.some(p => p.type === 'image') || !broken.some(p => p.text?.includes('未提供画面'))) throw Error('损坏图片没有占位');
    const imageCounts = requests.map(r => (Array.isArray(r.messages.at(-1).content) ? r.messages.at(-1).content : []).filter(c => c.type === 'image_url' && /^data:image\/png;base64,/.test(c.image_url.url)).length);
    el.scrollTo({ left: 0, behavior: 'instant' }); await frame();
    return { pageCount: pages.length, imageCounts, labels, placeholders, empty: await readingPageParts(without),
      metadata: book.chapters[0].media[0], raster: parts.filter(p => p.type === 'image').length };
  }, conversion);
  assert.ok(result.raster > 0);
  assert.ok(result.imageCounts[0] > 0); assert.ok(result.imageCounts[1] > 0); assert.equal(result.imageCounts[2], 0);
  assert.deepEqual(result.labels, ['图1-1','图1-2','图1-3','图1-4','图1-5','图1-6']);
  assert.equal(result.placeholders,3); assert.deepEqual(result.empty,[]);
  assert.equal(result.metadata.alt,'故意不描述形状的替代文字'); assert.equal(result.metadata.caption,'安全测试题注：树影');
  console.log('当前页共读图片验收（请求边界 mock，非真实模型回答）：', { pages: result.pageCount, imageCounts: result.imageCounts, order: result.labels, placeholders: result.placeholders });
};
