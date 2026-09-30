// 상태(state)에서 값을 꺼내고 파생 값을 계산하는 순수 함수 모음.
import { S, CLOSED, DEFAULT_SETTINGS } from './constants.js';
import { notFound } from './errors.js';
import { totals, lineAmount } from './money.js';
import { overlaps, workingHours } from './time.js';

export function emptyState(company = {}) {
  return {
    meta: {
      version: 1,
      company: { name: '우리배관설비', phone: '', bizNo: '', address: '', account: '', ...company },
      settings: { ...DEFAULT_SETTINGS },
      seq: {},
      laborCatalog: [],
    },
    customers: [],
    crews: [],
    materials: [],
    jobs: [],
    quotes: [],
    changeOrders: [],
    reservations: [],
    usages: [],
    invoices: [],
    events: [],
    acks: {},
  };
}

export const settingsOf = (s) => ({ ...DEFAULT_SETTINGS, ...(s.meta?.settings || {}) });

export function find(list, id) {
  return list.find((x) => x.id === id);
}

export function must(list, id, what) {
  const found = find(list, id);
  if (!found) throw notFound(what, id);
  return found;
}

export const getJob = (s, id) => must(s.jobs, id, '작업건');
export const getCustomer = (s, id) => find(s.customers, id);
export const getCrew = (s, id) => find(s.crews, id);
export const getMaterial = (s, id) => find(s.materials, id);

export const quotesOf = (s, jobId) => s.quotes.filter((q) => q.jobId === jobId).sort((a, b) => a.version - b.version);
export const latestQuote = (s, jobId) => quotesOf(s, jobId).filter((q) => q.status !== 'superseded').at(-1) || null;
export const approvedQuote = (s, jobId) => s.quotes.find((q) => q.jobId === jobId && q.status === 'approved') || null;
export const changeOrdersOf = (s, jobId) => s.changeOrders.filter((c) => c.jobId === jobId);
export const reservationsOf = (s, jobId) => s.reservations.filter((r) => r.jobId === jobId);
export const usagesOf = (s, jobId) => s.usages.filter((u) => u.jobId === jobId);
export const invoicesOf = (s, jobId) => s.invoices.filter((i) => i.jobId === jobId);
export const activeInvoice = (s, jobId) => s.invoices.find((i) => i.jobId === jobId && i.status !== 'void') || null;

export const quoteTotals = (q) => totals(q?.items || []);
export const coTotals = (co) => totals(co?.items || []);

export function invoicePaid(inv) {
  return (inv.payments || []).reduce((sum, p) => sum + p.amount, 0);
}

export function invoiceTotals(inv) {
  const t = totals(inv.items);
  const paid = invoicePaid(inv);
  return { ...t, paid, balance: t.total - paid };
}

/** 추가 작업이 실제 수행됐는지: 수행 표시가 있거나 그 추가 작업으로 자재가 사용된 경우 */
export function coPerformed(s, co) {
  return !!co.performed || s.usages.some((u) => u.changeOrderId === co.id);
}

// ─── 자재 ───────────────────────────────────────────────

export const outstanding = (r) => Math.max(0, (Number(r.qty) || 0) - (Number(r.usedQty) || 0));

export function reservationWindow(s, r) {
  const job = find(s.jobs, r.jobId);
  return job?.schedule ? { start: job.schedule.start, end: job.schedule.end } : null;
}

export function materialAvailability(s, materialId) {
  const m = getMaterial(s, materialId);
  const active = s.reservations.filter((r) => r.materialId === materialId && r.status === 'active');
  const reserved = active.reduce((sum, r) => sum + outstanding(r), 0);
  const used = s.usages.filter((u) => u.materialId === materialId).reduce((sum, u) => sum + u.qty, 0);
  return {
    stock: m?.stock ?? 0,
    reserved,
    available: (m?.stock ?? 0) - reserved,
    used,
    holders: active.map((r) => ({ reservationId: r.id, jobId: r.jobId, qty: outstanding(r) })),
  };
}

/** 장비 예약 중 주어진 시간대와 겹치는 활성 예약 */
export function overlappingEquipment(s, materialId, window, { excludeReservationId, excludeJobId } = {}) {
  if (!window) return [];
  return s.reservations.filter((r) => {
    if (r.materialId !== materialId || r.status !== 'active') return false;
    if (r.id === excludeReservationId || r.jobId === excludeJobId) return false;
    const w = reservationWindow(s, r);
    return w && overlaps(w, window);
  });
}

/** 고객이 승인한 수량(승인 견적 + 승인/무상 처리된 추가 작업) — 자재별 합계 */
export function approvedQuantities(s, jobId, { includeRequested = false } = {}) {
  const map = new Map();
  const add = (items) => items.forEach((it) => {
    if (!it.materialId) return;
    map.set(it.materialId, (map.get(it.materialId) || 0) + Number(it.qty || 0));
  });
  const q = approvedQuote(s, jobId);
  if (q) add(q.items);
  const okStatuses = includeRequested ? ['approved', 'waived', 'requested'] : ['approved', 'waived'];
  changeOrdersOf(s, jobId).filter((c) => okStatuses.includes(c.status)).forEach((c) => add(c.items));
  return map;
}

export function usedQuantities(s, jobId) {
  const map = new Map();
  usagesOf(s, jobId).forEach((u) => map.set(u.materialId, (map.get(u.materialId) || 0) + u.qty));
  return map;
}

/** 견적·추가 작업 어디에도 근거가 없는 초과 사용량 */
export function excessUsage(s, jobId) {
  const covered = approvedQuantities(s, jobId, { includeRequested: true });
  const used = usedQuantities(s, jobId);
  const out = [];
  for (const [materialId, qty] of used) {
    const extra = qty - (covered.get(materialId) || 0);
    if (extra > 1e-9) {
      const m = getMaterial(s, materialId);
      out.push({ materialId, name: m?.name || materialId, unit: m?.unit || '', used: qty, covered: covered.get(materialId) || 0, excess: Math.round(extra * 100) / 100, unitPrice: m?.price || 0 });
    }
  }
  return out;
}

// ─── 청구 ───────────────────────────────────────────────

/** 청구해야 할 항목: 승인 견적 전체 + 승인된 추가 작업 */
export function billingBasis(s, jobId) {
  const lines = [];
  const q = approvedQuote(s, jobId);
  if (q) {
    q.items.forEach((it) => lines.push({ ...pickItem(it), source: 'quote', refId: `${q.id}:${it.id}`, group: `견적 v${q.version}` }));
  }
  changeOrdersOf(s, jobId).filter((c) => c.status === 'approved').forEach((c) => {
    c.items.forEach((it) => lines.push({ ...pickItem(it), source: 'change', refId: `${c.id}:${it.id}`, changeOrderId: c.id, group: `추가 작업 · ${c.title}` }));
  });
  return { lines, ...totals(lines) };
}

function pickItem(it) {
  return { name: it.name, kind: it.kind, materialId: it.materialId || null, qty: Number(it.qty), unit: it.unit || '', unitPrice: Number(it.unitPrice) };
}

/** 청구서에 빠진 근거 항목 */
export function missingBillingLines(s, inv) {
  const basis = billingBasis(s, inv.jobId);
  const billed = new Set(inv.items.map((i) => i.refId).filter(Boolean));
  return basis.lines.filter((l) => !billed.has(l.refId));
}

// ─── 일정 ───────────────────────────────────────────────

/** 팀이 실제로 묶이는 시간 (현장 확인 방문 + 작업) */
export function crewBookings(s) {
  const out = [];
  for (const job of s.jobs) {
    if (job.status === S.CANCELED) continue;
    if (job.survey && job.survey.status === 'scheduled') {
      out.push({ id: `${job.id}:survey`, kind: 'survey', jobId: job.id, crewId: job.survey.crewId, start: job.survey.start, end: job.survey.end, address: job.address, forced: !!job.survey.forced });
    }
    if (job.schedule && (job.status === S.SCHEDULED || job.status === S.IN_PROGRESS)) {
      out.push({ id: `${job.id}:work`, kind: 'work', jobId: job.id, crewId: job.schedule.crewId, start: job.schedule.start, end: job.schedule.end, address: job.address, forced: !!job.schedule.forced });
    }
  }
  return out;
}

/** 모든 일정 (완료된 작업 포함) — 일정 화면 표시용 */
export function allBookings(s) {
  const out = [];
  for (const job of s.jobs) {
    if (job.status === S.CANCELED) continue;
    if (job.survey) {
      out.push({ id: `${job.id}:survey`, kind: 'survey', jobId: job.id, crewId: job.survey.crewId, start: job.survey.start, end: job.survey.end, address: job.address, done: job.survey.status === 'done' });
    }
    if (job.schedule) {
      out.push({ id: `${job.id}:work`, kind: 'work', jobId: job.id, crewId: job.schedule.crewId, start: job.schedule.start, end: job.schedule.end, address: job.address, done: CLOSED.includes(job.status) });
    }
  }
  return out;
}

export function sharedMembers(crewA, crewB) {
  if (!crewA || !crewB || crewA.id === crewB.id) return [];
  const setB = new Set(crewB.members || []);
  return (crewA.members || []).filter((m) => setB.has(m));
}

/** 제안된 일정과 충돌하는 기존 일정 (같은 팀, 또는 인원을 공유하는 다른 팀) */
export function bookingConflicts(s, proposal, { excludeId } = {}) {
  const crew = getCrew(s, proposal.crewId);
  const out = [];
  for (const b of crewBookings(s)) {
    if (b.id === excludeId) continue;
    if (!overlaps(b, proposal)) continue;
    if (b.crewId === proposal.crewId) {
      out.push({ ...b, reason: 'same-crew' });
    } else {
      const shared = sharedMembers(crew, getCrew(s, b.crewId));
      if (shared.length) out.push({ ...b, reason: 'shared-member', members: shared });
    }
  }
  return out;
}

/** 해당 시간에 비어 있는 팀 목록 */
export function freeCrews(s, window, { excludeId } = {}) {
  return s.crews.filter((c) => c.active !== false)
    .filter((c) => bookingConflicts(s, { ...window, crewId: c.id }, { excludeId }).length === 0)
    .map((c) => ({ id: c.id, name: c.name }));
}

// ─── 정산 ───────────────────────────────────────────────

export function jobCost(s, jobId) {
  const settings = settingsOf(s);
  const materialCost = usagesOf(s, jobId).reduce((sum, u) => {
    const m = getMaterial(s, u.materialId);
    return sum + (m && m.kind !== 'equipment' ? Math.round(u.qty * (m.cost || 0)) : 0);
  }, 0);
  const job = find(s.jobs, jobId);
  const hours = job?.schedule ? workingHours(job.schedule.start, job.schedule.end) : 0;
  const laborCost = Math.round(hours * settings.laborCostPerHour);
  return { materialCost, laborCost, hours, total: materialCost + laborCost };
}

export const itemAmount = lineAmount;
