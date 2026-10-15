// 专用于栖所绑定的文本协议：不接受 URL、凭证或多余字段，也不发任何网络请求。
export function bindingOrigin(value) {
  if (typeof value !== 'string' || value.length > 300 || /[\s\\]/.test(value)) throw new Error('二维码中的服务器地址不安全');
  let u;
  try { u = new URL(value); } catch { throw new Error('二维码中的服务器地址无效'); }
  if (u.username || u.password || u.search || u.hash || !['', '/'].includes(u.pathname)) throw new Error('二维码只能包含公开服务器 origin');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) throw new Error('二维码服务器必须使用 HTTPS');
  return u.origin;
}
function payload(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('不是栖所设备绑定二维码');
  if (Object.keys(value).some(k => !['type', 'v', 'code', 'origin'].includes(k)) || value.type !== 'qisuo-device' || value.v !== 1) throw new Error('不支持的绑定二维码协议');
  if (typeof value.code !== 'string' || !/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/.test(value.code)) throw new Error('二维码绑定码格式无效');
  return { type: 'qisuo-device', v: 1, code: value.code, origin: bindingOrigin(value.origin) };
}
export function createBindingPayload({ code, origin, expiresAt }, now = Date.now()) {
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 300_000) throw new Error('绑定码已过期或有效期无效，请重新生成');
  // 只挑这四个字段，设备凭证和有效期均不编码；最终过期判断由服务器负责。
  return JSON.stringify(payload({ type: 'qisuo-device', v: 1, code, origin }));
}
export function parseBindingPayload(text) {
  if (typeof text !== 'string' || text.length > 600) throw new Error('二维码内容无效或过长');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('不是栖所设备绑定二维码'); }
  // 要求规范序列化，连重复字段、别名和尾随内容也拒绝。
  const result = payload(value);
  if (JSON.stringify(result) !== text) throw new Error('二维码协议格式不规范');
  return result;
}

// 固定版本 10-L、字节模式、掩码 0；仅编码不超过 271 字节的绑定短文本。
// 不实现通用编码器/版本搜索；容量不够就保留手输路径。矩阵由 jsqr 回读验证。
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 271) throw new Error('服务器地址太长，请使用手工绑定码');
  const bits = [];
  const append = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  append(4, 4); append(bytes.length, 16);
  for (const b of bytes) append(b, 8);
  append(0, Math.min(4, 274 * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, b) => n * 2 + b, 0));
  for (let i = 0; data.length < 274; i++) data.push(i % 2 ? 0x11 : 0xec);
  const mul = (a, b) => { let n = 0; for (; b; b >>>= 1) { if (b & 1) n ^= a; a <<= 1; if (a & 256) a ^= 0x11d; } return n; };
  let poly = [1], root = 1;
  for (let i = 0; i < 18; i++) {
    const next = Array(poly.length + 1).fill(0);
    poly.forEach((p, j) => { next[j] ^= p; next[j + 1] ^= mul(p, root); });
    poly = next; root = mul(root, 2);
  }
  const blocks = [], parity = [];
  let offset = 0;
  for (const len of [68, 68, 69, 69]) {
    const block = data.slice(offset, offset += len), rem = Array(18).fill(0);
    for (const b of block) { const factor = b ^ rem.shift(); rem.push(0); for (let j = 0; j < 18; j++) rem[j] ^= mul(poly[j + 1], factor); }
    blocks.push(block); parity.push(rem);
  }
  const words = [];
  for (let i = 0; i < 69; i++) for (const b of blocks) if (i < b.length) words.push(b[i]);
  for (let i = 0; i < 18; i++) for (const p of parity) words.push(p[i]);
  const size = 57, matrix = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  const set = (x, y, black) => { if (x >= 0 && x < size && y >= 0 && y < size) { matrix[y][x] = !!black; reserved[y][x] = true; } };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [x, y] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x + dx, y + dy, d !== 2 && d !== 4); }
  }
  const centers = [6, 28, 50];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === 2) || (i === 2 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(centers[i] + dx, centers[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  let rem = 8;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const format = ((8 << 10) | rem) ^ 0x5412, bit = i => (format >>> i) & 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
  rem = 10;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const version = (10 << 12) | rem;
  for (let i = 0; i < 18; i++) { const a = size - 11 + i % 3, b = Math.floor(i / 3); set(a, b, (version >>> i) & 1); set(b, a, (version >>> i) & 1); }
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let row = 0; row < size; row++) for (let col = 0; col < 2; col++) {
      const x = right - col, y = ((right + 1) & 2) === 0 ? size - 1 - row : row;
      if (reserved[y][x]) continue;
      const value = index < words.length * 8 ? (words[index >>> 3] >>> (7 - (index & 7))) & 1 : 0;
      matrix[y][x] = !!(value ^ ((x + y) % 2 === 0)); index++;
    }
  }
  return matrix;
}
export function qrSvg(text) {
  const m = qrMatrix(text), n = m.length + 8;
  const cells = [];
  m.forEach((row, y) => row.forEach((black, x) => { if (black) cells.push(`M${x + 4},${y + 4}h1v1h-1z`); }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><path fill="white" d="M0 0h${n}v${n}H0z"/><path fill="black" d="${cells.join('')}"/></svg>`;
}
