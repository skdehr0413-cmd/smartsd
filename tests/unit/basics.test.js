import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWall, formatWall, overlaps, addMinutes, nowWall, workingHours, fmtDateTime, isValidRange } from '../../src/core/time.js';
import { totals, won, wonShort, lineAmount } from '../../src/core/money.js';
import { matchRoute, ROUTES } from '../../src/core/routes.js';
import { COMMAND_NAMES } from '../../src/core/commands.js';
import { queries } from '../../src/core/engine.js';

test('시각 문자열은 시간대와 상관없이 같은 값으로 계산된다', () => {
  assert.equal(formatWall(parseWall('2026-09-29T23:30')), '2026-09-29T23:30');
  assert.equal(addMinutes('2026-09-29T23:30', 45), '2026-09-30T00:15');
  assert.ok(Number.isNaN(parseWall('2026/09/29')));
  assert.equal(nowWall('Asia/Seoul', new Date('2026-09-29T01:30:00Z')), '2026-09-29T10:30');
  assert.equal(fmtDateTime('2026-09-29T09:05'), '9/29(화) 09:05');
});

test('일정 겹침: 끝과 시작이 맞닿으면 충돌이 아니다', () => {
  const a = { start: '2026-09-30T09:00', end: '2026-09-30T12:00' };
  assert.equal(overlaps(a, { start: '2026-09-30T12:00', end: '2026-09-30T13:00' }), false);
  assert.equal(overlaps(a, { start: '2026-09-30T11:59', end: '2026-09-30T13:00' }), true);
  assert.equal(overlaps(a, { start: '2026-09-30T08:00', end: '2026-09-30T18:00' }), true);
  assert.equal(isValidRange('2026-09-30T10:00', '2026-09-30T09:00'), false);
});

test('근무 시간 계산은 여러 날 작업의 야간을 제외한다', () => {
  assert.equal(workingHours('2026-09-30T09:00', '2026-09-30T13:00'), 4);
  assert.equal(workingHours('2026-09-30T09:00', '2026-10-01T18:00'), 19);
  assert.equal(workingHours('2026-09-30T19:00', '2026-09-30T21:00'), 0);
});

test('금액: 부가세 10% 원 단위 절사, 소수 수량 반올림', () => {
  assert.deepEqual(totals([{ qty: 3, unitPrice: 15000 }, { qty: 1, unitPrice: 33333 }]), { supply: 78333, vat: 7833, total: 86166 });
  assert.equal(lineAmount({ qty: 1.5, unitPrice: 12001 }), 18002);
  assert.equal(won(1234567), '1,234,567원');
  assert.equal(won(-5000), '-5,000원');
  assert.equal(wonShort(1460800), '146만원');
});

test('모든 REST 경로는 실제 명령·조회에 연결되어 있다', () => {
  for (const r of ROUTES) {
    if (r.command) assert.ok(COMMAND_NAMES.includes(r.command), `${r.path} → ${r.command}`);
    if (r.query) assert.ok(queries[r.query], `${r.path} → ${r.query}`);
  }
  const m = matchRoute('POST', '/api/jobs/J-0001/change-orders/from-excess');
  assert.equal(m.route.command, 'changeOrderFromExcess');
  assert.equal(m.params.id, 'J-0001');
  assert.equal(matchRoute('DELETE', '/api/jobs'), null);
});
