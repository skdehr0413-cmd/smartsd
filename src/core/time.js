// 벽시계(wall-clock) 시간 유틸리티.
// 모든 시각은 "YYYY-MM-DDTHH:mm" 형식의 한국 현지 시각 문자열로 저장한다.
// 계산은 UTC 밀리초로 환산해 수행하므로 서버(UTC)·브라우저(KST) 어디서 돌아도 결과가 같다.

const pad = (n) => String(n).padStart(2, '0');

export const DEFAULT_TZ = 'Asia/Seoul';

export function parseWall(s) {
  if (!s || typeof s !== 'string') return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(s.trim());
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

export function formatWall(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function nowWall(tz = DEFAULT_TZ, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export const isValidWall = (s) => !Number.isNaN(parseWall(s));
export const addMinutes = (s, min) => formatWall(parseWall(s) + min * 60000);
export const addDays = (s, days) => addMinutes(s, days * 1440);
export const dateOf = (s) => (s ? s.slice(0, 10) : '');
export const timeOf = (s) => (s && s.length >= 16 ? s.slice(11, 16) : '');
export const monthOf = (s) => (s ? s.slice(0, 7) : '');
export const minutesBetween = (a, b) => (parseWall(b) - parseWall(a)) / 60000;
export const hoursBetween = (a, b) => minutesBetween(a, b) / 60;
export const daysBetween = (a, b) => minutesBetween(a, b) / 1440;

/** 반열린 구간 [start, end) 두 개가 겹치는지 검사한다. 끝과 시작이 맞닿는 것은 충돌이 아니다. */
export function overlaps(a, b) {
  return parseWall(a.start) < parseWall(b.end) && parseWall(b.start) < parseWall(a.end);
}

/** 근무 시간(기본 08:00~18:00)에 해당하는 시간 합계. 여러 날에 걸친 작업의 야간 시간은 빼고 센다. */
export function workingHours(start, end, { from = 8, to = 18 } = {}) {
  const s = parseWall(start);
  const e = parseWall(end);
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return 0;
  let total = 0;
  const DAY = 86400000;
  for (let day = s - (s % DAY); day < e; day += DAY) {
    const lo = Math.max(s, day + from * 3600000);
    const hi = Math.min(e, day + to * 3600000);
    if (hi > lo) total += (hi - lo) / 3600000;
  }
  return total;
}

export function isValidRange(start, end) {
  const s = parseWall(start);
  const e = parseWall(end);
  return !Number.isNaN(s) && !Number.isNaN(e) && s < e;
}

/** "2026-09-29T09:00" → "9/29(화) 09:00" */
export function fmtDateTime(s, { withDay = true } = {}) {
  if (!isValidWall(s)) return '-';
  const d = new Date(parseWall(s));
  const dow = '일월화수목금토'[d.getUTCDay()];
  const date = `${d.getUTCMonth() + 1}/${d.getUTCDate()}${withDay ? `(${dow})` : ''}`;
  return s.length >= 16 ? `${date} ${timeOf(s)}` : date;
}

export function fmtDate(s) {
  if (!isValidWall(s)) return '-';
  const d = new Date(parseWall(s));
  const dow = '일월화수목금토'[d.getUTCDay()];
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}(${dow})`;
}

export function fmtRange(start, end) {
  if (!isValidWall(start) || !isValidWall(end)) return '-';
  if (dateOf(start) === dateOf(end)) return `${fmtDateTime(start)}~${timeOf(end)}`;
  return `${fmtDateTime(start)} ~ ${fmtDateTime(end)}`;
}

/** 상대 시간 표시: "3시간 전", "2일 후" */
export function fmtRelative(s, now) {
  const min = minutesBetween(s, now);
  const abs = Math.abs(min);
  const suffix = min >= 0 ? '전' : '후';
  if (abs < 1) return '방금';
  if (abs < 60) return `${Math.round(abs)}분 ${suffix}`;
  if (abs < 1440) return `${Math.round(abs / 60)}시간 ${suffix}`;
  return `${Math.round(abs / 1440)}일 ${suffix}`;
}

export function dayOfWeek(s) {
  return '일월화수목금토'[new Date(parseWall(s)).getUTCDay()];
}
