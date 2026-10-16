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

// 收尾复核：正常 UTF-8 不因英文、emoji 或扩展区汉字被禁用。
for (const value of ['普通中文小说。', 'Plain English text.\r\n123', '😀👩🏽‍💻🌙❤️', '𠀀𠮷龘䶮𰻞', '第一章\n她说：你好😀𠮷。']) {
  for (const bom of [false, true]) {
    const bytes = Buffer.concat([bom ? Buffer.from([239,187,191]) : Buffer.alloc(0), Buffer.from(value)]);
    const result = decodeTxt(bytes);
    assert.equal(result.encoding, 'utf-8');
    assert.equal(result.text, value);
    assert.equal(result.suspicious, false);
  }
}
// 0x8189 在 GB18030 是「亯」，在 UTF-16LE 是「要」；常见字评分不是可靠证据。
const ambiguous = Buffer.from([0x81, 0x89]);
assert.equal(decodeTxt(ambiguous).encoding, 'utf-16le');
assert.equal(decodeTxt(ambiguous, 'gb18030').text, '亯');
assert.equal(decodeTxt(ambiguous, 'gb18030').suspicious, false);
for (const e of ['UTF-16LE', 'UTF-16BE']) {
  const value = '章节目录';
  const result = decodeTxt(encode(value, e), e.toLowerCase());
  assert.equal(result.text, value);
  assert.equal(result.suspicious, false);
}
// BOM 优先于正文的统计特征，UTF-16BE BOM 以及空文件也要稳定。
assert.equal(decodeTxt(Buffer.concat([Buffer.from([254,255]), encode(text, 'UTF-16BE')])).text, text);
assert.equal(decodeTxt(Buffer.alloc(0)).text, '');
console.log('收尾复核回归通过（UTF-8 emoji/生僻字、BOM、手动纠正歧义编码）');
