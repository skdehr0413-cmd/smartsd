// 업무 상태·라벨·코드 정의 (서버와 브라우저가 함께 사용)

export const S = Object.freeze({
  RECEIVED: 'RECEIVED',
  SURVEY_SCHEDULED: 'SURVEY_SCHEDULED',
  SURVEYED: 'SURVEYED',
  QUOTED: 'QUOTED',
  APPROVED: 'APPROVED',
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  INVOICED: 'INVOICED',
  PAID: 'PAID',
  REJECTED: 'REJECTED',
  CANCELED: 'CANCELED',
});

export const STATUS_LABEL = {
  RECEIVED: '문의 접수',
  SURVEY_SCHEDULED: '현장 확인 예정',
  SURVEYED: '현장 확인 완료',
  QUOTED: '승인 대기',
  APPROVED: '배정 대기',
  SCHEDULED: '작업 예정',
  IN_PROGRESS: '작업 중',
  COMPLETED: '정산 대기',
  INVOICED: '청구 완료',
  PAID: '수금 완료',
  REJECTED: '견적 거절',
  CANCELED: '취소',
};

/** 업무 흐름 7단계 (요구사항의 순서 그대로) */
export const STEPS = [
  { key: 'intake', label: '문의 접수' },
  { key: 'survey', label: '현장 확인' },
  { key: 'quote', label: '견적' },
  { key: 'approval', label: '고객 승인' },
  { key: 'assign', label: '작업 배정' },
  { key: 'work', label: '자재 사용' },
  { key: 'settle', label: '완료 정산' },
];

/** 상태 → 현재 진행 중인 단계 인덱스 (STEPS.length 이면 모두 완료) */
export const STATUS_STEP = {
  RECEIVED: 1,
  SURVEY_SCHEDULED: 1,
  SURVEYED: 2,
  QUOTED: 3,
  APPROVED: 4,
  SCHEDULED: 5,
  IN_PROGRESS: 5,
  COMPLETED: 6,
  INVOICED: 6,
  PAID: 7,
  REJECTED: 2,
  CANCELED: 0,
};

/** 파이프라인 보드 컬럼 */
export const BOARD = [
  { key: 'intake', label: '접수·현장확인', statuses: [S.RECEIVED, S.SURVEY_SCHEDULED, S.SURVEYED] },
  { key: 'quote', label: '견적·승인', statuses: [S.QUOTED, S.REJECTED] },
  { key: 'assign', label: '배정', statuses: [S.APPROVED, S.SCHEDULED] },
  { key: 'work', label: '작업 중', statuses: [S.IN_PROGRESS] },
  { key: 'settle', label: '정산', statuses: [S.COMPLETED, S.INVOICED] },
  { key: 'done', label: '종결', statuses: [S.PAID, S.CANCELED] },
];

export const ACTIVE_WORK = [S.SCHEDULED, S.IN_PROGRESS];
export const CLOSED = [S.COMPLETED, S.INVOICED, S.PAID, S.CANCELED];
export const PRE_APPROVAL = [S.RECEIVED, S.SURVEY_SCHEDULED, S.SURVEYED, S.QUOTED, S.REJECTED];

export const CHANNELS = ['전화', '카카오톡', '문자', '홈페이지', '관리사무소', '재방문'];

export const APPROVAL_METHODS = ['현장 서명', '고객 링크 서명', '문자 회신', '전화(구두)'];
export const STRONG_APPROVAL = ['현장 서명', '고객 링크 서명', '문자 회신'];

export const ITEM_KINDS = { labor: '인건비', material: '자재', equipment: '장비', etc: '기타' };

export const CO_STATUS_LABEL = {
  requested: '고객 승인 대기',
  approved: '승인',
  rejected: '고객 거절',
  waived: '무상 처리',
  canceled: '요청 철회',
};

export const QUOTE_STATUS_LABEL = {
  draft: '작성 중',
  sent: '발송(승인 대기)',
  approved: '고객 승인',
  rejected: '거절',
  superseded: '이전 버전',
};

export const INVOICE_STATUS_LABEL = { issued: '미수', partial: '부분 수금', paid: '수금 완료', void: '취소' };

export const RESERVATION_STATUS_LABEL = { active: '예약', consumed: '사용 완료', released: '해제' };

export const PAYMENT_METHODS = ['계좌이체', '카드', '현금', '관리비 합산'];

export const CATEGORIES = [
  { key: 'APPROVAL', label: '추가 작업 승인 누락', short: '승인 누락' },
  { key: 'MATERIAL', label: '자재 중복 예약', short: '자재 중복' },
  { key: 'SCHEDULE', label: '작업팀 일정 충돌', short: '일정 충돌' },
  { key: 'BILLING', label: '청구 누락', short: '청구 누락' },
];

export const SEVERITY = { critical: '긴급', warning: '주의', info: '참고' };
export const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

export const DEFAULT_SETTINGS = {
  travelBufferMin: 30, // 같은 팀 연속 일정 사이 최소 이동 시간(분)
  invoiceGraceDays: 1, // 완료 후 이 기간이 지나도 청구서가 없으면 '주의'
  invoiceCriticalDays: 3, // 완료 후 이 기간이 지나도 청구서가 없으면 '긴급'
  approvalDelayHours: 24, // 추가 작업 승인 대기 경고 시간
  weakApprovalAmount: 300000, // 이 금액 이상 추가 작업을 구두로만 승인하면 참고 알림
  overdueCriticalDays: 30, // 미수금 연체 긴급 기준
  paymentDueDays: 7,
  laborCostPerHour: 55000, // 팀 1시간당 인건비 원가(정산용)
};

/** 대시보드·목록 필터용 흐름 단계 (각 단계에서 '다음 할 일'이 남은 작업건) */
export const FLOW = [
  { key: 'intake', label: '문의 접수', statuses: [S.RECEIVED], hint: '현장 확인 예약' },
  { key: 'survey', label: '현장 확인', statuses: [S.SURVEY_SCHEDULED], hint: '방문 예정' },
  { key: 'quote', label: '견적', statuses: [S.SURVEYED, S.REJECTED], hint: '견적 작성' },
  { key: 'approval', label: '고객 승인', statuses: [S.QUOTED], hint: '승인 대기' },
  { key: 'assign', label: '작업 배정', statuses: [S.APPROVED], hint: '팀 배정' },
  { key: 'work', label: '자재 사용', statuses: [S.SCHEDULED, S.IN_PROGRESS], hint: '작업 예정·진행' },
  { key: 'settle', label: '완료 정산', statuses: [S.COMPLETED, S.INVOICED], hint: '청구·수금' },
];
