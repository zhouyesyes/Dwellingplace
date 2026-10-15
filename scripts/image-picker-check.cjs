// 临时浏览器和生成的图片，不接触真实数据或外部服务。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch();
 try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  await page.goto('http://127.0.0.1:5199');
  const result = await page.evaluate(async () => {
   const { pickFile, fileActivity, decodeImage } = await import('/src/lib/filePicker.js');
   const { saveImage, pickAndCrop, imageURL } = await import('/src/lib/images.js');
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
  for (const theme of ['light', 'dark']) {
   await page.evaluate(async t => { const {store} = await import('/src/store/index.js'); store.settings.theme = t; document.documentElement.dataset.theme = t; }, theme);
   await page.screenshot({ path: `/tmp/image-picker-${theme}.png` });
  }
  await page.evaluate(async () => { const {fileActivity} = await import('/src/lib/filePicker.js'); fileActivity.processing = 0; });
  console.log(result);
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
