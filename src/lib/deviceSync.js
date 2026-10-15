// 设备凭证只在 sync:conf（本机 IndexedDB）里，不放进 store、同步数据或链接。
import { reactive } from 'vue';
import { get, set, del } from 'idb-keyval';

export const binding = reactive({ device: null, server: '', devices: [], code: '', expiresAt: 0, error: '' });
const secureOrigin = value => {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || !['', '/'].includes(u.pathname)) throw new Error('服务器只填写公开域名，不带口令或路径');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) throw new Error('设备绑定需要 HTTPS');
  return u.origin;
};
const nonce = async () => {
  let n = await get('sync:pair-nonce');
  if (!n) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    n = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await set('sync:pair-nonce', n);
  }
  return n;
};
const request = async (url, { token, body, method = 'GET' } = {}) => {
  const r = await fetch(url, {
    method, cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30_000),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await r.json().catch(() => null);
  if (!r.ok || !json) {
    const e = new Error(json?.error?.message || '设备服务尚未就绪，请确认服务器已升级');
    e.status = r.status; throw e;
  }
  return json;
};
export async function discoverSync(origin) {
  const base = secureOrigin(origin || import.meta.env.VITE_SYNC_ORIGIN || location.origin);
  const info = await request(`${base}/.well-known/qisuo-sync`);
  if (info.version !== 1 || info.endpoint !== '/sync') throw new Error('此网址未配置设备绑定服务');
  binding.server = base;
  return `${base}/sync`;
}
export function showBinding(conf) {
  binding.device = conf?.device ? { id: conf.device.id, name: conf.device.name } : null;
  binding.server = conf?.url ? new URL(conf.url).origin : '';
}
async function storeCredential(url, result) {
  if (!result?.device?.id || typeof result.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.token)) throw new Error('服务端未返回有效的设备凭证');
  // 一次落盘：响应丢失或落盘失败时，用同一本机随机凭据重试，不消费第二个设备名额。
  const conf = { url, device: { id: result.device.id, name: result.device.name, token: result.token } };
  await set('sync:conf', conf);
  await del('sync:pair-nonce');
  await del('sync:disabled');
  showBinding(conf);
  return conf;
}
export async function migrateLegacy(conf, name = '原来的设备') {
  const m = /^https?:\/\/[^/]+\/p\/([^/]+)\/sync$/.exec(conf?.url || '');
  if (!m) return conf;
  const url = `${secureOrigin(new URL(conf.url).origin)}/sync`;
  // 先发现能力：旧版服务器继续旧同步，不把新接口的 HTML 当成迁移成功。
  try { await discoverSync(new URL(url).origin); }
  catch (e) {
    if (e.status !== 404 && e.status !== 200) throw e; // 断网/服务异常不能降级回含口令的旧请求
    binding.error = '服务器尚未升级设备绑定；原同步配置和数据保留'; return conf;
  }
  const result = await request(`${url}/migrate`, { method: 'POST', token: decodeURIComponent(m[1]), body: { nonce: await nonce(), name } });
  binding.error = '';
  return storeCredential(url, result);
}
export async function redeemCode(code, name, origin) {
  const url = await discoverSync(origin);
  const result = await request(`${url}/redeem`, { method: 'POST', body: { code, name, nonce: await nonce() } });
  return storeCredential(url, result);
}
async function deviceRequest(path, options = {}) {
  const conf = await get('sync:conf');
  if (!conf?.device?.token) throw new Error('先绑定这台设备');
  return request(`${conf.url}${path}`, { ...options, token: conf.device.token });
}
export async function listDevices() {
  const result = await deviceRequest('/devices');
  binding.devices = result.devices;
  return result;
}
export async function createBindingCode() {
  const result = await deviceRequest('/codes', { method: 'POST' });
  binding.code = result.code; binding.expiresAt = result.expiresAt;
}
export async function revokeDevice(id) {
  await deviceRequest(`/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (id === binding.device?.id) { binding.code = ''; binding.expiresAt = 0; }
  await listDevices().catch(e => { if (id !== binding.device?.id) throw e; });
}
