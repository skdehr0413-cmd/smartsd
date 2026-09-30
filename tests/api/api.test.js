// HTTP API 통합 테스트: 실제 서버를 임의 포트로 띄워 전체 흐름을 요청으로 검증한다.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/server/app.js';
import { SIG, NOW } from '../helpers.js';

let server;
let base;

async function call(method, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', 'x-actor': encodeURIComponent('테스트 사무실'), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 정적 파일 */ }
  return { status: res.status, json, text, headers: res.headers };
}

before(async () => {
  ({ server } = createApp({ dataFile: null, now: NOW }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

describe('기본', () => {
  test('상태 확인과 데모 데이터', async () => {
    const h = await call('GET', '/api/health');
    assert.equal(h.json.now, NOW);
    const s = await call('GET', '/api/state');
    assert.equal(s.json.data.jobs.length, 19);
    const f = await call('GET', '/api/findings');
    assert.equal(f.json.data.summary.total, 16);
  });

  test('정적 파일 제공과 보안 헤더', async () => {
    const page = await call('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.text, /<div id="app">/);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    const core = await call('GET', '/core/detectors.js');
    assert.equal(core.status, 200);
    assert.match(core.headers.get('content-type'), /javascript/);
  });

  test('경로 조작·잘못된 요청 차단', async () => {
    assert.equal((await call('GET', '/core/..%2F..%2Fpackage.json')).status, 403);
    assert.equal((await call('GET', '/..%2Fpackage.json')).status, 403);
    assert.equal((await call('GET', '/nope.js')).status, 404);
    const bad = await call('POST', '/api/jobs', '{not json');
    assert.equal(bad.status, 400);
    assert.equal((await call('GET', '/api/unknown')).status, 404);
    const big = await call('POST', '/api/jobs', JSON.stringify({ title: 'x'.repeat(1_100_000) }));
    assert.equal(big.status, 413);
  });

  test('입력 검증 오류는 400과 한국어 메시지', async () => {
    const r = await call('POST', '/api/jobs', { customer: { name: '', phone: '' }, title: '' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'VALIDATION');
    assert.match(r.json.error.message, /입력하세요/);
  });
});

describe('전체 흐름 (HTTP)', () => {
  test('문의 → 현장 확인(충돌 409) → 견적 → 고객 링크 승인 → 배정 → 예약(409) → 사용 → 추가 작업 → 완료 → 청구 → 수금', async () => {
    const created = await call('POST', '/api/jobs', { customer: { name: 'API 고객', phone: '010-9999-0000', address: '성남시 API로 1' }, title: '보일러 배관 누수', channel: '홈페이지' });
    assert.equal(created.status, 201);
    const id = created.json.data.id;
    assert.equal(created.json.data.status, 'RECEIVED');

    // 1팀은 내일 09~13시 고압 세척 작업이 있다 → 충돌 + 빈 팀 제안
    const clash = await call('POST', `/api/jobs/${id}/survey`, { crewId: 'T1', start: '2026-09-30T10:00', end: '2026-09-30T11:00' });
    assert.equal(clash.status, 409);
    assert.equal(clash.json.error.code, 'SCHEDULE_CONFLICT');
    assert.ok(clash.json.error.details.freeCrews.some((c) => c.id === 'T2'));
    assert.equal((await call('POST', `/api/jobs/${id}/survey`, { crewId: 'T2', start: '2026-09-30T10:00', end: '2026-09-30T11:00' })).status, 200);
    await call('POST', `/api/jobs/${id}/survey/complete`, { findings: '분배기 교체 필요' });

    const q = (await call('POST', `/api/jobs/${id}/quotes`, { items: [{ materialId: 'M06', qty: 1 }, { name: '기사 2인 반일', qty: 1, unitPrice: 280000, kind: 'labor' }] })).json.data;
    const sent = (await call('POST', `/api/quotes/${q.id}/send`)).json.data;

    // 고객용 공개 링크: 내부 정보(원가 등)는 노출하지 않는다
    const pub = await call('GET', `/api/public/quotes/${sent.token}`);
    assert.equal(pub.json.data.totals.total, 660000);
    assert.equal(pub.json.data.customer.name, 'API 고객');
    assert.equal(JSON.stringify(pub.json.data).includes('cost'), false);
    const approve = await call('POST', `/api/public/quotes/${sent.token}/approve`, { name: 'API 고객', signature: SIG });
    assert.equal(approve.status, 200);
    assert.equal((await call('POST', `/api/public/quotes/${sent.token}/approve`, { name: 'API 고객', signature: SIG })).status, 409, '두 번 승인 불가');

    const sched = await call('POST', `/api/jobs/${id}/schedule`, { crewId: 'T2', start: '2026-10-02T09:00', end: '2026-10-02T13:00' }, { 'x-include-state': '1' });
    assert.equal(sched.status, 200);
    assert.ok(sched.json.state, 'x-include-state 헤더면 최신 상태 동봉');

    // 분배기 재고 2세트 — 3세트 예약은 거부
    const over = await call('POST', `/api/jobs/${id}/reservations`, { materialId: 'M06', qty: 3 });
    assert.equal(over.status, 409);
    assert.equal(over.json.error.code, 'INSUFFICIENT_STOCK');
    assert.equal((await call('POST', `/api/jobs/${id}/reservations`, { materialId: 'M06', qty: 1 })).status, 201);
    assert.equal((await call('POST', `/api/jobs/${id}/reservations`, { materialId: 'M06', qty: 1 })).json.error.code, 'DUPLICATE_RESERVATION');

    await call('POST', `/api/jobs/${id}/start`);
    await call('POST', `/api/jobs/${id}/usages`, { materialId: 'M06', qty: 1 });

    const co = (await call('POST', `/api/jobs/${id}/change-orders`, { title: '난방수 교체', items: [{ name: '난방수 교체', qty: 1, unitPrice: 60000, kind: 'labor' }] })).json.data;
    await call('POST', `/api/change-orders/${co.id}/perform`);
    const blocked = await call('POST', `/api/jobs/${id}/complete`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.error.code, 'UNAPPROVED_CHANGE_ORDER');
    const pending = (await call('GET', '/api/findings')).json.data.findings.filter((f) => f.jobIds.includes(id));
    assert.deepEqual(pending.map((f) => f.code), ['CO_PERFORMED_UNAPPROVED']);

    const pubCo = await call('GET', `/api/public/change-orders/${co.token}`);
    assert.equal(pubCo.json.data.baseTotal, 660000);
    await call('POST', `/api/public/change-orders/${co.token}/approve`, { name: 'API 고객', signature: SIG });
    assert.equal((await call('POST', `/api/jobs/${id}/complete`, { note: '완료' })).status, 200);

    const inv = (await call('POST', `/api/jobs/${id}/invoices`, {})).json.data;
    assert.equal(inv.items.length, 3);
    const detail = (await call('GET', `/api/jobs/${id}`)).json.data;
    assert.equal(detail.basis.total, 726000);
    const pay = await call('POST', `/api/invoices/${inv.id}/payments`, { amount: 726000, method: '계좌이체' });
    assert.equal(pay.json.data.status, 'paid');
    const job = (await call('GET', `/api/jobs/${id}`)).json.data;
    assert.equal(job.job.status, 'PAID');
    assert.equal(job.findings.length, 0);
    assert.ok(job.events.some((e) => e.actor === '테스트 사무실'), 'x-actor 헤더가 이력에 남음');
    assert.ok(job.events.some((e) => e.actor.startsWith('고객')), '고객 승인도 이력에 남음');
  });

  test('조회 API: 대시보드·일정·자재·정산', async () => {
    const d = (await call('GET', '/api/dashboard')).json.data;
    assert.ok(d.findings.total >= 16);
    const sc = (await call('GET', '/api/schedule?from=2026-09-30&days=1')).json.data;
    assert.equal(sc.dates.length, 1);
    assert.ok(sc.bookings.length >= 3);
    const m = (await call('GET', '/api/materials')).json.data;
    assert.ok(m.find((x) => x.id === 'M03').available < 0);
    const st = (await call('GET', '/api/settlement?month=2026-09')).json.data;
    assert.equal(st.month, '2026-09');
    assert.ok(st.totals.total > 0);
  });

  test('점검 항목 확인 처리 API', async () => {
    const f = (await call('GET', '/api/findings')).json.data.findings.find((x) => x.code === 'TRAVEL_TIME_SHORT');
    const r = await call('POST', '/api/findings/ack', { key: f.key, memo: '같은 단지 내 이동' });
    assert.equal(r.status, 200);
    const again = (await call('GET', '/api/findings')).json.data.findings.find((x) => x.key === f.key);
    assert.equal(again.acked, true);
  });

  test('데모 초기화', async () => {
    const r = await call('POST', '/api/admin/reset');
    assert.equal(r.json.state.jobs.length, 19);
  });
});

test('파일 저장소: 서버를 다시 켜도 데이터가 유지된다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartsd-'));
  const file = path.join(dir, 'db.json');
  const a = createApp({ dataFile: file, now: NOW });
  const res = a.engine.handle('POST', '/api/jobs', { body: { customer: { name: '저장 확인', phone: '1', address: 'x' }, title: '영속성' } });
  assert.equal(res.status, 201);
  const b = createApp({ dataFile: file, now: NOW });
  assert.ok(b.engine.state.jobs.some((j) => j.title === '영속성'));
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')).length, 0, '임시 파일이 남지 않음');
  fs.rmSync(dir, { recursive: true });
});
