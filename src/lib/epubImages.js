// 只解析书内路径；越过 ZIP 根目录、协议和畸形编码一律拒绝。
export function resolveEpubPath(base, reference) {
  if (typeof reference !== 'string') return '';
  let rel;
  try { rel = decodeURIComponent(reference.split(/[?#]/)[0]); } catch { return ''; }
  if (!rel || /^[\/\\]|[\x00-\x1f\x7f\\]|^[^/]*:/.test(rel)) return '';
  const parts = base.split('/').filter(Boolean);
  for (const part of rel.split('/')) {
    if (part === '..') { if (!parts.length) return ''; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}
export const epubImageType = type => /^image\/(jpeg|jpg|png|gif|webp|svg\+xml)$/i.test(type);
export function imageData(bytes, type) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${type.toLowerCase().replace('image/jpg', 'image/jpeg')};base64,${btoa(binary)}`;
}
// 阅读器只接受保存下来的图片数据，绝不把书内路径交给浏览器请求。
export const safeBookImage = value => typeof value === 'string' && /^data:image\/(jpeg|png|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
