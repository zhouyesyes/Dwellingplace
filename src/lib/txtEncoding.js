// 只负责 TXT 字节与正文之间的转换，不参与分章。
export const TXT_ENCODINGS = ['utf-8', 'gb18030', 'utf-16le', 'utf-16be'];
export const encodingLabel = encoding => encoding.toUpperCase();
const common = /[的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经之进着等部度家里如水天书你她]/gu;
function inspect(text) {
  const replacements = (text.match(/\uFFFD/gu) || []).length;
  const controls = (text.match(/[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f\uFDD0-\uFDEF\uFFFE\uFFFF]/gu) || []).length;
  const frequent = (text.match(common) || []).length;
  let length = 0;
  for (const char of text) length++;
  length = Math.max(1, length);
  const bad = replacements + controls;
  // 网文符号、英文、生僻字和私用区字形都不是乱码证据；偶尔引用 � 也可正常阅读。
  const suspicious = (replacements >= 3 && replacements / length > .005) || controls > Math.max(1, length * .002);
  const usable = !!text.trim() && replacements / length < .1 && controls / length < .02;
  return { bad, suspicious, usable, score: frequent / length - bad / length * 20 };
}
function read(bytes, encoding) {
  const text = new TextDecoder(encoding).decode(bytes);
  return { encoding, text, ...inspect(text) };
}
function signatureEncoding(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  // 无 BOM 的 UTF-16：ASCII 所在的奇偶字节常有零；纯中文用常见汉字比例辅助判断。
  if (bytes.length % 2 === 0 && bytes.length >= 4) {
    let even = 0, odd = 0;
    for (let i = 0; i < bytes.length; i += 2) {
      if (bytes[i] === 0) even++;
      if (bytes[i + 1] === 0) odd++;
    }
    if (odd > bytes.length * .15 && even < odd * .2) return 'utf-16le';
    if (even > bytes.length * .15 && odd < even * .2) return 'utf-16be';
  }
  return null;
}
export function detectTxtEncoding(bytes) {
  const signature = signatureEncoding(bytes);
  if (signature) return signature;
  const candidates = TXT_ENCODINGS.map(e => read(bytes, e));
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {}
  const gb = candidates[1];
  const wide = candidates.slice(2).sort((a, b) => b.score - a.score)[0];
  return bytes.length % 2 === 0 && !wide.suspicious && wide.score > gb.score + .06 ? wide.encoding : 'gb18030';
}
// 置信度只决定是否先展示预览，不拿自动猜测否决手动选择。
export function analyzeTxt(bytes) {
  const encoding = detectTxtEncoding(bytes);
  const result = read(bytes, encoding);
  let validUtf8 = false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); validUtf8 = true; } catch {}
  const signature = signatureEncoding(bytes);
  const alternatives = TXT_ENCODINGS.filter(e => e !== encoding).map(e => read(bytes, e));
  const gap = result.score - Math.max(...alternatives.map(c => c.score));
  const confident = !!signature || (encoding === 'utf-8' && validUtf8) ||
    (result.text.length >= 20 && result.score > .04 && gap > .06);
  return { ...result, confident, needsPreview: !confident || result.suspicious || !result.usable };
}
export function decodeTxt(bytes, encoding = detectTxtEncoding(bytes)) {
  if (!TXT_ENCODINGS.includes(encoding)) throw new Error('不支持这个 TXT 编码');
  return read(bytes, encoding);
}
