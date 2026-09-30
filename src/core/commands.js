// 상태를 바꾸는 업무 명령. 각 명령은 (state, payload, ctx) → result 형태이며
// 엔진이 복사본에서 실행하고 성공했을 때만 반영한다(실패 시 부분 변경 없음).
import {
  S, STATUS_LABEL, CHANNELS, APPROVAL_METHODS, ITEM_KINDS, PAYMENT_METHODS, PRE_APPROVAL,
} from './constants.js';
import { DomainError, invalid, notFound, badState, conflict } from './errors.js';
import {
  find, must, getJob, getCrew, getMaterial, approvedQuote, quotesOf, changeOrdersOf, reservationsOf,
  activeInvoice, outstanding, materialAvailability, overlappingEquipment, bookingConflicts, freeCrews,
  excessUsage, billingBasis, coPerformed, invoiceTotals, coTotals, settingsOf,
} from './model.js';
import { totals, won, fmtQty } from './money.js';
import { isValidRange, isValidWall, addDays, dateOf, fmtRange, monthOf } from './time.js';
import { detectFindings } from './detectors.js';

// ─── 공통 검증 ───────────────────────────────────────────

const text = (v, max = 500) => String(v ?? '').trim().slice(0, max);

function requireText(v, label, max) {
  const t = text(v, max);
  if (!t) throw invalid(`${label}을(를) 입력하세요.`);
  return t;
}

function requireStatus(job, allowed, action) {
  if (!allowed.includes(job.status)) {
    throw badState(`'${STATUS_LABEL[job.status]}' 상태에서는 ${action}할 수 없습니다.`, { status: job.status, allowed });
  }
}

function requireRange(start, end) {
  if (!isValidWall(start) || !isValidWall(end)) throw invalid('시작·종료 시각을 "YYYY-MM-DDTHH:mm" 형식으로 입력하세요.');
  if (!isValidRange(start, end)) throw invalid('종료 시각은 시작 시각보다 늦어야 합니다.');
}

function requireForceReason(p) {
  if (p.force && !text(p.reason)) throw invalid('강제로 진행하려면 사유를 입력하세요.');
}

function validSignature(sig) {
  if (!sig) return null;
  if (typeof sig !== 'string' || !sig.startsWith('data:image/') || sig.length > 300000) {
    throw invalid('서명 이미지 형식이 올바르지 않습니다.');
  }
  return sig;
}

function normalizeApproval(p, ctx) {
  const by = requireText(p.by, '승인자 이름', 40);
  const method = p.method || '현장 서명';
  if (!APPROVAL_METHODS.includes(method)) throw invalid(`승인 방법은 ${APPROVAL_METHODS.join(', ')} 중 하나여야 합니다.`);
  const signature = validSignature(p.signature);
  if ((method === '현장 서명' || method === '고객 링크 서명') && !signature) throw invalid('서명 승인에는 서명이 필요합니다.');
  return { by, method, signature, memo: text(p.memo, 300), at: ctx.now, recordedBy: ctx.actor };
}

export function normalizeItems(s, items, { allowEmpty = false } = {}) {
  if (!Array.isArray(items)) throw invalid('항목 목록이 필요합니다.');
  if (!allowEmpty && items.length === 0) throw invalid('항목을 1개 이상 입력하세요.');
  if (items.length > 100) throw invalid('항목은 100개까지 입력할 수 있습니다.');
  return items.map((raw, i) => {
    let m = null;
    if (raw.materialId) {
      m = getMaterial(s, raw.materialId);
      if (!m) throw notFound('자재', raw.materialId);
    }
    const name = text(raw.name, 120) || m?.name || '';
    const qty = Number(raw.qty);
    const unitPrice = raw.unitPrice === undefined || raw.unitPrice === null || raw.unitPrice === '' ? (m?.price ?? NaN) : Number(raw.unitPrice);
    if (!name) throw invalid(`${i + 1}번째 항목의 품명을 입력하세요.`);
    if (!(qty > 0) || qty > 100000) throw invalid(`${name}: 수량을 확인하세요.`);
    if (!(unitPrice >= 0) || unitPrice > 1e9) throw invalid(`${name}: 단가를 확인하세요.`);
    const kind = m ? (m.kind === 'equipment' ? 'equipment' : 'material') : (ITEM_KINDS[raw.kind] ? raw.kind : 'etc');
    return { id: `L${i + 1}`, kind, materialId: m?.id || null, name, qty, unit: text(raw.unit, 10) || m?.unit || '식', unitPrice: Math.round(unitPrice) };
  });
}

function preQuoteStatus(job) {
  if (job.survey?.status === 'done') return S.SURVEYED;
  if (job.survey?.status === 'scheduled') return S.SURVEY_SCHEDULED;
  return S.RECEIVED;
}

function touch(job, ctx) {
  job.updatedAt = ctx.now;
}

function scheduleConflictError(s, proposal, excludeId, what) {
  const conflicts = bookingConflicts(s, proposal, { excludeId });
  if (!conflicts.length) return { conflicts, error: null };
  const crew = getCrew(s, proposal.crewId);
  const first = conflicts[0];
  const reason = first.reason === 'shared-member'
    ? `${first.members.join(', ')} 님이 ${getCrew(s, first.crewId)?.name} 일정(${first.jobId})과 겹칩니다`
    : `${crew?.name}이(가) 같은 시간에 ${first.jobId} ${first.kind === 'survey' ? '현장 확인' : '작업'}(${fmtRange(first.start, first.end)})에 배정되어 있습니다`;
  return {
    conflicts,
    error: conflict('SCHEDULE_CONFLICT', `${what} 일정 충돌: ${reason}.`, {
      conflicts,
      freeCrews: freeCrews(s, proposal, { excludeId }),
    }),
  };
}

// ─── 명령 ────────────────────────────────────────────────

export const commands = {
  createCustomer(s, p, ctx) {
    const customer = {
      id: ctx.id('CU', 3),
      name: requireText(p.name, '고객명', 40),
      phone: requireText(p.phone, '연락처', 20),
      address: text(p.address, 120),
      type: ['개인', '상가', '관리사무소', '기업'].includes(p.type) ? p.type : '개인',
      memo: text(p.memo, 300),
      createdAt: ctx.now,
    };
    s.customers.push(customer);
    return customer;
  },

  /** 1단계: 문의 접수 */
  createInquiry(s, p, ctx) {
    let customer;
    if (p.customerId) {
      customer = must(s.customers, p.customerId, '고객');
    } else {
      customer = commands.createCustomer(s, p.customer || {}, ctx);
    }
    const channel = CHANNELS.includes(p.channel) ? p.channel : '전화';
    const job = {
      id: ctx.id('J', 4),
      customerId: customer.id,
      title: requireText(p.title, '문의 내용 요약', 80),
      address: text(p.address, 120) || customer.address,
      symptom: text(p.symptom, 1000),
      channel,
      urgency: p.urgency === 'urgent' ? 'urgent' : 'normal',
      preferredAt: isValidWall(p.preferredAt) ? p.preferredAt : null,
      status: S.RECEIVED,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      survey: null,
      schedule: null,
      approvedQuoteId: null,
    };
    if (!job.address) throw invalid('현장 주소를 입력하세요.');
    s.jobs.push(job);
    ctx.log(job.id, `문의 접수 (${channel}${job.urgency === 'urgent' ? ', 긴급' : ''}) — ${job.title}`);
    return job;
  },

  /** 2단계: 현장 확인 방문 예약 */
  scheduleSurvey(s, p, ctx) {
    const job = getJob(s, p.id);
    requireStatus(job, [S.RECEIVED, S.SURVEY_SCHEDULED], '현장 확인을 예약');
    const crew = getCrew(s, p.crewId);
    if (!crew) throw invalid('방문할 팀을 선택하세요.');
    requireRange(p.start, p.end);
    requireForceReason(p);
    const proposal = { crewId: crew.id, start: p.start, end: p.end };
    const { conflicts, error } = scheduleConflictError(s, proposal, `${job.id}:survey`, '현장 확인');
    if (error && !p.force) throw error;
    job.survey = { crewId: crew.id, start: p.start, end: p.end, status: 'scheduled', findings: '', forced: !!(p.force && conflicts.length), forceReason: p.force ? text(p.reason, 200) : '' };
    job.status = S.SURVEY_SCHEDULED;
    touch(job, ctx);
    ctx.log(job.id, `현장 확인 예약: ${crew.name} ${fmtRange(p.start, p.end)}${job.survey.forced ? ` — 충돌 무시(사유: ${job.survey.forceReason})` : ''}`, job.survey.forced ? 'warn' : 'info');
    return job;
  },

  completeSurvey(s, p, ctx) {
    const job = getJob(s, p.id);
    requireStatus(job, [S.SURVEY_SCHEDULED], '현장 확인을 완료');
    job.survey.status = 'done';
    job.survey.findings = requireText(p.findings, '현장 확인 결과', 2000);
    job.survey.doneAt = ctx.now;
    job.status = S.SURVEYED;
    touch(job, ctx);
    ctx.log(job.id, `현장 확인 완료 — ${job.survey.findings.slice(0, 60)}`);
    return job;
  },

  /** 3단계: 견적 작성 (새 버전) */
  createQuote(s, p, ctx) {
    const job = getJob(s, p.id);
    requireStatus(job, PRE_APPROVAL, '견적을 작성');
    const items = normalizeItems(s, p.items || [], { allowEmpty: true });
    quotesOf(s, job.id).filter((q) => q.status === 'draft' || q.status === 'sent').forEach((q) => { q.status = 'superseded'; });
    const version = quotesOf(s, job.id).length + 1;
    const quote = { id: `${job.id}-Q${version}`, jobId: job.id, version, status: 'draft', items, note: text(p.note, 500), validDays: Number(p.validDays) > 0 ? Number(p.validDays) : 14, createdAt: ctx.now, sentAt: null, token: null, approval: null };
    s.quotes.push(quote);
    if (job.status === S.QUOTED || job.status === S.REJECTED) job.status = preQuoteStatus(job);
    touch(job, ctx);
    ctx.log(job.id, `견적 v${version} 작성`);
    return quote;
  },

  updateQuote(s, p, ctx) {
    const quote = must(s.quotes, p.id, '견적');
    if (quote.status !== 'draft') throw badState('발송된 견적은 수정할 수 없습니다. 새 버전을 작성하세요.');
    if (p.items !== undefined) quote.items = normalizeItems(s, p.items, { allowEmpty: true });
    if (p.note !== undefined) quote.note = text(p.note, 500);
    touch(getJob(s, quote.jobId), ctx);
    return quote;
  },

  sendQuote(s, p, ctx) {
    const quote = must(s.quotes, p.id, '견적');
    const job = getJob(s, quote.jobId);
    if (quote.status !== 'draft') throw badState('작성 중인 견적만 발송할 수 있습니다.');
    if (!quote.items.length) throw invalid('견적 항목이 없습니다.');
    requireStatus(job, PRE_APPROVAL, '견적을 발송');
    quote.status = 'sent';
    quote.sentAt = ctx.now;
    quote.token = ctx.token();
    job.status = S.QUOTED;
    touch(job, ctx);
    ctx.log(job.id, `견적 v${quote.version} 발송 (${won(totals(quote.items).total)}) — 고객 승인 링크 생성`);
    return quote;
  },

  /** 4단계: 고객 승인 (사무실에서 기록) */
  approveQuote(s, p, ctx) {
    const quote = must(s.quotes, p.id, '견적');
    const job = getJob(s, quote.jobId);
    if (!['draft', 'sent'].includes(quote.status)) throw badState(`'${quote.status}' 상태의 견적은 승인할 수 없습니다.`);
    if (!quote.items.length) throw invalid('견적 항목이 없습니다.');
    requireStatus(job, PRE_APPROVAL, '견적을 승인');
    if (approvedQuote(s, job.id)) throw badState('이미 승인된 견적이 있습니다.');
    quote.approval = normalizeApproval(p, ctx);
    quote.status = 'approved';
    quote.sentAt = quote.sentAt || ctx.now;
    job.status = S.APPROVED;
    job.approvedQuoteId = quote.id;
    touch(job, ctx);
    ctx.log(job.id, `고객 승인: 견적 v${quote.version} ${won(totals(quote.items).total)} (${quote.approval.method}, ${quote.approval.by})`);
    return quote;
  },

  approveQuoteByToken(s, p, ctx) {
    const quote = s.quotes.find((q) => q.token && q.token === p.token);
    if (!quote) throw notFound('견적 링크', '만료되었거나 잘못된 링크');
    if (quote.status !== 'sent') throw badState('이미 처리되었거나 새 버전으로 교체된 견적입니다.');
    return commands.approveQuote(s, { id: quote.id, by: p.name, method: '고객 링크 서명', signature: p.signature, memo: '고객이 링크에서 직접 승인' }, { ...ctx, actor: `고객(${text(p.name, 20)})` });
  },

  rejectQuote(s, p, ctx) {
    const quote = must(s.quotes, p.id, '견적');
    const job = getJob(s, quote.jobId);
    if (quote.status !== 'sent') throw badState('발송된 견적만 거절 처리할 수 있습니다.');
    quote.status = 'rejected';
    quote.rejectReason = text(p.reason, 300);
    job.status = S.REJECTED;
    touch(job, ctx);
    ctx.log(job.id, `견적 v${quote.version} 거절${quote.rejectReason ? ` — ${quote.rejectReason}` : ''}`, 'warn');
    return quote;
  },

  rejectQuoteByToken(s, p, ctx) {
    const quote = s.quotes.find((q) => q.token && q.token === p.token);
    if (!quote) throw notFound('견적 링크', '만료되었거나 잘못된 링크');
    return commands.rejectQuote(s, { id: quote.id, reason: p.reason }, { ...ctx, actor: '고객' });
  },

  /** 5단계: 작업 배정 */
  scheduleJob(s, p, ctx) {
    const job = getJob(s, p.id);
    requireStatus(job, [S.APPROVED, S.SCHEDULED], '작업을 배정');
    if (!approvedQuote(s, job.id)) throw badState('고객이 승인한 견적이 없어 작업을 배정할 수 없습니다.');
    const crew = getCrew(s, p.crewId);
    if (!crew) throw invalid('작업팀을 선택하세요.');
    requireRange(p.start, p.end);
    requireForceReason(p);
    const proposal = { crewId: crew.id, start: p.start, end: p.end };
    const { conflicts, error } = scheduleConflictError(s, proposal, `${job.id}:work`, '작업');
    if (error && !p.force) throw error;
    const before = job.schedule;
    job.schedule = { crewId: crew.id, start: p.start, end: p.end, forced: !!(p.force && conflicts.length), forceReason: p.force ? text(p.reason, 200) : '', assignedAt: ctx.now };
    job.status = S.SCHEDULED;
    touch(job, ctx);
    ctx.log(job.id, `${before ? '일정 변경' : '작업 배정'}: ${crew.name} ${fmtRange(p.start, p.end)}${job.schedule.forced ? ` — 충돌 무시(사유: ${job.schedule.forceReason})` : ''}`, job.schedule.forced ? 'warn' : 'info');

    // 일정이 바뀌면 장비 예약이 새 시간에 겹치지 않는지 알려준다.
    const warnings = reservationsOf(s, job.id)
      .filter((r) => r.status === 'active' && getMaterial(s, r.materialId)?.kind === 'equipment')
      .filter((r) => {
        const m = getMaterial(s, r.materialId);
        return overlappingEquipment(s, m.id, proposal, { excludeJobId: job.id }).length + 1 > m.stock;
      })
      .map((r) => `${getMaterial(s, r.materialId).name} 예약이 새 시간대에 다른 작업과 겹칩니다.`);
    return { job, warnings };
  },

  /** 자재·장비 예약 */
  reserveMaterial(s, p, ctx) {
    const job = getJob(s, p.id);
    requireStatus(job, [S.APPROVED, S.SCHEDULED, S.IN_PROGRESS], '자재를 예약');
    const m = getMaterial(s, p.materialId);
    if (!m) throw invalid('자재를 선택하세요.');
    const qty = Number(p.qty);
    if (!(qty > 0)) throw invalid('예약 수량은 0보다 커야 합니다.');
    requireForceReason(p);

    const dup = s.reservations.find((r) => r.jobId === job.id && r.materialId === m.id && r.status === 'active');
    if (dup && !p.force) {
      throw conflict('DUPLICATE_RESERVATION', `이 작업에 ${m.name}이(가) 이미 ${fmtQty(dup.qty)}${m.unit} 예약되어 있습니다. 수량을 변경하세요.`, { reservationId: dup.id, qty: dup.qty });
    }
    let issue = null;
    if (m.kind === 'equipment') {
      if (!job.schedule) throw badState('장비는 작업 일정이 정해진 뒤에 예약할 수 있습니다.');
      const window = { start: job.schedule.start, end: job.schedule.end };
      const overlapping = overlappingEquipment(s, m.id, window, { excludeJobId: job.id });
      const inUse = overlapping.reduce((sum, r) => sum + outstanding(r), 0);
      if (inUse + qty > m.stock) {
        issue = conflict('EQUIPMENT_BOOKED', `${m.name}(보유 ${m.stock}대)이(가) 같은 시간에 ${overlapping.map((r) => r.jobId).join(', ')} 작업에 예약되어 있습니다.`, { overlapping: overlapping.map((r) => ({ reservationId: r.id, jobId: r.jobId })), stock: m.stock });
      }
    } else {
      const av = materialAvailability(s, m.id);
      if (qty > av.available) {
        issue = conflict('INSUFFICIENT_STOCK', `${m.name} 가용 재고가 부족합니다 (보유 ${fmtQty(av.stock)}, 다른 작업 예약 ${fmtQty(av.reserved)}, 가용 ${fmtQty(Math.max(0, av.available))}${m.unit}).`, av);
      }
    }
    if (issue && !p.force) throw issue;

    const r = { id: ctx.id('R', 4), jobId: job.id, materialId: m.id, qty, usedQty: 0, status: 'active', createdAt: ctx.now, createdBy: ctx.actor, forced: !!(p.force && (issue || dup)), forceReason: p.force ? text(p.reason, 200) : '' };
    s.reservations.push(r);
    ctx.log(job.id, `자재 예약: ${m.name} ${fmtQty(qty)}${m.unit}${r.forced ? ` — 경고 무시(사유: ${r.forceReason})` : ''}`, r.forced ? 'warn' : 'info');
    return r;
  },

  adjustReservation(s, p, ctx) {
    const r = must(s.reservations, p.id, '예약');
    if (r.status !== 'active') throw badState('활성 예약만 수량을 바꿀 수 있습니다.');
    const m = getMaterial(s, r.materialId);
    const qty = Number(p.qty);
    if (!(qty > 0) || qty < r.usedQty) throw invalid(`수량은 이미 사용한 ${fmtQty(r.usedQty)}${m.unit} 이상이어야 합니다.`);
    requireForceReason(p);
    const delta = qty - r.qty;
    if (delta > 0 && m.kind !== 'equipment') {
      const av = materialAvailability(s, m.id);
      if (delta > av.available && !p.force) {
        throw conflict('INSUFFICIENT_STOCK', `${m.name} 가용 재고가 부족합니다 (가용 ${fmtQty(Math.max(0, av.available))}${m.unit}).`, av);
      }
    }
    const before = r.qty;
    r.qty = qty;
    if (p.force) { r.forced = true; r.forceReason = text(p.reason, 200); }
    ctx.log(r.jobId, `자재 예약 수량 변경: ${m.name} ${fmtQty(before)} → ${fmtQty(qty)}${m.unit}`);
    return r;
  },

  releaseReservation(s, p, ctx) {
    const r = must(s.reservations, p.id, '예약');
    if (r.status !== 'active') throw badState('이미 해제되었거나 사용 완료된 예약입니다.');
    r.status = 'released';
    r.releasedAt = ctx.now;
    ctx.log(r.jobId, `자재 예약 해제: ${getMaterial(s, r.materialId)?.name} ${fmtQty(outstanding(r))}`);
    return r;
  },

  startJob(s, p, ctx) {
    const job = getJob(s, p.id);
    requireStatus(job, [S.SCHEDULED], '작업을 시작');
    if (!approvedQuote(s, job.id)) throw badState('승인된 견적 없이 작업을 시작할 수 없습니다.');
    job.status = S.IN_PROGRESS;
    job.startedAt = ctx.now;
    touch(job, ctx);
    ctx.log(job.id, '작업 시작');
    return job;
  },

  /** 6단계: 자재 사용 기록 */
  recordUsage(s, p, ctx) {
    const job = getJob(s, p.id);
    requireStatus(job, [S.IN_PROGRESS, S.COMPLETED], '자재 사용을 기록');
    const m = getMaterial(s, p.materialId);
    if (!m) throw invalid('자재를 선택하세요.');
    const qty = Number(p.qty);
    if (!(qty > 0)) throw invalid('사용 수량은 0보다 커야 합니다.');
    let co = null;
    if (p.changeOrderId) {
      co = must(s.changeOrders, p.changeOrderId, '추가 작업');
      if (co.jobId !== job.id) throw invalid('다른 작업건의 추가 작업입니다.');
      if (co.status === 'canceled') throw badState('철회된 추가 작업에는 자재를 쓸 수 없습니다.');
    }
    if (m.kind !== 'equipment') {
      if (qty > m.stock && !p.force) throw conflict('INSUFFICIENT_STOCK', `${m.name} 재고(${fmtQty(m.stock)}${m.unit})보다 많이 사용할 수 없습니다. 입고를 먼저 기록하세요.`, { stock: m.stock });
      m.stock = Math.round((m.stock - qty) * 100) / 100;
    }
    // 이 작업의 활성 예약에서 먼저 차감한다.
    let left = qty;
    for (const r of s.reservations.filter((x) => x.jobId === job.id && x.materialId === m.id && x.status === 'active')) {
      const take = Math.min(left, outstanding(r));
      r.usedQty = Math.round((r.usedQty + take) * 100) / 100;
      left -= take;
      if (outstanding(r) <= 0) { r.status = 'consumed'; r.consumedAt = ctx.now; }
      if (left <= 0) break;
    }
    const usage = { id: ctx.id('U', 4), jobId: job.id, materialId: m.id, qty, changeOrderId: co?.id || null, at: ctx.now, by: ctx.actor, note: text(p.note, 200) };
    s.usages.push(usage);

    const warnings = [];
    if (co && !['approved', 'waived'].includes(co.status)) {
      co.performed = true;
      co.performedAt = co.performedAt || ctx.now;
      warnings.push(`추가 작업 "${co.title}"이(가) 아직 고객 승인 전입니다. 승인을 받아야 청구할 수 있습니다.`);
    }
    const excess = excessUsage(s, job.id).find((e) => e.materialId === m.id);
    if (excess) warnings.push(`${m.name} 사용량이 승인 수량을 ${fmtQty(excess.excess)}${m.unit} 초과했습니다. 추가 작업 승인을 받으세요.`);
    ctx.log(job.id, `자재 사용: ${m.name} ${fmtQty(qty)}${m.unit}${co ? ` (추가 작업: ${co.title})` : ''}`, warnings.length ? 'warn' : 'info');
    return { usage, warnings };
  },

  /** 추가 작업 요청 (현장에서 발견된 작업) */
  requestChangeOrder(s, p, ctx) {
    const job = getJob(s, p.id);
    requireStatus(job, [S.SCHEDULED, S.IN_PROGRESS], '추가 작업을 요청');
    const items = normalizeItems(s, p.items || []);
    const co = {
      id: ctx.id('CO', 3), jobId: job.id,
      title: requireText(p.title, '추가 작업명', 60),
      reason: text(p.reason, 500),
      items, status: 'requested', requestedAt: ctx.now, requestedBy: ctx.actor,
      token: ctx.token(), approval: null, performed: false,
    };
    s.changeOrders.push(co);
    ctx.log(job.id, `추가 작업 요청: ${co.title} ${won(totals(items).total)} — 고객 승인 필요`, 'warn');
    return co;
  },

  /** 승인 근거 없는 초과 자재 사용분을 추가 작업으로 전환 */
  changeOrderFromExcess(s, p, ctx) {
    const job = getJob(s, p.id);
    const excess = excessUsage(s, job.id);
    if (!excess.length) throw badState('승인 수량을 초과한 자재가 없습니다.');
    if (![S.SCHEDULED, S.IN_PROGRESS, S.COMPLETED].includes(job.status)) throw badState(`'${STATUS_LABEL[job.status]}' 상태에서는 추가 작업을 만들 수 없습니다.`);
    const items = normalizeItems(s, excess.map((e) => ({ materialId: e.materialId, qty: e.excess })));
    const co = {
      id: ctx.id('CO', 3), jobId: job.id,
      title: text(p.title, 60) || '견적 초과 자재 사용분',
      reason: text(p.reason, 500) || excess.map((e) => `${e.name} 승인 ${fmtQty(e.covered)} → 사용 ${fmtQty(e.used)}${e.unit}`).join(', '),
      items, status: 'requested', requestedAt: ctx.now, requestedBy: ctx.actor,
      token: ctx.token(), approval: null, performed: true, performedAt: ctx.now,
    };
    s.changeOrders.push(co);
    ctx.log(job.id, `초과 사용분 추가 작업 생성: ${won(totals(items).total)} — 고객 승인 필요`, 'warn');
    return co;
  },

  approveChangeOrder(s, p, ctx) {
    const co = must(s.changeOrders, p.id, '추가 작업');
    if (!['requested', 'rejected'].includes(co.status)) throw badState(`'${co.status}' 상태의 추가 작업은 승인할 수 없습니다.`);
    const job = getJob(s, co.jobId);
    if ([S.INVOICED, S.PAID, S.CANCELED].includes(job.status)) throw badState('청구가 끝났거나 취소된 작업의 추가 작업은 승인할 수 없습니다. 청구서를 취소한 뒤 다시 시도하세요.');
    co.approval = normalizeApproval(p, ctx);
    co.status = 'approved';
    ctx.log(co.jobId, `추가 작업 고객 승인: ${co.title} ${won(totals(co.items).total)} (${co.approval.method}, ${co.approval.by})`);
    return co;
  },

  approveChangeOrderByToken(s, p, ctx) {
    const co = s.changeOrders.find((c) => c.token && c.token === p.token);
    if (!co) throw notFound('추가 작업 링크', '만료되었거나 잘못된 링크');
    if (co.status !== 'requested') throw badState('이미 처리된 추가 작업 요청입니다.');
    return commands.approveChangeOrder(s, { id: co.id, by: p.name, method: '고객 링크 서명', signature: p.signature }, { ...ctx, actor: `고객(${text(p.name, 20)})` });
  },

  rejectChangeOrder(s, p, ctx) {
    const co = must(s.changeOrders, p.id, '추가 작업');
    if (co.status !== 'requested') throw badState('승인 대기 중인 요청만 거절 처리할 수 있습니다.');
    co.status = 'rejected';
    co.rejectReason = text(p.reason, 300);
    co.rejectedAt = ctx.now;
    ctx.log(co.jobId, `추가 작업 고객 거절: ${co.title}${coPerformed(s, co) ? ' — 이미 수행됨! 무상 처리 필요' : ''}`, 'warn');
    return co;
  },

  rejectChangeOrderByToken(s, p, ctx) {
    const co = s.changeOrders.find((c) => c.token && c.token === p.token);
    if (!co) throw notFound('추가 작업 링크', '만료되었거나 잘못된 링크');
    return commands.rejectChangeOrder(s, { id: co.id, reason: p.reason }, { ...ctx, actor: '고객' });
  },

  cancelChangeOrder(s, p, ctx) {
    const co = must(s.changeOrders, p.id, '추가 작업');
    if (co.status !== 'requested') throw badState('승인 대기 중인 요청만 철회할 수 있습니다.');
    if (coPerformed(s, co)) throw badState('이미 수행된 추가 작업은 철회할 수 없습니다. 고객 승인을 받거나 무상 처리하세요.');
    co.status = 'canceled';
    ctx.log(co.jobId, `추가 작업 요청 철회: ${co.title}`);
    return co;
  },

  performChangeOrder(s, p, ctx) {
    const co = must(s.changeOrders, p.id, '추가 작업');
    if (!['requested', 'approved'].includes(co.status)) throw badState(`'${co.status}' 상태의 추가 작업은 수행 처리할 수 없습니다.`);
    const job = getJob(s, co.jobId);
    requireStatus(job, [S.IN_PROGRESS], '추가 작업을 수행');
    co.performed = true;
    co.performedAt = ctx.now;
    co.performNote = text(p.note, 300);
    const unapproved = co.status !== 'approved';
    ctx.log(co.jobId, `추가 작업 수행: ${co.title}${unapproved ? ' — 고객 승인 없이 수행됨' : ''}`, unapproved ? 'warn' : 'info');
    return { changeOrder: co, warnings: unapproved ? ['고객 승인 없이 추가 작업을 수행했습니다. 승인 누락으로 표시됩니다.'] : [] };
  },

  waiveChangeOrder(s, p, ctx) {
    const co = must(s.changeOrders, p.id, '추가 작업');
    if (!['requested', 'rejected', 'approved'].includes(co.status)) throw badState('이 추가 작업은 무상 처리할 수 없습니다.');
    const job = getJob(s, co.jobId);
    if ([S.INVOICED, S.PAID].includes(job.status)) throw badState('청구가 끝난 작업입니다.');
    co.status = 'waived';
    co.waiveReason = requireText(p.reason, '무상 처리 사유', 300);
    co.waivedAt = ctx.now;
    co.waivedBy = ctx.actor;
    ctx.log(co.jobId, `추가 작업 무상 처리: ${co.title} ${won(totals(co.items).total)} — ${co.waiveReason}`, 'warn');
    return co;
  },

  /** 7단계 ①: 작업 완료 */
  completeJob(s, p, ctx) {
    const job = getJob(s, p.id);
    requireStatus(job, [S.IN_PROGRESS], '작업을 완료');
    const cos = changeOrdersOf(s, job.id);
    const unapproved = cos.filter((c) => coPerformed(s, c) && !['approved', 'waived'].includes(c.status));
    if (unapproved.length) {
      throw conflict('UNAPPROVED_CHANGE_ORDER', `고객 승인 없이 수행된 추가 작업이 있습니다: ${unapproved.map((c) => c.title).join(', ')}. 고객 승인을 받거나 무상 처리해야 완료할 수 있습니다.`, { changeOrders: unapproved.map((c) => c.id) });
    }
    const pending = cos.filter((c) => c.status === 'requested');
    if (pending.length) {
      throw conflict('PENDING_CHANGE_ORDER', `처리되지 않은 추가 작업 요청이 있습니다: ${pending.map((c) => c.title).join(', ')}. 승인받거나 철회하세요.`, { changeOrders: pending.map((c) => c.id) });
    }
    const excess = excessUsage(s, job.id);
    if (excess.length) {
      throw conflict('UNAPPROVED_EXCESS_USAGE', `승인 수량을 넘겨 사용한 자재가 있습니다: ${excess.map((e) => `${e.name} +${fmtQty(e.excess)}${e.unit}`).join(', ')}. 초과분을 추가 작업으로 만들어 승인받거나 무상 처리하세요.`, { excess });
    }
    cos.filter((c) => c.status === 'approved' && !c.performed).forEach((c) => { c.performed = true; c.performedAt = ctx.now; });
    const released = [];
    reservationsOf(s, job.id).filter((r) => r.status === 'active').forEach((r) => {
      r.status = 'released';
      r.releasedAt = ctx.now;
      released.push(`${getMaterial(s, r.materialId)?.name} ${fmtQty(outstanding(r))}`);
    });
    job.status = S.COMPLETED;
    job.completedAt = ctx.now;
    job.completionNote = text(p.note, 500);
    touch(job, ctx);
    ctx.log(job.id, `작업 완료${released.length ? ` — 미사용 예약 해제: ${released.join(', ')}` : ''}`);
    return job;
  },

  cancelJob(s, p, ctx) {
    const job = getJob(s, p.id);
    if ([S.COMPLETED, S.INVOICED, S.PAID, S.CANCELED].includes(job.status)) throw badState('완료되었거나 이미 취소된 작업입니다.');
    if (job.status === S.IN_PROGRESS && s.usages.some((u) => u.jobId === job.id)) throw badState('자재를 사용한 작업은 취소할 수 없습니다. 작업을 완료 처리하고 정산하세요.');
    reservationsOf(s, job.id).filter((r) => r.status === 'active').forEach((r) => { r.status = 'released'; r.releasedAt = ctx.now; });
    job.status = S.CANCELED;
    job.canceledReason = requireText(p.reason, '취소 사유', 300);
    touch(job, ctx);
    ctx.log(job.id, `작업 취소 — ${job.canceledReason}`, 'warn');
    return job;
  },

  /** 7단계 ②: 청구서 발행. 기본은 승인 견적 + 승인 추가 작업을 자동으로 모두 포함한다. */
  issueInvoice(s, p, ctx) {
    const job = getJob(s, p.id);
    requireStatus(job, [S.COMPLETED], '청구서를 발행');
    if (activeInvoice(s, job.id)) throw badState('이미 발행된 청구서가 있습니다. 기존 청구서를 취소한 뒤 다시 발행하세요.');
    const basis = billingBasis(s, job.id);
    if (!basis.lines.length) throw badState('청구 근거(승인 견적)가 없습니다.');
    const exclude = new Set(p.excludeRefs || []);
    let items = basis.lines.filter((l) => !exclude.has(l.refId)).map((l, i) => ({ ...l, id: `L${i + 1}` }));
    const extra = normalizeItems(s, p.extraItems || [], { allowEmpty: true }).map((it, i) => ({ ...it, id: `X${i + 1}`, source: 'manual', refId: null, group: '추가 청구' }));
    items = items.concat(extra);
    const missing = basis.lines.filter((l) => exclude.has(l.refId));
    const omissionReason = text(p.omissionReason, 300);
    if (missing.length && !omissionReason) {
      throw conflict('BILLING_OMISSION', `승인된 항목 ${missing.length}건(${won(totals(missing).total)})이 청구서에서 빠졌습니다. 제외하려면 사유를 입력하세요.`, { missing });
    }
    const settings = settingsOf(s);
    const dueDays = Number(p.dueDays) > 0 ? Number(p.dueDays) : settings.paymentDueDays;
    const seq = ctx.seq(`INV${monthOf(ctx.now)}`);
    const inv = {
      id: `INV-${ctx.now.slice(2, 4)}${ctx.now.slice(5, 7)}-${String(seq).padStart(3, '0')}`,
      jobId: job.id, items, issuedAt: ctx.now, dueDate: dateOf(addDays(ctx.now, dueDays)),
      status: 'issued', payments: [], note: text(p.note, 300), omissionReason: missing.length ? omissionReason : '',
    };
    s.invoices.push(inv);
    job.status = S.INVOICED;
    touch(job, ctx);
    ctx.log(job.id, `청구서 ${inv.id} 발행 ${won(totals(items).total)}${missing.length ? ` — 승인 항목 ${missing.length}건 제외(사유: ${omissionReason})` : ''}`, missing.length ? 'warn' : 'info');
    return inv;
  },

  recordPayment(s, p, ctx) {
    const inv = must(s.invoices, p.id, '청구서');
    if (!['issued', 'partial'].includes(inv.status)) throw badState('수금할 수 없는 청구서입니다.');
    const amount = Math.round(Number(p.amount));
    const { balance } = invoiceTotals(inv);
    if (!(amount > 0)) throw invalid('수금액을 입력하세요.');
    if (amount > balance) throw new DomainError('OVERPAYMENT', `잔액(${won(balance)})보다 많이 입금 처리할 수 없습니다.`, { status: 400, details: { balance } });
    const method = PAYMENT_METHODS.includes(p.method) ? p.method : '계좌이체';
    inv.payments.push({ id: ctx.id('P', 4), amount, method, at: ctx.now, by: ctx.actor });
    const job = getJob(s, inv.jobId);
    if (amount === balance) {
      inv.status = 'paid';
      inv.paidAt = ctx.now;
      job.status = S.PAID;
      job.closedAt = ctx.now;
    } else {
      inv.status = 'partial';
    }
    touch(job, ctx);
    ctx.log(inv.jobId, `수금 ${won(amount)} (${method})${inv.status === 'paid' ? ' — 정산 완료' : ` — 잔액 ${won(balance - amount)}`}`);
    return inv;
  },

  voidInvoice(s, p, ctx) {
    const inv = must(s.invoices, p.id, '청구서');
    if (inv.status !== 'issued') throw badState('수금 기록이 없는 청구서만 취소할 수 있습니다.');
    inv.status = 'void';
    inv.voidReason = requireText(p.reason, '취소 사유', 300);
    const job = getJob(s, inv.jobId);
    job.status = S.COMPLETED;
    touch(job, ctx);
    ctx.log(inv.jobId, `청구서 ${inv.id} 취소 — ${inv.voidReason}`, 'warn');
    return inv;
  },

  stockIn(s, p, ctx) {
    const m = must(s.materials, p.id, '자재');
    const qty = Number(p.qty);
    if (!(qty > 0)) throw invalid('입고 수량은 0보다 커야 합니다.');
    m.stock = Math.round((m.stock + qty) * 100) / 100;
    ctx.log(null, `입고: ${m.name} +${fmtQty(qty)}${m.unit} (재고 ${fmtQty(m.stock)})`);
    return m;
  },

  acknowledgeFinding(s, p, ctx) {
    const key = requireText(p.key, '항목 키', 200);
    const f = detectFindings(s, ctx.now).find((x) => x.key === key);
    if (!f) throw notFound('점검 항목', key);
    if (f.severity === 'critical') throw badState('긴급 항목은 확인 처리할 수 없습니다. 원인을 해결하세요.');
    s.acks[key] = { by: ctx.actor, at: ctx.now, memo: requireText(p.memo, '확인 메모', 200) };
    ctx.log(f.jobIds?.[0] || null, `점검 항목 확인 처리: ${f.title} — ${s.acks[key].memo}`);
    return s.acks[key];
  },
};

export const COMMAND_NAMES = Object.keys(commands);
export { coTotals, find };
