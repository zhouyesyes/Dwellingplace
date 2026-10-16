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
  for (const [name, bytes, encoding] of [
    ['UTF8', Buffer.from(text), 'utf-8'],
    ['UTF8-BOM', Buffer.concat([Buffer.from([239,187,191]), Buffer.from(text)]), 'utf-8'],
    ['GBK', encoded('GBK'), 'gb18030'],
    ['GB18030', encoded('GB18030'), 'gb18030'],
    ['UTF16LE', encoded('UTF-16LE'), 'utf-16le'],
    ['UTF16BE', encoded('UTF-16BE'), 'utf-16be'],
    ['UTF16-BOM', Buffer.concat([Buffer.from([255,254]), encoded('UTF-16LE')]), 'utf-16le'],
  ]) {
    await open(bytes, name);
    assert.equal(await page.getByLabel('TXT 编码').inputValue(), encoding);
    assert.equal(await page.locator('.txt-preview').textContent(), text);
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
    await page.goto(page.url().split('#')[0] + '#/books');
    await page.getByRole('button', {name:'放一本书',exact:true}).first().waitFor();
  }
  await open(Buffer.from(text), '预览示例');
  await page.getByLabel('TXT 编码').selectOption('utf-16be');
  assert.equal(await page.getByRole('button',{name:'确认导入',exact:true}).isDisabled(),true);
  await page.getByLabel('TXT 编码').selectOption('utf-8');
  await page.screenshot({path:path.join(output,`${view}-${theme}-preview.png`)});
};
