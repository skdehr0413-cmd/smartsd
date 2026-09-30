// 정산: 월별 청구·수금·미수·원가·이익, 청구 대기와 청구 누락
import { html, won, fmtDate, fmtDateTime, findingAlert, empty } from '../ui.js';
import { settlement } from '../../core/views.js';
import { INVOICE_STATUS_LABEL } from '../../core/constants.js';
import { daysBetween } from '../../core/time.js';

const pct = (x) => `${Math.round(x * 100)}%`;

export default {
  title: () => '정산',
  render(c) {
    const v = settlement(c.state, c.now, { month: /^\d{4}-\d{2}$/.test(c.query.m || '') ? c.query.m : undefined });
    const t = v.totals;
    const fs = c.findings.filter((f) => f.category === 'BILLING' && !f.acked);
    const marginRate = t.supply ? t.margin / t.supply : 0;
    return html`
      <div class="page-head"><div><div class="eyebrow">7단계 · 완료 정산</div><h1>${v.month.replace('-', '년 ')}월 정산</h1></div></div>
      <div class="chips" role="tablist" aria-label="월 선택">${v.months.map((m) => html`<a href="#/billing?m=${m}" aria-selected="${m === v.month}">${m}</a>`)}</div>
      <section class="kpis">
        <div class="kpi"><span class="label">청구 합계</span><span class="value">${won(t.total)}</span><span class="sub">공급가 ${won(t.supply)} · 부가세 ${won(t.vat)}</span></div>
        <div class="kpi"><span class="label">수금</span><span class="value">${won(t.paid)}</span><span class="sub">미수 ${won(t.balance)}</span></div>
        <div class="kpi"><span class="label">원가</span><span class="value">${won(t.materialCost + t.laborCost)}</span><span class="sub">자재 ${won(t.materialCost)} · 인건비 ${won(t.laborCost)}</span></div>
        <div class="kpi"><span class="label">이익</span><span class="value">${won(t.margin)}</span><span class="sub">이익률 ${pct(marginRate)}${t.waived ? ` · 무상 처리 ${won(t.waived)}` : ''}</span></div>
      </section>
      ${fs.length ? html`<section class="stack"><h2>청구 누락 점검</h2>${fs.map((f) => findingAlert(f))}</section>` : html`<div class="alert alert-ok"><div class="alert-body">청구 누락이 없습니다.</div></div>`}
      <section class="card">
        <div class="card-head"><h2>청구 대기</h2><span class="small muted">작업은 끝났지만 청구서가 없는 건</span></div>
        <div class="card-body">${v.waiting.length ? v.waiting.map((w) => html`<a class="row-between" href="#/jobs/${w.job.id}/billing" style="color:inherit;padding:8px 0;border-bottom:1px solid var(--line)">
          <span><span class="mono xs faint">${w.job.id}</span> <strong>${w.job.title}</strong><br><span class="small muted">${w.customer?.name} · 완료 ${fmtDateTime(w.job.completedAt)} (${Math.floor(daysBetween(w.job.completedAt, c.now))}일 전)</span></span>
          <span class="num strong">${won(w.basis.total)}</span></a>`) : empty('청구를 기다리는 작업이 없습니다.')}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>청구서</h2><span class="small muted">${v.rows.length}건</span></div>
        ${v.rows.length ? html`<div class="table-wrap"><table class="tbl">
          <thead><tr><th>청구번호</th><th>작업</th><th>발행일</th><th class="num">합계</th><th class="num">수금</th><th class="num">잔액</th><th class="num">원가</th><th class="num">이익률</th><th>상태</th></tr></thead>
          <tbody>${v.rows.map((r) => html`<tr class="${r.unbilled > 0 ? 'row-warn' : ''}">
            <td class="mono small">${r.invoice.id}</td>
            <td><a class="rowlink" href="#/jobs/${r.job.id}/billing">${r.job.title}</a><div class="xs faint">${r.customer?.name}${r.unbilled > 0 ? ` · 미청구 ${won(r.unbilled)}` : ''}</div></td>
            <td class="nowrap">${fmtDate(r.invoice.issuedAt)}</td><td class="num">${won(r.total)}</td><td class="num">${won(r.paid)}</td><td class="num">${won(r.balance)}</td>
            <td class="num">${won(r.cost.total)}</td><td class="num">${pct(r.marginRate)}</td>
            <td><span class="chip ${r.invoice.status === 'paid' ? 'chip-ok' : 'chip-warn'}">${INVOICE_STATUS_LABEL[r.invoice.status]}</span></td></tr>`)}</tbody>
          <tfoot><tr><td colspan="3">합계</td><td class="num">${won(t.total)}</td><td class="num">${won(t.paid)}</td><td class="num">${won(t.balance)}</td><td class="num">${won(t.materialCost + t.laborCost)}</td><td class="num">${pct(marginRate)}</td><td></td></tr></tfoot>
        </table></div>` : html`<div class="card-body">${empty('이 달에 발행한 청구서가 없습니다.')}</div>`}
      </section>
      <p class="xs faint">인건비 원가는 배정 시간(근무 시간 08~18시) × 팀 시간당 ${won(v.settings.laborCostPerHour)}로 계산합니다.</p>
    `;
  },
};
