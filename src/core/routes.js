// REST 경로 ↔ 엔진 명령/조회 매핑 (서버·브라우저 공용)

export const ROUTES = [
  // 조회
  { method: 'GET', path: '/api/state', query: 'state' },
  { method: 'GET', path: '/api/dashboard', query: 'dashboard' },
  { method: 'GET', path: '/api/board', query: 'board' },
  { method: 'GET', path: '/api/findings', query: 'findings' },
  { method: 'GET', path: '/api/jobs/:id', query: 'job' },
  { method: 'GET', path: '/api/schedule', query: 'schedule' },
  { method: 'GET', path: '/api/materials', query: 'materials' },
  { method: 'GET', path: '/api/settlement', query: 'settlement' },

  // 1. 문의 접수
  { method: 'POST', path: '/api/customers', command: 'createCustomer', created: true },
  { method: 'POST', path: '/api/jobs', command: 'createInquiry', created: true },
  { method: 'POST', path: '/api/jobs/:id/cancel', command: 'cancelJob' },
  // 2. 현장 확인
  { method: 'POST', path: '/api/jobs/:id/survey', command: 'scheduleSurvey' },
  { method: 'POST', path: '/api/jobs/:id/survey/complete', command: 'completeSurvey' },
  // 3. 견적
  { method: 'POST', path: '/api/jobs/:id/quotes', command: 'createQuote', created: true },
  { method: 'PUT', path: '/api/quotes/:id', command: 'updateQuote' },
  { method: 'POST', path: '/api/quotes/:id/send', command: 'sendQuote' },
  // 4. 고객 승인
  { method: 'POST', path: '/api/quotes/:id/approve', command: 'approveQuote' },
  { method: 'POST', path: '/api/quotes/:id/reject', command: 'rejectQuote' },
  // 5. 작업 배정
  { method: 'POST', path: '/api/jobs/:id/schedule', command: 'scheduleJob' },
  { method: 'POST', path: '/api/jobs/:id/reservations', command: 'reserveMaterial', created: true },
  { method: 'PATCH', path: '/api/reservations/:id', command: 'adjustReservation' },
  { method: 'POST', path: '/api/reservations/:id/release', command: 'releaseReservation' },
  // 6. 작업·자재 사용·추가 작업
  { method: 'POST', path: '/api/jobs/:id/start', command: 'startJob' },
  { method: 'POST', path: '/api/jobs/:id/usages', command: 'recordUsage', created: true },
  { method: 'POST', path: '/api/jobs/:id/change-orders', command: 'requestChangeOrder', created: true },
  { method: 'POST', path: '/api/jobs/:id/change-orders/from-excess', command: 'changeOrderFromExcess', created: true },
  { method: 'POST', path: '/api/change-orders/:id/approve', command: 'approveChangeOrder' },
  { method: 'POST', path: '/api/change-orders/:id/reject', command: 'rejectChangeOrder' },
  { method: 'POST', path: '/api/change-orders/:id/cancel', command: 'cancelChangeOrder' },
  { method: 'POST', path: '/api/change-orders/:id/perform', command: 'performChangeOrder' },
  { method: 'POST', path: '/api/change-orders/:id/waive', command: 'waiveChangeOrder' },
  // 7. 완료 정산
  { method: 'POST', path: '/api/jobs/:id/complete', command: 'completeJob' },
  { method: 'POST', path: '/api/jobs/:id/invoices', command: 'issueInvoice', created: true },
  { method: 'POST', path: '/api/invoices/:id/payments', command: 'recordPayment' },
  { method: 'POST', path: '/api/invoices/:id/void', command: 'voidInvoice' },
  // 자재·점검
  { method: 'POST', path: '/api/materials/:id/stock-in', command: 'stockIn' },
  { method: 'POST', path: '/api/findings/ack', command: 'acknowledgeFinding' },

  // 고객용 공개 링크
  { method: 'GET', path: '/api/public/quotes/:token', query: 'publicQuote', public: true },
  { method: 'POST', path: '/api/public/quotes/:token/approve', command: 'approveQuoteByToken', public: true },
  { method: 'POST', path: '/api/public/quotes/:token/reject', command: 'rejectQuoteByToken', public: true },
  { method: 'GET', path: '/api/public/change-orders/:token', query: 'publicChangeOrder', public: true },
  { method: 'POST', path: '/api/public/change-orders/:token/approve', command: 'approveChangeOrderByToken', public: true },
  { method: 'POST', path: '/api/public/change-orders/:token/reject', command: 'rejectChangeOrderByToken', public: true },
];

const compiled = ROUTES.map((r) => {
  const keys = [];
  const re = new RegExp(`^${r.path.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  return { ...r, re, keys };
});

export function matchRoute(method, pathname) {
  for (const r of compiled) {
    if (r.method !== method) continue;
    const m = r.re.exec(pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return { route: r, params };
  }
  return null;
}
