// 网址卡片：聊天里出现网址时，栖所来这里问「这个网页叫什么、讲什么、有没有封面图」，画成一张卡片。
// 网页是服务器替栖所去读的（手机上的浏览器直接读别人的网站会被跨域挡住）。
//
// 路径（都在 /p/<口令>/preview 下面）：
//   GET /?url=…        → { url, title, description, image, site, icon }
//   GET /img?url=…     → 封面图本身（有的网站不让别处直接引用它的图，这里转一手）
//
// 安全：只去公网上的 http/https 网页。先把域名解析成 IP，内网、本机、云服务器的元数据地址一律不去，
// 而且实际连的就是检查过的那个 IP（防止域名查的时候是公网、连的时候变成内网）。跳转也一样每次都查。
import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const TIMEOUT = 7000;
const MAX_HTML = 768 * 1024; // 网页只读开头这么多，标题和封面都在 <head> 里
const MAX_IMG = 4 * 1024 * 1024;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
// 有的网站（维基百科等）不让服务器假装成手机浏览器，回 403；这时老老实实报上名字再试一次
const BOT_UA = "QisuoLinkPreview/1.0 (+https://github.com/zhouyesyes/Dwellingplace; link preview for a personal app)";

// 读过的记一会儿（6 小时，最多 300 条）
const cache = new Map();
const CACHE_MS = 6 * 3600_000;
function remember(k, v) {
  cache.set(k, { v, at: Date.now() });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
}

// ---------- 只去公网 ----------
function privateIP(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const s = ip.toLowerCase();
  if (s.startsWith("::ffff:")) return privateIP(s.slice(7));
  return s === "::" || s === "::1" || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe8") || s.startsWith("fe9") ||
    s.startsWith("fea") || s.startsWith("feb") || s.startsWith("ff") || s.startsWith("64:ff9b");
}
async function safeTarget(raw) {
  let u;
  try { u = new URL(raw); } catch { throw Object.assign(new Error("不是网址"), { status: 400 }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error("只看 http/https 网页"), { status: 400 });
  if (u.username || u.password) throw Object.assign(new Error("网址里不能带账号密码"), { status: 400 });
  if (u.port && !["80", "443"].includes(u.port)) throw Object.assign(new Error("只去常见端口"), { status: 400 });
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw Object.assign(new Error("不去内网"), { status: 400 });
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([
    lookup(host, { all: true }),
    new Promise((_, no) => setTimeout(() => no(Object.assign(new Error("找这个网站太久了"), { status: 504 })), 5000)),
  ]);
  if (!addrs.length || addrs.some(a => privateIP(a.address))) throw Object.assign(new Error("不去内网"), { status: 400 });
  // IPv4 排前面：Docker 里多半连不上 IPv6；一个连不上就换下一个（见 get）
  return { u, addrs: [...addrs].sort((a, b) => a.family - b.family) };
}

// 连检查过的那个 IP；跳转最多 4 次，每次重新检查
async function get(raw, opt, hops = 0) {
  try { return await getOnce(raw, opt, hops); } catch (e) {
    if (opt.ua || ![401, 403, 429].includes(e.http)) throw e;
    return getOnce(raw, { ...opt, ua: BOT_UA }, hops);
  }
}
async function getOnce(raw, { accept, max, ua }, hops) {
  const { u, addrs } = await safeTarget(raw);
  let last;
  for (const addr of addrs.slice(0, 4)) {
    try { return await getVia(u, addr, { accept, max, ua }, hops); } catch (e) {
      last = e;
      if (e.status) throw e; // 网站自己回了错（404 之类），换地址也没用
    }
  }
  throw Object.assign(new Error(`连不上这个网站（${last?.code || last?.message || "?"}）`), { status: 502 });
}
function getVia(u, addr, { accept, max, ua }, hops) {
  const mod = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(u, {
      method: "GET",
      headers: { "User-Agent": ua || UA, Accept: accept, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6" },
      // 新版 Node 会要一组地址（all: true），旧的要一个：都只给检查过的那个
      lookup: (_h, o, cb) => (o?.all ? cb(null, [{ address: addr.address, family: addr.family }]) : cb(null, addr.address, addr.family)),
      timeout: TIMEOUT,
    }, res => {
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
        res.resume();
        if (hops >= 4) return reject(Object.assign(new Error("跳转太多次"), { status: 502 }));
        return getOnce(new URL(loc, u).href, { accept, max, ua }, hops + 1).then(resolve, reject);
      }
      if (res.statusCode >= 400) { res.resume(); return reject(Object.assign(new Error(`网页打不开（${res.statusCode}）`), { status: 502, http: res.statusCode })); }
      const chunks = [];
      let n = 0;
      res.on("data", c => {
        n += c.length;
        chunks.push(c);
        if (n >= max) { res.destroy(); finish(); }
      });
      let done = false;
      const finish = () => { if (done) return; done = true; resolve({ url: u.href, type: String(res.headers["content-type"] || ""), body: Buffer.concat(chunks).subarray(0, max) }); };
      res.on("end", finish);
      res.on("close", finish);
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("网页太慢了"), { status: 504 })));
    req.on("error", reject);
    req.end();
  });
}

// ---------- 从网页里找标题、简介、封面 ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const unent = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m);
const clean = (s, n) => (s ? unent(s).replace(/\s+/g, " ").trim().slice(0, n) : "");
function decode(buf, type) {
  const head = buf.subarray(0, 4096).toString("latin1");
  const cs = (type.match(/charset=([\w-]+)/i) || head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  try { return new TextDecoder(cs.toLowerCase()).decode(buf); } catch { return buf.toString("utf8"); }
}
export function parse(html, base) { // 导出只是方便单独测
  const head = html.slice(0, 400_000);
  const metas = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const key = (tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const val = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
    if (key && val != null && !(key.toLowerCase() in metas)) metas[key.toLowerCase()] = val;
  }
  const abs = v => { try { return v ? new URL(unent(v), base).href : ""; } catch { return ""; } };
  const icon = (head.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i) || [""])[0].match(/href=["']([^"']+)["']/i)?.[1];
  const u = new URL(base);
  return {
    url: base,
    title: clean(metas["og:title"] || metas["twitter:title"] || (head.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1], 120),
    description: clean(metas["og:description"] || metas["twitter:description"] || metas.description, 240),
    image: abs(metas["og:image"] || metas["og:image:url"] || metas["twitter:image"] || metas["twitter:image:src"]),
    site: clean(metas["og:site_name"], 40) || u.hostname.replace(/^www\./, ""),
    icon: abs(icon) || `${u.origin}/favicon.ico`,
  };
}

// 维基百科：直接问它的公开接口要摘要和配图，比读整个网页稳（它对服务器来读网页很严）
async function wikipedia(target) {
  const u = new URL(target);
  const m = u.hostname.match(/^([a-z-]+)\.(?:m\.)?wikipedia\.org$/i);
  const t = m && u.pathname.match(/^\/(?:wiki|zh-[a-z]+)\/(.+)$/i);
  if (!t) return null;
  const api = `https://${m[1]}.wikipedia.org/api/rest_v1/page/summary/${t[1]}`;
  const r = await get(api, { accept: "application/json", max: 256 * 1024, ua: BOT_UA });
  const j = JSON.parse(r.body.toString("utf8"));
  return {
    url: j.content_urls?.mobile?.page || target,
    title: clean(j.title, 120),
    description: clean(j.extract, 240),
    image: j.thumbnail?.source || j.originalimage?.source || "",
    site: "Wikipedia",
    icon: `https://${m[1]}.wikipedia.org/static/favicon/wikipedia.ico`,
  };
}

export async function handlePreview(req, res, rest, query, CORS) {
  // 出错也回 200 + { error }：回 5xx 的话 Cloudflare 会换成它自己的报错页，栖所就看不到原因了
  const json = (code, obj) => { if (code >= 500) code = 200; res.writeHead(code, { ...CORS, "Content-Type": "application/json", "Cache-Control": code === 200 && !obj.error ? "public, max-age=3600" : "no-store" }); res.end(JSON.stringify(obj)); };
  try {
    if (req.method !== "GET") return json(405, { error: { message: "只能 GET" } });
    const target = query.get("url") || "";
    if (rest === "/img") {
      const r = await get(target, { accept: "image/*", max: MAX_IMG });
      if (!/^image\//i.test(r.type) || /svg/i.test(r.type)) return json(415, { error: { message: "不是图片" } });
      res.writeHead(200, { ...CORS, "Content-Type": r.type, "Cache-Control": "public, max-age=86400" });
      return res.end(r.body);
    }
    if (rest && rest !== "/") return json(404, { error: { message: "没有这个地址" } });
    const hit = cache.get(target);
    if (hit && Date.now() - hit.at < CACHE_MS) return json(200, hit.v);
    const wiki = await wikipedia(target).catch(() => null);
    if (wiki?.title) { remember(target, wiki); return json(200, wiki); }
    const r = await get(target, { accept: "text/html,application/xhtml+xml", max: MAX_HTML });
    const info = /html|xml/i.test(r.type) || !r.type ? parse(decode(r.body, r.type), r.url) : { url: r.url, title: "", description: "", image: "", site: new URL(r.url).hostname, icon: "" };
    remember(target, info);
    return json(200, info);
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch { /* 断了 */ } return; }
    return json(e.status || 502, { error: { message: e.code === "ENOTFOUND" ? "找不到这个网站" : e.message } });
  }
}
