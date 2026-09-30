// API 어댑터: 서버가 있으면 REST(/api)를 쓰고, 없으면(단독 데모) 브라우저 안에서
// 같은 업무 엔진을 돌려 localStorage 에 저장한다. 두 경우 모두 같은 경로·응답 형식을 쓴다.

export class ApiError extends Error {
  constructor(status, error = {}) {
    super(error.message || '요청을 처리하지 못했습니다.');
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }
}

export async function createApi({ standalone = false } = {}) {
  if (!standalone) {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (res.ok) return httpApi();
    } catch { /* 서버 없음 → 단독 모드 */ }
  }
  return localApi();
}

function httpApi() {
  return {
    mode: 'server',
    async request(method, path, body, actor = '사무실') {
      const res = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json', 'x-actor': encodeURIComponent(actor), 'x-include-state': '1' },
        body: method === 'GET' ? undefined : JSON.stringify(body || {}),
      });
      let json = {};
      try { json = await res.json(); } catch { /* 빈 응답 */ }
      if (!res.ok) throw new ApiError(res.status, json.error);
      return json;
    },
    async load() {
      const r = await this.request('GET', '/api/state');
      return { state: r.data, now: r.now };
    },
    async reset() {
      const r = await this.request('POST', '/api/admin/reset');
      return { state: r.state, now: r.now };
    },
  };
}

async function localApi() {
  const [{ Engine }, { buildSeed }, { nowWall }] = await Promise.all([
    import('../core/engine.js'), import('../core/seed.js'), import('../core/time.js'),
  ]);
  const KEY = 'smartsd-demo-v1';
  const clock = () => window.SMARTSD_NOW || nowWall();
  const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 저장 불가 환경 */ } };
  let initial = null;
  try { initial = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { initial = null; }
  if (!initial) initial = buildSeed(clock());
  const engine = new Engine(initial, { clock, onCommit: save });
  save(engine.state);

  return {
    mode: 'standalone',
    async request(method, path, body, actor = '사무실') {
      const url = new URL(path, 'http://local');
      const out = engine.handle(method, url.pathname, {
        body: body ? JSON.parse(JSON.stringify(body)) : {},
        query: Object.fromEntries(url.searchParams),
        actor,
        includeState: true,
      });
      if (out.status >= 400) throw new ApiError(out.status, out.body.error);
      return { ...out.body, now: clock() };
    },
    async load() {
      return { state: engine.state, now: clock() };
    },
    async reset() {
      engine.state = buildSeed(clock());
      save(engine.state);
      return { state: engine.state, now: clock() };
    },
  };
}
