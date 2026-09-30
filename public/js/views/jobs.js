// 작업건 목록: PC는 단계별 보드, 휴대폰은 필터 + 카드 목록
import { html, icon, won, statusChip, fmtDateTime, empty, crewDot } from '../ui.js';
import { FLOW, BOARD } from '../../core/constants.js';
import { jobSummary } from '../../core/views.js';

function jobCard(c, j) {
  const fs = c.findings.filter((f) => !f.acked && f.jobIds.includes(j.id));
  const crit = fs.filter((f) => f.severity === 'critical').length;
  const warn = fs.length - crit;
  return html`<a class="job-card ${crit ? 'has-critical' : warn ? 'has-warning' : ''}" href="#/jobs/${j.id}" data-testid="job-card-${j.id}">
    <div class="jc-top"><span class="mono xs faint">${j.id}</span>${statusChip(j.status)}</div>
    <div class="jc-title">${j.urgency === 'urgent' ? html`<span class="chip chip-crit">긴급</span> ` : ''}${j.title}</div>
    <div class="jc-meta"><span>${j.customer?.name}</span>${j.amount ? html`<span class="num">${won(j.amount)}</span>` : ''}</div>
    ${j.nextAt ? html`<div class="jc-meta">${crewDot(j.crew)}<span>${j.crew?.name} · ${fmtDateTime(j.nextAt)}</span></div>` : ''}
    ${fs.length ? html`<div class="row">${crit ? html`<span class="chip chip-crit">긴급 ${crit}</span>` : ''}${warn ? html`<span class="chip chip-warn">주의 ${warn}</span>` : ''}</div>` : ''}
  </a>`;
}

function filterJobs(c) {
  const { s, q, f } = c.query;
  let list = c.state.jobs.map((j) => jobSummary(c.state, j));
  if (s) {
    const stage = FLOW.find((x) => x.key === s);
    if (stage) list = list.filter((j) => stage.statuses.includes(j.status));
    if (s === 'done') list = list.filter((j) => ['PAID', 'CANCELED'].includes(j.status));
  }
  if (f === 'risk') list = list.filter((j) => c.findings.some((x) => !x.acked && x.jobIds.includes(j.id)));
  if (f === 'urgent') list = list.filter((j) => j.urgency === 'urgent');
  if (q) {
    const k = q.trim().toLowerCase();
    list = list.filter((j) => [j.id, j.title, j.address, j.customer?.name, j.customer?.phone].some((v) => String(v || '').toLowerCase().includes(k)));
  }
  return list.sort((a, b) => (b.urgency === 'urgent') - (a.urgency === 'urgent') || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function link(c, patch) {
  const q = { ...c.query, ...patch };
  Object.keys(q).forEach((k) => { if (!q[k]) delete q[k]; });
  const qs = new URLSearchParams(q).toString();
  return `#/jobs${qs ? `?${qs}` : ''}`;
}

export default {
  title: () => '작업건',
  render(c) {
    const list = filterJobs(c);
    const filtered = !!(c.query.s || c.query.q || c.query.f);
    const riskCount = c.state.jobs.filter((j) => c.findings.some((x) => !x.acked && x.jobIds.includes(j.id))).length;
    return html`
      <div class="page-head">
        <div><div class="eyebrow">문의 접수 → 현장 확인 → 견적 → 고객 승인 → 작업 배정 → 자재 사용 → 완료 정산</div><h1>작업건</h1></div>
        <div class="page-actions hide-mobile"><a class="btn btn-primary" href="#/jobs/new">${icon('plus')}새 문의 접수</a></div>
      </div>
      <form class="row" data-form="search" role="search">
        <input type="search" name="q" id="job-search" value="${c.query.q || ''}" placeholder="고객명, 주소, 작업번호, 전화번호" style="flex:1 1 180px;width:auto;max-width:420px" aria-label="작업건 검색">
        <button class="btn" type="submit">${icon('search')}<span class="hide-mobile">검색</span></button>
      </form>
      <div class="chips" role="tablist" aria-label="단계 필터">
        <a href="${link(c, { s: '', f: '' })}" aria-selected="${!c.query.s && !c.query.f}">전체 ${c.state.jobs.length}</a>
        <a href="${link(c, { f: c.query.f === 'risk' ? '' : 'risk' })}" aria-selected="${c.query.f === 'risk'}">문제 있음 ${riskCount}</a>
        <a href="${link(c, { f: c.query.f === 'urgent' ? '' : 'urgent' })}" aria-selected="${c.query.f === 'urgent'}">긴급</a>
        ${FLOW.map((st) => html`<a href="${link(c, { s: c.query.s === st.key ? '' : st.key })}" aria-selected="${c.query.s === st.key}">${st.label} ${c.state.jobs.filter((j) => st.statuses.includes(j.status)).length}</a>`)}
        <a href="${link(c, { s: c.query.s === 'done' ? '' : 'done' })}" aria-selected="${c.query.s === 'done'}">종결</a>
      </div>
      ${filtered ? '' : html`<div class="board hide-mobile" aria-label="단계별 보드">
        ${BOARD.map((col) => {
          const jobs = list.filter((j) => col.statuses.includes(j.status));
          return html`<section class="col" aria-label="${col.label}"><div class="col-head"><span>${col.label}</span><span class="chip">${jobs.length}</span></div>${jobs.map((j) => jobCard(c, j))}</section>`;
        })}
      </div>`}
      <div class="job-list ${filtered ? '' : 'only-mobile'}" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">
        ${list.length ? list.map((j) => jobCard(c, j)) : empty('조건에 맞는 작업건이 없습니다.')}
      </div>
      <a class="btn btn-primary fab only-mobile" href="#/jobs/new">${icon('plus')}새 문의</a>
    `;
  },
  forms: {
    search(c, data) {
      const q = String(data.q || '').trim();
      c.go(link(c, { q }).slice(1));
    },
  },
};
