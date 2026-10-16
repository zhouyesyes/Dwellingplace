// 只负责 TXT 字节与正文之间的转换，不参与分章。
export const TXT_ENCODINGS = ['utf-8', 'gb18030', 'utf-16le', 'utf-16be'];
export const encodingLabel = encoding => encoding.toUpperCase();
const common = /[的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经之进着等部度家里如水天书你她]/gu;
function inspect(text) {
  const bad = (text.match(/[\uFFFD\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f\uFDD0-\uFDEF\uFFFE\uFFFF]/gu) || []).length;
  const unusual = (text.match(/[\uE000-\uF8FF]/gu) || []).length;
  const frequent = (text.match(common) || []).length;
  const length = Math.max(1, text.length);
  return { bad, suspicious: bad > 0 || unusual > Math.max(2, length * .01), score: frequent / length - bad / length * 20 - unusual / length * 3 };
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
  const utf8 = candidates[0];
  if (!utf8.bad) return 'utf-8';
  const gb = candidates[1];
  const wide = candidates.slice(2).sort((a, b) => b.score - a.score)[0];
  return bytes.length % 2 === 0 && !wide.suspicious && wide.score > gb.score + .06 ? wide.encoding : 'gb18030';
}
export function decodeTxt(bytes, encoding = detectTxtEncoding(bytes)) {
  if (!TXT_ENCODINGS.includes(encoding)) throw new Error('不支持这个 TXT 编码');
  const result = read(bytes, encoding);
  const detected = detectTxtEncoding(bytes);
  const best = read(bytes, detected);
  // 常见汉字评分只能辅助识别，不能据此否决手动选择的生僻字正文。
  // 仅在有 BOM、零字节特征或有效 UTF-8 的依据时，补充检查明显劣化的结果。
  const reliable = signatureEncoding(bytes) === detected || (detected === 'utf-8' && !best.bad);
  result.suspicious ||= reliable && encoding !== detected && !best.suspicious && best.score > result.score + .06;
  return result;
}
