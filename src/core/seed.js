// 데모 데이터. 모든 데이터를 실제 업무 명령으로 만들어 규칙과 어긋나지 않게 한다.
// 날짜는 '오늘' 기준 상대값이라 언제 실행해도 살아 있는 화면이 나온다.
// 누락·충돌 사례는 현장에서 흔히 생기는 방식(강제 배정, 구두 지시 등)으로 재현한다.
import { Engine } from './engine.js';
import { emptyState } from './model.js';
import { addDays, dateOf } from './time.js';
import { totals } from './money.js';

export const DEMO_SIGNATURE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><path d="M10 55 C 30 10, 50 70, 70 35 S 110 20, 120 50 S 160 70, 175 30 S 215 45, 230 40" fill="none" stroke="#1d2a3a" stroke-width="3" stroke-linecap="round"/></svg>')}`;

export function buildSeed(now) {
  const today = dateOf(now);
  const at = (days, hm) => `${dateOf(addDays(`${today}T00:00`, days))}T${hm}`;
  const minus = (min) => { const t = new Date(Date.parse(`${now}:00Z`) - min * 60000); return t.toISOString().slice(0, 16); };

  const state = emptyState({
    name: '한결배관설비',
    owner: '오상철',
    phone: '031-555-0142',
    bizNo: '000-00-00000',
    address: '경기 성남시 중원구 둔촌대로 ○○ (데모)',
    account: '데모은행 000-000000-00 한결배관설비',
  });
  state.meta.laborCatalog = [
    { name: '출장비', unit: '회', unitPrice: 30000 },
    { name: '기사 1인 반일', unit: '식', unitPrice: 150000 },
    { name: '기사 2인 반일', unit: '식', unitPrice: 280000 },
    { name: '기사 2인 1일', unit: '식', unitPrice: 480000 },
    { name: '누수 탐지', unit: '식', unitPrice: 150000 },
    { name: '하수구 뚫음(기본)', unit: '식', unitPrice: 80000 },
    { name: '바닥 철거·복구', unit: '식', unitPrice: 200000 },
    { name: '폐기물 처리', unit: '식', unitPrice: 50000 },
  ];
  state.crews = [
    { id: 'T1', name: '1팀', role: '배관 교체', leader: '오상철', members: ['오상철', '이승우'], phone: '010-5501-1001', color: 0, active: true },
    { id: 'T2', name: '2팀', role: '하수·막힘', leader: '박민재', members: ['박민재', '최현준'], phone: '010-5501-1002', color: 1, active: true },
    { id: 'T3', name: '3팀', role: '누수 탐지', leader: '정우진', members: ['정우진', '오상철'], phone: '010-5501-1003', color: 2, active: true },
  ];
  const mat = (id, sku, name, category, unit, price, cost, stock, safety, kind = 'consumable') => ({ id, sku, name, category, unit, price, cost, stock, safety, kind });
  state.materials = [
    mat('M01', 'PPR-20', 'PPR 급수관 20A (4m)', '급수', '본', 15000, 8500, 24, 8),
    mat('M02', 'PPR-EL20', 'PPR 엘보 20A', '급수', '개', 2500, 900, 60, 20),
    mat('M03', 'PVC-100', 'PVC 하수관 100A (4m)', '배수', '본', 28000, 16000, 10, 3),
    mat('M04', 'TRAP-50', 'PVC 배수 트랩 50A', '배수', '개', 9000, 4200, 12, 4),
    mat('M05', 'CU-15', '동관 15A', '급수', 'm', 12000, 7000, 30, 10),
    mat('M06', 'MANI-8', '난방 분배기 8구', '난방', '세트', 320000, 210000, 2, 1),
    mat('M07', 'FAU-K1', '싱크대 원홀 수전', '수전', '개', 85000, 48000, 5, 2),
    mat('M08', 'WC-KIT', '양변기 부속 세트', '위생', '세트', 35000, 15000, 10, 3),
    mat('M09', 'INS-15', '보온재 15A (2m)', '급수', '개', 4000, 1500, 40, 10),
    mat('M10', 'MORTAR', '방수 몰탈 20kg', '마감', '포', 18000, 9000, 10, 3),
    mat('E01', 'EQ-CAM', '배관 내시경 카메라', '장비', '대', 50000, 0, 1, 0, 'equipment'),
    mat('E02', 'EQ-JET', '고압 세척기', '장비', '대', 80000, 0, 1, 0, 'equipment'),
    mat('E03', 'EQ-LEAK', '누수 탐지기(청음식)', '장비', '대', 100000, 0, 1, 0, 'equipment'),
    mat('E04', 'EQ-SNAKE', '전동 스네이크', '장비', '대', 30000, 0, 2, 0, 'equipment'),
  ];

  let tokenSeq = 0;
  const engine = new Engine(state, { clock: () => now, token: () => `demo${String(++tokenSeq).padStart(3, '0')}` });
  const run = (name, payload, when, actor = '사무실(김혜진)') => engine.execute(name, payload, { actor, now: when });
  const L = (name, qty, unitPrice, unit = '식', kind = 'labor') => ({ name, qty, unitPrice, unit, kind });
  const M = (materialId, qty) => ({ materialId, qty });
  const sign = (by, method = '현장 서명') => ({ by, method, signature: method.includes('서명') ? DEMO_SIGNATURE : undefined });
  const field = (crew) => `현장 ${crew}`;

  const customer = (name, phone, address, type = '개인') => run('createCustomer', { name, phone, address, type }, at(-60, '09:00'));
  const C = [
    customer('김서연', '010-2811-4402', '성남시 분당구 샘물로 21, 102동 1203호'),
    customer('카페 온유', '010-9123-7780', '성남시 분당구 느티로 22, 1층', '상가'),
    customer('이정민', '010-4410-2291', '성남시 수정구 산마루길 31 (단독주택)'),
    customer('윤보람', '010-7755-1820', '성남시 중원구 은행골로 18, 302호'),
    customer('드림타워 관리사무소', '031-555-7710', '성남시 분당구 별빛로 331 (오피스텔)', '관리사무소'),
    customer('한빛아파트 관리사무소', '031-555-2204', '성남시 분당구 내정로 55', '관리사무소'),
    customer('명동칼국수', '010-3320-9981', '성남시 수정구 장터로 190, 1층', '상가'),
    customer('새솔빌 관리인', '010-6612-0045', '성남시 중원구 둔촌길 101 (다세대)', '관리사무소'),
    customer('정다은', '010-8812-3304', '성남시 분당구 판교숲로 10, 804호'),
    customer('최동훈', '010-2290-4417', '성남시 수정구 태평길 45 (단독주택)'),
    customer('해오름약국', '010-5530-7712', '성남시 중원구 성남로 1120, 1층', '상가'),
    customer('박선영', '010-4471-9902', '성남시 중원구 여수길 7, 201호'),
    customer('장수빈', '010-9981-2270', '성남시 분당구 정든마을로 12, 1503호'),
    customer('대원상가 관리단', '031-555-9120', '성남시 수정구 대원로 88', '관리사무소'),
    customer('이지훈', '010-3381-6620', '성남시 분당구 금곡로 40, 707호'),
    customer('서하준', '010-2724-1180', '성남시 중원구 금빛로 16, 101호'),
    customer('문가은', '010-6620-4471', '성남시 분당구 수내로 77, 1102호'),
    customer('그린빌 관리사무소', '031-555-6630', '성남시 수정구 산성로 301', '관리사무소'),
    customer('한가람', '010-5520-8813', '성남시 분당구 서현로 180, 504호'),
  ];
  const inquiry = (ci, title, symptom, when, extra = {}) => run('createInquiry', { customerId: C[ci].id, title, symptom, ...extra }, when);
  const quote = (jobId, items, when, note = '') => run('createQuote', { id: jobId, items, note }, when);

  // J-0001 방금 들어온 긴급 문의
  inquiry(0, '욕실 누수 — 아랫집 천장 얼룩', '아랫집 욕실 천장에 물 얼룩이 2주 전부터 번짐. 윗집 욕실 바닥 배관 의심. 오늘 중 방문 희망.', minus(40), { channel: '전화', urgency: 'urgent' });

  // J-0002 현장 확인 예약 (2팀, 오늘 점심) — 오전 작업과 이동 시간 15분
  const j2 = inquiry(1, '화장실 변기 막힘 반복', '손님용 화장실 변기가 일주일에 두세 번 막힘. 뚫어도 재발.', at(-1, '15:10'), { channel: '카카오톡' });
  run('scheduleSurvey', { id: j2.id, crewId: 'T2', start: at(0, '12:15'), end: at(0, '13:00') }, at(-1, '15:20'));

  // J-0003 현장 확인 완료, 견적 작성 중
  const j3 = inquiry(2, '보일러 난방 분배기 교체', '작은방 난방이 안 됨. 분배기 밸브에서 물이 샘.', at(-3, '10:05'), { channel: '전화' });
  run('scheduleSurvey', { id: j3.id, crewId: 'T1', start: at(-2, '14:00'), end: at(-2, '15:00') }, at(-3, '10:10'));
  run('completeSurvey', { id: j3.id, findings: '분배기 8구 부식, 밸브 3개 고착. 교체 권장. 교체 후 난방수 보충·공기 빼기 필요.' }, at(-2, '15:05'), field('1팀'));
  quote(j3.id, [M('M06', 1), M('M02', 6), L('기사 2인 반일', 1, 280000), L('출장비', 1, 30000, '회')], at(-1, '09:30'));

  // J-0004 견적 발송, 고객 승인 대기
  const j4 = inquiry(3, '싱크대 배수관 교체', '싱크대 아래 배수관에서 냄새와 누수.', at(-4, '11:00'), { channel: '문자' });
  run('scheduleSurvey', { id: j4.id, crewId: 'T2', start: at(-3, '16:00'), end: at(-3, '16:40') }, at(-4, '11:10'));
  run('completeSurvey', { id: j4.id, findings: '배수 트랩 균열, 벽체 배관 연결부 노후. 트랩·연결관 교체.' }, at(-3, '16:45'), field('2팀'));
  const q4 = quote(j4.id, [M('M04', 1), L('하수구 뚫음(기본)', 1, 80000), L('기사 1인 반일', 1, 150000)], at(-2, '09:40'));
  run('sendQuote', { id: q4.id }, at(-2, '10:00'));

  // J-0005 고객 승인 완료, 작업 배정 대기
  const j5 = inquiry(4, '12층 세대 급수관 PPR 교체', '1203호 급수관 노후로 녹물. 관리사무소 요청.', at(-5, '09:20'), { channel: '관리사무소' });
  run('scheduleSurvey', { id: j5.id, crewId: 'T1', start: at(-4, '10:00'), end: at(-4, '11:00') }, at(-5, '09:30'));
  run('completeSurvey', { id: j5.id, findings: '세대 내 급수관 12m 교체 필요. 엘보 10개 예상.' }, at(-4, '11:10'), field('1팀'));
  let q5 = quote(j5.id, [M('M01', 3), M('M02', 10), L('기사 2인 1일', 1, 480000), L('폐기물 처리', 1, 50000)], at(-3, '09:00'));
  q5 = run('sendQuote', { id: q5.id }, at(-3, '09:05'));
  run('approveQuoteByToken', { token: q5.token, name: '드림타워 관리소장 한도윤', signature: DEMO_SIGNATURE }, at(-1, '17:40'), '고객');

  // J-0006 고압 세척 — 1팀 내일 09~13시, 고압 세척기·내시경 예약
  const j6 = inquiry(5, '지하주차장 배수관 고압 세척', 'B2 주차장 집수정 역류. 배수관 고압 세척 및 내시경 점검.', at(-6, '14:00'), { channel: '관리사무소' });
  run('scheduleSurvey', { id: j6.id, crewId: 'T2', start: at(-5, '10:00'), end: at(-5, '11:00') }, at(-6, '14:10'));
  run('completeSurvey', { id: j6.id, findings: '배수관 30m 구간 슬러지 퇴적. 고압 세척 후 내시경 확인.' }, at(-5, '11:05'), field('2팀'));
  const q6 = quote(j6.id, [M('E02', 1), M('E01', 1), L('기사 2인 반일', 1, 280000)], at(-4, '09:00'));
  run('sendQuote', { id: q6.id }, at(-4, '09:10'));
  run('approveQuote', { id: q6.id, ...sign('한빛아파트 관리과장 서지호') }, at(-3, '15:00'));
  run('scheduleJob', { id: j6.id, crewId: 'T1', start: at(1, '09:00'), end: at(1, '13:00') }, at(-3, '15:10'));
  run('reserveMaterial', { id: j6.id, materialId: 'E02', qty: 1 }, at(-3, '15:12'));
  run('reserveMaterial', { id: j6.id, materialId: 'E01', qty: 1 }, at(-3, '15:13'));

  // J-0007 식당 하수구 역류 — 사장님 지시로 1팀에 겹치게 배정, 세척기도 겹쳐 예약
  const j7 = inquiry(6, '주방 하수구 역류 — 배관 일부 교체', '주방 바닥 배수구 역류. 영업 전 처리 요청.', at(-1, '16:30'), { channel: '전화', urgency: 'urgent' });
  const q7 = quote(j7.id, [M('M03', 4), M('E02', 1), L('기사 2인 반일', 1, 280000), L('바닥 철거·복구', 1, 200000)], at(-1, '17:00'), '전화 상담 후 긴급 견적');
  run('sendQuote', { id: q7.id }, at(-1, '17:05'));
  run('approveQuote', { id: q7.id, by: '명동칼국수 사장 윤재석', method: '전화(구두)' }, at(-1, '18:00'));
  run('scheduleJob', { id: j7.id, crewId: 'T1', start: at(1, '11:00'), end: at(1, '15:00'), force: true, reason: '식당 영업 전 긴급 처리 — 대표 지시' }, at(-1, '18:10'), '대표(오상철)');
  run('reserveMaterial', { id: j7.id, materialId: 'M03', qty: 4 }, at(-1, '18:12'));
  run('reserveMaterial', { id: j7.id, materialId: 'E02', qty: 1, force: true, reason: '세척기 먼저 쓰고 넘겨받기로 함' }, at(-1, '18:13'), '대표(오상철)');

  // J-0008 옥상 물탱크 배관 — 하수관 재고 초과 예약, 엘보 중복 예약, 추가 작업 승인 지연
  const j8 = inquiry(7, '옥상 물탱크 배관 교체', '물탱크 출수관 부식, 누수. 세대 수압 저하.', at(-7, '10:00'), { channel: '홈페이지' });
  run('scheduleSurvey', { id: j8.id, crewId: 'T2', start: at(-6, '09:00'), end: at(-6, '10:00') }, at(-7, '10:10'));
  run('completeSurvey', { id: j8.id, findings: '출수관 100A 6본 교체, 급수 분기 엘보 교체.' }, at(-6, '10:10'), field('2팀'));
  const q8 = quote(j8.id, [M('M03', 6), M('M02', 16), L('기사 2인 1일', 1, 480000), L('폐기물 처리', 1, 50000)], at(-5, '09:00'));
  run('sendQuote', { id: q8.id }, at(-5, '09:05'));
  run('approveQuote', { id: q8.id, by: '새솔빌 관리인 강민호', method: '문자 회신', memo: '"네 진행해 주세요" 문자 회신' }, at(-4, '13:20'));
  run('scheduleJob', { id: j8.id, crewId: 'T2', start: at(2, '09:00'), end: at(2, '17:00') }, at(-3, '16:00'));
  run('reserveMaterial', { id: j8.id, materialId: 'M03', qty: 6, force: true, reason: '추가 입고 예정(발주 완료)' }, at(-3, '16:05'));
  run('reserveMaterial', { id: j8.id, materialId: 'M02', qty: 10 }, at(-3, '16:06'));
  run('reserveMaterial', { id: j8.id, materialId: 'M02', qty: 6, force: true, reason: '현장 추가분' }, at(-2, '08:50'), field('2팀'));
  run('requestChangeOrder', { id: j8.id, title: '옥상 배관 관통부 방수 보강', reason: '관통부 방수층 들뜸 — 교체 후 누수 재발 우려', items: [M('M10', 2), L('기사 2인 반일', 1, 280000)] }, at(-2, '10:00'), field('2팀'));

  // J-0009 오늘 작업 중 — 승인 없이 추가 작업 수행 (위험 ①)
  const j9 = inquiry(8, '주방 수전 교체', '싱크대 수전 손잡이 헐거움, 물이 샘.', at(-3, '13:00'), { channel: '전화' });
  const q9 = quote(j9.id, [M('M07', 1), L('기사 1인 반일', 1, 150000), L('출장비', 1, 30000, '회')], at(-3, '13:30'));
  run('sendQuote', { id: q9.id }, at(-3, '13:35'));
  run('approveQuote', { id: q9.id, by: '정다은', method: '문자 회신' }, at(-2, '09:10'));
  run('scheduleJob', { id: j9.id, crewId: 'T2', start: at(0, '09:00'), end: at(0, '12:00') }, at(-2, '09:20'));
  run('reserveMaterial', { id: j9.id, materialId: 'M07', qty: 1 }, at(-2, '09:21'));
  run('startJob', { id: j9.id }, at(0, '09:05'), field('2팀'));
  run('recordUsage', { id: j9.id, materialId: 'M07', qty: 1 }, at(0, '09:50'), field('2팀'));
  const co9 = run('requestChangeOrder', { id: j9.id, title: '싱크대 배수 트랩 교체', reason: '트랩 부식으로 누수 — 수전 교체 중 발견', items: [M('M04', 1), L('추가 인건비', 1, 40000)] }, at(0, '10:20'), field('2팀'));
  run('recordUsage', { id: j9.id, materialId: 'M04', qty: 1, changeOrderId: co9.id, note: '고객 부재로 승인 전 교체' }, at(0, '10:40'), field('2팀'));

  // J-0010 오늘 작업 중 — 견적보다 동관을 더 씀 (위험 ①-초과 사용)
  const j10 = inquiry(9, '외부 급수관 동파 복구', '마당 수도 배관 동파로 누수.', at(-2, '08:10'), { channel: '전화', urgency: 'urgent' });
  const q10 = quote(j10.id, [M('M05', 8), M('M09', 4), L('기사 2인 1일', 1, 480000)], at(-2, '11:00'));
  run('approveQuote', { id: q10.id, ...sign('최동훈') }, at(-2, '11:30'));
  run('scheduleJob', { id: j10.id, crewId: 'T3', start: at(0, '08:30'), end: at(0, '17:00') }, at(-1, '09:00'));
  run('reserveMaterial', { id: j10.id, materialId: 'M05', qty: 8 }, at(-1, '09:05'));
  run('reserveMaterial', { id: j10.id, materialId: 'M09', qty: 4 }, at(-1, '09:06'));
  run('startJob', { id: j10.id }, at(0, '08:40'), field('3팀'));
  run('recordUsage', { id: j10.id, materialId: 'M05', qty: 12, note: '동파 구간이 예상보다 김' }, at(0, '10:10'), field('3팀'));
  run('recordUsage', { id: j10.id, materialId: 'M09', qty: 4 }, at(0, '10:15'), field('3팀'));

  // J-0011 완료 후 4일째 청구서 없음 (위험 ④)
  const j11 = inquiry(10, '약국 화장실 급수관 교체', '화장실 세면대 급수관 누수.', at(-9, '10:00'), { channel: '전화' });
  run('scheduleSurvey', { id: j11.id, crewId: 'T2', start: at(-8, '14:00'), end: at(-8, '15:00') }, at(-9, '10:10'));
  run('completeSurvey', { id: j11.id, findings: '세면대 급수관 PPR 교체 4본, 엘보 8개.' }, at(-8, '15:05'), field('2팀'));
  let q11 = quote(j11.id, [M('M01', 4), M('M02', 8), L('기사 2인 반일', 1, 280000)], at(-8, '16:00'));
  q11 = run('sendQuote', { id: q11.id }, at(-8, '16:05'));
  run('approveQuoteByToken', { token: q11.token, name: '해오름약국 약사 김나래', signature: DEMO_SIGNATURE }, at(-7, '09:30'), '고객');
  run('scheduleJob', { id: j11.id, crewId: 'T1', start: at(-5, '09:00'), end: at(-5, '18:00') }, at(-7, '10:00'));
  run('reserveMaterial', { id: j11.id, materialId: 'M01', qty: 4 }, at(-7, '10:01'));
  run('reserveMaterial', { id: j11.id, materialId: 'M02', qty: 8 }, at(-7, '10:02'));
  run('startJob', { id: j11.id }, at(-5, '09:10'), field('1팀'));
  run('recordUsage', { id: j11.id, materialId: 'M01', qty: 4 }, at(-5, '11:00'), field('1팀'));
  run('recordUsage', { id: j11.id, materialId: 'M02', qty: 8 }, at(-5, '11:05'), field('1팀'));
  run('completeJob', { id: j11.id, note: '누수 없음 확인' }, at(-5, '17:40'), field('1팀'));

  // J-0012 3팀 누수 탐지 현장 확인 — 1팀과 대표님 중복 배정 (위험 ③)
  const j12 = inquiry(11, '보일러실 배관 누수 탐지', '보일러실 바닥에 물이 고임. 위치 불명.', at(-1, '11:00'), { channel: '전화' });
  run('scheduleSurvey', { id: j12.id, crewId: 'T3', start: at(1, '10:00'), end: at(1, '11:30'), force: true, reason: '대표님 오전 합류 가능하다고 함' }, at(-1, '11:10'), '대표(오상철)');

  // J-0013 청구서에서 승인된 추가 작업이 빠짐 (위험 ④)
  const j13 = inquiry(12, '아파트 욕실 배관 전체 교체', '욕실 리모델링 전 배관 전체 교체.', at(-15, '10:00'), { channel: '재방문' });
  run('scheduleSurvey', { id: j13.id, crewId: 'T1', start: at(-14, '10:00'), end: at(-14, '11:00') }, at(-15, '10:10'));
  run('completeSurvey', { id: j13.id, findings: '급수 PPR 6본, 배수 100A 2본 교체.' }, at(-14, '11:10'), field('1팀'));
  const q13 = quote(j13.id, [M('M01', 6), M('M02', 12), M('M03', 2), L('기사 2인 1일', 2, 480000), L('바닥 철거·복구', 1, 200000)], at(-13, '09:00'));
  run('sendQuote', { id: q13.id }, at(-13, '09:05'));
  run('approveQuote', { id: q13.id, ...sign('장수빈') }, at(-12, '18:00'));
  run('scheduleJob', { id: j13.id, crewId: 'T1', start: at(-8, '09:00'), end: at(-7, '18:00') }, at(-12, '18:10'));
  run('startJob', { id: j13.id }, at(-8, '09:05'), field('1팀'));
  const co13 = run('requestChangeOrder', { id: j13.id, title: '욕조 배수구 교체', reason: '철거 후 욕조 배수구 파손 발견', items: [M('M04', 2), L('추가 인건비', 1, 150000)] }, at(-8, '11:00'), field('1팀'));
  run('approveChangeOrder', { id: co13.id, ...sign('장수빈') }, at(-8, '11:30'), field('1팀'));
  run('recordUsage', { id: j13.id, materialId: 'M01', qty: 6 }, at(-8, '15:00'), field('1팀'));
  run('recordUsage', { id: j13.id, materialId: 'M02', qty: 12 }, at(-8, '15:01'), field('1팀'));
  run('recordUsage', { id: j13.id, materialId: 'M03', qty: 2 }, at(-7, '10:00'), field('1팀'));
  run('recordUsage', { id: j13.id, materialId: 'M04', qty: 2, changeOrderId: co13.id }, at(-7, '11:00'), field('1팀'));
  run('completeJob', { id: j13.id }, at(-7, '17:30'), field('1팀'));
  run('issueInvoice', { id: j13.id, excludeRefs: [`${co13.id}:L1`, `${co13.id}:L2`], omissionReason: '욕조 배수구 비용은 따로 받기로 했다는 기사 구두 보고(증빙 없음)' }, at(-5, '10:00'));

  // J-0014 40일 전 청구, 미수 (위험 ④-미수금)
  const j14 = inquiry(13, '상가 급수 펌프 배관 교체', '지하 급수 펌프 토출 배관 누수.', at(-48, '10:00'), { channel: '관리사무소' });
  const q14 = quote(j14.id, [M('M01', 5), M('M02', 10), L('기사 2인 1일', 1, 480000)], at(-47, '10:00'));
  run('sendQuote', { id: q14.id }, at(-47, '10:05'));
  run('approveQuote', { id: q14.id, by: '대원상가 관리단 총무 이수진', method: '문자 회신' }, at(-46, '15:00'));
  run('scheduleJob', { id: j14.id, crewId: 'T1', start: at(-43, '09:00'), end: at(-43, '17:00') }, at(-46, '15:10'));
  run('startJob', { id: j14.id }, at(-43, '09:05'), field('1팀'));
  run('recordUsage', { id: j14.id, materialId: 'M01', qty: 5 }, at(-43, '13:00'), field('1팀'));
  run('recordUsage', { id: j14.id, materialId: 'M02', qty: 10 }, at(-43, '13:01'), field('1팀'));
  run('completeJob', { id: j14.id }, at(-43, '16:50'), field('1팀'));
  run('issueInvoice', { id: j14.id, dueDays: 7 }, at(-40, '10:00'));

  // J-0015 수금 완료 — 고액 추가 작업을 전화로만 승인 (참고)
  const j15 = inquiry(14, '세탁실 배수 역류', '세탁기 배수 시 역류.', at(-14, '09:00'), { channel: '카카오톡' });
  const q15 = quote(j15.id, [L('하수구 뚫음(기본)', 1, 80000), M('E04', 1), L('기사 1인 반일', 1, 150000)], at(-14, '10:00'));
  run('sendQuote', { id: q15.id }, at(-14, '10:05'));
  run('approveQuote', { id: q15.id, by: '이지훈', method: '문자 회신' }, at(-14, '12:00'));
  run('scheduleJob', { id: j15.id, crewId: 'T2', start: at(-12, '13:00'), end: at(-12, '18:00') }, at(-14, '12:10'));
  run('startJob', { id: j15.id }, at(-12, '13:05'), field('2팀'));
  const co15 = run('requestChangeOrder', { id: j15.id, title: '세탁실 배수관 부분 교체', reason: '뚫음 후에도 배관 꺾임부 막힘 — 교체 필요', items: [M('M03', 1), L('기사 2인 반일', 1, 280000)] }, at(-12, '14:30'), field('2팀'));
  run('approveChangeOrder', { id: co15.id, by: '이지훈', method: '전화(구두)' }, at(-12, '14:40'), field('2팀'));
  run('recordUsage', { id: j15.id, materialId: 'M03', qty: 1, changeOrderId: co15.id }, at(-12, '16:00'), field('2팀'));
  run('completeJob', { id: j15.id }, at(-12, '17:50'), field('2팀'));
  const inv15 = run('issueInvoice', { id: j15.id }, at(-11, '10:00'));
  run('recordPayment', { id: inv15.id, amount: totals(inv15.items).total, method: '계좌이체' }, at(-9, '11:00'));

  // J-0016 지난달 수금 완료
  const j16 = inquiry(15, '빌라 공용 하수구 막힘', '1층 공용 하수구 막힘, 악취.', at(-36, '09:00'), { channel: '전화' });
  const q16 = quote(j16.id, [L('하수구 뚫음(기본)', 1, 80000), M('E01', 1), M('E04', 1)], at(-36, '09:30'));
  run('approveQuote', { id: q16.id, ...sign('서하준') }, at(-36, '10:00'));
  run('scheduleJob', { id: j16.id, crewId: 'T2', start: at(-35, '09:00'), end: at(-35, '12:00') }, at(-36, '10:05'));
  run('startJob', { id: j16.id }, at(-35, '09:00'), field('2팀'));
  run('completeJob', { id: j16.id }, at(-35, '11:40'), field('2팀'));
  const inv16 = run('issueInvoice', { id: j16.id }, at(-35, '13:00'));
  run('recordPayment', { id: inv16.id, amount: 176000, method: '카드' }, at(-35, '13:10'));

  // J-0017 견적 거절
  const j17 = inquiry(16, '욕실 수전 교체', '욕실 세면대 수전 교체 문의.', at(-7, '15:00'), { channel: '홈페이지' });
  let q17 = quote(j17.id, [M('M07', 1), L('기사 1인 반일', 1, 150000)], at(-6, '10:00'));
  q17 = run('sendQuote', { id: q17.id }, at(-6, '10:05'));
  run('rejectQuoteByToken', { token: q17.token, reason: '직접 교체하기로 함' }, at(-5, '20:10'), '고객');

  // J-0018 그저께 완료, 청구 대기 (주의)
  const j18 = inquiry(17, '관리동 화장실 양변기 부속 교체', '관리동 남자 화장실 변기 물이 계속 흐름.', at(-4, '09:00'), { channel: '관리사무소' });
  const q18 = quote(j18.id, [M('M08', 2), L('기사 1인 반일', 1, 150000)], at(-4, '09:30'));
  run('sendQuote', { id: q18.id }, at(-4, '09:35'));
  run('approveQuote', { id: q18.id, by: '그린빌 관리과장 오세영', method: '문자 회신' }, at(-4, '11:00'));
  run('scheduleJob', { id: j18.id, crewId: 'T2', start: at(-2, '09:00'), end: at(-2, '12:00') }, at(-4, '11:10'));
  run('startJob', { id: j18.id }, at(-2, '09:10'), field('2팀'));
  run('recordUsage', { id: j18.id, materialId: 'M08', qty: 2 }, at(-2, '10:00'), field('2팀'));
  run('completeJob', { id: j18.id }, at(-2, '11:30'), field('2팀'));

  // J-0019 이번 달 수금 완료 (정상 흐름 예시)
  const j19 = inquiry(18, '주방 배수관 막힘', '싱크대 물이 안 내려감.', at(-4, '08:30'), { channel: '전화' });
  let q19 = quote(j19.id, [L('하수구 뚫음(기본)', 1, 80000), M('E04', 1), L('출장비', 1, 30000, '회')], at(-4, '09:00'));
  q19 = run('sendQuote', { id: q19.id }, at(-4, '09:05'));
  run('approveQuoteByToken', { token: q19.token, name: '한가람', signature: DEMO_SIGNATURE }, at(-4, '09:30'), '고객');
  run('scheduleJob', { id: j19.id, crewId: 'T3', start: at(-4, '13:00'), end: at(-4, '15:00') }, at(-4, '09:40'));
  run('startJob', { id: j19.id }, at(-4, '13:00'), field('3팀'));
  run('completeJob', { id: j19.id }, at(-4, '14:20'), field('3팀'));
  const inv19 = run('issueInvoice', { id: j19.id, dueDays: 3 }, at(-4, '15:00'));
  run('recordPayment', { id: inv19.id, amount: 100000, method: '계좌이체' }, at(-3, '10:00'));
  run('recordPayment', { id: inv19.id, amount: 54000, method: '계좌이체' }, at(-2, '10:00'));

  return engine.state;
}
