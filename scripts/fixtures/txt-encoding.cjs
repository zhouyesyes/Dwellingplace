const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const text = '第一章 春天\n这是我们的中文小说，他在这里读书。\n第二章 晚风\n她说：今天的天气很好，我们一起回家。';
const encoded = e => execFileSync('iconv', ['-f', 'UTF-8', '-t', e], { input: text });
exports.install = async () => ({});
exports.prepare = async (page, origin) => page.goto(origin + '/#/books');
exports.verify = async (page, fixture, { output, view, theme }) => {
  async function open(buffer, name) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '放一本书', exact: true }).first().click();
    await (await chooser).setFiles({ name: name + '.txt', mimeType: 'text/plain', buffer });
    await page.getByRole('dialog').waitFor();
  }
  for (const [name, bytes, encoding, expected = text, manual] of [
    ['UTF8', Buffer.from(text), 'utf-8'],
    ['UTF8-BOM', Buffer.concat([Buffer.from([239,187,191]), Buffer.from(text)]), 'utf-8'],
    ['GBK', encoded('GBK'), 'gb18030'],
    ['GB18030', encoded('GB18030'), 'gb18030'],
    ['UTF16LE', encoded('UTF-16LE'), 'utf-16le'],
    ['UTF16BE', encoded('UTF-16BE'), 'utf-16be'],
    ['UTF8-English', Buffer.from('Plain English text.\nA second paragraph.'), 'utf-8', 'Plain English text.\nA second paragraph.'],
    ['UTF8-emoji', Buffer.from('她说：你好😀👩🏽‍💻𠀀𠮷龘䶮𰻞。'), 'utf-8', '她说：你好😀👩🏽‍💻𠀀𠮷龘䶮𰻞。'],
    ['GB18030-歧义', Buffer.from([0x81,0x89]), 'utf-16le', '亯', 'gb18030'],
    ['UTF16BE-BOM', Buffer.concat([Buffer.from([254,255]), encoded('UTF-16BE')]), 'utf-16be'],
    ['UTF16-BOM', Buffer.concat([Buffer.from([255,254]), encoded('UTF-16LE')]), 'utf-16le'],
  ]) {
    await open(bytes, name);
    assert.equal(await page.getByLabel('TXT 编码').inputValue(), encoding);
    if (manual) await page.getByLabel('TXT 编码').selectOption(manual);
    assert.equal(await page.locator('.txt-preview').textContent(), expected);
    assert.equal(await page.getByRole('button', {name:'确认导入',exact:true}).isEnabled(), true);
    if (name === 'GBK') {
      await page.getByLabel('TXT 编码').selectOption('utf-8');
      await page.getByRole('alert').waitFor();
      assert.equal(await page.getByRole('button', {name:'确认导入',exact:true}).isDisabled(), true);
      await page.screenshot({path:path.join(output,`${view}-${theme}-wrong.png`)});
      await page.getByLabel('TXT 编码').selectOption('gb18030');
      assert.equal(await page.locator('.txt-preview').textContent(), text);
    }
    await page.getByRole('button', {name:'确认导入',exact:true}).click();
    await page.waitForURL(/#\/read\//);
    const id = page.url().split('/read/')[1];
    const saved = await page.evaluate(id => new Promise((resolve, reject) => {
      const request = indexedDB.open('keyval-store');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('keyval', 'readonly');
        const get = tx.objectStore('keyval').get('book:' + id);
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
        tx.oncomplete = () => db.close();
      };
    }), id);
    // 核对实际持久化的正文和旧分章结果，不能仅以跳转成功代替导入验收。
    if (expected === text) {
      assert.deepEqual(saved.chapters.map(c => c.title), ['第一章 春天', '第二章 晚风']);
      assert.equal(saved.chapters.map(c => c.paras.join('\n')).join('\n'), text.split('\n').filter(l => !l.startsWith('第')).join('\n'));
    } else assert.equal(saved.chapters.flatMap(c => c.paras).join('\n'), expected);
    await page.goto(page.url().split('#')[0] + '#/books');
    await page.getByRole('button', {name:'放一本书',exact:true}).first().waitFor();
  }
  await open(Buffer.from(text), '预览示例');
  await page.getByLabel('TXT 编码').selectOption('utf-16be');
  assert.equal(await page.getByRole('button',{name:'确认导入',exact:true}).isDisabled(),true);
  await page.getByLabel('TXT 编码').selectOption('utf-8');
  await page.screenshot({path:path.join(output,`${view}-${theme}-preview.png`)});
};
