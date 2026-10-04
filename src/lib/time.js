const pad = n => String(n).padStart(2, "0");

function dayDiff(a, b) {
  const da = new Date(a); da.setHours(0, 0, 0, 0);
  const db = new Date(b); db.setHours(0, 0, 0, 0);
  return Math.round((db - da) / 86400000);
}

// 今天05:20 / 昨天23:07 / 9月18日 17:48 / 2025年9月18日 17:48
export function stamp(ts) {
  const d = new Date(ts);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const diff = dayDiff(ts, Date.now());
  if (diff === 0) return `今天${hm}`;
  if (diff === 1) return `昨天${hm}`;
  if (d.getFullYear() === new Date().getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

// 通讯列表用的短时间
export function shortTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const diff = dayDiff(ts, Date.now());
  if (diff === 0) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (diff === 1) return "昨天";
  if (diff < 7) return "周" + "日一二三四五六"[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function nowForAI() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${"日一二三四五六"[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function gapForAI(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} 分钟`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} 小时`;
  return `${Math.round(h / 24)} 天`;
}
