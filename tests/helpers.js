// 테스트 공용 픽스처: 최소 데이터로 엔진을 만들고 작업건을 원하는 단계까지 진행한다.
import { Engine } from '../src/core/engine.js';
import { emptyState } from '../src/core/model.js';
import { DEMO_SIGNATURE } from '../src/core/seed.js';

export const NOW = '2026-09-29T10:30';
export const SIG = DEMO_SIGNATURE;

export function fixture() {
  const s = emptyState({ name: '테스트배관' });
  s.crews = [
    { id: 'T1', name: '1팀', role: '배관', members: ['김대표', '이기사'], color: 0, active: true },
    { id: 'T2', name: '2팀', role: '하수', members: ['박기사', '최기사'], color: 1, active: true },
    { id: 'T3', name: '3팀', role: '누수', members: ['정기사', '김대표'], color: 2, active: true },
  ];
  s.materials = [
    { id: 'M01', sku: 'PPR', name: 'PPR 급수관', unit: '본', price: 15000, cost: 8000, stock: 10, safety: 2, kind: 'consumable' },
    { id: 'M02', sku: 'TRAP', name: '배수 트랩', unit: '개', price: 9000, cost: 4000, stock: 5, safety: 0, kind: 'consumable' },
    { id: 'E01', sku: 'JET', name: '고압 세척기', unit: '대', price: 80000, cost: 0, stock: 1, safety: 0, kind: 'equipment' },
  ];
  let t = 0;
  const engine = new Engine(s, { clock: () => NOW, token: () => `tok${++t}` });
  return engine;
}

/** 엔진 명령 실행 (시각·사용자 지정 가능) */
export function runner(engine) {
  return (name, payload, now = NOW, actor = '테스트') => engine.execute(name, payload, { actor, now });
}

export const LABOR = (price = 200000) => ({ name: '기사 2인 반일', qty: 1, unitPrice: price, kind: 'labor' });

/**
 * 작업건 하나를 만들어 target 단계까지 진행한다.
 * target: RECEIVED | QUOTED | APPROVED | SCHEDULED | IN_PROGRESS | COMPLETED | INVOICED
 */
export function jobAt(engine, target, { crewId = 'T1', start = '2026-09-30T09:00', end = '2026-09-30T12:00', items } = {}) {
  const run = runner(engine);
  const job = run('createInquiry', { customer: { name: '홍길동', phone: '010-0000-0000', address: '테스트시 1번지' }, title: '급수관 교체' });
  if (target === 'RECEIVED') return { job };
  let q = run('createQuote', { id: job.id, items: items || [{ materialId: 'M01', qty: 2 }, LABOR()] });
  q = run('sendQuote', { id: q.id });
  if (target === 'QUOTED') return { job, quote: q };
  run('approveQuote', { id: q.id, by: '홍길동', method: '현장 서명', signature: SIG });
  if (target === 'APPROVED') return { job, quote: q };
  run('scheduleJob', { id: job.id, crewId, start, end });
  if (target === 'SCHEDULED') return { job, quote: q };
  run('startJob', { id: job.id });
  if (target === 'IN_PROGRESS') return { job, quote: q };
  run('completeJob', { id: job.id }, '2026-09-29T09:00');
  if (target === 'COMPLETED') return { job, quote: q };
  const inv = run('issueInvoice', { id: job.id });
  return { job, quote: q, invoice: inv };
}

export function expectError(fn, code) {
  try {
    fn();
  } catch (err) {
    if (err.code !== code) throw new Error(`기대한 오류 ${code}, 실제 ${err.code}: ${err.message}`);
    return err;
  }
  throw new Error(`오류 ${code} 가 발생해야 합니다.`);
}
