// 小屋里的小声音：用浏览器自带的合成器现做，不用下载音频文件
let ctx = null;
function ac() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}
function tone(freq, { at = 0, dur = 0.3, type = "sine", vol = 0.08, to = null } = {}) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}
export const sfx = {
  chime() { [1568, 2093, 1760, 2637].forEach((f, i) => tone(f, { at: i * 0.09, dur: 0.9, vol: 0.05 })); },
  chirp() { tone(2200, { dur: 0.09, to: 3400, type: "triangle", vol: 0.05 }); tone(2600, { at: 0.12, dur: 0.08, to: 3800, type: "triangle", vol: 0.04 }); },
  whoosh() { tone(180, { dur: 0.35, to: 520, type: "sawtooth", vol: 0.02 }); },
  pop() { tone(660, { dur: 0.12, to: 990, vol: 0.06 }); },
  creak() { tone(140, { dur: 0.25, to: 110, type: "triangle", vol: 0.04 }); },
  paper() { tone(900, { dur: 0.06, type: "square", vol: 0.015 }); tone(700, { at: 0.07, dur: 0.06, type: "square", vol: 0.012 }); },
};
