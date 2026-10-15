// jsqr 与 Canvas 沿用工具页的解码方式；相机和图片都只在本机处理。
let decoder;
export async function decodeQrFrame(source) {
  decoder ||= import('jsqr').then(m => m.default);
  const jsQR = await decoder;
  const w = source.videoWidth || source.naturalWidth, h = source.videoHeight || source.naturalHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, 1200 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, c.width, c.height);
  const pixels = ctx.getImageData(0, 0, c.width, c.height);
  return jsQR(pixels.data, c.width, c.height)?.data || null;
}
export async function decodeQrFile(file) {
  if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 12 * 1024 * 1024) throw new Error('请选择不超过 12MB 的 PNG、JPEG、WebP 或 GIF 图片');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url;
    await img.decode().catch(() => { throw new Error('图片无法读取，请换一张清晰的二维码图片'); });
    const result = await decodeQrFrame(img);
    if (!result) throw new Error('图片里没有识别到二维码，请换一张清晰的图片或手工输入绑定码');
    return result;
  } finally { URL.revokeObjectURL(url); }
}
export function createQrCamera({ video, onResult, onError, getStream = () => navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }), decode = decodeQrFrame, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame }) {
  let stream, frame, generation = 0;
  const stopTracks = s => s?.getTracks().forEach(t => t.stop());
  const stop = () => {
    generation++;
    if (frame != null) cancelFrame(frame);
    frame = null; stopTracks(stream); stream = null;
    video.pause(); video.srcObject = null;
  };
  const start = async () => {
    stop(); const run = generation;
    try {
      const incoming = await getStream();
      if (generation !== run) { stopTracks(incoming); return; }
      stream = incoming; video.srcObject = incoming;
      await video.play();
      if (generation !== run) return;
      let last = -Infinity;
      const tick = async time => {
        if (generation !== run) return;
        if (time - last >= 200 && video.readyState >= 2) {
          last = time;
          try {
            const result = await decode(video);
            if (generation !== run) return;
            if (result) { stop(); onResult(result); return; }
          } catch { if (generation === run) { stop(); onError('无法读取相机画面，请改用图片识别或手工输入'); } return; }
        }
        if (generation === run) frame = requestFrame(tick);
      };
      frame = requestFrame(tick);
    } catch (e) {
      if (generation !== run) return;
      stop();
      onError(e.name === 'NotAllowedError' ? '没有获得摄像头授权，可重新开启，或使用图片识别/手工输入' : '摄像头不可用，请使用图片识别或手工输入');
    }
  };
  return { start, stop };
}
