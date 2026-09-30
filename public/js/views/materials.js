// 자재: 보유·예약·가용 재고와 중복 예약, 장비 예약 시간표
import { html, won, fmtQty, fmtRange, findingAlert, empty } from '../ui.js';
import { materialsOverview } from '../../core/views.js';

function status(m) {
  if (m.findings.some((f) => f.severity === 'critical')) return html`<span class="chip chip-crit">${m.kind === 'equipment' ? '이중 예약' : '중복 예약'}</span>`;
  if (m.findings.some((f) => f.severity === 'warning')) return html`<span class="chip chip-warn">예약 정리 필요</span>`;
  if (m.kind !== 'equipment' && m.safety && m.available < m.safety) return html`<span class="chip chip-info">발주 필요</span>`;
  return html`<span class="chip chip-ok">정상</span>`;
}

function holders(m) {
  return m.reservations.map((r) => html`<a class="chip chip-outline" href="#/jobs/${r.jobId}/material">${r.jobId} ${m.kind === 'equipment' ? (r.window ? fmtRange(r.window.start, r.window.end) : '일정 미정') : `${fmtQty(r.outstanding)}${m.unit}`}</a> `);
}

export default {
  title: () => '자재',
  render(c) {
    const list = materialsOverview(c.state, c.now);
    const cons = list.filter((m) => m.kind !== 'equipment');
    const equip = list.filter((m) => m.kind === 'equipment');
    const fs = c.findings.filter((f) => f.category === 'MATERIAL' && !f.acked);
    return html`
      <div class="page-head"><div><div class="eyebrow">예약하면 다른 작업이 같은 재고를 쓰지 못합니다</div><h1>자재·장비</h1></div></div>
      <section class="kpis">
        <div class="kpi"><span class="label">자재 품목</span><span class="value">${cons.length}</span><span class="sub">장비 ${equip.length}종</span></div>
        <div class="kpi"><span class="label">중복·초과 예약</span><span class="value">${fs.filter((f) => f.severity === 'critical').length}건</span><span class="sub">같은 재고·장비를 여러 작업이 잡음</span></div>
        <div class="kpi"><span class="label">예약 정리 필요</span><span class="value">${fs.filter((f) => f.severity === 'warning').length}건</span><span class="sub">중복 줄·끝난 작업 예약</span></div>
        <div class="kpi"><span class="label">재고 금액(원가)</span><span class="value">${won(cons.reduce((s, m) => s + m.stock * (m.cost || 0), 0))}</span><span class="sub">보유 수량 × 매입가</span></div>
      </section>
      ${fs.length ? html`<div class="stack">${fs.map((f) => findingAlert(f))}</div>` : ''}
      <section class="card">
        <div class="card-head"><h2>자재 재고</h2><span class="small muted">가용 = 보유 − 다른 작업 예약</span></div>
        <div class="table-wrap hide-mobile"><table class="tbl">
          <thead><tr><th>코드</th><th>자재</th><th class="num">보유</th><th class="num">예약</th><th class="num">가용</th><th class="num">안전 재고</th><th class="num">판매가</th><th>예약한 작업</th><th>상태</th><th></th></tr></thead>
          <tbody>${cons.map((m) => html`<tr class="${m.available < 0 ? 'row-crit' : ''}" data-testid="mat-${m.id}">
            <td class="mono small">${m.sku}</td><td><strong>${m.name}</strong><div class="xs faint">${m.category}</div></td>
            <td class="num">${fmtQty(m.stock)}${m.unit}</td><td class="num">${fmtQty(m.reserved)}</td><td class="num strong">${fmtQty(m.available)}</td><td class="num">${fmtQty(m.safety)}</td><td class="num">${won(m.price)}</td>
            <td>${holders(m)}</td><td>${status(m)}</td><td><button class="btn btn-sm" data-act="stock-in" data-id="${m.id}" data-name="${m.name}">입고</button></td></tr>`)}</tbody>
        </table></div>
        <div class="card-body only-mobile">${cons.map((m) => html`<div class="stack" style="gap:4px;padding-bottom:10px;border-bottom:1px solid var(--line)">
          <div class="row-between"><strong>${m.name}</strong>${status(m)}</div>
          <div class="row small num"><span>보유 ${fmtQty(m.stock)}${m.unit}</span><span>예약 ${fmtQty(m.reserved)}</span><span class="strong">가용 ${fmtQty(m.available)}</span></div>
          ${m.reservations.length ? html`<div class="row">${holders(m)}</div>` : ''}
          <div><button class="btn btn-sm" data-act="stock-in" data-id="${m.id}" data-name="${m.name}">입고 기록</button></div>
        </div>`)}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>장비 예약</h2><span class="small muted">장비는 작업 시간 동안 한 현장에만 있을 수 있습니다</span></div>
        <div class="card-body">${equip.map((m) => html`<div class="row-between" style="padding:8px 0;border-bottom:1px solid var(--line)" data-testid="equip-${m.id}">
          <div class="stack" style="gap:4px"><strong>${m.name} <span class="faint small">보유 ${m.stock}대 · 사용료 ${won(m.price)}</span></strong><div class="row">${m.reservations.length ? holders(m) : html`<span class="small faint">예약 없음</span>`}</div></div>
          ${status(m)}</div>`)}
          ${equip.length ? '' : empty('등록된 장비가 없습니다.')}
        </div>
      </section>
    `;
  },
  actions: {
    'stock-in'(c, el) {
      c.modal.open({
        title: `입고 기록 — ${el.dataset.name}`,
        body: html`<form class="modal-body" data-form="save" id="in-form"><div class="field"><label for="in-qty">입고 수량</label><input id="in-qty" name="qty" type="number" min="0" step="any" inputmode="decimal" required value="1"></div><p class="form-error" hidden></p></form>`,
        foot: html`<div class="modal-foot"><button type="button" class="btn" data-act="modal-close">취소</button><button class="btn btn-primary" type="submit" form="in-form">입고</button></div>`,
        forms: {
          async save(cc, d) {
            await cc.run('POST', `/api/materials/${el.dataset.id}/stock-in`, { qty: Number(d.qty) });
            cc.modal.close();
            cc.toast('입고를 기록했습니다.');
          },
        },
      });
    },
  },
};
