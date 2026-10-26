// 聊天发视频：压一下再存（长边 ≤ 720、码率压低），封面和截帧都是 JPEG 图片。
// 视频本体存 file:<id>（跟着现有同步走），封面和截帧存 img:<id>。
import { uid } from "../store/index.js";
import { set } from "./kv.js";
import { fileActivity } from "./filePicker.js";

export const VIDEO_MAX_SECS = 60;           // 太长的不收（压的时候要等够视频这么长）
export const VIDEO_MAX_SOURCE = 300 * 1024 * 1024; // 原视频超过这个大小不收
export const VIDEO_MAX_OUT = 20 * 1024 * 1024;     // 压完还超过这个就放弃
export const VIDEO_FRAMES = 6;              // 发给 TA 时均匀截几帧
const LONG_EDGE = 720;
const BITRATE = 1_200_000;
const FRAME_EDGE = 640;

export const isVideoFile = f => /^video\//.test(f?.type || "") || /\.(mp4|mov|m4v|webm)$/i.test(f?.name || "");

const wait = (el, ok, bad = "error") => new Promise((resolve, reject) => {
  el.addEventListener(ok, resolve, { once: true });
  el.addEventListener(bad, () => reject(new Error("这段视频读不了")), { once: true });
});

async function openVideo(blob) {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  await wait(v, "loadeddata");
  return { v, done: () => { v.removeAttribute("src"); v.load(); URL.revokeObjectURL(url); } };
}

const seek = (v, t) => new Promise(resolve => {
  if (Math.abs(v.currentTime - t) < 0.01) return resolve();
  v.addEventListener("seeked", resolve, { once: true });
  v.currentTime = t;
});

function frameBlob(v, edge) {
  const k = Math.min(1, edge / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(v.videoWidth * k));
  c.height = Math.max(2, Math.round(v.videoHeight * k));
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, "image/jpeg", 0.75));
}

async function saveJpeg(blob) {
  const id = uid();
  await set("img:" + id, blob);
  return id;
}

// 均匀截帧（每一段的正中间），存成图片，返回 id 列表
export async function videoFrames(blob, n = VIDEO_FRAMES) {
  const { v, done } = await openVideo(blob);
  try {
    const dur = v.duration;
    const ids = [];
    for (let i = 0; i < n; i++) {
      await seek(v, Math.min(dur - 0.05, (dur * (i + 0.5)) / n));
      const jpg = await frameBlob(v, FRAME_EDGE);
      if (jpg) ids.push(await saveJpeg(jpg));
    }
    return ids;
  } finally { done(); }
}

// 边放边重新编码：画面画到小画布上、声音单独接过来，用 MediaRecorder 录成新的
async function reencode(v, onProgress) {
  const k = Math.min(1, LONG_EDGE / Math.max(v.videoWidth, v.videoHeight));
  const w = Math.max(2, Math.round((v.videoWidth * k) / 2) * 2), h = Math.max(2, Math.round((v.videoHeight * k) / 2) * 2);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  const stream = canvas.captureStream(24);
  let ac = null;
  try { // 声音：接不上就算了，只有画面
    const AC = window.AudioContext || window.webkitAudioContext;
    ac = new AC();
    const dest = ac.createMediaStreamDestination();
    ac.createMediaElementSource(v).connect(dest);
    dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  } catch { /* 没声音 */ }
  const mime = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find(t => window.MediaRecorder?.isTypeSupported?.(t));
  if (!mime) throw new Error("这个浏览器压不了视频");
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: BITRATE, audioBitsPerSecond: 64_000 });
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stopped = new Promise(r => { rec.onstop = r; });
  v.muted = false; v.volume = 1; // 声音只进录音，不会外放（没接到扬声器）
  let raf = 0;
  const draw = () => { ctx.drawImage(v, 0, 0, w, h); onProgress?.(v.currentTime / v.duration); raf = requestAnimationFrame(draw); };
  rec.start(1000);
  await v.play();
  draw();
  await wait(v, "ended");
  cancelAnimationFrame(raf);
  rec.stop();
  await stopped;
  stream.getTracks().forEach(t => t.stop());
  ac?.close?.();
  return new Blob(chunks, { type: mime.split(";")[0] });
}

// 选来的视频 → 附件 { kind:"video", file, img(封面), frames:[…], dur, mime, name }；不合格就抛出带中文说明的错
export async function videoAttachment(file, { onProgress } = {}) {
  if (file.size > VIDEO_MAX_SOURCE) throw new Error(`视频太大了（超过 ${VIDEO_MAX_SOURCE / 1024 / 1024} MB）`);
  fileActivity.processing++;
  const { v, done } = await openVideo(file);
  try {
    const dur = v.duration;
    if (!isFinite(dur) || !v.videoWidth) throw new Error("这段视频读不了");
    if (dur > VIDEO_MAX_SECS) throw new Error(`视频太长了（${Math.round(dur)} 秒），最多 ${VIDEO_MAX_SECS} 秒`);
    await seek(v, 0);
    const poster = await frameBlob(v, FRAME_EDGE);
    // 已经够小的（分辨率、大小都在线内）原样存，省得白等一遍重新编码
    const small = Math.max(v.videoWidth, v.videoHeight) <= LONG_EDGE && file.size <= (BITRATE / 8) * dur * 1.3 + 400_000;
    let blob = file;
    if (!small) { blob = await reencode(v, onProgress); }
    if (blob.size > VIDEO_MAX_OUT) throw new Error(`压完还是太大了（${(blob.size / 1024 / 1024).toFixed(1)} MB），请剪短一点`);
    const id = uid();
    await set("file:" + id, blob);
    const img = await saveJpeg(poster);
    const frames = await videoFrames(file); // 从原视频截（重新编码出来的 webm 没有时长，不好跳）
    return { kind: "video", file: id, img, frames, dur: Math.round(dur), mime: blob.type || file.type, name: file.name, size: blob.size };
  } finally { done(); fileActivity.processing--; }
}

export const videoNote = a => `视频，共 ${a.dur} 秒，以下是截帧（只看得到画面，听不到声音）`;
