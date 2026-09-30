// 화면과 API가 함께 쓰는 조회용 계산 (읽기 전용)
import { S, BOARD, STATUS_STEP, ACTIVE_WORK } from './constants.js';
import {
  find, getCustomer, getCrew, getMaterial, quotesOf, approvedQuote, latestQuote, changeOrdersOf,
  reservationsOf, usagesOf, invoicesOf, activeInvoice, materialAvailability, outstanding, reservationWindow,
  billingBasis, excessUsage, invoiceTotals, jobCost, allBookings, coPerformed, settingsOf,
} from './model.js';
import { detectFindings, summarizeFindings, findingsForJob } from './detectors.js';
import { totals } from './money.js';
import { dateOf, monthOf, parseWall, overlaps, addDays } from './time.js';
import { notFound } from './errors.js';

export function jobSummary(s, job) {
  const customer = getCustomer(s, job.customerId);
  const q = approvedQuote(s, job.id) || latestQuote(s, job.id);
  const inv = activeInvoice(s, job.id);
  return {
    ...job,
    customer,
    step: STATUS_STEP[job.status],
    amount: inv ? totals(inv.items).total : q ? totals(q.items).total : 0,
    crew: getCrew(s, job.schedule?.crewId || job.survey?.crewId),
    nextAt: nextEventAt(job),
  };
}

function nextEventAt(job) {
  if (job.status === S.SURVEY_SCHEDULED) return job.survey?.start;
  if (ACTIVE_WORK.includes(job.status)) return job.schedule?.start;
  return null;
}

export function jobDetail(s, jobId, now) {
  const job = find(s.jobs, jobId);
  if (!job) throw notFound('작업건', jobId);
  const findings = findingsForJob(detectFindings(s, now), jobId);
  const cos = changeOrdersOf(s, jobId).map((c) => ({ ...c, totals: totals(c.items), performed: coPerformed(s, c) }));
  const reservations = reservationsOf(s, jobId).map((r) => ({ ...r, material: getMaterial(s, r.materialId), outstanding: outstanding(r) }));
  const usages = usagesOf(s, jobId).map((u) => ({ ...u, material: getMaterial(s, u.materialId), changeOrder: find(s.changeOrders, u.changeOrderId) }));
  const invoices = invoicesOf(s, jobId).map((i) => ({ ...i, totals: invoiceTotals(i) }));
  return {
    job: jobSummary(s, job),
    customer: getCustomer(s, job.customerId),
    quotes: quotesOf(s, jobId).map((q) => ({ ...q, totals: totals(q.items) })),
    approvedQuote: approvedQuote(s, jobId),
    changeOrders: cos,
    reservations,
    usages,
    excess: excessUsage(s, jobId),
    invoices,
    activeInvoice: invoices.find((i) => i.status !== 'void') || null,
    basis: billingBasis(s, jobId),
    cost: jobCost(s, jobId),
    events: s.events.filter((e) => e.jobId === jobId).slice().reverse(),
    findings,
    surveyCrew: getCrew(s, job.survey?.crewId),
    workCrew: getCrew(s, job.schedule?.crewId),
  };
}

export function board(s) {
  return BOARD.map((col) => ({
    ...col,
    jobs: s.jobs.filter((j) => col.statuses.includes(j.status)).map((j) => jobSummary(s, j))
      .sort((a, b) => (b.urgency === 'urgent') - (a.urgency === 'urgent') || (b.updatedAt || '').localeCompare(a.updatedAt || '')),
  }));
}

export function dashboard(s, now) {
  const today = dateOf(now);
  const month = monthOf(now);
  const findings = detectFindings(s, now);
  const fsum = summarizeFindings(findings);
  const count = (statuses) => s.jobs.filter((j) => statuses.includes(j.status)).length;

  const todays = allBookings(s)
    .filter((b) => dateOf(b.start) <= today && dateOf(b.end) >= today)
    .sort((a, b) => parseWall(a.start) - parseWall(b.start))
    .map((b) => ({ ...b, job: find(s.jobs, b.jobId), crew: getCrew(s, b.crewId), conflict: findings.some((f) => f.category === 'SCHEDULE' && f.severity === 'critical' && f.refs.includes(b.id)) }));

  const invoicedThisMonth = s.invoices.filter((i) => i.status !== 'void' && monthOf(i.issuedAt) === month);
  const collected = s.invoices.flatMap((i) => i.payments || []).filter((p) => monthOf(p.at) === month).reduce((sum, p) => sum + p.amount, 0);
  const receivable = s.invoices.filter((i) => ['issued', 'partial'].includes(i.status)).reduce((sum, i) => sum + invoiceTotals(i).balance, 0);

  return {
    today,
    month,
    pipeline: {
      intake: count([S.RECEIVED, S.SURVEY_SCHEDULED, S.SURVEYED]),
      awaitingApproval: count([S.QUOTED]),
      toAssign: count([S.APPROVED]),
      scheduled: count([S.SCHEDULED]),
      inProgress: count([S.IN_PROGRESS]),
      toSettle: count([S.COMPLETED]),
      invoiced: count([S.INVOICED]),
    },
    pendingChangeOrders: s.changeOrders.filter((c) => c.status === 'requested').length,
    todays,
    money: {
      invoiced: invoicedThisMonth.reduce((sum, i) => sum + totals(i.items).total, 0),
      collected,
      receivable,
    },
    findings: fsum,
    topFindings: findings.filter((f) => !f.acked).slice(0, 6),
  };
}

export function materialsOverview(s, now) {
  const findings = detectFindings(s, now).filter((f) => f.category === 'MATERIAL' && !f.acked);
  return s.materials.map((m) => {
    const av = materialAvailability(s, m.id);
    const reservations = s.reservations.filter((r) => r.materialId === m.id && r.status === 'active').map((r) => ({
      ...r, outstanding: outstanding(r), window: reservationWindow(s, r), job: find(s.jobs, r.jobId),
    }));
    const flagged = findings.filter((f) => f.refs.some((ref) => ref === m.id || reservations.some((r) => r.id === ref)));
    return { ...m, ...av, reservations, findings: flagged };
  });
}

export function schedule(s, now, { from, days = 7 } = {}) {
  const start = from || dateOf(now);
  const dates = Array.from({ length: days }, (_, i) => dateOf(addDays(`${start}T00:00`, i)));
  const end = addDays(`${start}T00:00`, days);
  const findings = detectFindings(s, now).filter((f) => f.category === 'SCHEDULE' && !f.acked);
  const bookings = allBookings(s)
    .filter((b) => overlaps(b, { start: `${start}T00:00`, end }))
    .map((b) => ({
      ...b,
      job: find(s.jobs, b.jobId),
      customer: getCustomer(s, find(s.jobs, b.jobId)?.customerId),
      issues: findings.filter((f) => f.refs.includes(b.id)).map((f) => ({ key: f.key, severity: f.severity, title: f.title, code: f.code })),
    }))
    .sort((a, b) => parseWall(a.start) - parseWall(b.start));
  return { from: start, dates, crews: s.crews.filter((c) => c.active !== false), bookings, findings };
}

export function settlement(s, now, { month } = {}) {
  const m = month || monthOf(now);
  const rows = s.invoices.filter((i) => i.status !== 'void' && monthOf(i.issuedAt) === m).map((inv) => {
    const job = find(s.jobs, inv.jobId);
    const t = invoiceTotals(inv);
    const cost = jobCost(s, inv.jobId);
    const basis = billingBasis(s, inv.jobId);
    return {
      invoice: inv, job, customer: getCustomer(s, job?.customerId), ...t, cost,
      margin: t.supply - cost.total,
      marginRate: t.supply ? (t.supply - cost.total) / t.supply : 0,
      unbilled: Math.max(0, basis.total - t.total),
    };
  }).sort((a, b) => a.invoice.issuedAt.localeCompare(b.invoice.issuedAt));
  const sum = (k) => rows.reduce((acc, r) => acc + (typeof k === 'function' ? k(r) : r[k]), 0);
  const waiting = s.jobs.filter((j) => j.status === S.COMPLETED).map((j) => ({ job: j, customer: getCustomer(s, j.customerId), basis: billingBasis(s, j.id) }));
  const months = [...new Set(s.invoices.filter((i) => i.status !== 'void').map((i) => monthOf(i.issuedAt)).concat([monthOf(now)]))].sort().reverse();
  const waivedAmount = s.changeOrders.filter((c) => c.status === 'waived' && monthOf(c.waivedAt || '') === m).reduce((acc, c) => acc + totals(c.items).total, 0);
  return {
    month: m,
    months,
    rows,
    waiting,
    totals: {
      supply: sum('supply'), vat: sum('vat'), total: sum('total'), paid: sum('paid'), balance: sum('balance'),
      materialCost: sum((r) => r.cost.materialCost), laborCost: sum((r) => r.cost.laborCost), margin: sum('margin'),
      unbilled: sum('unbilled'), waived: waivedAmount,
    },
    settings: settingsOf(s),
  };
}

/** 고객에게 보여 줄 견적 (내부 정보 제외) */
export function publicQuote(s, token) {
  const q = s.quotes.find((x) => x.token && x.token === token);
  if (!q) throw notFound('견적 링크', '만료되었거나 잘못된 링크');
  const job = find(s.jobs, q.jobId);
  const customer = getCustomer(s, job.customerId);
  return {
    kind: 'quote', id: q.id, version: q.version, status: q.status, items: q.items, note: q.note, validDays: q.validDays,
    sentAt: q.sentAt, totals: totals(q.items), approval: q.approval ? { by: q.approval.by, at: q.approval.at, method: q.approval.method } : null,
    job: { id: job.id, title: job.title, address: job.address, symptom: job.symptom, findings: job.survey?.findings || '' },
    customer: { name: customer?.name }, company: s.meta.company,
  };
}

export function publicChangeOrder(s, token) {
  const co = s.changeOrders.find((x) => x.token && x.token === token);
  if (!co) throw notFound('추가 작업 링크', '만료되었거나 잘못된 링크');
  const job = find(s.jobs, co.jobId);
  const customer = getCustomer(s, job.customerId);
  const base = approvedQuote(s, job.id);
  return {
    kind: 'change', id: co.id, title: co.title, reason: co.reason, status: co.status, items: co.items, totals: totals(co.items),
    requestedAt: co.requestedAt, approval: co.approval ? { by: co.approval.by, at: co.approval.at, method: co.approval.method } : null,
    job: { id: job.id, title: job.title, address: job.address }, baseTotal: base ? totals(base.items).total : 0,
    customer: { name: customer?.name }, company: s.meta.company,
  };
}

export function findingsView(s, now) {
  const list = detectFindings(s, now);
  return { findings: list, summary: summarizeFindings(list) };
}
