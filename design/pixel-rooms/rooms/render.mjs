// 生成 PNG：原尺寸和放大版，再拼一张对比图
import fs from "node:fs";
import zlib from "node:zlib";
import { makeCanvas, drawRoom, W, H } from "./iso.js";
import { cui, rowan } from "./rooms.js";

const OUT = new URL("./out/", import.meta.url);
fs.mkdirSync(OUT, { recursive: true });

function png(buf, w, h, bg = [0, 0, 0, 0]) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, o = y * (w * 4 + 1) + 1 + x * 4;
      const a = buf[i + 3];
      raw[o] = a ? buf[i] : bg[0]; raw[o + 1] = a ? buf[i + 1] : bg[1]; raw[o + 2] = a ? buf[i + 2] : bg[2]; raw[o + 3] = a ? 255 : bg[3];
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function scale(buf, w, h, s) {
  const o = new Uint8ClampedArray(w * s * h * s * 4);
  for (let y = 0; y < h * s; y++) for (let x = 0; x < w * s; x++) {
    const i = ((y / s | 0) * w + (x / s | 0)) * 4, j = (y * w * s + x) * 4;
    o[j] = buf[i]; o[j + 1] = buf[i + 1]; o[j + 2] = buf[i + 2]; o[j + 3] = buf[i + 3];
  }
  return o;
}

const shots = [];
for (const [key, room] of [["cui", cui], ["rowan", rowan]]) {
  for (const [step, opt, mail] of [["final", { light: true, furniture: true }, false], ["final-有信", { light: true, furniture: true }, true]]) {
    globalThis.MAIL = mail;
    const cv = makeCanvas();
    drawRoom(cv, room, opt);
    const name = `${key}-${step}`;
    fs.writeFileSync(new URL(`${name}.png`, OUT), png(cv.buf, W, H));
    fs.writeFileSync(new URL(`${name}@3x.png`, OUT), png(scale(cv.buf, W, H, 3), W * 3, H * 3));
    shots.push(name);
  }
}
console.log(shots.join(" "));
