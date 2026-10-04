const pad = n => String(n).padStart(2, "0");

export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayYmd = () => ymd(new Date());

export function parseYmd(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// 两个日期之间相差的天数（按日历日算）
export function daysBetween(a, b) {
  const x = new Date(a); x.setHours(12, 0, 0, 0);
  const y = new Date(b); y.setHours(12, 0, 0, 0);
  return Math.round((y - x) / 86400000);
}

// 纪念日：在一起第几天，以及下一个「整百天 / 周年」还有几天
export function anniversaryInfo(dateStr, now = new Date()) {
  const start = parseYmd(dateStr);
  const passed = daysBetween(start, now); // 当天 = 0
  if (passed < 0) return { day: 0, future: true, until: -passed, nextLabel: "那一天" };
  const day = passed + 1; // 第一天算第 1 天

  const nextHundred = Math.floor(day / 100 + 1) * 100;
  const untilHundred = nextHundred - day;

  let years = now.getFullYear() - start.getFullYear();
  let next = new Date(start); next.setFullYear(start.getFullYear() + years);
  if (daysBetween(now, next) <= 0) { years += 1; next = new Date(start); next.setFullYear(start.getFullYear() + years); }
  const untilYear = daysBetween(now, next);

  return untilYear < untilHundred
    ? { day, until: untilYear, nextLabel: `${years} 周年` }
    : { day, until: untilHundred, nextLabel: `第 ${nextHundred} 天` };
}

export const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
