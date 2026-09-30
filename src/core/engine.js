// 업무 엔진: 명령 실행(트랜잭션) + 조회 + 라우팅.
// 서버(Node)와 브라우저 단독 실행 모드가 같은 엔진을 쓴다.
import { commands } from './commands.js';
import { DomainError } from './errors.js';
import { emptyState } from './model.js';
import { nowWall } from './time.js';
import { matchRoute } from './routes.js';
import * as views from './views.js';

const MAX_EVENTS = 5000;

function randomToken() {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export const queries = {
  state: (s) => s,
  dashboard: (s, now) => views.dashboard(s, now),
  board: (s) => views.board(s),
  findings: (s, now) => views.findingsView(s, now),
  job: (s, now, p) => views.jobDetail(s, p.id, now),
  schedule: (s, now, p) => views.schedule(s, now, { from: p.from, days: Number(p.days) || 7 }),
  materials: (s, now) => views.materialsOverview(s, now),
  settlement: (s, now, p) => views.settlement(s, now, { month: p.month }),
  publicQuote: (s, now, p) => views.publicQuote(s, p.token),
  publicChangeOrder: (s, now, p) => views.publicChangeOrder(s, p.token),
};

export class Engine {
  constructor(state, { clock = () => nowWall(), onCommit = null, token = randomToken } = {}) {
    this.state = state || emptyState();
    this.clock = clock;
    this.onCommit = onCommit;
    this.token = token;
  }

  now() {
    return this.clock();
  }

  /** 명령을 복사본에서 실행하고, 성공하면 한 번에 반영한다. */
  execute(name, payload = {}, { actor = '사무실', now } = {}) {
    const fn = commands[name];
    if (!fn) throw new DomainError('UNKNOWN_COMMAND', `알 수 없는 명령: ${name}`, { status: 404 });
    const draft = structuredClone(this.state);
    const at = now || this.clock();
    draft.meta.seq = draft.meta.seq || {};
    const seq = (key) => {
      draft.meta.seq[key] = (draft.meta.seq[key] || 0) + 1;
      return draft.meta.seq[key];
    };
    const ctx = {
      now: at,
      actor,
      seq,
      id: (prefix, width = 4) => `${prefix}-${String(seq(prefix)).padStart(width, '0')}`,
      token: this.token,
      log: (jobId, message, level = 'info') => {
        draft.events.push({ id: `E${seq('E')}`, at, actor, jobId: jobId || null, message, level, command: name });
      },
    };
    const result = fn(draft, payload || {}, ctx);
    if (draft.events.length > MAX_EVENTS) draft.events.splice(0, draft.events.length - MAX_EVENTS);
    this.state = draft;
    if (this.onCommit) this.onCommit(draft, { name, payload });
    return result;
  }

  query(name, params = {}) {
    const fn = queries[name];
    if (!fn) throw new DomainError('UNKNOWN_QUERY', `알 수 없는 조회: ${name}`, { status: 404 });
    return fn(this.state, this.clock(), params);
  }

  /** HTTP 형태 요청 처리 — 서버와 브라우저 어댑터가 공용으로 사용 */
  handle(method, pathname, { body = {}, query = {}, actor = '사무실', includeState = false } = {}) {
    const m = matchRoute(method, pathname);
    if (!m) return { status: 404, body: { error: { code: 'NOT_FOUND', message: `경로를 찾을 수 없습니다: ${method} ${pathname}` } } };
    const { route, params } = m;
    try {
      if (route.query) {
        const data = this.query(route.query, { ...query, ...params });
        return { status: 200, body: { data } };
      }
      const who = route.public ? '고객' : actor;
      const data = this.execute(route.command, { ...(body || {}), ...params }, { actor: who });
      const out = { data };
      if (includeState && !route.public) out.state = this.state;
      return { status: route.method === 'POST' && route.created ? 201 : 200, body: out };
    } catch (err) {
      if (err instanceof DomainError) return { status: err.status, body: { error: err.toJSON() } };
      throw err;
    }
  }
}
