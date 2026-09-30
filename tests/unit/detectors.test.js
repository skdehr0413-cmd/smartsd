// 4대 위험 탐지 규칙: 예방(명령 거부)과 탐지(점검 항목) 양쪽을 검증한다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, runner, jobAt, expectError, LABOR, SIG, NOW } from '../helpers.js';
import { detectFindings, summarizeFindings } from '../../src/core/detectors.js';

const codes = (e, now = NOW) => detectFindings(e.state, now).map((f) => f.code);
const byCode = (e, code, now = NOW) => detectFindings(e.state, now).filter((f) => f.code === code);

describe('① 추가 작업 승인 누락', () => {
  test('승인 없이 수행된 추가 작업 → 긴급, 금액 표시, 완료 차단', () => {
    const e = fixture();
    const run = runner(e);
    const { job } = jobAt(e, 'IN_PROGRESS');
    const co = run('requestChangeOrder', { id: job.id, title: '트랩 교체', items: [{ materialId: 'M02', qty: 1 }] });
    assert.equal(byCode(e, 'CO_PERFORMED_UNAPPROVED').length, 0, '요청만으로는 누락 아님');
    const { warnings } = run('recordUsage', { id: job.id, materialId: 'M02', qty: 1, changeOrderId: co.id });
    assert.match(warnings[0], /고객 승인 전/);
    const [f] = byCode(e, 'CO_PERFORMED_UNAPPROVED');
    assert.equal(f.severity, 'critical');
    assert.equal(f.amount, 9900);
    expectError(() => run('completeJob', { id: job.id }), 'UNAPPROVED_CHANGE_ORDER');
    expectError(() => run('cancelChangeOrder', { id: co.id }), 'INVALID_STATE');

    run('approveChangeOrder', { id: co.id, by: '홍길동', method: '현장 서명', signature: SIG });
    assert.equal(byCode(e, 'CO_PERFORMED_UNAPPROVED').length, 0, '승인하면 해소');
    run('completeJob', { id: job.id });
  });

  test('고객이 거절했는데 이미 수행한 추가 작업 → 무상 처리해야 해소', () => {
    const e = fixture();
    const run = runner(e);
    const { job } = jobAt(e, 'IN_PROGRESS');
    const co = run('requestChangeOrder', { id: job.id, title: '보온 공사', items: [LABOR(50000)] });
    run('performChangeOrder', { id: co.id });
    run('rejectChangeOrderByToken', { token: co.token, reason: '필요 없음' });
    const [f] = byCode(e, 'CO_PERFORMED_UNAPPROVED');
    assert.match(f.title, /거절/);
    expectError(() => run('waiveChangeOrder', { id: co.id }), 'VALIDATION');
    run('waiveChangeOrder', { id: co.id, reason: '당사 판단으로 선시공' });
    assert.equal(byCode(e, 'CO_PERFORMED_UNAPPROVED').length, 0);
  });

  test('견적보다 많이 쓴 자재 → 작업 중 주의, 완료 차단, 추가 작업으로 전환하면 승인 누락으로 이관', () => {
    const e = fixture();
    const run = runner(e);
    const { job } = jobAt(e, 'IN_PROGRESS'); // 견적: PPR 2본
    const { warnings } = run('recordUsage', { id: job.id, materialId: 'M01', qty: 5 });
    assert.match(warnings.at(-1), /3본 초과/);
    const [f] = byCode(e, 'EXCESS_USAGE_UNAPPROVED');
    assert.equal(f.severity, 'warning');
    assert.equal(f.amount, 49500);
    expectError(() => run('completeJob', { id: job.id }), 'UNAPPROVED_EXCESS_USAGE');

    const co = run('changeOrderFromExcess', { id: job.id });
    assert.equal(co.items[0].qty, 3);
    assert.deepEqual(codes(e).filter((c) => c.startsWith('EXCESS') || c.startsWith('CO_')), ['CO_PERFORMED_UNAPPROVED']);
    run('approveChangeOrderByToken', { token: co.token, name: '홍길동', signature: SIG });
    run('completeJob', { id: job.id });
    const inv = run('issueInvoice', { id: job.id });
    assert.ok(inv.items.some((i) => i.changeOrderId === co.id));
    assert.equal(detectFindings(e.state, NOW).length, 0);
  });

  test('완료된 작업의 초과 사용(데이터 이관 등) → 긴급', () => {
    const e = fixture();
    const run = runner(e);
    const { job } = jobAt(e, 'COMPLETED');
    run('recordUsage', { id: job.id, materialId: 'M01', qty: 4 }); // 완료 후 늦게 기록
    assert.equal(byCode(e, 'EXCESS_USAGE_UNAPPROVED')[0].severity, 'critical');
  });

  test('추가 작업 승인 24시간 지연 → 주의 / 고액 구두 승인 → 참고', () => {
    const e = fixture();
    const run = runner(e);
    const { job } = jobAt(e, 'IN_PROGRESS');
    run('requestChangeOrder', { id: job.id, title: '배관 연장', items: [LABOR(100000)] }, '2026-09-28T09:00');
    assert.equal(byCode(e, 'CO_APPROVAL_DELAYED').length, 1);
    assert.equal(byCode(e, 'CO_APPROVAL_DELAYED', '2026-09-28T20:00').length, 0, '24시간 전에는 알리지 않음');
    const big = run('requestChangeOrder', { id: job.id, title: '벽체 철거', items: [LABOR(400000)] });
    run('approveChangeOrder', { id: big.id, by: '홍길동', method: '전화(구두)' });
    assert.equal(byCode(e, 'WEAK_APPROVAL_EVIDENCE')[0].severity, 'info');
  });

  test('승인 견적 없이 진행 중인 작업(수기 이관 데이터) → 긴급', () => {
    const e = fixture();
    const { job } = jobAt(e, 'SCHEDULED');
    e.state.quotes.forEach((q) => { q.status = 'superseded'; }); // 이관 데이터 흉내
    assert.equal(byCode(e, 'WORK_WITHOUT_APPROVED_QUOTE')[0].jobIds[0], job.id);
  });
});

describe('② 자재 중복 예약', () => {
  test('소모 자재 재고 초과 예약 → 예약 거부, 강제 시 긴급 표시', () => {
    const e = fixture();
    const run = runner(e);
    const { job: a } = jobAt(e, 'SCHEDULED');
    const { job: b } = jobAt(e, 'SCHEDULED', { crewId: 'T2' });
    run('reserveMaterial', { id: a.id, materialId: 'M01', qty: 7 });
    const err = expectError(() => run('reserveMaterial', { id: b.id, materialId: 'M01', qty: 5 }), 'INSUFFICIENT_STOCK');
    assert.equal(err.details.available, 3);
    expectError(() => run('reserveMaterial', { id: b.id, materialId: 'M01', qty: 5, force: true }), 'VALIDATION');
    run('reserveMaterial', { id: b.id, materialId: 'M01', qty: 5, force: true, reason: '입고 예정' });
    const [f] = byCode(e, 'STOCK_OVERBOOKED');
    assert.equal(f.severity, 'critical');
    assert.deepEqual(f.jobIds.sort(), [a.id, b.id].sort());
    run('stockIn', { id: 'M01', qty: 2 });
    assert.equal(byCode(e, 'STOCK_OVERBOOKED').length, 0, '입고하면 해소');
  });

  test('장비 같은 시간 이중 예약 → 거부, 시간이 안 겹치면 허용', () => {
    const e = fixture();
    const run = runner(e);
    const { job: a } = jobAt(e, 'SCHEDULED', { start: '2026-09-30T09:00', end: '2026-09-30T13:00' });
    const { job: b } = jobAt(e, 'SCHEDULED', { crewId: 'T2', start: '2026-09-30T11:00', end: '2026-09-30T15:00' });
    const { job: c } = jobAt(e, 'SCHEDULED', { crewId: 'T2', start: '2026-09-30T15:00', end: '2026-09-30T17:00' });
    run('reserveMaterial', { id: a.id, materialId: 'E01', qty: 1 });
    expectError(() => run('reserveMaterial', { id: b.id, materialId: 'E01', qty: 1 }), 'EQUIPMENT_BOOKED');
    run('reserveMaterial', { id: c.id, materialId: 'E01', qty: 1 });
    assert.equal(byCode(e, 'EQUIPMENT_DOUBLE_BOOKED').length, 0);
    run('reserveMaterial', { id: b.id, materialId: 'E01', qty: 1, force: true, reason: '돌려쓰기' });
    const found = byCode(e, 'EQUIPMENT_DOUBLE_BOOKED');
    assert.equal(found.length, 1, 'a(09~13)와 b(11~15)만 겹침 — c(15~17)는 b와 맞닿기만 함');
    assert.deepEqual(found[0].jobIds.sort(), [a.id, b.id].sort());
  });

  test('일정 변경으로 장비 예약이 겹치게 되면 경고하고 탐지한다', () => {
    const e = fixture();
    const run = runner(e);
    const { job: a } = jobAt(e, 'SCHEDULED', { start: '2026-09-30T09:00', end: '2026-09-30T11:00' });
    const { job: b } = jobAt(e, 'SCHEDULED', { crewId: 'T2', start: '2026-09-30T13:00', end: '2026-09-30T15:00' });
    run('reserveMaterial', { id: a.id, materialId: 'E01', qty: 1 });
    run('reserveMaterial', { id: b.id, materialId: 'E01', qty: 1 });
    const { warnings } = run('scheduleJob', { id: b.id, crewId: 'T2', start: '2026-09-30T10:00', end: '2026-09-30T12:00' });
    assert.match(warnings[0], /고압 세척기/);
    assert.equal(byCode(e, 'EQUIPMENT_DOUBLE_BOOKED').length, 1);
  });

  test('같은 작업에 같은 자재 중복 예약 → 거부(수량 변경 안내), 강제 시 주의', () => {
    const e = fixture();
    const run = runner(e);
    const { job } = jobAt(e, 'SCHEDULED');
    const r = run('reserveMaterial', { id: job.id, materialId: 'M01', qty: 2 });
    const err = expectError(() => run('reserveMaterial', { id: job.id, materialId: 'M01', qty: 1 }), 'DUPLICATE_RESERVATION');
    assert.equal(err.details.reservationId, r.id);
    run('adjustReservation', { id: r.id, qty: 3 });
    run('reserveMaterial', { id: job.id, materialId: 'M01', qty: 1, force: true, reason: '현장 추가분' });
    assert.equal(byCode(e, 'DUPLICATE_RESERVATION')[0].severity, 'warning');
  });

  test('끝난 작업에 남은 예약 → 주의', () => {
    const e = fixture();
    const { job } = jobAt(e, 'COMPLETED');
    e.state.reservations.push({ id: 'R-X', jobId: job.id, materialId: 'M01', qty: 2, usedQty: 0, status: 'active' });
    assert.equal(byCode(e, 'ORPHAN_RESERVATION').length, 1);
  });
});

describe('③ 작업팀 일정 충돌', () => {
  test('같은 팀 겹치는 배정 → 거부 + 빈 팀 제안, 강제 배정 시 긴급', () => {
    const e = fixture();
    const run = runner(e);
    jobAt(e, 'SCHEDULED', { crewId: 'T1', start: '2026-09-30T09:00', end: '2026-09-30T13:00' });
    const { job: b } = jobAt(e, 'APPROVED');
    const err = expectError(() => run('scheduleJob', { id: b.id, crewId: 'T1', start: '2026-09-30T11:00', end: '2026-09-30T15:00' }), 'SCHEDULE_CONFLICT');
    assert.deepEqual(err.details.freeCrews.map((c) => c.id), ['T2'], '1팀과 인원을 공유하는 3팀은 제안하지 않음');
    run('scheduleJob', { id: b.id, crewId: 'T1', start: '2026-09-30T11:00', end: '2026-09-30T15:00', force: true, reason: '긴급' });
    const [f] = byCode(e, 'CREW_DOUBLE_BOOKED');
    assert.equal(f.severity, 'critical');
    run('scheduleJob', { id: b.id, crewId: 'T2', start: '2026-09-30T11:00', end: '2026-09-30T15:00' });
    assert.equal(byCode(e, 'CREW_DOUBLE_BOOKED').length, 0, '다른 팀으로 옮기면 해소');
  });

  test('현장 확인 방문도 팀 시간을 차지한다', () => {
    const e = fixture();
    const run = runner(e);
    jobAt(e, 'SCHEDULED', { crewId: 'T2', start: '2026-09-30T09:00', end: '2026-09-30T12:00' });
    const { job } = jobAt(e, 'RECEIVED');
    expectError(() => run('scheduleSurvey', { id: job.id, crewId: 'T2', start: '2026-09-30T10:00', end: '2026-09-30T11:00' }), 'SCHEDULE_CONFLICT');
  });

  test('두 팀에 속한 인원의 동시 배정 → 긴급', () => {
    const e = fixture();
    const run = runner(e);
    jobAt(e, 'SCHEDULED', { crewId: 'T1', start: '2026-09-30T09:00', end: '2026-09-30T12:00' });
    const { job } = jobAt(e, 'APPROVED');
    const err = expectError(() => run('scheduleJob', { id: job.id, crewId: 'T3', start: '2026-09-30T10:00', end: '2026-09-30T11:00' }), 'SCHEDULE_CONFLICT');
    assert.match(err.message, /김대표/);
    run('scheduleJob', { id: job.id, crewId: 'T3', start: '2026-09-30T10:00', end: '2026-09-30T11:00', force: true, reason: '대표 합류' });
    assert.equal(byCode(e, 'MEMBER_DOUBLE_BOOKED').length, 1);
  });

  test('연속 일정 이동 시간 부족 → 주의, 같은 주소면 제외', () => {
    const e = fixture();
    const run = runner(e);
    jobAt(e, 'SCHEDULED', { crewId: 'T2', start: '2026-09-30T09:00', end: '2026-09-30T12:00' });
    const { job } = jobAt(e, 'APPROVED');
    e.state.jobs.find((j) => j.id === job.id).address = '다른 동네 5번지';
    run('scheduleJob', { id: job.id, crewId: 'T2', start: '2026-09-30T12:10', end: '2026-09-30T14:00' });
    const [f] = byCode(e, 'TRAVEL_TIME_SHORT');
    assert.match(f.title, /10분/);
    e.state.jobs.find((j) => j.id === job.id).address = '테스트시 1번지';
    assert.equal(byCode(e, 'TRAVEL_TIME_SHORT').length, 0);
  });

  test('지난 일정인데 처리 기록 없음 → 주의', () => {
    const e = fixture();
    jobAt(e, 'SCHEDULED', { start: '2026-09-28T09:00', end: '2026-09-28T12:00' });
    assert.equal(byCode(e, 'SCHEDULE_ELAPSED').length, 1);
  });
});

describe('④ 청구 누락', () => {
  test('완료 후 청구서 미발행: 1일 주의 → 3일 긴급', () => {
    const e = fixture();
    jobAt(e, 'COMPLETED'); // 9/29 09:00 완료
    assert.equal(byCode(e, 'COMPLETED_NOT_INVOICED', '2026-09-29T20:00').length, 0);
    assert.equal(byCode(e, 'COMPLETED_NOT_INVOICED', '2026-09-30T10:00')[0].severity, 'warning');
    const [f] = byCode(e, 'COMPLETED_NOT_INVOICED', '2026-10-02T10:00');
    assert.equal(f.severity, 'critical');
    assert.equal(f.amount, 253000);
  });

  test('승인 항목을 빼고 발행하려면 사유 필수, 빼면 누락으로 남는다', () => {
    const e = fixture();
    const run = runner(e);
    const { job } = jobAt(e, 'IN_PROGRESS');
    const co = run('requestChangeOrder', { id: job.id, title: '트랩 교체', items: [{ materialId: 'M02', qty: 1 }] });
    run('approveChangeOrder', { id: co.id, by: '홍길동', method: '문자 회신' });
    run('completeJob', { id: job.id });
    const err = expectError(() => run('issueInvoice', { id: job.id, excludeRefs: [`${co.id}:L1`] }), 'BILLING_OMISSION');
    assert.equal(err.details.missing.length, 1);
    run('issueInvoice', { id: job.id, excludeRefs: [`${co.id}:L1`], omissionReason: '다음 달 합산' });
    const [f] = byCode(e, 'APPROVED_CO_NOT_BILLED');
    assert.equal(f.severity, 'warning', '사유를 남긴 누락은 주의');
    assert.equal(f.amount, 9900);
  });

  test('청구서 발행 뒤 금액을 줄이면(수기 수정) 청구액 부족 → 긴급', () => {
    const e = fixture();
    const { invoice } = jobAt(e, 'INVOICED');
    e.state.invoices.find((i) => i.id === invoice.id).items[1].unitPrice = 150000;
    const [f] = byCode(e, 'UNDER_BILLED');
    assert.equal(f.severity, 'critical');
    assert.equal(f.amount, 55000);
  });

  test('결제 기한 경과 미수금 → 주의, 30일 이상 긴급', () => {
    const e = fixture();
    jobAt(e, 'INVOICED'); // 9/29 발행, 기한 10/06
    assert.equal(byCode(e, 'OVERDUE_RECEIVABLE', '2026-10-06T10:00').length, 0);
    assert.equal(byCode(e, 'OVERDUE_RECEIVABLE', '2026-10-08T10:00')[0].severity, 'warning');
    assert.equal(byCode(e, 'OVERDUE_RECEIVABLE', '2026-11-10T10:00')[0].severity, 'critical');
  });
});

describe('확인 처리', () => {
  test('주의 항목은 메모와 함께 확인 처리, 긴급 항목은 불가', () => {
    const e = fixture();
    const run = runner(e);
    jobAt(e, 'SCHEDULED', { start: '2026-09-28T09:00', end: '2026-09-28T12:00' });
    const [f] = detectFindings(e.state, NOW);
    expectError(() => run('acknowledgeFinding', { key: f.key }), 'VALIDATION');
    run('acknowledgeFinding', { key: f.key, memo: '현장 처리 확인, 기록만 누락' });
    const after = detectFindings(e.state, NOW);
    assert.equal(after[0].acked, true);
    assert.equal(summarizeFindings(after).total, 0);

    const e2 = fixture();
    const r2 = runner(e2);
    const { job } = jobAt(e2, 'IN_PROGRESS');
    const co = r2('requestChangeOrder', { id: job.id, title: 'x', items: [LABOR(1000)] });
    r2('performChangeOrder', { id: co.id });
    const crit = detectFindings(e2.state, NOW).find((x) => x.severity === 'critical');
    expectError(() => r2('acknowledgeFinding', { key: crit.key, memo: '무시' }), 'INVALID_STATE');
  });
});
