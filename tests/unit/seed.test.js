// 데모 데이터: 실제 업무 명령만으로 만들어지고, 4대 위험 사례를 모두 담고 있다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeed } from '../../src/core/seed.js';
import { detectFindings, summarizeFindings } from '../../src/core/detectors.js';
import { dashboard, settlement, schedule, materialsOverview, board, jobDetail } from '../../src/core/views.js';
import { NOW } from '../helpers.js';

const seed = buildSeed(NOW);

test('데모 데이터는 모든 단계의 작업건을 포함한다', () => {
  const statuses = new Set(seed.jobs.map((j) => j.status));
  for (const s of ['RECEIVED', 'SURVEY_SCHEDULED', 'SURVEYED', 'QUOTED', 'APPROVED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'INVOICED', 'PAID', 'REJECTED']) {
    assert.ok(statuses.has(s), `${s} 상태 작업건 존재`);
  }
});

test('데모 데이터에서 4대 위험을 모두 찾아낸다', () => {
  const f = detectFindings(seed, NOW);
  const sum = summarizeFindings(f);
  assert.equal(sum.total, 16);
  for (const k of ['APPROVAL', 'MATERIAL', 'SCHEDULE', 'BILLING']) {
    assert.ok(sum.byCategory[k].count >= 3, `${k} ${sum.byCategory[k].count}건`);
    assert.ok(sum.byCategory[k].critical >= 1 || k === 'APPROVAL', `${k} 긴급 존재`);
  }
  const codes = new Set(f.map((x) => x.code));
  for (const c of ['CO_PERFORMED_UNAPPROVED', 'EXCESS_USAGE_UNAPPROVED', 'CO_APPROVAL_DELAYED', 'STOCK_OVERBOOKED', 'EQUIPMENT_DOUBLE_BOOKED',
    'DUPLICATE_RESERVATION', 'CREW_DOUBLE_BOOKED', 'MEMBER_DOUBLE_BOOKED', 'TRAVEL_TIME_SHORT', 'COMPLETED_NOT_INVOICED', 'APPROVED_CO_NOT_BILLED', 'OVERDUE_RECEIVABLE']) {
    assert.ok(codes.has(c), `${c} 탐지`);
  }
  assert.equal(sum.amount, 1567500);
});

test('화면용 계산이 데모 데이터에서 오류 없이 동작한다', () => {
  const d = dashboard(seed, NOW);
  assert.equal(d.todays.length, 3);
  assert.ok(d.todays.every((b) => b.job && b.crew));
  assert.ok(settlement(seed, NOW).rows.length >= 3);
  assert.ok(schedule(seed, NOW, { from: '2026-09-30', days: 1 }).bookings.some((b) => b.issues.some((i) => i.severity === 'critical')));
  assert.equal(materialsOverview(seed, NOW).length, 14);
  assert.equal(board(seed).reduce((n, c) => n + c.jobs.length, 0), seed.jobs.length);
  for (const j of seed.jobs) jobDetail(seed, j.id, NOW);
});

test('시드는 어느 날짜에 만들어도 같은 구조를 만든다', () => {
  const other = buildSeed('2027-01-01T08:00');
  assert.equal(other.jobs.length, seed.jobs.length);
  assert.equal(summarizeFindings(detectFindings(other, '2027-01-01T08:00')).total, 16);
});
