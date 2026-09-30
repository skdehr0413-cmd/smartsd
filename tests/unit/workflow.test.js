// 7단계 업무 흐름과 단계별 안전장치(가드) 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, runner, jobAt, expectError, LABOR, SIG, NOW } from '../helpers.js';
import { detectFindings } from '../../src/core/detectors.js';
import { jobDetail } from '../../src/core/views.js';
import { totals } from '../../src/core/money.js';

test('정상 흐름: 문의 접수 → 현장 확인 → 견적 → 고객 승인 → 배정 → 자재 사용 → 완료 → 청구 → 수금', () => {
  const e = fixture();
  const run = runner(e);
  const job = run('createInquiry', { customer: { name: '김고객', phone: '010-1111-2222', address: '성남시 1' }, title: '욕실 누수', channel: '카카오톡', urgency: 'urgent' });
  assert.equal(job.status, 'RECEIVED');
  assert.equal(job.urgency, 'urgent');

  run('scheduleSurvey', { id: job.id, crewId: 'T2', start: '2026-09-29T14:00', end: '2026-09-29T15:00' });
  run('completeSurvey', { id: job.id, findings: '욕실 바닥 급수관 누수' });
  let q = run('createQuote', { id: job.id, items: [{ materialId: 'M01', qty: 3 }, LABOR(250000)] });
  assert.equal(q.items[0].unitPrice, 15000, '자재 단가는 자재 목록에서 자동 입력');
  q = run('sendQuote', { id: q.id });
  assert.ok(q.token, '고객 승인 링크 토큰 생성');
  run('approveQuoteByToken', { token: q.token, name: '김고객', signature: SIG });
  assert.equal(e.state.jobs[0].status, 'APPROVED');
  assert.equal(e.state.quotes[0].approval.method, '고객 링크 서명');

  run('scheduleJob', { id: job.id, crewId: 'T1', start: '2026-09-30T09:00', end: '2026-09-30T13:00' });
  run('reserveMaterial', { id: job.id, materialId: 'M01', qty: 3 });
  run('startJob', { id: job.id });
  const { usage, warnings } = run('recordUsage', { id: job.id, materialId: 'M01', qty: 3 });
  assert.equal(usage.qty, 3);
  assert.deepEqual(warnings, []);
  assert.equal(e.state.materials[0].stock, 7, '사용하면 재고 차감');
  assert.equal(e.state.reservations[0].status, 'consumed', '예약은 사용 완료로 전환');

  run('completeJob', { id: job.id, note: '누수 없음' });
  const inv = run('issueInvoice', { id: job.id });
  assert.equal(totals(inv.items).total, totals(q.items).total, '청구액 = 승인 견적');
  run('recordPayment', { id: inv.id, amount: 100000, method: '카드' });
  assert.equal(e.state.invoices[0].status, 'partial');
  run('recordPayment', { id: inv.id, amount: totals(inv.items).total - 100000 });
  assert.equal(e.state.jobs[0].status, 'PAID');
  assert.equal(detectFindings(e.state, NOW).length, 0, '정상 흐름에서는 점검 항목이 없다');
  assert.ok(e.state.events.length >= 10, '모든 단계가 이력에 남는다');
});

test('가드: 고객 승인 없이는 배정·착수할 수 없다', () => {
  const e = fixture();
  const run = runner(e);
  const { job } = jobAt(e, 'QUOTED');
  expectError(() => run('scheduleJob', { id: job.id, crewId: 'T1', start: '2026-09-30T09:00', end: '2026-09-30T10:00' }), 'INVALID_STATE');
  expectError(() => run('startJob', { id: job.id }), 'INVALID_STATE');
});

test('가드: 빈 견적은 발송할 수 없고, 발송된 견적은 수정할 수 없다', () => {
  const e = fixture();
  const run = runner(e);
  const job = run('createInquiry', { customer: { name: 'A', phone: '1', address: 'x' }, title: 't' });
  const q = run('createQuote', { id: job.id, items: [] });
  expectError(() => run('sendQuote', { id: q.id }), 'VALIDATION');
  run('updateQuote', { id: q.id, items: [LABOR()] });
  run('sendQuote', { id: q.id });
  expectError(() => run('updateQuote', { id: q.id, items: [] }), 'INVALID_STATE');
  const v2 = run('createQuote', { id: job.id, items: [LABOR(300000)] });
  assert.equal(v2.version, 2);
  assert.equal(e.state.quotes[0].status, 'superseded', '새 버전을 만들면 이전 발송본은 교체');
  expectError(() => run('approveQuoteByToken', { token: e.state.quotes[0].token, name: 'A', signature: SIG }), 'INVALID_STATE');
});

test('가드: 현장 서명 승인에는 서명이 필요하다', () => {
  const e = fixture();
  const run = runner(e);
  const { quote } = jobAt(e, 'QUOTED');
  expectError(() => run('approveQuote', { id: quote.id, by: '홍길동', method: '현장 서명' }), 'VALIDATION');
  expectError(() => run('approveQuote', { id: quote.id, by: '홍길동', method: '카톡 이모티콘' }), 'VALIDATION');
  run('approveQuote', { id: quote.id, by: '홍길동', method: '문자 회신' });
});

test('트랜잭션: 명령이 실패하면 상태가 조금도 바뀌지 않는다', () => {
  const e = fixture();
  const run = runner(e);
  const { job } = jobAt(e, 'IN_PROGRESS');
  const before = JSON.stringify(e.state);
  expectError(() => run('recordUsage', { id: job.id, materialId: 'M02', qty: 99 }), 'INSUFFICIENT_STOCK');
  assert.equal(JSON.stringify(e.state), before);
});

test('작업 완료 시 남은 자재 예약은 자동 해제된다', () => {
  const e = fixture();
  const run = runner(e);
  const { job } = jobAt(e, 'IN_PROGRESS');
  run('reserveMaterial', { id: job.id, materialId: 'M01', qty: 2 });
  run('recordUsage', { id: job.id, materialId: 'M01', qty: 1 });
  run('completeJob', { id: job.id });
  const r = e.state.reservations[0];
  assert.equal(r.status, 'released');
  assert.equal(r.usedQty, 1);
});

test('추가 작업: 요청 → 고객 링크 승인 → 청구서에 자동 포함', () => {
  const e = fixture();
  const run = runner(e);
  const { job } = jobAt(e, 'IN_PROGRESS');
  const co = run('requestChangeOrder', { id: job.id, title: '트랩 교체', reason: '부식', items: [{ materialId: 'M02', qty: 1 }, { name: '추가 인건비', qty: 1, unitPrice: 40000, kind: 'labor' }] });
  run('approveChangeOrderByToken', { token: co.token, name: '홍길동', signature: SIG });
  run('recordUsage', { id: job.id, materialId: 'M02', qty: 1, changeOrderId: co.id });
  run('completeJob', { id: job.id });
  const inv = run('issueInvoice', { id: job.id });
  assert.ok(inv.items.some((i) => i.source === 'change' && i.changeOrderId === co.id), '승인된 추가 작업이 청구서에 들어감');
  const d = jobDetail(e.state, job.id, NOW);
  assert.equal(d.basis.total, totals(inv.items).total);
});

test('청구서 취소 후 재발행, 과입금 방지', () => {
  const e = fixture();
  const run = runner(e);
  const { job, invoice } = jobAt(e, 'INVOICED');
  expectError(() => run('recordPayment', { id: invoice.id, amount: 10_000_000 }), 'OVERPAYMENT');
  run('voidInvoice', { id: invoice.id, reason: '금액 정정' });
  assert.equal(e.state.jobs[0].status, 'COMPLETED');
  const inv2 = run('issueInvoice', { id: job.id });
  assert.notEqual(inv2.id, invoice.id);
});

test('작업 취소: 예약 해제, 자재를 쓴 작업은 취소 불가', () => {
  const e = fixture();
  const run = runner(e);
  const { job } = jobAt(e, 'SCHEDULED');
  run('reserveMaterial', { id: job.id, materialId: 'M01', qty: 2 });
  run('cancelJob', { id: job.id, reason: '고객 사정' });
  assert.equal(e.state.reservations[0].status, 'released');
  const { job: j2 } = jobAt(e, 'IN_PROGRESS', { start: '2026-10-02T09:00', end: '2026-10-02T12:00' });
  run('recordUsage', { id: j2.id, materialId: 'M01', qty: 1 });
  expectError(() => run('cancelJob', { id: j2.id, reason: 'x' }), 'INVALID_STATE');
});
