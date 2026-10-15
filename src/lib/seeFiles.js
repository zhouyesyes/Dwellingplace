import { decodeImage } from "./filePicker.js";
// 工作间「和他一起」：她发来的附件，在手机上先「看一遍」，变成他能直接看懂的东西一起发给他
//   图片 → 缩小成 JPEG（GIF 只取第一帧）
//   视频 → 均匀截几张画面（听不到声音）
//   PDF  → 取出里面的字（接口收 PDF 的话也带上原文件）
//   TXT / MD / CSV / JSON → 直接读成文字（太长截掉）
//   ZIP 和别的 → 看不了，只告诉他有这么个文件（要看就交给 Codex 解开）
// 全在浏览器里做，服务器不用多干活；每个文件出错只跳过它自己

const MAX_SIDE = 1600; // 图片最长边
const FRAME_SIDE = 768; // 视频截图最长边
const MAX_TEXT = 30_000; // 文字文件最多读多少字

function canvasOf(src, w, h, side) {
  const scale = Math.min(1, side / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; // 透明图转 JPEG 会变黑，先铺底色
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82).split(",")[1];
}

async function imagePart(file) {
  const bmp = await decodeImage(file);
  try {
    const data = canvasOf(bmp, bmp.width, bmp.height, MAX_SIDE);
    return { type: "image", data, mime: "image/jpeg" };
  } finally { bmp.close?.(); }
}

// 视频：等它能跳、跳到几个时间点、各截一张。iPhone 上要静音 + playsinline 才肯加载
function waitFor(el, ev, ms = 8000) {
  return new Promise((ok, bad) => {
    const t = setTimeout(() => { el.removeEventListener(ev, done); bad(new Error("视频读不出来")); }, ms);
    function done() { clearTimeout(t); ok(); }
    el.addEventListener(ev, done, { once: true });
  });
}
async function videoParts(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  Object.assign(v, { muted: true, playsInline: true, preload: "auto", src: url });
  try {
    await waitFor(v, "loadeddata");
    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    const n = dur < 4 ? 2 : dur < 20 ? 4 : 6;
    const frames = [];
    for (let i = 0; i < n; i++) {
      const at = dur ? Math.min(dur - 0.05, (dur * (i + 0.5)) / n) : 0;
      if (Math.abs(v.currentTime - at) > 0.01) { v.currentTime = at; await waitFor(v, "seeked"); }
      frames.push({ type: "image", data: canvasOf(v, v.videoWidth, v.videoHeight, FRAME_SIDE), mime: "image/jpeg" });
    }
    return [{ type: "text", text: `【视频：${file.name}，大约 ${Math.round(dur)} 秒。下面 ${frames.length} 张是从头到尾均匀截的画面，听不到声音】` }, ...frames];
  } finally {
    v.removeAttribute("src"); v.load();
    URL.revokeObjectURL(url);
  }
}

async function pdfPart(file) {
  const { pdfText } = await import("./pdfText.js");
  const text = await pdfText(file).catch(() => "");
  return { type: "pdf", name: file.name, data: await toBase64(file), text: text.slice(0, MAX_TEXT * 2) };
}
async function toBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function textPart(file) {
  const s = await file.text();
  const cut = s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n……（后面还有 ${s.length - MAX_TEXT} 字没放进来，要全看就交给 Codex 读）` : s;
  return { type: "text", text: `【文件：${file.name}】\n${cut}` };
}

// files：File 列表 → { parts: 给模型的内容, seen: 每个文件看成了什么（写进提示里）}
export async function seeFiles(files) {
  const parts = [];
  const seen = [];
  for (const file of files || []) {
    const name = file.name || "";
    const type = file.type || "";
    try {
      if (type.startsWith("image/")) { parts.push(await imagePart(file)); seen.push(`${name}（图片，你看得到）`); }
      else if (type.startsWith("video/")) { const p = await videoParts(file); parts.push(...p); seen.push(`${name}（视频，看得到截下来的 ${p.length - 1} 张画面，听不到声音）`); }
      else if (type === "application/pdf" || /\.pdf$/i.test(name)) { parts.push(await pdfPart(file)); seen.push(`${name}（PDF，里面的字你看得到）`); }
      else if (/^text\/|json/.test(type) || /\.(txt|md|csv|json)$/i.test(name)) { parts.push(await textPart(file)); seen.push(`${name}（文字文件，内容你看得到）`); }
      else seen.push(`${name}（这种文件你直接看不了，要看就交给 Codex 打开）`);
    } catch {
      seen.push(`${name}（没读出来，要看就交给 Codex 打开）`);
    }
  }
  return { parts, seen };
}
