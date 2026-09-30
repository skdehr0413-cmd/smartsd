// 오늘 화면: 누락·충돌 요약 → 흐름 현황 → 오늘 일정 → 이번 달 돈
import { html, icon, won, fmtDate, crewVar, sevPill, catLabel, empty } from '../ui.js';
import { dashboard as dashboardView } from '../../core/views.js';
import { FLOW, CATEGORIES } from '../../core/constants.js';
import { summarizeFindings } from '../../core/detectors.js';
import { timeOf } from '../../core/time.js';
import { wonShort } from '../../core/money.js';

function riskTiles(c) {
  const sum = summarizeFindings(c.findings);
  return html`<section class="risk-hero" aria-label="누락·충돌 요약">
    <div class="risk-total">
      <div>
        <div class="label">지금 놓치고 있는 돈</div>
        <div class="value" data-testid="risk-amount">${won(sum.amount)}</div>
      </div>
      <div class="sub">누락·충돌 ${sum.total}건 · 긴급 ${sum.critical}건</div>
    </div>
    <div class="risk-grid">
      ${CATEGORIES.map((cat) => {
        const x = sum.byCategory[cat.key];
        const cls = x.critical ? 'has-critical' : x.count ? 'has-warning' : 'is-clear';
        return html`<a class="risk ${cls}" href="#/checks?c=${cat.key}" data-testid="risk-${cat.key}">
          <span class="r-label">${cat.label}</span>
          <span class="r-count">${x.count}<small>건</small></span>
          <span class="r-sub">${x.count ? `긴급 ${x.critical}${x.amount ? ` · ${wonShort(x.amount)}` : ''}` : '문제 없음'}</span>
        </a>`;
      })}
    </div>
  </section>`;
}

function flow(c) {
  return html`<section class="card" aria-label="업무 흐름">
    <div class="card-head"><h2>업무 흐름</h2><a href="#/jobs" class="small">작업건 전체 보기</a></div>
    <div class="flow">
      ${FLOW.map((f) => {
        const n = c.state.jobs.filter((j) => f.statuses.includes(j.status)).length;
        return html`<a href="#/jobs?s=${f.key}"><span class="f-label">${f.label}</span><span class="f-count">${n}</span><span class="f-sub">${f.hint}</span></a>`;
      })}
    </div>
  </section>`;
}

function today(c, d) {
  const myCrew = c.state.crews.find((cr) => c.actor.includes(cr.name));
  const list = myCrew ? d.todays.filter((b) => b.crewId === myCrew.id) : d.todays;
  return html`<section class="card">
    <div class="card-head"><h2>${myCrew ? `${myCrew.name} 오늘 일정` : '오늘 일정'}</h2><a class="small" href="#/schedule">일정표</a></div>
    <div class="card-body">
      ${list.length ? html`<div class="agenda">${list.map((b) => html`<a class="agenda-item ${b.conflict ? 'conflict' : ''}" style="${crewVar(b.crew)}" href="#/jobs/${b.jobId}">
        <div class="time">${timeOf(b.start)}<small>${timeOf(b.end)}</small></div>
        <div class="stack" style="gap:2px">
          <div class="row"><strong>${b.job.title}</strong>${b.conflict ? html`<span class="chip chip-crit">일정 충돌</span>` : ''}</div>
          <div class="small muted">${b.crew?.name} · ${b.kind === 'survey' ? '현장 확인' : '작업'} · ${b.address}</div>
        </div>
      </a>`)}</div>` : empty('오늘 잡힌 일정이 없습니다.')}
    </div>
  </section>`;
}

function todo(c, d) {
  return html`<section class="card">
    <div class="card-head"><h2>지금 처리할 일</h2><a class="small" href="#/checks">점검 전체</a></div>
    <div class="card-body">
      ${d.topFindings.length ? d.topFindings.map((f) => html`<a class="row" href="${f.fix?.href || '#/checks'}" style="color:inherit;text-decoration:none;align-items:flex-start;gap:10px">
        ${sevPill(f.severity)}
        <span class="grow"><span class="strong">${f.title}</span><br><span class="xs faint">${catLabel(f.category)}${f.amount ? ` · ${won(f.amount)}` : ''}</span></span>
      </a>`) : empty('처리할 누락·충돌이 없습니다.')}
    </div>
  </section>`;
}

export default {
  title: () => '오늘',
  render(c) {
    const d = dashboardView(c.state, c.now);
    return html`
      <div class="page-head">
        <div><div class="eyebrow">${fmtDate(c.now)} ${timeOf(c.now)} 기준</div><h1>오늘의 현장</h1></div>
        <div class="page-actions hide-mobile"><a class="btn btn-primary" href="#/jobs/new">${icon('plus')}새 문의 접수</a></div>
      </div>
      ${riskTiles(c)}
      ${flow(c)}
      <div class="grid-2">${today(c, d)}${todo(c, d)}</div>
      <section class="kpis" aria-label="이번 달 돈 흐름">
        <div class="kpi"><span class="label">이번 달 청구</span><span class="value">${won(d.money.invoiced)}</span><span class="sub">부가세 포함</span></div>
        <div class="kpi"><span class="label">이번 달 수금</span><span class="value">${won(d.money.collected)}</span><span class="sub">입금 기록 기준</span></div>
        <div class="kpi"><span class="label">미수금</span><span class="value">${won(d.money.receivable)}</span><span class="sub">청구 후 미입금 전체</span></div>
        <div class="kpi"><span class="label">추가 작업 승인 대기</span><span class="value">${d.pendingChangeOrders}건</span><span class="sub">승인 전 작업 금지</span></div>
      </section>
      <a class="btn btn-primary fab only-mobile" href="#/jobs/new">${icon('plus')}새 문의</a>
    `;
  },
};

