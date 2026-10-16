// 只在点击共读的瞬间读取可视书页，不查整章图片，也不请求书内路径。
import { safeBookImage } from './epubImages.js';
const intersects = (r, b) => r.width > 0 && r.height > 0 && r.right > b.left + 1 && r.left < b.right - 1 && r.bottom > b.top + 1 && r.top < b.bottom - 1;
export function captureReadingPage(el, book, ch) {
  const box = el.getBoundingClientRect(), chapter = book.chapters[ch];
  const text = [];
  for (const p of el.querySelectorAll('[data-p]')) {
    if (![...p.getClientRects()].some(r => intersects(r, box))) continue;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT), range = document.createRange();
    let node, visible = '';
    while ((node = walker.nextNode())) for (let i = 0; i < node.length; i++) {
      range.setStart(node, i); range.setEnd(node, i + 1);
      if ([...range.getClientRects()].some(r => intersects(r, box))) visible += node.data[i];
    }
    if (visible.trim()) text.push(`[${ch + 1}.${p.dataset.p}] ${visible}`);
  }
  const images = [];
  for (const figure of el.querySelectorAll('[data-media]')) {
    const visual = figure.querySelector('img, .image-missing');
    if (!visual || ![...visual.getClientRects()].some(r => intersects(r, box))) continue;
    const index = Number(figure.dataset.media), m = chapter.media[index];
    images.push({ id: `图${ch + 1}-${index + 1}`, p: m.p, alt: m.alt || '', caption: m.caption || '',
      before: chapter.paras[m.p - 1] || '', after: chapter.paras[m.p] || '',
      source: book.resources?.[m.resource] || '' });
  }
  return { ch, text: text.join('\n'), images };
}
const short = value => String(value || '').slice(0, 400);
// 转成静态 PNG：SVG/GIF 也通过浏览器安全图片解码，绝不把 SVG 直接交给模型。
async function raster(source) {
  const src = safeBookImage(source);
  if (!src) throw Error('图片资源缺失或格式不支持');
  if (src.length > 16 * 1024 * 1024) throw Error('原始图片超过 12 MiB');
  const img = new Image();
  img.src = src;
  let timer;
  try { await Promise.race([img.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('图片解码超时')), 8000); })]); }
  finally { clearTimeout(timer); }
  if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 40_000_000) throw Error('图片尺寸无效或超过 4000 万像素');
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL('image/png').split(',')[1];
  if (data.length > 2 * 1024 * 1024) throw Error('缩放后仍超过单图 2 MiB 编码负载，未继续降质');
  return { type: 'image', mime: 'image/png', data };
}
export async function readingPageParts(page) {
  if (!page?.images?.length) return [];
  const parts = [{ type: 'text', text: `【点击时当前页】\n${page.text}\n仅以下图片实际出现在当前页；后续预读文字不代表其图片已提供。按正文顺序最多提供前 4 张，最长边 1600px，单图编码 2 MiB、图片编码总计 6 MiB；动图仅首帧。占位项没有画面，不得声称看见，不能把 alt 或题注当成视觉证据。` }];
  let total = 0;
  for (let i = 0; i < Math.min(page.images.length, 20); i++) {
    const m = page.images[i];
    const label = `${m.id}（第 ${page.ch + 1} 章，段 ${m.p} 之前）\nalt：${short(m.alt) || '未保存'}\n题注：${short(m.caption) || '未保存'}\n前段：${short(m.before)}\n后段：${short(m.after)}`;
    let image, reason;
    try {
      if (i >= 4) throw Error('超过当前页前 4 张限制');
      image = await raster(m.source);
      if (total + image.data.length > 6 * 1024 * 1024) throw Error('超过图片总编码负载 6 MiB');
      total += image.data.length;
    } catch (e) { reason = e.message || '读取失败'; }
    parts.push({ type: 'text', text: `${label}\n${reason ? `【未提供画面：${reason}】` : '【紧接此标识的图像输入就是本图】'}` });
    if (!reason) parts.push(image);
  }
  if (page.images.length > 20) parts.push({ type: 'text', text: `【另有 ${page.images.length - 20} 张当前页图片未提供画面及逐图定位：${page.images[20].id} 至 ${page.images.at(-1).id}；定位信息最多列出前 20 项。不得推断这些图片内容。】` });
  return parts;
}
