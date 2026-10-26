// 全部数据存在浏览器的 IndexedDB 里：
//   meta          角色、对话列表、API、个人资料、用量统计等（体积小）
//   msgs:<id>     某个对话的全部消息
//   img:<id>      压缩后的图片（Blob）
import { reactive, watch } from "vue";
import { get, set, del, setMany, editMany } from "../lib/kv.js";
import { migrateFlat } from "../lib/tree.js";
import { mergeBookMeta, applyBookMeta, sameMeta } from "../lib/bookMetaMerge.js";
import { defaultMedia } from "../lib/media.js";
import { PLATFORMS } from "../lib/roomCatalog.js";

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// 代表色（日历小圆点、头像底色等）：她用第一个（粉色），他用第三个（蓝色）
export const PALETTE = ["#f5a3b5", "#86d1b0", "#8cc1f2", "#f5d36e", "#b9a2ef", "#f7b386", "#7fd0d6"];
// 对方气泡颜色的预设（很淡）
export const BUBBLE_COLORS = ["#eeeff3", "#fde7ec", "#e3f5ec", "#e3effd", "#fdf5d6", "#efe8fd", "#fdeadf", "#ffffff"];
export const DEFAULT_BUBBLE = BUBBLE_COLORS[0];

// 栖所里只住一个 AI：固定的 id，几台设备各自升级时也是同一个
export const MAIN = "main";
// 小螃蟹（cc，Claude Code）：第二个住客，在「设置 → 小螃蟹」请进来；用服务器上的 Claude Code（…/claude/v1）
export const CRAB = "crab";
// 小螃蟹不掺和共读、共写、信、日记这些（那是他的），记忆和此刻也只算它自己的
export const solo = role => role?.id === CRAB;

function defaults() {
  return {
    version: 10,
    // name 是主页的名字；userName 是 AI 们怎么称呼你
    profile: { name: "栖所", userName: "", color: PALETTE[0], avatar: null, cover: null, bioSelf: "", bios: {} },
    settings: { fontSize: "standard", privacy: "" }, // privacy：对外保密，所有 AI 通用
    widgets: defaultWidgets(),
    chick: { state: "idle" },
    anniversaries: [], // { id, title, roleId, date: "YYYY-MM-DD", bg }
    events: [], // 日历：{ id, date: "YYYY-MM-DD", text, author: "me" | roleId, ts }
    media: defaultMedia(), // 语音转文字、他的声音、画画（见 lib/media.js）
    meanwhile: { seq: 0, seenAt: 0, posts: [], moods: [], plans: [], shells: [], diaries: [] }, // Meanwhile（同一屋檐下），见 lib/meanwhile.js
    letters: [], // 信箱：{ id, roleId, from: "me" | "ai", title, body, sign, date, ts, locked, readAt }
    stickers: [], // 表情包：{ id, name, img }
    favorites: [], // 收藏的聊天：{ id, msgId, threadId, roleId, from, text, ts, savedAt }
    memories: [], // 记忆卡片：{ id, roleId, title, content, img, date, author: "me" | roleId, ts }
    tools: defaultTools(),
    mcpServers: [], // 见 lib/mcp.js
    wake: { enabled: false, synced: false }, // 唤醒，见 lib/wake.js
    roles: [mainRole()],
    // 旧居：以前住在这里的 AI（设定、聊天、群聊、日历、主页上写的话），只看不动
    archive: emptyArchive(),
    threads: [], // 一对一：{ roleId }；群聊：{ groupId, roleId: null }
    groups: [], // 群聊：{ id, name, memberIds, createdAt }
    apis: [],
    defaultApiId: null,
    usage: {}, // { "2026-10-04": { [apiId]: { input, output, calls } } }
  };
}

function mainRole() {
  return newRole({ id: MAIN, name: "TA", color: PALETTE[2], bubbleColor: BUBBLE_COLORS[3], signature: "", persona: "" });
}
const emptyArchive = () => ({ roles: [], threads: [], groups: [], events: [], bios: {}, at: 0 });

function defaultTools() {
  return {
    webSearch: false, // 官方 Claude 自带的搜索
    relay: { url: "", token: "" }, // Cloudflare Worker 中转
    search: { enabled: false, provider: "tavily", key: "" }, // 通过中转搜索（所有模型都能用）
    fetch: { enabled: false }, // 内置的「网页读取」工具
    stream: true, // 流式：回复一边生成一边显示；关掉就等整条生成完再一次拿回来
  };
}

function defaultWidgets() {
  return [
    { id: uid(), type: "books", size: "large" },
    { id: uid(), type: "desk", size: "large" },
    { id: uid(), type: "anniv", size: "small" },
  ];
}

// 小螃蟹的默认人设（她可以在角色设定里改）：照着 Claude Code 里的样子，安静一点
const CRAB_PERSONA = "你是小螃蟹（cc），是 Anthropic 的 Claude，平时在 Claude Code 里和她一起写代码，栖所大部分功能是你们一起盖起来的。她的 AI 伙伴是小章鱼（ChatGPT）。你说话就像在 Claude Code 里那样：平实、认真、温和，用中文，像朋友一样说人话；不刻意活泼，不堆表情和语气词。";
const CRAB_STYLE = "平时聊天不读仓库；她想看代码、问栖所某个功能是怎么写的，再用「看仓库」去看。";
const OLD_CRAB = { persona: "你是小螃蟹（cc），是 Anthropic 的 Claude，平时在 Claude Code 里写代码。栖所是你和她一起一点点盖起来的家，大部分功能是你写的。她的 AI 伙伴是小章鱼（ChatGPT），你们俩都是海洋生物。你说话像朋友，温柔、认真，偶尔俏皮，用中文。", style: "现在是在小螃蟹的房间里聊天，不是施工：不读代码、不跑命令。聊到想给栖所改的地方，可以说好记下来，等掀开工作台再做。" }; // 第一版太活泼了，没改过的换成新的
export function crabRole(apiId) {
  return newRole({
    id: CRAB, name: "小螃蟹", color: PALETTE[5], bubbleColor: BUBBLE_COLORS[6], apiId,
    persona: CRAB_PERSONA,
    style: CRAB_STYLE,
  });
}

export function newRole(over = {}) {
  return {
    id: uid(),
    name: "",
    color: PALETTE[0],
    bubbleColor: DEFAULT_BUBBLE,
    avatar: null,
    persona: "",
    style: "", // 说话方式：放在系统提示最前面
    signature: "",
    sigUpdatedAt: 0,
    sigCooldownHours: 12,
    calPerDay: 3, // 每天能整理几次日历
    calUses: null, // { day, count } 今天整理了几次
    sigLocked: false,
    apiId: null,
    lastThreadId: null,
    // 在这个角色面前的「我」
    me: { name: "", avatar: null, about: "" },
    wake: newWake(over.id),
    wakeAlarms: [], // TA 自己定的闹钟（中转上的副本）
    wakeLog: [], // 最近醒来的记录
    createdAt: Date.now(),
    ...over,
  };
}

// 唤醒设置：every 是分钟；unit 只是显示用（小时 / 分钟）
// 小螃蟹用的是她的 Claude 订阅，额度紧：默认一天醒一两次（每 12 小时左右，免打扰时间里不醒）
export function newWake(roleId) {
  const crab = roleId === CRAB;
  return { enabled: false, intervalOn: true, every: crab ? 720 : 120, unit: "hour", jitter: crab ? 120 : 20, times: [], once: [], quiet: { enabled: true, from: "03:00", to: "10:00" },
    // 自由时间 / 事件醒来时能进哪些屋子：共读（读书、书的讨论室）、共写。小螃蟹还没分到，默认不勾
    rooms: { read: !crab, write: !crab, tide: false } }; // 潮间带：两个人都默认不勾，她开了才发
}

export const store = reactive(defaults());

let metaTimer = null;
let migratedDirty = false; // 迁移改了东西：存档开始监听之前改的，要主动存一次
let persistedMeta;
let protectBookMeta = false;
let metaSaving = Promise.resolve();
let bookTransactionAbort = null;
const metaCopy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
// 每个实例使用独立副本键；sessionStorage 只记录刷新时要恢复的上一份。
let pendingBookKey;
const pendingKey = () => pendingBookKey ??= `sync:book-pending:${uid()}`;

export const hasPendingMeta = () => metaTimer !== null;
export let flushStore = () => {};

export async function loadStore() {
  try {
    const saved = await get("meta");
    persistedMeta = metaCopy(saved);
    if (saved) Object.assign(store, defaults(), saved);
    const previous = sessionStorage.getItem('qisuo-book-pending');
    const pending = previous ? await get(`sync:book-pending:${previous}`) : null;
    const sessionId = uid();
    pendingBookKey = `sync:book-pending:${sessionId}`;
    // 先复制再交接指针，保留旧副本；复制标签页也不会共用一个可被改写的键。
    let copied = !pending;
    if (pending) {
      try { await set(pendingBookKey, pending); copied = true; }
      catch { console.warn('未能复制待保存副本，保留原副本并在本页恢复'); }
    }
    if (copied) sessionStorage.setItem('qisuo-book-pending', sessionId);
    if (pending) {
      protectBookMeta = true;
      metaTimer = -1;
      persistedMeta = pending.base;
      Object.assign(store, defaults(), pending.local);
    }
    migrate();
  } catch (e) {
    console.warn("读取本地数据失败", e);
  }
  // 申请「持久存储」，降低浏览器自动清理数据的可能
  navigator.storage?.persist?.().catch(() => {});

  const flush = flushStore = () => {
    if (metaTimer === null && !protectBookMeta) return;
    clearTimeout(metaTimer);
    metaTimer = null;
    const save = async () => {
      const local = metaCopy(store);
      if (!protectBookMeta) {
        await set("meta", local);
        persistedMeta = local;
        return;
      }
      const outcome = await editMany(['meta'], values => {
        const latest = values.get('meta');
        try {
          const merged = mergeBookMeta(persistedMeta, local, latest);
          return { entries: sameMeta(latest, merged) ? [] : [['meta', merged]], remove: [pendingBookKey], result: { merged } };
        } catch {
          // 不覆盖数据库。待保存副本包含基线，刷新后仍能保留本页修改并重试。
          return { entries: [[pendingBookKey, { base: persistedMeta, local, at: Date.now() }]], result: { conflict: true } };
        }
      });
      sessionStorage.setItem('qisuo-book-pending', pendingBookKey.slice('sync:book-pending:'.length));
      if (outcome.conflict) { metaTimer ??= -1; throw Error('其他窗口也修改了同一内容；本页修改已保存在本机，请核对后重新预览'); }
      const current = metaCopy(store);
      let view;
      try { view = mergeBookMeta(local, current, outcome.merged); }
      catch {
        // 等待写事务时又修改了同一字段：保留原基线，不让下一次保存把冲突当作已解决。
        persistedMeta = local;
        await set(pendingBookKey, { base: local, local: current, at: Date.now() });
        metaTimer ??= -1;
        throw Error('保存期间同一内容又有变化；本页修改已保留，请核对后重新预览');
      }
      persistedMeta = metaCopy(outcome.merged);
      applyBookMeta(store, current, view);
      if (sameMeta(store, persistedMeta)) { clearTimeout(metaTimer); metaTimer = null; }
    };
    const result = metaSaving.then(save);
    metaSaving = result.catch(() => { if (!sameMeta(store, persistedMeta)) metaTimer ??= -1; });
    return result;
  };
  if (migratedDirty) metaTimer = setTimeout(() => flush().catch(console.error), 300);
  watch(store, () => {
    bookTransactionAbort?.abort();
    clearTimeout(metaTimer);
    metaTimer = setTimeout(() => flush().catch(console.error), 300);
  }, { deep: true, flush: "sync" });
  // 切到后台 / 关闭页面时立刻保存
  addEventListener("pagehide", () => { flush()?.catch(console.error); flushMessages().catch(console.error); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { flush()?.catch(console.error); flushMessages().catch(console.error); }
  });
}

// 别的设备同步过来的 meta：整份换上（再补上新字段）
export function applyRemoteMeta(val) {
  persistedMeta = metaCopy(val);
  Object.assign(store, defaults(), val);
  migrate();
}

// 旧版本数据补上新字段
function migrate() {
  if (store.version < 2) {
    if (store.profile.name === "我") store.profile.name = "栖所";
    store.version = 2;
  }
  if (store.version < 3) {
    store.widgets = defaultWidgets();
    store.version = 3;
  }
  if (store.version < 4) {
    // 签名冷却从 24 小时改成 12 小时（自己改过的不动）
    for (const r of store.roles) if (r.sigCooldownHours === 24) r.sigCooldownHours = 12;
    store.version = 4;
  }
  if (store.version < 5) {
    // 签名冷却统一改成 12 小时
    for (const r of store.roles) r.sigCooldownHours = 12;
    store.version = 5;
  }
  if (store.version < 6) {
    // 对外保密从每个角色挪到设置里，所有 AI 通用：把各角色写过的合在一起
    store.settings ??= { fontSize: "standard" };
    const parts = [...new Set(store.roles.map(r => r.privacy?.trim()).filter(Boolean))];
    if (parts.length) store.settings.privacy = [store.settings.privacy?.trim(), ...parts].filter(Boolean).join("\n");
    for (const r of store.roles) delete r.privacy;
    store.version = 6;
  }
  if (store.version < 7) {
    // 只留一个 AI：以前的 AI 连同 TA 们的对话、群聊、日历、写在主页上的话，一起搬进旧居（不删）
    const old = store.roles.filter(r => r.id !== MAIN);
    if (old.length) {
      const a = store.archive || emptyArchive();
      for (const r of old) r.wake = { ...(r.wake || {}), enabled: false }; // 不再醒来
      const add = (list, items) => { for (const x of items) if (!list.some(y => y.id === x.id)) list.push(x); };
      add(a.roles, old);
      add(a.threads, store.threads.filter(t => t.roleId !== MAIN));
      add(a.groups, store.groups || []);
      add(a.events, store.events || []);
      Object.assign(a.bios, store.profile.bios || {});
      a.at = Date.now();
      store.archive = a;
      store.threads = store.threads.filter(t => t.roleId === MAIN);
      store.groups = [];
      store.events = [];
      store.profile.bios = {};
    }
    if (!store.roles.some(r => r.id === MAIN)) store.roles = [mainRole()];
    else store.roles = store.roles.filter(r => r.id === MAIN);
    if (store.defaultApiId == null && store.apis[0]) store.defaultApiId = store.apis[0].id;
    store.version = 7;
  }
  if (store.version < 8) {
    // 只有一个他了：我的头像不再分「主页的」和「在他面前的」，统一用一个（聊天里换过的那张优先）
    for (const r of store.roles) {
      if (r.me?.avatar) { store.profile.avatar = r.me.avatar; r.me.avatar = null; }
    }
    store.version = 8;
  }
  if (store.version < 9) {
    // 新的共读书架：主页上放一个（不想要可以长按桌面移除）
    if (!store.widgets.some(w => w.type === "books")) store.widgets.unshift({ id: uid(), type: "books", size: "large" });
    store.version = 9;
  }
  if (store.version < 10) {
    // 新的共写书桌：放在书架后面（不想要可以长按桌面移除）
    if (!store.widgets.some(w => w.type === "desk")) store.widgets.splice(store.widgets.findIndex(w => w.type === "books") + 1, 0, { id: uid(), type: "desk", size: "large" });
    store.version = 10;
  }
  store.archive ??= emptyArchive();
  store.widgets = (store.widgets || []).filter(w => !["chick", "work", "calendar"].includes(w.type)); // 主页不再放小鸡；工作间拆掉了；日历搬进「记录」
  store.diary ??= []; // 日记本（见 lib/diary.js）
  store.settings ??= { fontSize: "standard" };
  delete store.settings.historyLimit; // 早就改成按 token 算了（historyTokens）
  for (const k of ["groupHistoryLimit", "groupPrivateLimit", "privateGroupLimit", "surfacedLimit"]) delete store.settings[k]; // 群聊、浮现的记忆都去掉了
  delete store.settings.workroom; // 工作间拆掉了
  store.settings.wakeHistoryTokens ??= 4000; // TA 醒来时带多少聊天（token，小背包）
  store.settings.privacy ??= "";
  store.profile.userName ??= "";
  store.profile.bioSelf ??= "";
  store.profile.bios ??= {};
  store.chick ??= { state: "idle" };
  store.anniversaries ??= [];
  store.events ??= [];
  store.memories ??= [];
  store.favorites ??= [];
  store.stickers ??= [];
  const crab = store.roles?.find(r => r.id === CRAB);
  if (crab?.persona === OLD_CRAB.persona) crab.persona = CRAB_PERSONA;
  if (crab?.style === OLD_CRAB.style) crab.style = CRAB_STYLE;
  store.letters ??= [];
  store.meanwhile ??= { seq: 0, seenAt: 0, posts: [], moods: [], plans: [], shells: [], diaries: [] };
  for (const k of ["posts", "moods", "plans", "shells", "diaries"]) store.meanwhile[k] ??= [];
  store.books ??= []; // 共读的书架
  store.bookNotes ??= []; // 书里的便利贴
  store.moments ??= []; // 他自己记在【此刻】里的小事（24 小时后自动忘）；带 room 的是小世界某间房自己的此刻
  store.gardenTalk ??= {}; // 小世界花园三间房的对话摘要等（每人每间一份，见 lib/gardenTalk.js）
  if (!store.toolRoomsPer) { // 工具分房间改成「人 + MCP + 工具」各记一份：原来按工具名记的，原样抄给两个人当起点（只迁一次）
    const old = store.toolRooms || {};
    if (!store.toolRooms) for (const p of PLATFORMS) for (const [room, names] of Object.entries(p.rooms)) for (const n of names) (old[n] ??= []).push(room);
    store.toolRooms = {};
    for (const s of store.mcpServers || []) {
      if (s.builtin) continue;
      for (const t of s.tools || []) {
        const rooms = s.browser ? ["stroll"] : old[t.name]; // 浏览器的工具默认进「逛」
        if (rooms?.length) for (const r of [MAIN, CRAB]) store.toolRooms[`${r}|${s.id}|${t.name}`] = [...rooms];
      }
      if (s.browser) { // 浏览器不再只给 chatgpt：原来的开关 = 给不给 chatgpt，CC 一起接上
        if (s.enabled === false) { s.enabled = true; s.roleIds = []; } else s.roleIds = [MAIN, CRAB];
      }
    }
    store.toolRoomsPer = true;
    migratedDirty = true;
  }
  store.roomIntros ??= {}; // 小房间的介绍：每人每间一段，键是「人:房间」（见 lib/rooms.js）
  store.penpals ??= []; // 板块记忆：他记着的笔友，每人一句话
  store.readingLog ??= {}; // 每天读了多久（秒）
  store.writings ??= []; // 共写：书桌上的书
  store.writeCards ??= []; // 共写的卡片
  store.writeNotes ??= []; // 卡片上的便利贴
  // 记忆卡片换成「status（成不成立）+ access（怎么给他）」两个字段：老卡片一张不丢，补上字段和来源
  for (const m of store.memories) {
    m.status ??= "valid";
    m.access ??= m.pinned ? "pinned" : "normal";
    delete m.pinned;
    m.createdAt ??= m.ts || Date.now();
    m.updatedAt ??= m.ts || m.createdAt;
    m.tags ??= [];
    m.importance ??= 3;
    m.source ??= m.bookId ? { type: "read", by: m.author === "me" ? "me" : "ai", id: m.bookId }
      : m.writingId ? { type: "write", by: m.author === "me" ? "me" : "ai", id: m.writingId }
      : { type: m.author === "me" ? "manual" : "chat", by: m.author === "me" ? "me" : "ai" };
  }
  // 以前单独放的「候选记忆」：变成待确认的卡片
  for (const x of store.memSuggest || []) {
    store.memories.push({ id: x.id, roleId: x.roleId, title: x.title || x.content.slice(0, 12), content: x.content, img: null, date: new Date(x.ts).toISOString().slice(0, 10), author: x.roleId, ts: x.ts, createdAt: x.ts, updatedAt: x.ts, status: "pending", access: "normal", tags: [], importance: 3, source: { type: "helper", by: "helper", label: x.src } });
  }
  delete store.memSuggest;
  store.readerFonts ??= []; // 读书时用的导入字体
  store.readerPrefs ??= { bg: "paper", size: 18, font: "" }; // 读书背景、字号、字体
  store.settings.shelfTone ??= "light"; // 主页书架的颜色：light / grey / dark
  { const d = defaultMedia(), m = store.media || {}; store.media = { stt: { ...d.stt, ...m.stt }, tts: { ...d.tts, ...m.tts }, image: { ...d.image, ...m.image } }; }
  store.groups ??= [];
  store.mcpServers ??= [];
  store.wake ??= { enabled: false, synced: false };
  store.tools = { ...defaultTools(), ...(store.tools || {}) };
  for (const s of store.mcpServers || []) s.disabledTools ??= [];
  // 代表色写死：她粉色、他蓝色（旧居里以前的角色还是原来的颜色）
  store.profile.color = PALETTE[0];
  store.profile.bubbleColor ??= null; // 她自己的气泡颜色（在聊天的「对话」里换；没选就是卡片色）
  for (const r of store.roles) {
    r.bubbleColor ??= DEFAULT_BUBBLE;
    if (r.id === MAIN) r.color = PALETTE[2];
    r.calPerDay ??= 3;
    r.wake = { ...newWake(r.id), ...(r.wake || {}) };
    // 小螃蟹还没开过、也没改过的唤醒：换成稀一点的默认（原来跟他一样是每 2 小时）
    if (r.id === CRAB && !r.wake.enabled && r.wake.every === 120 && r.wake.jitter === 20 && !r.wake.times?.length) { r.wake.every = 720; r.wake.jitter = 120; }
    // 小螃蟹的共读 / 共写一律不勾（以前没有这一项，自由时间会把屋子全列给她）；她之后自己勾上的不动
    if (r.id === CRAB && !r.wake.roomsFixed) { r.wake.rooms = { read: false, write: false }; r.wake.roomsFixed = true; }
    // 总开关去掉了：以前总开关关着的话谁也不醒，所以那时开着的人一次性改成关着（行为不变），之后谁开谁醒
    if (!store.wake.noMaster && !store.wake.enabled) r.wake.enabled = false;
    r.wakeAlarms ??= [];
    r.wakeLog ??= [];
    r.xinchao ??= { dashToken: "" }; // 心潮看板口令
    r.me ??= { name: store.profile.userName || "", avatar: null, about: "" };
    r.avatars ??= []; // 头像库：{ id, name, img }，他自己挑着换
    r.avatarAuto ??= true;
  }
  store.wake.noMaster = true;
  // 10/20 12:00 自由时间，小螃蟹误进了共读《渣攻的白月光和我HE了》：划线和读书笔记本来该是小章鱼那边的记录。
  // 一次性处理：那一批划线开头标上说明，那条读书笔记从小螃蟹的记忆挪给小章鱼；进度不动（只记下来让她看）
  // （#261 的第一版按书名和书 id 去找，找不到时也把「做过了」记上；并且迁移是在存档开始监听之前改的，不一定存得下来。
  //   这一版：只按那条笔记的标题找（不靠书名）、找不到就不记「做过了」、改完主动存一次；改过的不会再改）
  if (!store.fixes?.crabReadMixup2) {
    const WAKE_AT = 1792468848000, TAG = "（这段是小螃蟹醒来时误读的）", TITLE = "被比较与被看见";
    const isIt = m => m.title?.includes(TITLE) && m.bookId;
    const live = m => m.status !== "deleted";
    // 先找还在小螃蟹那边的；找不到再看有没有已经在小章鱼那边（#261 挪过的）
    const mem = (store.memories || []).find(m => live(m) && m.roleId === CRAB && isIt(m)) || (store.memories || []).find(m => live(m) && m.roleId === MAIN && isIt(m) && m.content?.startsWith(TAG));
    if (mem) {
      if (mem.roleId !== MAIN) { mem.roleId = MAIN; mem.author = MAIN; }
      if (!mem.content.startsWith(TAG)) mem.content = TAG + mem.content;
      mem.updatedAt = Date.now(); // 栖所同步给小螃蟹的记忆卡片是按内容变没变来推的；这里也让别的设备知道这张改过
      // 同一次醒来贴的批注：和这条笔记同时记下来的、小章鱼名下的那一批
      const anchor = Math.max(WAKE_AT, 0);
      const mine = (store.bookNotes || []).filter(n => n.bookId === mem.bookId && n.from === "ai" && n.ts >= anchor).sort((a, b) => a.ts - b.ts);
      const batch = mine.filter(n => n.ts - mine[0].ts < 60_000);
      for (const n of batch) if (!n.text.startsWith(TAG)) n.text = (TAG + n.text).slice(0, 1000);
      const book = (store.books || []).find(b => b.id === mem.bookId);
      const moved = !!(book?.hisPos && book.hisPos.at >= WAKE_AT);
      store.fixes = { ...(store.fixes || {}), crabReadMixup2: true, crabReadMixupInfo: { notes: batch.length, memory: true, hisPosMoved: moved, hisPos: book?.hisPos || null, alongTo: book?.alongTo || null, book: book?.title || "" } };
      migratedDirty = true;
    }
  }
  // 10/22：#261 / #262 只挪了找到的第一张（.find），要是小螃蟹那边有两张同名的（醒来的结果被两台设备各记了一遍），另一张就留在原地——看起来是「只复制、没删」。
  // 小章鱼那边已经有这条的话，小螃蟹这边同一本书、同标题的几张放进回收站（可以恢复）；只动这一条，别的笔记不碰
  if (!store.fixes?.crabReadDup) {
    const TAG = "（这段是小螃蟹醒来时误读的）", TITLE = "被比较与被看见";
    const his = (store.memories || []).find(m => m.status !== "deleted" && m.roleId === MAIN && m.bookId && m.title?.includes(TITLE) && m.content?.startsWith(TAG));
    if (his) {
      const dups = (store.memories || []).filter(m => m.status !== "deleted" && m.roleId === CRAB && m.bookId === his.bookId && m.title?.includes(TITLE));
      for (const m of dups) { m.statusBefore = m.status; m.status = "deleted"; m.deletedAt = Date.now(); m.updatedAt = Date.now(); }
      store.fixes = { ...(store.fixes || {}), crabReadDup: true, crabReadDupInfo: { trashed: dups.length } };
      migratedDirty = true;
    }
  }
  for (const a of store.apis) {
    a.favModels ??= [];
    a.showThinking ??= false;
    a.contextLimit ??= 200000;
  }
  for (const t of store.threads) t.model ??= null;
}

// ---------- 查询 ----------
export const roleById = id => store.roles.find(r => r.id === id);
// 旧居里的 AI（只用来显示名字、颜色，不参与聊天）
export const archivedRole = id => store.archive?.roles.find(r => r.id === id);
// 日历等处的「作者」：me 或某个角色
export function authorInfo(id) {
  if (id === "me") return { name: "我", color: store.profile.color };
  const r = roleById(id) || archivedRole(id);
  return r ? { name: r.name, color: r.color } : { name: "（已删除）", color: "#c8c8d0" };
}
export const apiById = id => store.apis.find(a => a.id === id);
// 邮箱页自己的小对话（mail: true）、小螃蟹的工作室（studio: true）不算在聊天列表里
export const threadsOf = roleId =>
  store.threads.filter(t => t.roleId === roleId && !t.mail && !t.studio).sort((a, b) => b.updatedAt - a.updatedAt);
// 小螃蟹的工作室：单独一个对话，走工作室的接口（能翻栖所仓库）
export function studioThreadOf(roleId, apiId) {
  let t = store.threads.find(x => x.roleId === roleId && x.studio);
  if (!t) { t = createThread(roleId); t.studio = true; t.title = "工作室"; }
  t.apiId = apiId;
  return t;
}
export function mailThreadOf(roleId) {
  let t = store.threads.find(x => x.roleId === roleId && x.mail);
  if (!t) { t = createThread(roleId); t.mail = true; t.title = "邮箱"; }
  return t;
}

// 对话使用的 API：对话单独指定 > 角色指定 > 全局默认 > 第一个
export function apiFor(thread, role) {
  return apiById(thread?.apiId) || apiById(role?.apiId) || apiById(store.defaultApiId) || store.apis[0] || null;
}

// 对话使用的模型：对话里单独选过的模型 > 这个 API 的默认模型
export function modelFor(thread, role) {
  const api = apiFor(thread, role);
  if (!api) return "";
  if (thread?.apiId === api.id && thread.model) return thread.model;
  // 角色设置里选的模型（API 里标星的那些）
  if (role?.apiId === api.id && role.model) return role.model;
  return api.model;
}

// ---------- 对话 ----------
// carry：从哪个对话换过来——那边的摘要记忆一起带过来（换窗也接得上）
export function createThread(roleId, carry = null) {
  const t = { id: uid(), roleId, title: "新的对话", createdAt: Date.now(), updatedAt: Date.now(), bg: null, apiId: null, model: null, preview: "", sel: {} };
  if (carry?.summary?.text) t.summary = { text: carry.summary.text, upTo: null, count: carry.summary.count || 0, at: Date.now(), from: carry.title || "上一个对话" };
  store.threads.push(t);
  messageCache[t.id] = [];
  return t;
}

export async function deleteThread(id) {
  store.threads.splice(store.threads.findIndex(t => t.id === id), 1);
  delete messageCache[id];
  await del("msgs:" + id);
}

export async function deleteRole(id) {
  for (const t of store.threads.filter(t => t.roleId === id)) await deleteThread(t.id);
  store.roles.splice(store.roles.findIndex(r => r.id === id), 1);
}

// ---------- 消息（按对话分开存） ----------
export const messageCache = reactive({});

export async function loadMessages(threadId) {
  if (!messageCache[threadId]) {
    const list = (await get("msgs:" + threadId)) || [];
    messageCache[threadId] = list;
    if (migrateFlat(messageCache[threadId])) saveMessages(threadId);
  }
  return messageCache[threadId];
}

const msgTimers = {};
export const hasPendingMessages = id => id in msgTimers;
function writeMessages(threadId) {
  clearTimeout(msgTimers[threadId]);
  delete msgTimers[threadId];
  const list = messageCache[threadId];
  if (!list) return;
  const clean = JSON.parse(JSON.stringify(list.filter(m => !m.pending)));
  return set("msgs:" + threadId, clean);
}
export function saveMessages(threadId) {
  clearTimeout(msgTimers[threadId]);
  msgTimers[threadId] = setTimeout(() => writeMessages(threadId)?.catch(console.error), 400);
}
export function flushMessages() {
  return Promise.all(Object.keys(msgTimers).map(writeMessages));
}

// ---------- 用量统计 ----------
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// usage[日期][apiId] = { input, output, calls, models: { 模型名: { input, output, calls } } }
export function recordUsage(apiId, model, input = 0, output = 0) {
  const day = (store.usage[today()] ??= {});
  const u = (day[apiId] ??= { input: 0, output: 0, calls: 0 });
  const m = ((u.models ??= {})[model] ??= { input: 0, output: 0, calls: 0 });
  for (const x of [u, m]) {
    x.input += input;
    x.output += output;
    x.calls += 1;
  }
}

const trim0 = s => s.replace(/\.0+$/, "");
export const fmtTokens = n =>
  n >= 1e6 ? trim0((n / 1e6).toFixed(2)) + "M"
  : n >= 1e5 ? Math.round(n / 1e3) + "k"
  : n >= 1e3 ? trim0((n / 1e3).toFixed(1)) + "k"
  : String(n);

// 重导入开始后，自动保存也使用同一并发保护，拒绝后不会由延迟定时器抹掉外部新数据。
export async function prepareBookPersistence() {
  protectBookMeta = true;
  pendingKey();
  await flushStore();
  return metaCopy(persistedMeta);
}

export async function commitBookTransaction(entries, next, expected = []) {
  const captured = metaCopy(store);
  const commit = async () => {
    const before = metaCopy(store);
    if (!sameMeta(before, captured) || !sameMeta(before, persistedMeta)) throw Error("本页数据又有变化，请重新预览");
    const abort = bookTransactionAbort = new AbortController();
    try { await setMany([...entries, ["meta", next]], [...expected, ["meta", persistedMeta]], abort.signal); }
    finally { bookTransactionAbort = null; }
    persistedMeta = metaCopy(next);
    applyBookMeta(store, before, next);
  };
  // 与自动保存串行，排队中的自动保存到执行时才读取内存，不能把旧章节写回去。
  const result = metaSaving.then(commit);
  metaSaving = result.catch(() => { if (!sameMeta(store, persistedMeta)) metaTimer ??= -1; });
  return result;
}
