// 临时浏览器和生成的图片，不接触真实数据或外部服务。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch();
 try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.QISUO_TEST_URL || 'http://127.0.0.1:5199');
  const result = await page.evaluate(async () => {
   const { pickFile, fileActivity, decodeImage } = await import('/src/lib/filePicker.js');
   const { saveImage, pickAndCrop, imageURL, useImage } = await import('/src/lib/images.js');
   const { cropState, finishCrop } = await import('/src/lib/crop.js');
   const check = (ok, message) => { if (!ok) throw Error(message); };
   const click = HTMLInputElement.prototype.click;
   HTMLInputElement.prototype.click = function () { check(this.isConnected, 'input 必须在 DOM 中'); };
   try {
    const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 30;
    const blob = await new Promise(r => canvas.toBlob(r));
    const file = new File([blob], 'test.png', { type: 'image/png' });
    function select() {
     const input = document.querySelector('input[type=file]');
     const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
     input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change'));
    }
    for (let i = 0; i < 2; i++) {
     const pending = pickFile();
     check((await pickFile()).length === 0, '重复选择应被阻止');
     window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'));
     check(fileActivity.selecting, '恢复焦点不能提前取消');
     select(); check((await pending)[0] === file, '同一张图每次都应接收一次');
     check(!document.querySelector('input[type=file]'), '应清理 input');
    }
    let pending = pickFile(); document.querySelector('input[type=file]').dispatchEvent(new Event('cancel'));
    check((await pending).length === 0, '原生取消');
    pending = pickFile(); fileActivity.cancel(); check((await pending).length === 0, '旧 Safari 手工取消');
    const bitmap = window.createImageBitmap;
    window.createImageBitmap = async () => { throw Error('模拟 Safari 解码失败'); };
    try {
     const img = await decodeImage(file); check(img.width === 20, '原生图片回退');
     const saving = saveImage(file); check(fileActivity.processing === 1, '立即进入处理');
     check((await pickFile()).length === 0, '处理期间不能再选');
     const id = await saving; check(await imageURL(id), '压缩并持久化');
     check(fileActivity.processing === 0, '处理完成解锁');
     let failed = false;
     try { await saveImage(new Blob(['坏图片'])); } catch { failed = true; }
     check(failed && !fileActivity.processing, '解码失败后恢复');
     const toBlob = HTMLCanvasElement.prototype.toBlob;
     HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
     try { failed = false; try { await saveImage(file); } catch { failed = true; } check(failed, '空压缩结果不能保存'); }
     finally { HTMLCanvasElement.prototype.toBlob = toBlob; }
    } finally { window.createImageBitmap = bitmap; }
    // 异常路径不能遗留全局锁或未处理 Promise。
    const append = document.body.append;
    document.body.append = () => { throw Error('模拟挂载失败'); };
    try { check((await pickFile()).length === 0 && !fileActivity.selecting, '挂载失败清理'); }
    finally { document.body.append = append; }
    pending = pickFile(); fileActivity.cancel(); await pending;
    const createURL = URL.createObjectURL;
    URL.createObjectURL = () => { throw Error('模拟 URL 创建失败'); };
    try {
     pending = pickAndCrop(); select();
     check(await pending === null && !fileActivity.cropping && !cropState.open, 'URL 失败不能遗留裁剪锁');
    } finally { URL.createObjectURL = createURL; }
    const {set} = await import('/src/lib/kv.js');
    await set('img:review-concurrent', file);
    let created = 0;
    URL.createObjectURL = value => { created++; return createURL(value); };
    try {
     const urls = await Promise.all([imageURL('review-concurrent'), imageURL('review-concurrent')]);
     check(urls[0] === urls[1] && created === 1, '并发读取只创建一个 URL');
    } finally { URL.createObjectURL = createURL; }
    const {effectScope, ref, nextTick} = await import('/node_modules/.vite/deps/vue.js');
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function () { throw Error('模拟读取失败'); };
    const scope = effectScope();
    let displayed;
    try {
     scope.run(() => { displayed = useImage(() => 'review-read-failure'); });
     await new Promise(r => setTimeout(r, 50));
     check(displayed.value === null, '读取失败清空显示');
    } finally { scope.stop(); IDBObjectStore.prototype.get = get; }
    // 旧异步结果和组件卸载后均不能回写。
    const id = ref('review-concurrent'); const scope2 = effectScope();
    scope2.run(() => { displayed = useImage(() => id.value); });
    id.value = null; await nextTick(); await new Promise(r => setTimeout(r, 50));
    check(displayed.value === null, '旧结果不能覆盖新状态'); scope2.stop();
    const {seeFiles} = await import('/src/lib/seeFiles.js');
    const bitmapForFailure = window.createImageBitmap;
    const context = HTMLCanvasElement.prototype.getContext;
    let closed = 0;
    window.createImageBitmap = async () => ({width: 20, height: 30, close() { closed++; }});
    HTMLCanvasElement.prototype.getContext = () => null;
    try {
     const result = await seeFiles([file]);
     check(closed === 1 && result.parts.length === 0 && result.seen[0].includes('没读出来'), '工作间转码失败释放 bitmap');
    } finally { window.createImageBitmap = bitmapForFailure; HTMLCanvasElement.prototype.getContext = context; }
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new Error('模拟存储空间不足'); };
    try { let failed = false; try { await saveImage(file); } catch { failed = true; } check(failed && !fileActivity.processing, '存储失败必须上报并解锁'); }
    finally { IDBObjectStore.prototype.put = put; }
    pending = pickAndCrop(); select(); await new Promise(r => setTimeout(r, 50));
    check(cropState.open, '一次选择即打开裁剪');
    check((await pickFile()).length === 0, '裁剪不能被重复选择覆盖');
    finishCrop(null); check(await pending === null, '裁剪取消恢复');
    pending = pickAndCrop(); select(); await new Promise(r => setTimeout(r, 50));
    document.querySelector('.crop img').dispatchEvent(new Event('error'));
    check(await pending === null && !cropState.open, '加载失败退出并提示');
    fileActivity.processing = 1;
    return '选图竞态、同文件重选、取消、解码回退、压缩存储、失败解锁、裁剪通过';
   } finally { HTMLInputElement.prototype.click = click; }
  });
  assert.match(result, /通过/);
  assert.deepEqual(errors, [], '不应有未捕获的浏览器异常');
  for (const theme of ['light', 'dark']) {
   await page.evaluate(async t => { const {store} = await import('/src/store/index.js'); store.settings.theme = t; document.documentElement.dataset.theme = t; }, theme);
   await page.screenshot({ path: `/tmp/image-picker-${theme}.png` });
  }
  await page.evaluate(async () => { const {fileActivity} = await import('/src/lib/filePicker.js'); fileActivity.processing = 0; });
  console.log(result);
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
