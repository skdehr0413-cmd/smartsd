// 누락·충돌 점검 센터: 4대 위험을 한곳에서 확인하고 해결 화면으로 이동
import { html, won, sevPill, catLabel, empty } from '../ui.js';
import { CATEGORIES } from '../../core/constants.js';
import { summarizeFindings } from '../../core/detectors.js';
import { fmtDateTime } from '../../core/time.js';

const RULES = {
  APPROVAL: [
    '고객 승인(서명·링크·문자·전화) 기록이 없는 추가 작업이 수행되었거나, 그 작업에 자재가 쓰였다 → 긴급',
    '견적·추가 작업 어디에도 없는 수량만큼 자재를 더 썼다 → 작업 중이면 주의, 완료 후면 긴급',
    '고객 승인 견적 없이 작업이 배정·진행되었다 → 긴급',
    '추가 작업 요청 후 24시간이 지나도 승인이 없다 → 주의',
    '30만 원 이상 추가 작업을 전화(구두)로만 승인받았다 → 참고',
  ],
  MATERIAL: [
    '소모 자재: 여러 작업의 예약 합계가 보유 재고보다 많다 → 긴급',
    '장비: 같은 시간대에 필요한 대수가 보유 대수보다 많다 → 긴급',
    '한 작업에 같은 자재가 두 줄 이상 예약되어 재고가 이중으로 묶였다 → 주의',
    '완료·취소된 작업의 예약이 해제되지 않았다 → 주의',
    '예약 후 가용 재고가 안전 재고보다 적다 → 참고',
  ],
  SCHEDULE: [
    '한 팀이 같은 시간에 두 현장(작업·현장 확인)에 배정되었다 → 긴급',
    '두 팀에 모두 속한 사람이 겹치는 시간에 양쪽 일정에 필요하다 → 긴급',
    '같은 날 연속 일정 사이 이동 시간이 30분보다 짧다 → 주의',
    '예정 시간이 지났는데 현장 확인 결과·작업 시작 기록이 없다 → 주의',
  ],
  BILLING: [
    '작업 완료 후 1일이 지나도 청구서가 없다 → 주의, 3일 이상이면 긴급',
    '승인된 추가 작업이 청구서에 빠졌다 → 긴급 (사유를 남기고 뺀 경우 주의)',
    '청구액이 고객 승인 금액보다 적다 → 긴급',
    '결제 기한이 지난 미수금이 있다 → 주의, 30일 이상이면 긴급',
  ],
};

function row(f) {
  return html`<div class="finding ${f.acked ? 'acked' : ''}" data-testid="finding" data-code="${f.code}">
    <div class="stack" style="gap:4px">
      <div class="f-head">${sevPill(f.severity)}<span class="chip">${catLabel(f.category)}</span>${f.jobIds.map((id) => html`<a class="mono small" href="#/jobs/${id}">${id}</a>`)}</div>
      <div class="f-title">${f.title}</div>
      <div class="f-detail">${f.detail}</div>
      ${f.ack ? html`<div class="xs faint">확인 처리: ${f.ack.memo} — ${f.ack.by}, ${fmtDateTime(f.ack.at)}</div>` : ''}
    </div>
    <div class="f-side">
      ${f.amount ? html`<span class="f-amount">${won(f.amount)}</span>` : ''}
      <div class="f-actions">
        ${f.fix ? html`<a class="btn btn-sm btn-primary" href="${f.fix.href}">${f.fix.label}</a>` : ''}
        ${f.severity !== 'critical' && !f.acked ? html`<button class="btn btn-sm" data-act="ack" data-key="${f.key}" data-title="${f.title}">확인 처리</button>` : ''}
      </div>
    </div>
  </div>`;
}

export default {
  title: () => '누락·충돌 점검',
  render(c) {
    const cat = CATEGORIES.some((x) => x.key === c.query.c) ? c.query.c : '';
    const sum = summarizeFindings(c.findings);
    const list = c.findings.filter((f) => !cat || f.category === cat);
    const open = list.filter((f) => !f.acked);
    const acked = list.filter((f) => f.acked);
    return html`
      <div class="page-head">
        <div><div class="eyebrow">데이터가 바뀔 때마다 모든 작업건을 다시 검사합니다</div><h1>누락·충돌 점검</h1></div>
        <div class="row"><span class="chip chip-crit">긴급 ${sum.critical}</span><span class="chip">전체 ${sum.total}</span><span class="chip chip-copper">위험 금액 ${won(sum.amount)}</span></div>
      </div>
      <nav class="tabs" role="tablist" aria-label="점검 분류">
        <a role="tab" href="#/checks" aria-selected="${!cat}">전체<span class="badge" style="background:var(--text-3)">${sum.total}</span></a>
        ${CATEGORIES.map((x) => html`<a role="tab" href="#/checks?c=${x.key}" aria-selected="${cat === x.key}" data-testid="tab-${x.key}">${x.label}${sum.byCategory[x.key].count ? html`<span class="badge" style="${sum.byCategory[x.key].critical ? '' : 'background:var(--warn)'}">${sum.byCategory[x.key].count}</span>` : ''}</a>`)}
      </nav>
      <section class="card">
        ${open.length ? open.map(row) : html`<div class="empty">${cat ? `${catLabel(cat)} 문제가 없습니다.` : '모든 점검을 통과했습니다.'}</div>`}
      </section>
      ${acked.length ? html`<details class="card"><summary class="card-head" style="cursor:pointer"><h2>확인 처리된 항목 ${acked.length}건</h2></summary>${acked.map(row)}</details>` : ''}
      <details class="card">
        <summary class="card-head" style="cursor:pointer"><h2>점검 규칙</h2><span class="small muted">무엇을 어떻게 찾는지</span></summary>
        <div class="card-body">${(cat ? CATEGORIES.filter((x) => x.key === cat) : CATEGORIES).map((x) => html`<div class="stack" style="gap:4px"><h3>${x.label}</h3><ul class="small muted" style="margin:0;padding-left:18px">${RULES[x.key].map((r) => html`<li>${r}</li>`)}</ul></div>`)}
          <p class="xs faint">긴급 항목은 원인을 해결해야만 사라집니다. 주의·참고 항목은 사유를 남기고 확인 처리할 수 있습니다.</p>
        </div>
      </details>
      ${list.length ? '' : empty('')}
    `;
  },
  actions: {
    ack(c, el) {
      c.modal.open({
        title: '확인 처리',
        body: html`<form class="modal-body" data-form="save" id="ack-form"><p class="small">${el.dataset.title}</p>
          <div class="field"><label for="ack-memo">확인 메모 (필수)</label><input id="ack-memo" name="memo" type="text" required maxlength="200" placeholder="예: 같은 건물이라 이동 시간 불필요"></div><p class="form-error" hidden></p></form>`,
        foot: html`<div class="modal-foot"><button type="button" class="btn" data-act="modal-close">취소</button><button class="btn btn-primary" type="submit" form="ack-form">확인 처리</button></div>`,
        forms: {
          async save(cc, d) {
            await cc.run('POST', '/api/findings/ack', { key: el.dataset.key, memo: d.memo });
            cc.modal.close();
            cc.toast('확인 처리했습니다.');
          },
        },
      });
    },
  },
};
