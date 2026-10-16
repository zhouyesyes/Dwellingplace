import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { decodeTxt } from '../src/lib/txtEncoding.js';
const text = '第一章 春天\r\n这是我们的小说，她说我们一起回家。\r\n';
const encode = (text, e) => execFileSync('iconv', ['-f', 'UTF-8', '-t', e], { input: text });
for (const e of ['UTF-8', 'GBK', 'GB18030', 'UTF-16LE', 'UTF-16BE', 'UTF-16']) {
  const bytes = encode(text, e);
  assert.equal(decodeTxt(bytes).text, text, e);
  assert.equal(decodeTxt(bytes).suspicious, false, e);
}
const extended = text + '𠀀';
assert.equal(decodeTxt(encode(extended, 'GB18030')).text, extended);
for (const e of ['UTF-16LE', 'UTF-16BE']) {
  assert.equal(decodeTxt(encode('Hello world\n123456789', e)).text, 'Hello world\n123456789');
}
assert.equal(decodeTxt(encode(text, 'GBK'), 'utf-8').suspicious, true);
assert.equal(decodeTxt(Buffer.from(text), 'gb18030').suspicious, true);
assert.equal(decodeTxt(Buffer.from(text), 'utf-16be').suspicious, true);
assert.equal(decodeTxt(Buffer.from(text + '\0'), 'utf-8').suspicious, true);
assert.equal(decodeTxt(Buffer.from(text.repeat(300) + '\uFFFD'), 'utf-8').suspicious, true);
assert.equal(decodeTxt(Buffer.from('Plain ASCII\n1234')).text, 'Plain ASCII\n1234');
console.log('TXT 编码逻辑回归通过（含 GB18030 四字节、无 BOM UTF-16、全文末尾异常）');
