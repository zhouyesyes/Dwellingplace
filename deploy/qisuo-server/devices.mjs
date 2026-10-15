// 个人设备共用原有的一份同步数据；凭证、绑定码只在本机鉴权账本里记摘要。
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { handleSync } from './sync.mjs';

const hash = s => createHash('sha256').update(s).digest('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const nonceOK = s => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);
const CODE_TTL = 5 * 60_000, WINDOW = 10 * 60_000;

export function createDeviceSync({ dir = process.env.DATA_DIR || '/app/data', masterMatches, now = Date.now, sync = handleSync } = {}) {
  const file = join(dir, 'sync-devices.json');
  let state;
  const load = () => {
    if (state) return state;
    try {
      const s = JSON.parse(readFileSync(file, 'utf8'));
      if (s.version !== 1 || !Array.isArray(s.devices) || !Array.isArray(s.codes) || !s.secret || !s.limits) throw new Error('设备账本格式不对');
      state = s;
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error('设备账本无法读取，请在服务器上检查备份'); // 损坏时拒绝请求，不重新开放主口令入口
      state = { version: 1, secret: randomBytes(32).toString('hex'), devices: [], codes: [], limits: {} };
    }
    return state;
  };
  const save = () => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
      renameSync(tmp, file);
    } catch (e) { state = null; throw e; }
  };
  const limited = (key, max) => {
    const s = load(), t = now();
    // 不信任客户端可伪造的转发 IP；全站上限也约束共享反代下的尝试。
    for (const [k, v] of Object.entries(s.limits)) if (t - v.at >= WINDOW) delete s.limits[k];
    const v = s.limits[key] ??= { at: t, n: 0 };
    if (v.n >= max) fail(429, '尝试太多，请十分钟后再试');
    v.n++; save();
  };
  const bearer = req => /^Bearer ([^\s]+)$/.exec(req.headers.authorization || '')?.[1] || '';
  const authenticate = req => {
    const credential = bearer(req);
    const d = credential && load().devices.find(x => same(x.hash, hash(credential)) && !x.revokedAt);
    if (!d) fail(401, '这台设备未绑定或已被撤销，请重新输入绑定码');
    if (now() - d.lastUsedAt >= 60_000) { d.lastUsedAt = now(); save(); }
    return d;
  };
  const publicDevice = d => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastUsedAt: d.lastUsedAt, revokedAt: d.revokedAt || null });
  const tokenFor = nonce => createHmac('sha256', load().secret).update(nonce).digest('base64url');
  const issue = (body) => {
    const token = tokenFor(body.nonce), t = now();
    const d = { id: randomUUID(), name: String(body.name || '我的设备').trim().slice(0, 60) || '我的设备', hash: hash(token), requestHash: hash(body.nonce), createdAt: t, lastUsedAt: t };
    load().devices.push(d);
    return { device: publicDevice(d), token };
  };
  const receipt = (id, nonce) => {
    const d = load().devices.find(d => d.id === id && !d.revokedAt && same(d.requestHash, hash(nonce)));
    if (!d) fail(409, '绑定码已使用，请在已绑定设备重新生成');
    return { device: publicDevice(d), token: tokenFor(nonce) };
  };
  const bodyOf = async req => {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 2048) fail(413, '请求太大'); }
    try { return JSON.parse(raw); } catch { fail(400, '请求格式不对'); }
  };
  return {
    legacyAllowed: () => load().devices.length === 0,
    async handle(req, res, path, query, cors) {
      const send = (status, value) => { res.writeHead(status, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(JSON.stringify(value)); };
      try {
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
        if (path === '/migrate' && req.method === 'POST') {
          limited('bootstrap', 20);
          if (!masterMatches?.(bearer(req))) fail(401, '旧服务器凭据不正确');
          const body = await bodyOf(req);
          if (!nonceOK(body?.nonce)) fail(400, '缺少本机迁移凭据');
          const s = load();
          if (s.devices.length) {
            // 同一次迁移响应丢失时可安全重试；其他旧设备必须经已绑定设备同意。
            if (s.bootstrapHash === hash(body.nonce)) return send(200, receipt(s.bootstrapDevice, body.nonce));
            fail(409, '已有设备完成迁移，请在那台设备生成绑定码；本地数据仍保留');
          }
          const result = issue(body);
          s.bootstrapHash = hash(body.nonce); s.bootstrapDevice = result.device.id;
          save(); return send(200, result);
        }
        if (path === '/redeem' && req.method === 'POST') {
          limited('redeem:all', 30);
          limited(`redeem:${hash(req.socket.remoteAddress || 'local')}`, 10);
          const body = await bodyOf(req);
          if (!nonceOK(body?.nonce)) fail(400, '缺少本机绑定凭据');
          const code = String(body.code || '').replace(/[-\s]/g, '').toUpperCase();
          const entry = load().codes.find(c => same(c.hash, hash(code)) && c.expiresAt > now());
          const issuer = entry && load().devices.find(d => d.id === entry.issuer && !d.revokedAt);
          if (!entry || !issuer) fail(400, '绑定码无效或已过期，请重新生成');
          if (entry.usedBy) return send(200, receipt(entry.usedBy, body.nonce));
          const result = issue(body);
          entry.usedBy = result.device.id; save();
          return send(200, result);
        }
        const device = authenticate(req);
        if (path === '/devices' && req.method === 'GET') return send(200, { current: device.id, devices: load().devices.map(publicDevice) });
        if (path === '/codes' && req.method === 'POST') {
          limited(`issue:${device.id}`, 5);
          const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          // 32 字符字母表，12 位随机码约 60 bit，不携带服务器地址或长期凭证。
          const code = Array.from(randomBytes(12), b => alphabet[b & 31]).join('');
          const s = load();
          s.codes = s.codes.filter(c => c.expiresAt > now() && c.issuer !== device.id);
          const expiresAt = now() + CODE_TTL;
          s.codes.push({ hash: hash(code), issuer: device.id, expiresAt }); save();
          return send(200, { code: code.match(/.{4}/g).join('-'), expiresAt });
        }
        if (path.startsWith('/devices/') && req.method === 'DELETE') {
          const target = load().devices.find(d => d.id === path.slice(9));
          if (!target) fail(404, '找不到这台设备');
          target.revokedAt ||= now();
          load().codes = load().codes.filter(c => c.issuer !== target.id);
          save(); return send(200, { ok: true });
        }
        if (path === '/changes' || path === '/item') return await sync(req, res, path, query, cors, () => authenticate(req));
        return send(404, { error: { message: '没有这个同步地址' } });
      } catch (e) {
        if (res.headersSent) { res.end(); return; }
        // 不回传底层异常（路径/请求等），更不记录凭据或绑定码。
        return send(e.status || 503, { error: { message: e.status ? e.message : '设备服务暂不可用，请保留本地数据后重试' } });
      }
    },
  };
}
