// 覆盖导入只处理选中的书；正文和笔记在事务成功前都保持原样。
import { store, prepareBookPersistence, commitBookTransaction } from '../store/index.js';
import { get } from './kv.js';
import { parseEpub, parseTxt, replaceBookCache, shelfChapters } from './books.js';
import { saveImage } from './images.js';
const copy = x => JSON.parse(JSON.stringify(x));
const norm = s => (s || '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
const backupKey = id => `sync:book-reimport:${id}`;
const imageCount = body => body.chapters.reduce((n, c) => n + (c.media?.length || 0), 0);
const stateOf = id => JSON.stringify({ book: { ...store.books.find(b => b.id === id), readSecs: undefined }, notes: (store.bookNotes || []).filter(n => n.bookId === id) });
const plans = new WeakMap();

export function migrateReading(book, notes, oldBody, body) {
  const cs = body.chapters;
  const chapterTexts = cs.map(c => new Set(c.paras.map(norm)));
  const matches = oldBody.chapters.map((old, oi) => {
    const anchors = old.paras.filter(p => norm(p).length >= 16);
    const ranked = cs.map((c, i) => {
      const hit = anchors.filter(p => chapterTexts[i].has(norm(p))).length / Math.max(1, anchors.length);
      const stable = (old.sourcePath && old.sourcePath === c.sourcePath) || (old.sourceId && old.sourceId === c.sourceId);
      const title = norm(old.title) && norm(old.title) === norm(c.title);
      return { i, hit, score: hit * 8 + (stable ? 3 : 0) + (title ? 3 : 0) + (i === oi ? .1 : 0) };
    }).sort((a, b) => b.score - a.score);
    const best = ranked[0];
    return best && best.score >= 3 && (!ranked[1] || best.score - ranked[1].score >= 1) ? best.i : null;
  });
  function locate(ch, p, quote, offset) {
    const old = oldBody.chapters[ch]?.paras[p];
    const target = matches[ch];
    const find = (text, exact) => {
      if (!text) return [];
      const hits = [];
      cs.forEach((c, ci) => c.paras.forEach((v, pi) => {
        if (exact) { if (v === text) hits.push({ ch: ci, p: pi, start: 0 }); }
        else {
          // 每个字符位置都是独立候选，包括同段重复及重叠的摘录。
          for (let start = v.indexOf(text); start >= 0; start = v.indexOf(text, start + 1)) hits.push({ ch: ci, p: pi, start });
        }
      }));
      const local = hits.filter(h => h.ch === target);
      return local.length ? local : hits;
    };
    let hits = find(old, true);
    if (hits.length === 1) {
      const h = hits[0], v = cs[h.ch].paras[h.p];
      if (!quote) return h;
      if (Number.isInteger(offset) && v.slice(offset, offset + quote.length) === quote) return { ...h, start: offset };
      const start = v.indexOf(quote);
      if (start >= 0 && v.indexOf(quote, start + 1) < 0) return { ...h, start };
      return null;
    }
    if (norm(quote).length < 8) return null;
    hits = find(quote, false);
    return hits.length === 1 ? hits[0] : null;
  }
  let approximate = 0;
  const position = pos => {
    const exact = locate(pos.ch, pos.p);
    if (exact) return { ...pos, ch: exact.ch, p: exact.p };
    approximate++;
    const ch = matches[pos.ch] ?? 0;
    const p = matches[pos.ch] == null ? 0 : Math.min(Math.max(0, Math.round((pos.p || 0) / Math.max(1, oldBody.chapters[pos.ch]?.paras.length || 1) * cs[ch].paras.length)), Math.max(0, cs[ch].paras.length - 1));
    return { ...pos, ch, p };
  };
  // 其他阅读历史中的 from / upTo 等坐标也一并迁移，内容和未知字段原样保留。
  const walk = value => {
    if (!value || typeof value !== 'object') return value;
    if (Number.isInteger(value.ch) && Number.isInteger(value.p)) return position(value);
    if (Array.isArray(value)) return value.map(walk);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
  };
  const nextBook = walk(copy(book));
  nextBook.chapters = shelfChapters(cs);
  let moved = 0;
  const nextNotes = notes.map(n => {
    if (n.unlocated || n.removedCh) return copy(n); // 移除章节上的笔记跟着那一章收着
    const old = oldBody.chapters[n.ch];
    const selection = n.start != null ? old?.paras[n.p]?.slice(n.start, n.end) : '';
    const quote = selection && (!n.quote || selection.startsWith(n.quote)) ? selection : n.quote || '';
    const hit = locate(n.ch, n.p, quote, n.start);
    if (!hit) return { ...copy(n), ch: -1, p: -1, unlocated: { chapter: old?.title || `第 ${n.ch + 1} 章`, ch: n.ch, p: n.p, quote: quote || old?.paras[n.p] || '', start: n.start, end: n.end } };
    moved++;
    const next = { ...copy(n), ch: hit.ch, p: hit.p };
    if (n.start != null && quote) Object.assign(next, { start: hit.start, end: hit.start + quote.length });
    return next;
  });
  return { book: nextBook, notes: nextNotes, matches, moved, unresolved: nextNotes.filter(n => n.unlocated).length, approximate };
}

// txtOptions：TXT 在分章预览里定下来的 { encoding, rule, edits }
export async function previewReimport(id, file, txtOptions) {
  if (!/\.(epub|txt)$/i.test(file.name)) throw Error('请选择 EPUB 或 TXT 文件');
  if (file.size > 100 * 1024 * 1024) throw Error('文件过大，请选择小于 100 MB 的文件');
  const isTxt = /\.txt$/i.test(file.name);
  await prepareBookPersistence();
  const book = store.books.find(b => b.id === id);
  if (!book) throw Error('这本书已不在书架上');
  const before = stateOf(id), saved = await get(`book:${id}`);
  if (!saved?.chapters?.length) throw Error('旧书正文暂不可用，不能覆盖');
  const oldBody = copy(saved);
  let parsed;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    parsed = isTxt ? parseTxt(buf, file.name.replace(/\.[^.]+$/, ''), txtOptions?.encoding, txtOptions?.rule, txtOptions?.edits) : await parseEpub(buf);
  } catch (e) {
    if (isTxt) throw e;
    if (e.code !== 'EPUB_STRUCTURE') throw e;
    return { id, title: book.title, newTitle: '文件异常', author: '无法读取', oldChapters: oldBody.chapters.length, newChapters: '无法读取', oldImages: imageCount(oldBody), newImages: '无法读取', moved: 0, unresolved: 0, approximate: 0, pending: [], allowed: false, reason: e.message };
  }
  const body = { chapters: parsed.chapters, resources: parsed.resources || {} };
  // 以前手动移除的章节：新文件里同一章（同一个编号，或者内容大半一样）还是收在「已移除」里，不会又冒出来
  if (oldBody.removed?.length) {
    const removed = oldBody.removed.map(r => ({ ...r }));
    body.chapters = body.chapters.filter(c => {
      const texts = new Set(c.paras.map(norm));
      const k = removed.findIndex(r => r.id === c.id || (r.paras.length && r.paras.filter(p => norm(p).length >= 8 && texts.has(norm(p))).length / r.paras.length >= .6));
      if (k < 0) return true;
      removed[k] = { ...c, id: removed[k].id, at: removed[k].at, removedAt: removed[k].removedAt };
      return false;
    });
    body.removed = removed;
  }
  if (!body.chapters.length) throw Error('文件中没有可用章节，旧书未改动');
  if (body.chapters.some(c => c.media?.some(m => !m.resource || !body.resources[m.resource]))) throw Error('文件有缺失的插图资源，请换用完整 EPUB，旧书未改动');
  const referenced = new Set(body.chapters.flatMap(c => (c.media || []).map(m => m.resource)));
  for (const resource of referenced) {
    const image = new Image();
    image.src = body.resources[resource];
    let timer;
    try {
      await Promise.race([image.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('图片解码超时')), 8000); })]);
    } catch { throw Error('文件中的插图无法读取，请换用完整 EPUB，旧书未改动'); }
    finally { clearTimeout(timer); image.src = ''; }
  }
  const notes = copy((store.bookNotes || []).filter(n => n.bookId === id));
  const migration = migrateReading(book, notes, oldBody, body);
  const anchors = oldBody.chapters.flatMap(c => c.paras).filter(p => norm(p).length >= 16);
  const texts = new Set(body.chapters.flatMap(c => c.paras).map(norm));
  const overlap = anchors.filter(p => texts.has(norm(p))).length / Math.max(1, anchors.length);
  const titleOK = norm(book.title) === norm(parsed.title);
  const authorOK = !book.author || !parsed.author || norm(book.author) === norm(parsed.author);
  // TXT 的书名只是文件名，对不上不拒，改看正文段落对上的比例；比例低就让她自己确认一下
  const txtLow = isTxt && overlap < .45;
  const allowed = isTxt ? true : titleOK && authorOK && overlap >= .45;
  const pct = Math.round(overlap * 100);
  const reason = isTxt
    ? (txtLow ? `正文只有约 ${pct}% 的段落和书架上这本对得上，可能不是同一本，也可能是分段不一样。请确认后再覆盖。` : `正文约 ${pct}% 的段落和书架上这本对得上，核对通过。`)
    : allowed ? '书名与正文核对通过；已核对文件提供的作者信息' : '书名或作者不同，或正文相似度不足；为保护旧书，不能覆盖。';
  const preview = { id, title: book.title, newTitle: isTxt ? file.name : (parsed.title || '未提供书名'), author: isTxt ? 'TXT（没有作者信息）' : (parsed.author || '未提供作者'), oldChapters: oldBody.chapters.length, newChapters: body.chapters.length, oldImages: imageCount(oldBody), newImages: imageCount(body), moved: migration.moved, unresolved: migration.unresolved, approximate: migration.approximate, allowed, reason, isTxt, needSure: txtLow, overlap, pending: migration.notes.filter(n => n.unlocated) };
  plans.set(preview, { before, oldBody, body, migration, cover: book.cover ? null : parsed.cover });
  return preview;
}

export async function confirmReimport(preview) {
  const plan = plans.get(preview);
  if (!plan || !preview.allowed) throw Error('请先重新选择文件并核对预览');
  const latestMeta = await prepareBookPersistence();
  if (stateOf(preview.id) !== plan.before) throw Error('预览后阅读数据发生变化，请重新选择文件生成预览');
  const { id } = preview;
  const current = store.books.find(b => b.id === id);
  const coverImage = current.cover ? await get(`img:${current.cover}`) : null;
  if (stateOf(id) !== plan.before) throw Error('阅读数据发生变化，请重新预览');
  const snapshot = { at: Date.now(), book: copy(latestMeta.books.find(b => b.id === id)), notes: copy((latestMeta.bookNotes || []).filter(n => n.bookId === id)), body: plan.oldBody, coverImage };
  // 旧书没封面、新文件有：补上
  const cover = plan.cover ? await saveImage(plan.cover, { maxSize: 600, quality: 0.85 }).catch(() => null) : null;
  const next = copy(store);
  next.books[next.books.findIndex(b => b.id === id)] = { ...plan.migration.book, ...(cover ? { cover } : {}), readSecs: current.readSecs, reimport: { at: snapshot.at, moved: preview.moved, unresolved: preview.unresolved, approximate: preview.approximate } };
  const migrated = new Map(plan.migration.notes.map(n => [n.id, n]));
  next.bookNotes = (next.bookNotes || []).map(n => migrated.get(n.id) || n);
  await commitBookTransaction([[backupKey(id), snapshot], [`book:${id}`, plan.body]], next, [[`book:${id}`, plan.oldBody]]);
  replaceBookCache(id, plan.body);
  plans.delete(preview);
}

export async function restoreReimport(id) {
  await prepareBookPersistence();
  const snapshot = await get(backupKey(id));
  const currentBody = await get(`book:${id}`);
  if (!snapshot || !store.books.some(b => b.id === id)) throw Error('没有找到可恢复的备份');
  if (store.books.find(b => b.id === id).reimport?.at !== snapshot.at) throw Error('当前设备没有这次覆盖的备份，请回到执行覆盖的设备恢复');
  // 恢复后新增的笔记也保留，不能因回滚而消失。
  const extras = (store.bookNotes || []).filter(n => n.bookId === id && !snapshot.notes.some(old => old.id === n.id)).map(n => ({ ...copy(n), ch: -1, p: -1, unlocated: n.unlocated || { chapter: store.books.find(b => b.id === id).chapters[n.ch]?.title || '', quote: n.quote, ch: n.ch, p: n.p } }));
  const next = copy(store);
  next.books[next.books.findIndex(b => b.id === id)] = snapshot.book;
  next.bookNotes = (next.bookNotes || []).filter(n => n.bookId !== id).concat(snapshot.notes, extras);
  const entries = [[`book:${id}`, snapshot.body]];
  if (snapshot.book.cover && snapshot.coverImage) entries.push([`img:${snapshot.book.cover}`, snapshot.coverImage]);
  await commitBookTransaction(entries, next, [[`book:${id}`, currentBody]]);
  replaceBookCache(id, snapshot.body);
}
