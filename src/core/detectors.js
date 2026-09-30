// 누락·충돌 탐지 엔진.
// 4대 위험(추가 작업 승인 누락 / 자재 중복 예약 / 작업팀 일정 충돌 / 청구 누락)을
// 현재 상태에서 매번 새로 계산한다. 저장된 플래그에 의존하지 않으므로 데이터를
// 직접 고치거나 이관한 경우에도 빠짐없이 잡아낸다.
import { S, CATEGORIES, SEVERITY_RANK, STRONG_APPROVAL, CO_STATUS_LABEL } from './constants.js';
import {
  find, getCrew, getMaterial, approvedQuote, activeInvoice, outstanding,
  reservationWindow, excessUsage, billingBasis, missingBillingLines, crewBookings, sharedMembers,
  coPerformed, invoiceTotals, settingsOf,
} from './model.js';
import { totals, won, fmtQty, withVat } from './money.js';
import { overlaps, parseWall, minutesBetween, hoursBetween, daysBetween, dateOf, fmtRange, fmtDateTime } from './time.js';

const jobLink = (jobId, tab) => `#/jobs/${jobId}${tab ? `/${tab}` : ''}`;

function finding(f) {
  return { amount: 0, jobIds: [], ...f };
}

// ─── ① 추가 작업 승인 누락 ────────────────────────────────

function approvalFindings(s, now, out) {
  const settings = settingsOf(s);
  for (const co of s.changeOrders) {
    const job = find(s.jobs, co.jobId);
    if (!job || job.status === S.CANCELED) continue;
    const amount = totals(co.items).total;
    const performed = coPerformed(s, co);

    if (performed && !['approved', 'waived'].includes(co.status)) {
      out.push(finding({
        key: `APPROVAL:CO_UNAPPROVED:${co.id}`, category: 'APPROVAL', code: 'CO_PERFORMED_UNAPPROVED', severity: 'critical',
        title: co.status === 'rejected' ? `고객이 거절한 추가 작업이 이미 수행됨: ${co.title}` : `승인 없이 수행된 추가 작업: ${co.title}`,
        detail: `${job.id} ${job.title} · 상태 '${CO_STATUS_LABEL[co.status]}' · ${won(amount)}. 고객 승인 기록이 없으면 청구할 수 없고 분쟁 위험이 있습니다.`,
        jobIds: [job.id], refs: [co.id], amount,
        fix: { label: co.status === 'rejected' ? '무상 처리 또는 재승인' : '고객 승인 받기', href: jobLink(job.id, 'change') },
      }));
    } else if (co.status === 'requested' && !performed && hoursBetween(co.requestedAt, now) >= settings.approvalDelayHours) {
      out.push(finding({
        key: `APPROVAL:CO_DELAYED:${co.id}`, category: 'APPROVAL', code: 'CO_APPROVAL_DELAYED', severity: 'warning',
        title: `추가 작업 고객 승인 ${Math.floor(hoursBetween(co.requestedAt, now))}시간째 대기: ${co.title}`,
        detail: `${job.id} ${job.title} · ${won(amount)}. 승인 전에 작업하면 승인 누락이 됩니다. 고객에게 다시 연락하세요.`,
        jobIds: [job.id], refs: [co.id], amount: 0,
        fix: { label: '승인 링크 재전송', href: jobLink(job.id, 'change') },
      }));
    }

    if (co.status === 'approved' && co.approval && !STRONG_APPROVAL.includes(co.approval.method) && amount >= settings.weakApprovalAmount) {
      out.push(finding({
        key: `APPROVAL:WEAK_EVIDENCE:${co.id}`, category: 'APPROVAL', code: 'WEAK_APPROVAL_EVIDENCE', severity: 'info',
        title: `고액 추가 작업이 구두로만 승인됨: ${co.title}`,
        detail: `${job.id} · ${won(amount)} · ${co.approval.by}(${co.approval.method}). 문자 회신이나 서명으로 증빙을 남기면 분쟁을 막을 수 있습니다.`,
        jobIds: [job.id], refs: [co.id], amount: 0,
        fix: { label: '증빙 확인', href: jobLink(job.id, 'change') },
      }));
    }
  }

  for (const job of s.jobs) {
    if (job.status === S.CANCELED) continue;
    const started = [S.SCHEDULED, S.IN_PROGRESS, S.COMPLETED, S.INVOICED, S.PAID].includes(job.status);
    if (started && !approvedQuote(s, job.id)) {
      out.push(finding({
        key: `APPROVAL:NO_QUOTE:${job.id}`, category: 'APPROVAL', code: 'WORK_WITHOUT_APPROVED_QUOTE', severity: 'critical',
        title: `승인된 견적 없이 진행 중인 작업: ${job.title}`,
        detail: `${job.id} · 고객이 승인한 금액이 없어 청구 근거가 없습니다.`,
        jobIds: [job.id], refs: [], fix: { label: '견적 승인 받기', href: jobLink(job.id, 'quote') },
      }));
    }
    for (const e of excessUsage(s, job.id)) {
      const done = [S.COMPLETED, S.INVOICED, S.PAID].includes(job.status);
      const amount = withVat(Math.round(e.excess * e.unitPrice));
      out.push(finding({
        key: `APPROVAL:EXCESS:${job.id}:${e.materialId}`, category: 'APPROVAL', code: 'EXCESS_USAGE_UNAPPROVED', severity: done ? 'critical' : 'warning',
        title: `견적보다 많이 쓴 자재 — 추가 작업 승인 없음: ${e.name}`,
        detail: `${job.id} ${job.title} · 승인 ${fmtQty(e.covered)}${e.unit} / 사용 ${fmtQty(e.used)}${e.unit} (초과 ${fmtQty(e.excess)}${e.unit}, ${won(amount)}).`,
        jobIds: [job.id], refs: [e.materialId], amount,
        fix: { label: '초과분 추가 작업 만들기', href: jobLink(job.id, 'change') },
      }));
    }
  }
}

// ─── ② 자재 중복 예약 ────────────────────────────────────

function materialFindings(s, now, out) {
  const active = s.reservations.filter((r) => r.status === 'active');
  for (const m of s.materials) {
    const rs = active.filter((r) => r.materialId === m.id);
    if (!rs.length) continue;
    if (m.kind === 'equipment') {
      // 시간대별 동시 사용 대수 > 보유 대수 인 구간을 찾는다 (스윕 라인).
      const withWin = rs.map((r) => ({ r, w: reservationWindow(s, r) })).filter((x) => x.w);
      const points = [];
      withWin.forEach((x) => {
        points.push({ t: parseWall(x.w.start), d: +1, x });
        points.push({ t: parseWall(x.w.end), d: -1, x });
      });
      points.sort((a, b) => a.t - b.t || a.d - b.d);
      const open = new Set();
      const clusters = new Map();
      for (const pt of points) {
        if (pt.d > 0) open.add(pt.x); else open.delete(pt.x);
        const units = [...open].reduce((sum, x) => sum + outstanding(x.r), 0);
        if (pt.d > 0 && units > m.stock) {
          const ids = [...open].map((x) => x.r.id).sort();
          clusters.set(ids.join(','), [...open]);
        }
      }
      // 더 큰 묶음에 포함되는 묶음은 합친다.
      const keys = [...clusters.keys()];
      for (const k of keys) {
        const ids = k.split(',');
        const covered = keys.some((o) => o !== k && o.split(',').length > ids.length && ids.every((id) => o.split(',').includes(id)));
        if (covered) continue;
        const group = clusters.get(k);
        const jobIds = [...new Set(group.map((x) => x.r.jobId))];
        out.push(finding({
          key: `MATERIAL:EQUIP:${m.id}:${k}`, category: 'MATERIAL', code: 'EQUIPMENT_DOUBLE_BOOKED', severity: 'critical',
          title: `장비 이중 예약: ${m.name} (보유 ${m.stock}대)`,
          detail: group.map((x) => `${x.r.jobId} ${fmtRange(x.w.start, x.w.end)}`).join(' / ') + ' — 같은 시간에 필요한 대수가 보유 대수보다 많습니다.',
          jobIds, refs: group.map((x) => x.r.id),
          fix: { label: '예약·일정 조정', href: '#/materials' },
        }));
      }
    } else {
      const reserved = rs.reduce((sum, r) => sum + outstanding(r), 0);
      if (reserved > m.stock + 1e-9) {
        const byJob = new Map();
        rs.forEach((r) => byJob.set(r.jobId, (byJob.get(r.jobId) || 0) + outstanding(r)));
        out.push(finding({
          key: `MATERIAL:OVERBOOK:${m.id}`, category: 'MATERIAL', code: 'STOCK_OVERBOOKED', severity: 'critical',
          title: `같은 재고를 여러 작업에 중복 예약: ${m.name}`,
          detail: `보유 ${fmtQty(m.stock)}${m.unit} · 예약 합계 ${fmtQty(reserved)}${m.unit} (${[...byJob].map(([j, q]) => `${j} ${fmtQty(q)}`).join(', ')}) — ${fmtQty(reserved - m.stock)}${m.unit} 부족.`,
          jobIds: [...byJob.keys()], refs: rs.map((r) => r.id),
          fix: { label: '입고 또는 예약 조정', href: '#/materials' },
        }));
      } else if (m.safety && m.stock - reserved < m.safety) {
        out.push(finding({
          key: `MATERIAL:LOW:${m.id}`, category: 'MATERIAL', code: 'LOW_AVAILABLE_STOCK', severity: 'info',
          title: `가용 재고가 안전 재고보다 적음: ${m.name}`,
          detail: `가용 ${fmtQty(m.stock - reserved)}${m.unit} / 안전 재고 ${fmtQty(m.safety)}${m.unit}. 다음 예약 전에 발주하세요.`,
          jobIds: [], refs: [m.id], fix: { label: '입고 기록', href: '#/materials' },
        }));
      }
    }
  }

  // 같은 작업에 같은 자재가 두 번 이상 예약됨
  const groups = new Map();
  active.forEach((r) => {
    const k = `${r.jobId}|${r.materialId}`;
    groups.set(k, [...(groups.get(k) || []), r]);
  });
  for (const [k, rs] of groups) {
    if (rs.length < 2) continue;
    const [jobId, materialId] = k.split('|');
    const m = getMaterial(s, materialId);
    out.push(finding({
      key: `MATERIAL:DUP:${jobId}:${materialId}`, category: 'MATERIAL', code: 'DUPLICATE_RESERVATION', severity: 'warning',
      title: `같은 작업에 같은 자재가 ${rs.length}번 예약됨: ${m?.name}`,
      detail: `${jobId} · ${rs.map((r) => `${r.id} ${fmtQty(outstanding(r))}${m?.unit || ''}`).join(', ')} — 한 건으로 합치지 않으면 재고가 이중으로 묶입니다.`,
      jobIds: [jobId], refs: rs.map((r) => r.id), fix: { label: '예약 정리', href: jobLink(jobId, 'material') },
    }));
  }

  // 끝난 작업에 남은 예약 (재고를 계속 묶어 둠)
  for (const r of active) {
    const job = find(s.jobs, r.jobId);
    if (job && [S.COMPLETED, S.INVOICED, S.PAID, S.CANCELED].includes(job.status)) {
      const m = getMaterial(s, r.materialId);
      out.push(finding({
        key: `MATERIAL:ORPHAN:${r.id}`, category: 'MATERIAL', code: 'ORPHAN_RESERVATION', severity: 'warning',
        title: `종료된 작업의 예약이 재고를 묶고 있음: ${m?.name}`,
        detail: `${job.id}(${job.title}) · ${fmtQty(outstanding(r))}${m?.unit || ''} 예약이 해제되지 않았습니다.`,
        jobIds: [job.id], refs: [r.id], fix: { label: '예약 해제', href: jobLink(job.id, 'material') },
      }));
    }
  }
}

// ─── ③ 작업팀 일정 충돌 ──────────────────────────────────

function scheduleFindings(s, now, out) {
  const settings = settingsOf(s);
  const bookings = crewBookings(s).sort((a, b) => parseWall(a.start) - parseWall(b.start));
  const label = (b) => `${b.jobId} ${b.kind === 'survey' ? '현장 확인' : '작업'} ${fmtRange(b.start, b.end)}`;

  for (let i = 0; i < bookings.length; i += 1) {
    for (let j = i + 1; j < bookings.length; j += 1) {
      const a = bookings[i];
      const b = bookings[j];
      if (!overlaps(a, b)) continue;
      if (a.crewId === b.crewId) {
        const crew = getCrew(s, a.crewId);
        out.push(finding({
          key: `SCHEDULE:CREW:${a.id}|${b.id}`, category: 'SCHEDULE', code: 'CREW_DOUBLE_BOOKED', severity: 'critical',
          title: `${crew?.name || a.crewId} 일정 충돌 (${fmtDateTime(a.start)})`,
          detail: `${label(a)} ↔ ${label(b)} — 한 팀이 같은 시간에 두 현장에 배정되었습니다.`,
          jobIds: [a.jobId, b.jobId], refs: [a.id, b.id], fix: { label: '일정 재배정', href: `#/schedule?d=${dateOf(a.start)}` },
        }));
      } else {
        const shared = sharedMembers(getCrew(s, a.crewId), getCrew(s, b.crewId));
        if (shared.length) {
          out.push(finding({
            key: `SCHEDULE:MEMBER:${a.id}|${b.id}`, category: 'SCHEDULE', code: 'MEMBER_DOUBLE_BOOKED', severity: 'critical',
            title: `인원 중복 배정: ${shared.join(', ')} (${fmtDateTime(a.start)})`,
            detail: `${getCrew(s, a.crewId)?.name} ${label(a)} ↔ ${getCrew(s, b.crewId)?.name} ${label(b)} — 두 팀에 모두 속한 인원이 동시에 필요합니다.`,
            jobIds: [a.jobId, b.jobId], refs: [a.id, b.id], fix: { label: '일정 재배정', href: `#/schedule?d=${dateOf(a.start)}` },
          }));
        }
      }
    }
  }

  // 같은 팀 연속 일정 사이 이동 시간 부족
  const byCrew = new Map();
  bookings.forEach((b) => byCrew.set(b.crewId, [...(byCrew.get(b.crewId) || []), b]));
  for (const [crewId, list] of byCrew) {
    for (let i = 0; i + 1 < list.length; i += 1) {
      const a = list[i];
      const b = list[i + 1];
      if (dateOf(a.start) !== dateOf(b.start) || a.address === b.address) continue;
      const gap = minutesBetween(a.end, b.start);
      if (gap >= 0 && gap < settings.travelBufferMin) {
        out.push(finding({
          key: `SCHEDULE:TRAVEL:${a.id}|${b.id}`, category: 'SCHEDULE', code: 'TRAVEL_TIME_SHORT', severity: 'warning',
          title: `${getCrew(s, crewId)?.name} 이동 시간 ${gap}분 (${fmtDateTime(b.start)})`,
          detail: `${label(a)} → ${label(b)} — 다른 현장으로 이동하는 데 최소 ${settings.travelBufferMin}분이 필요합니다.`,
          jobIds: [a.jobId, b.jobId], refs: [a.id, b.id], fix: { label: '일정 조정', href: `#/schedule?d=${dateOf(a.start)}` },
        }));
      }
    }
  }

  // 일정이 지났는데 처리 기록이 없음
  for (const b of bookings) {
    if (parseWall(b.end) >= parseWall(now)) continue;
    const job = find(s.jobs, b.jobId);
    if (b.kind === 'work' && job.status !== S.SCHEDULED) continue;
    out.push(finding({
      key: `SCHEDULE:ELAPSED:${b.id}`, category: 'SCHEDULE', code: 'SCHEDULE_ELAPSED', severity: 'warning',
      title: `지난 일정인데 ${b.kind === 'survey' ? '현장 확인 결과' : '작업 시작'} 기록 없음: ${job.title}`,
      detail: `${label(b)} · ${getCrew(s, b.crewId)?.name}. 현장에서 처리했다면 기록하고, 못 갔다면 일정을 다시 잡으세요.`,
      jobIds: [b.jobId], refs: [b.id], fix: { label: '기록하기', href: jobLink(b.jobId) },
    }));
  }
}

// ─── ④ 청구 누락 ─────────────────────────────────────────

function billingFindings(s, now, out) {
  const settings = settingsOf(s);
  for (const job of s.jobs) {
    if (job.status === S.COMPLETED && !activeInvoice(s, job.id)) {
      const days = daysBetween(job.completedAt, now);
      if (days < settings.invoiceGraceDays) continue;
      const basis = billingBasis(s, job.id);
      out.push(finding({
        key: `BILLING:NOT_INVOICED:${job.id}`, category: 'BILLING', code: 'COMPLETED_NOT_INVOICED',
        severity: days >= settings.invoiceCriticalDays ? 'critical' : 'warning',
        title: `작업 완료 ${Math.floor(days)}일째 청구서 미발행: ${job.title}`,
        detail: `${job.id} · 완료 ${fmtDateTime(job.completedAt)} · 청구 예정 ${won(basis.total)}.`,
        jobIds: [job.id], refs: [], amount: basis.total, fix: { label: '청구서 발행', href: jobLink(job.id, 'billing') },
      }));
    }
  }

  for (const inv of s.invoices) {
    if (inv.status === 'void') continue;
    const job = find(s.jobs, inv.jobId);
    if (!job) continue;
    const missing = missingBillingLines(s, inv);
    const byCo = new Map();
    const quoteLines = [];
    missing.forEach((l) => {
      if (l.source === 'change') byCo.set(l.changeOrderId, [...(byCo.get(l.changeOrderId) || []), l]);
      else quoteLines.push(l);
    });
    const acknowledged = !!inv.omissionReason;
    for (const [coId, lines] of byCo) {
      const co = find(s.changeOrders, coId);
      const amount = totals(lines).total;
      out.push(finding({
        key: `BILLING:CO_NOT_BILLED:${inv.id}:${coId}`, category: 'BILLING', code: 'APPROVED_CO_NOT_BILLED',
        severity: acknowledged ? 'warning' : 'critical',
        title: `승인된 추가 작업이 청구서에서 빠짐: ${co?.title}`,
        detail: `${job.id} · 청구서 ${inv.id}에 ${won(amount)}이(가) 없습니다.${acknowledged ? ` 제외 사유: ${inv.omissionReason}` : ''}`,
        jobIds: [job.id], refs: [inv.id, coId], amount, fix: { label: '추가 청구', href: jobLink(job.id, 'billing') },
      }));
    }
    // 견적 항목 누락 또는 금액 축소
    const basis = billingBasis(s, job.id);
    const billed = totals(inv.items);
    const coMissingSupply = [...byCo.values()].flat().reduce((sum, l) => sum + Math.round(l.qty * l.unitPrice), 0);
    const shortSupply = basis.supply - billed.supply - coMissingSupply;
    if (shortSupply > 0 || quoteLines.length) {
      const amount = withVat(Math.max(shortSupply, 0));
      out.push(finding({
        key: `BILLING:UNDER_BILLED:${inv.id}`, category: 'BILLING', code: 'UNDER_BILLED',
        severity: acknowledged ? 'warning' : 'critical',
        title: `청구액이 승인 금액보다 적음: ${job.title}`,
        detail: `${job.id} · 승인 ${won(basis.total)} / 청구 ${won(billed.total)}${quoteLines.length ? ` · 빠진 견적 항목: ${quoteLines.map((l) => l.name).join(', ')}` : ''}.${acknowledged ? ` 제외 사유: ${inv.omissionReason}` : ''}`,
        jobIds: [job.id], refs: [inv.id], amount, fix: { label: '청구서 확인', href: jobLink(job.id, 'billing') },
      }));
    }
    // 미수금 연체
    const t = invoiceTotals(inv);
    if (['issued', 'partial'].includes(inv.status) && t.balance > 0 && inv.dueDate < dateOf(now)) {
      const overdue = Math.floor(daysBetween(inv.dueDate, dateOf(now)));
      out.push(finding({
        key: `BILLING:OVERDUE:${inv.id}`, category: 'BILLING', code: 'OVERDUE_RECEIVABLE',
        severity: overdue >= settings.overdueCriticalDays ? 'critical' : 'warning',
        title: `미수금 ${overdue}일 연체: ${job.title}`,
        detail: `${inv.id} · 잔액 ${won(t.balance)} · 납기 ${inv.dueDate}. 수금 확인 후 입금 기록을 남기세요.`,
        jobIds: [job.id], refs: [inv.id], amount: t.balance, fix: { label: '수금 기록', href: jobLink(job.id, 'billing') },
      }));
    }
  }
}

// ─── 공개 API ────────────────────────────────────────────

export function detectFindings(s, now) {
  const out = [];
  approvalFindings(s, now, out);
  materialFindings(s, now, out);
  scheduleFindings(s, now, out);
  billingFindings(s, now, out);
  const order = Object.fromEntries(CATEGORIES.map((c, i) => [c.key, i]));
  return out
    .map((f) => ({ ...f, acked: f.severity !== 'critical' && !!s.acks?.[f.key], ack: s.acks?.[f.key] || null }))
    .sort((a, b) => (a.acked - b.acked) || (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) || (order[a.category] - order[b.category]) || (b.amount - a.amount));
}

export function summarizeFindings(findings) {
  const open = findings.filter((f) => !f.acked);
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c.key, { ...c, count: 0, critical: 0, amount: 0 }]));
  open.forEach((f) => {
    const c = byCategory[f.category];
    c.count += 1;
    if (f.severity === 'critical') c.critical += 1;
    c.amount += f.amount || 0;
  });
  return {
    total: open.length,
    critical: open.filter((f) => f.severity === 'critical').length,
    amount: open.reduce((sum, f) => sum + (f.amount || 0), 0),
    byCategory,
  };
}

export const findingsForJob = (findings, jobId) => findings.filter((f) => f.jobIds.includes(jobId));
