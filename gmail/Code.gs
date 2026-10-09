/**
 * 栖所 · 邮箱 MCP（Google Apps Script）
 *
 * 把这段代码放进 AI 自己的谷歌账号里，部署成「网页应用」，就得到一个只属于这个 AI 的邮箱 MCP。
 * 在栖所「设置 → 工具 → 添加 MCP」里填：网页应用的网址 + ?key=下面的密码
 *
 * 步骤见：docs/gmail.md
 */

// ① 在这里设一个只有你知道的密码（随便一串字母数字，越长越好）
const SECRET = '在这里填一个密码';

// 一次最多返回多少封、正文最多多少字
const MAX_RESULTS = 20;
const MAX_BODY = 15000;

const TOOLS = [
  {
    name: 'get_profile',
    description: '查看这个邮箱的地址，以及收件箱里有几封未读',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_emails',
    description: '搜索邮件，用 Gmail 的搜索语法，比如 "is:unread"、"from:someone@example.com"、"newer_than:3d"、"subject:你好"。不填就是收件箱最新的',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, max: { type: 'number' } },
    },
  },
  {
    name: 'read_email',
    description: '读一封邮件的全文（id 来自 search_emails 的结果）',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'send_email',
    description: '发一封新邮件。发出去之前想清楚：不要在邮件里透露对方的隐私',
    inputSchema: {
      type: 'object',
      properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, cc: { type: 'string' } },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'reply_email',
    description: '回复一封邮件（id 来自 search_emails 的结果）',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, body: { type: 'string' }, reply_all: { type: 'boolean' } },
      required: ['id', 'body'],
    },
  },
  {
    name: 'mark_read',
    description: '把一封邮件标成已读（read=false 就是标成未读）',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, read: { type: 'boolean' } }, required: ['id'] },
  },
  {
    name: 'list_pen_pals',
    description: '按人整理最近来往的笔友：每个人来往了几封、最后一封是谁发的（有没有等着回）、最后一封的主题和日期',
    inputSchema: { type: 'object', properties: { days: { type: 'number' } } },
  },
  {
    name: 'archive_email',
    description: '把一封邮件所在的对话归档（移出收件箱，不会删除）',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

// ---------- 工具的具体实现 ----------

// 这个邮箱自己的地址：看自己发过信的几个对话，每个对话里都出现的那个发件人就是自己（只用邮箱权限，不用另外授权）
function myEmail_() {
  try {
    const addr = function (f) { const m = String(f || '').match(/<([^>]+)>/); return (m ? m[1] : String(f || '')).trim().toLowerCase(); };
    let common = null;
    GmailApp.search('from:me', 0, 10).forEach(function (t) {
      const here = {};
      t.getMessages().forEach(function (m) { here[addr(m.getFrom())] = true; });
      common = common === null ? here : Object.keys(common).reduce(function (o, k) { if (here[k]) o[k] = true; return o; }, {});
    });
    const left = common ? Object.keys(common).filter(Boolean) : [];
    if (left.length === 1) return left[0];
  } catch (e) { /* 读不到就算了 */ }
  try { return String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { return ''; }
}
// 自己的地址，加上别名
function myAddrs_() {
  const list = [myEmail_()];
  try { GmailApp.getAliases().forEach(function (a) { list.push(String(a).toLowerCase()); }); } catch (e) { /* 没有别名 */ }
  return list.filter(Boolean);
}

function brief_(m) {
  return {
    id: m.getId(),
    from: m.getFrom(),
    to: m.getTo(),
    subject: m.getSubject(),
    date: m.getDate().toISOString(),
    unread: m.isUnread(),
    preview: m.getPlainBody().replace(/\s+/g, ' ').slice(0, 160),
  };
}

function message_(id) {
  const m = GmailApp.getMessageById(String(id || ''));
  if (!m) throw new Error('找不到这封邮件：' + id);
  return m;
}

const HANDLERS = {
  get_profile: function () {
    return { email: myEmail_(), unread_in_inbox: GmailApp.getInboxUnreadCount() };
  },
  search_emails: function (a) {
    const max = Math.min(Math.max(Number(a.max) || 10, 1), MAX_RESULTS);
    const threads = a.query ? GmailApp.search(String(a.query), 0, max) : GmailApp.getInboxThreads(0, max);
    return threads.map(function (t) {
      const msgs = t.getMessages();
      return Object.assign(brief_(msgs[msgs.length - 1]), { messages_in_thread: msgs.length });
    });
  },
  read_email: function (a) {
    const m = message_(a.id);
    const body = m.getPlainBody();
    return {
      id: m.getId(),
      from: m.getFrom(),
      to: m.getTo(),
      cc: m.getCc(),
      subject: m.getSubject(),
      date: m.getDate().toISOString(),
      body: body.length > MAX_BODY ? body.slice(0, MAX_BODY) + '…（后面还有）' : body,
      attachments: m.getAttachments().map(function (x) { return x.getName(); }),
    };
  },
  send_email: function (a) {
    if (!a.to || !a.subject || !a.body) throw new Error('需要 to、subject、body');
    const opts = {};
    if (a.cc) opts.cc = String(a.cc);
    GmailApp.sendEmail(String(a.to), String(a.subject), String(a.body), opts);
    return { sent: true, to: a.to, subject: a.subject };
  },
  reply_email: function (a) {
    const m = message_(a.id);
    if (a.reply_all) m.replyAll(String(a.body));
    else m.reply(String(a.body));
    return { replied: true, to: m.getFrom(), subject: m.getSubject() };
  },
  mark_read: function (a) {
    const m = message_(a.id);
    if (a.read === false) m.markUnread();
    else m.markRead();
    return { ok: true };
  },
  list_pen_pals: function (a) {
    const days = Math.min(Math.max(Number(a.days) || 90, 1), 365);
    const mine = myAddrs_();
    const addr = function (s) { const m = String(s || '').match(/<([^>]+)>/); return (m ? m[1] : String(s || '')).trim().toLowerCase(); };
    const nameOf = function (s) { const m = String(s || '').match(/^\s*"?([^"<]*?)"?\s*</); return m && m[1] ? m[1].trim() : addr(s); };
    const pals = {};
    const threads = GmailApp.search('newer_than:' + days + 'd -in:spam -in:trash -in:chats', 0, 100);
    threads.forEach(function (t) {
      t.getMessages().forEach(function (m) {
        // 自己发的：发件人是自己（或自己的别名）
        const fromMe = mine.indexOf(addr(m.getFrom())) >= 0;
        const others = fromMe ? String(m.getTo() || '').split(',') : [m.getFrom()];
        others.forEach(function (o) {
          const key = addr(o);
          if (!key || mine.indexOf(key) >= 0 || /no-?reply|mailer-daemon|notification/i.test(key)) return;
          const p = pals[key] || (pals[key] = { email: key, name: nameOf(o), sent: 0, received: 0, unread: 0 });
          if (!fromMe && nameOf(o) !== key) p.name = nameOf(o);
          if (fromMe) p.sent++; else { p.received++; if (m.isUnread()) p.unread++; }
          const d = m.getDate();
          if (!p.last || d > p.last) { p.last = d; p.last_from_me = fromMe; p.last_subject = m.getSubject(); p.last_id = m.getId(); p.preview = m.getPlainBody().replace(/\s+/g, ' ').slice(0, 120); }
        });
      });
    });
    return Object.keys(pals).map(function (k) { const p = pals[k]; p.last = p.last.toISOString(); return p; })
      .sort(function (x, y) { return x.last < y.last ? 1 : -1; });
  },
  archive_email: function (a) {
    message_(a.id).getThread().moveToArchive();
    return { archived: true };
  },
};

// ---------- MCP（JSON-RPC）----------

function handle_(req) {
  const p = req.params || {};
  switch (req.method) {
    case 'initialize':
      return {
        protocolVersion: p.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'Gmail (栖所 Apps Script)', version: '1.3' },
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call': {
      const fn = HANDLERS[p.name];
      if (!fn) throw new Error('没有这个工具：' + p.name);
      try {
        const result = fn(p.arguments || {});
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: '出错了：' + (err && err.message ? err.message : err) }], isError: true };
      }
    }
    default:
      throw Object.assign(new Error('不支持的方法：' + req.method), { code: -32601 });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  if (!SECRET || SECRET === '在这里填一个密码' || (e.parameter && e.parameter.key) !== SECRET) {
    return json_({ jsonrpc: '2.0', id: null, error: { code: -32001, message: '密码不对：网址最后的 ?key= 要和脚本里的 SECRET 一样' } });
  }
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '请求格式不对' } });
  }
  if (req.id === undefined || req.id === null) return json_({}); // 通知，不需要回复
  try {
    return json_({ jsonrpc: '2.0', id: req.id, result: handle_(req) });
  } catch (err) {
    return json_({ jsonrpc: '2.0', id: req.id, error: { code: err.code || -32000, message: String(err && err.message ? err.message : err) } });
  }
}

function doGet() {
  return json_({ ok: true, message: '这是栖所的邮箱 MCP。请在栖所里把这个网址（加上 ?key=密码）添加为 MCP。' });
}

// ② 第一次部署前，在编辑器上方选中这个函数点「运行」，按提示允许访问 Gmail
function authorize() {
  Logger.log('邮箱：' + Session.getActiveUser().getEmail() + '，未读：' + GmailApp.getInboxUnreadCount());
}
