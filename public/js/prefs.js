// 브라우저별 개인 설정 (사용자·테마). 저장이 막힌 환경에서도 기본값으로 동작한다.
export function readPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

export function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 저장 불가 */ }
}

export function applyTheme() {
  const t = readPref('smartsd-theme', 'system');
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

export function setTheme(t) {
  writePref('smartsd-theme', t);
  applyTheme();
}

export const getTheme = () => readPref('smartsd-theme', 'system');
