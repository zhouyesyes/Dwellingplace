// 同步时把 meta 这一整份拆成几个板块各存各的：只交改了的板块，只取改了的板块
// 本机 IndexedDB 里 meta 还是一整份，拆和拼只发生在同步这一层（服务器上的键是 meta:<板块名>）
// 没列在这里的新字段一律归到 core，不会丢
const GROUPS = {
  books: ["books", "readerPrefs", "readerFonts"], // 书架 / 书的信息（读到哪、读了多久也在里面）
  notes: ["bookNotes", "writeNotes", "writeCards", "writings", "reviews"], // 便利贴批注、共写
  memories: ["memories", "diary", "penpals", "favorites"], // 记忆
  tide: ["meanwhile", "moments", "events", "anniversaries"], // 潮间带、日历、纪念日
  letters: ["letters"], // 信
  usage: ["usage", "turnLog", "planSnap", "searchLog", "recallLog", "readingLog"], // 用量统计（高频小改动）
  roles: ["roles", "wake"], // 角色设定、唤醒记录
  archive: ["archive", "groups"], // 旧居（只读）
  rooms: ["threads", "group", "gardenTalk", "toolRooms", "roomIntros"], // 对话列表、小房间
  stickers: ["stickers", "media"], // 表情包
};
const OF = {};
for (const [name, keys] of Object.entries(GROUPS)) for (const k of keys) OF[k] = name;

export const sectionKey = name => `meta:${name}`;
export const sectionName = k => (k.startsWith("meta:") ? k.slice(5) : null);
export const sectionOf = key => OF[key] || "core";

const isObj = v => v && typeof v === "object" && !Array.isArray(v);

// meta → { 板块名: { 顶层字段: 值 } }（空板块不出现）
export function splitMeta(meta) {
  const out = {};
  if (!isObj(meta)) return out;
  for (const [k, v] of Object.entries(meta)) (out[sectionOf(k)] ??= {})[k] = v;
  return out;
}
// 板块拼回 meta；rest 是已有的 meta，没出现在板块里的字段保留
export function joinMeta(parts, rest = {}) {
  const out = { ...rest };
  for (const p of Object.values(parts)) if (isObj(p)) Object.assign(out, p);
  return out;
}
// 每个字段的数量（数组看条数，对象看键数），迁移后逐项核对
export function countMeta(meta) {
  const c = {};
  for (const [k, v] of Object.entries(isObj(meta) ? meta : {})) c[k] = Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 1;
  return c;
}

// 高频小改动：先攒着再交（和 sync.js 里的 lazy 一致）。返回「去掉高频字段后的指纹原料」，没有就是这个板块没有高频字段
const LAZY_BOOK = ["pos", "readSecs", "readAt"];
export function lazyPart(name, val) {
  if (name === "usage") return "usage";
  if (name === "books" && isObj(val)) {
    const o = { ...val };
    if (Array.isArray(o.books)) o.books = o.books.map(b => { if (!isObj(b)) return b; const c = { ...b }; for (const f of LAZY_BOOK) delete c[f]; return c; });
    return JSON.stringify(o);
  }
  return null;
}
