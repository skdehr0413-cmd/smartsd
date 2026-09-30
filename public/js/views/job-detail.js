// 작업건 상세: 7단계 흐름 전체를 한 화면에서 처리한다.
import {
  html, raw, icon, won, fmtQty, fmtDateTime, fmtRange, statusChip, stepper, itemsTable, findingAlert,
  signaturePad, options, combine, empty, crewDot, totals, lineAmount, withRo,
} from '../ui.js';
import { openEditor, ensureEditor, editorHtml, payloadItems, editorActions, editorInputs } from '../items-editor.js';
import { jobDetail } from '../../core/views.js';
import { materialAvailability, approvedQuantities, usedQuantities, settingsOf } from '../../core/model.js';
import {
  CO_STATUS_LABEL, QUOTE_STATUS_LABEL, INVOICE_STATUS_LABEL, RESERVATION_STATUS_LABEL, APPROVAL_METHODS, PAYMENT_METHODS,
} from '../../core/constants.js';
import { addMinutes, addDays, dateOf, timeOf } from '../../core/time.js';

const TABS = [
  { key: 'overview', label: '개요' },
  { key: 'quote', label: '현장·견적' },
  { key: 'material', label: '배정·자재' },
  { key: 'change', label: '추가 작업' },
  { key: 'billing', label: '정산' },
  { key: 'history', label: '이력' },
];

function tabOf(f) {
  if (f.code === 'WORK_WITHOUT_APPROVED_QUOTE') return 'quote';
  return { APPROVAL: 'change', MATERIAL: 'material', SCHEDULE: 'material', BILLING: 'billing' }[f.category];
}

const customerUrl = (kind, token) => `${location.href.split('#')[0]}#/c/${kind}/${token}`;

function nextSlot(now) {
  // 다음 날 오전 9시를 기본 제안
  return `${dateOf(addDays(now, 1))}T09:00`;
}

// ─── 모달들 ─────────────────────────────────────────────

function conflictHtml(err) {
  const d = err.details || {};
  return html`<div class="alert alert-critical"><div class="alert-body">
    <div class="alert-title">${err.message}</div>
    ${(d.conflicts || []).map((x) => html`<div class="small">· ${x.jobId} ${x.kind === 'survey' ? '현장 확인' : '작업'} ${fmtRange(x.start, x.end)}${x.members ? ` (공유 인원: ${x.members.join(', ')})` : ''}</div>`)}
    ${d.freeCrews?.length ? html`<div class="row" style="margin-top:6px"><span class="small strong">이 시간에 비어 있는 팀:</span>${d.freeCrews.map((fc) => html`<button type="button" class="btn btn-sm" data-act="pick-crew" data-crew="${fc.id}">${withRo(fc.name)} 변경</button>`)}</div>` : html`<div class="small">이 시간에 비어 있는 팀이 없습니다. 시간을 바꾸세요.</div>`}
  </div></div>`;
}

function forceBox(label) {
  return html`<div class="force-box stack" hidden>
    <label class="check"><input type="checkbox" name="force" value="1"> ${label}</label>
    <div class="field"><label for="f-reason">사유 (기록에 남고 점검 화면에 계속 표시됩니다)</label><input id="f-reason" name="reason" type="text" maxlength="200" placeholder="예: 고객 요청으로 긴급 처리"></div>
  </div>`;
}

function showConflict(form, err, boxHtml) {
  const box = form.querySelector('.conflict-box');
  box.innerHTML = String(boxHtml);
  box.hidden = false;
  form.querySelector('.force-box').hidden = false;
}

function scheduleModal(c, job, kind) {
  const cur = kind === 'survey' ? job.survey : job.schedule;
  const base = cur?.start || job.preferredAt || nextSlot(c.now);
  const end = cur?.end || addMinutes(base, kind === 'survey' ? 60 : 240);
  const crews = c.state.crews.filter((x) => x.active !== false);
  const title = kind === 'survey' ? '현장 확인 예약' : (job.schedule ? '작업 일정 변경' : '작업 배정');
  c.modal.open({
    title,
    body: html`<form class="modal-body" data-form="save" id="sched-form">
      <div class="field"><label for="s-crew">${kind === 'survey' ? '방문 팀' : '작업팀'}</label>
        <select id="s-crew" name="crewId" required>${options(crews, cur?.crewId || crews[0]?.id, { label: (x) => `${x.name} (${x.role}) · ${x.members.join(', ')}` })}</select></div>
      <div class="fields-3">
        <div class="field"><label for="s-date">날짜</label><input id="s-date" name="date" type="date" value="${dateOf(base)}" required></div>
        <div class="field"><label for="s-start">시작</label><input id="s-start" name="start" type="time" step="600" value="${timeOf(base)}" required></div>
        <div class="field"><label for="s-end">종료</label><input id="s-end" name="end" type="time" step="600" value="${timeOf(end)}" required></div>
      </div>
      ${kind === 'work' ? html`<div class="field"><label for="s-enddate">종료일 (여러 날 작업일 때)</label><input id="s-enddate" name="endDate" type="date" value="${dateOf(end)}"></div>` : ''}
      <div class="conflict-box" hidden></div>
      ${forceBox('충돌을 알고도 이대로 배정')}
      <p class="form-error" hidden></p>
    </form>`,
    foot: html`<div class="modal-foot"><button type="button" class="btn" data-act="modal-close">취소</button><button class="btn btn-primary" type="submit" form="sched-form">${kind === 'survey' ? '예약' : '배정'}</button></div>`,
    actions: {
      'pick-crew'(cc, el) {
        const f = document.getElementById('sched-form');
        f.crewId.value = el.dataset.crew;
        f.querySelector('.conflict-box').hidden = true;
        f.querySelector('.force-box').hidden = true;
        f.force.checked = false;
      },
    },
    forms: {
      async save(cc, d, form) {
        const payload = { crewId: d.crewId, start: combine(d.date, d.start), end: combine(d.endDate || d.date, d.end), force: d.force === '1', reason: d.reason };
        try {
          await cc.run('POST', `/api/jobs/${job.id}/${kind === 'survey' ? 'survey' : 'schedule'}`, payload);
          cc.modal.close();
          cc.toast(`${title} 완료`);
        } catch (err) {
          if (err.code === 'SCHEDULE_CONFLICT') showConflict(form, err, conflictHtml(err));
          else throw err;
        }
      },
    },
  });
}

function textModal(c, { title, label, name = 'text', placeholder = '', submit, required = true, value = '', multiline = true, onSubmit }) {
  c.modal.open({
    title,
    body: html`<form class="modal-body" data-form="save" id="text-form">
      <div class="field"><label for="t-in">${label}</label>
      ${multiline ? html`<textarea id="t-in" name="${name}" ${required ? raw('required') : ''} placeholder="${placeholder}">${value}</textarea>` : html`<input id="t-in" name="${name}" type="text" value="${value}" ${required ? raw('required') : ''} placeholder="${placeholder}">`}</div>
      <p class="form-error" hidden></p>
    </form>`,
    foot: html`<div class="modal-foot"><button type="button" class="btn" data-act="modal-close">취소</button><button class="btn btn-primary" type="submit" form="text-form">${submit}</button></div>`,
    forms: { async save(cc, d) { await onSubmit(cc, d[name]); cc.modal.close(); } },
  });
}

export function approveModal(c, { kind, id, title, amount, by = '', note = '' }) {
  const path = kind === 'quote' ? `/api/quotes/${id}/approve` : `/api/change-orders/${id}/approve`;
  c.modal.open({
    title: `고객 승인 기록 — ${title}`,
    body: html`<form class="modal-body approve-form" data-form="save" id="approve-form">
      ${note ? html`<div class="alert alert-info"><div class="alert-body">${note}</div></div>` : ''}
      <div class="doc-total"><span>승인 금액 (부가세 포함)</span><span class="v">${won(amount)}</span></div>
      <div class="field"><label for="a-by">승인한 사람</label><input id="a-by" name="by" type="text" value="${by}" required placeholder="고객 이름 / 관리소장 이름"></div>
      <div class="field"><span class="label">승인 방법</span>
        <div class="seg">${APPROVAL_METHODS.filter((m) => m !== '고객 링크 서명').map((m, i) => html`<label><input type="radio" name="method" value="${m}" ${i === 0 ? raw('checked') : ''}> ${m}</label>`)}</div>
        <span class="hint">전화(구두) 승인은 분쟁 시 증빙이 약합니다. 가능하면 서명이나 문자 회신을 받으세요.</span>
      </div>
      <div class="sig-area">${signaturePad('approve-sig', '고객이 여기에 서명합니다')}</div>
      <div class="field"><label for="a-memo">메모</label><input id="a-memo" name="memo" type="text" placeholder="예: 문자로 '진행해 주세요' 회신"></div>
      <p class="form-error" hidden></p>
    </form>`,
    foot: html`<div class="modal-foot"><button type="button" class="btn" data-act="modal-close">나중에</button><button class="btn btn-primary" type="submit" form="approve-form">${icon('check')}승인 기록</button></div>`,
    forms: {
      async save(cc, d) {
        const pad = cc.getPad('approve-sig');
        const signature = d.method === '현장 서명' ? (pad && !pad.isEmpty() ? pad.toDataURL() : null) : null;
        if (d.method === '현장 서명' && !signature) return cc.modal.error('현장 서명을 받아 주세요.');
        await cc.run('POST', path, { by: d.by, method: d.method, memo: d.memo, signature });
        cc.modal.close();
        cc.toast('고객 승인이 기록되었습니다.');
      },
    },
  });
}

function linkModal(c, { title, url }) {
  c.modal.open({
    title,
    body: html`<div class="modal-body">
      <p class="muted small">고객에게 문자나 카카오톡으로 이 링크를 보내면, 고객이 휴대폰에서 내용을 확인하고 직접 서명해 승인합니다.</p>
      <div class="field"><label for="l-url">고객 승인 링크</label><input id="l-url" type="text" readonly value="${url}"></div>
      <div class="row"><button type="button" class="btn btn-primary" data-act="copy">${icon('link')}링크 복사</button><a class="btn" href="${url}">고객 화면 미리 보기</a></div>
    </div>`,
    actions: {
      async copy(cc) {
        const input = document.getElementById('l-url');
        try { await navigator.clipboard.writeText(url); cc.toast('링크를 복사했습니다.'); } catch { input.select(); cc.toast('링크를 선택했습니다. 길게 눌러 복사하세요.', 'warn'); }
      },
    },
  });
}

function reserveModal(c, d) {
  const job = d.job;
  const quoted = approvedQuantities(c.state, job.id);
  const mats = [...c.state.materials].sort((a, b) => (quoted.has(b.id) - quoted.has(a.id)));
  const label = (m) => {
    const av = materialAvailability(c.state, m.id);
    const q = quoted.get(m.id);
    return m.kind === 'equipment' ? `[장비] ${m.name} · 보유 ${m.stock}대${q ? ' · 견적 포함' : ''}` : `${m.name} · 가용 ${fmtQty(Math.max(0, av.available))}/${fmtQty(av.stock)}${m.unit}${q ? ` · 견적 ${fmtQty(q)}${m.unit}` : ''}`;
  };
  c.modal.open({
    title: '자재·장비 예약',
    body: html`<form class="modal-body" data-form="save" id="res-form">
      <p class="small muted">예약하면 다른 작업이 같은 재고를 가져가지 못합니다. 장비는 작업 시간(${job.schedule ? fmtRange(job.schedule.start, job.schedule.end) : '미정'}) 동안 묶입니다.</p>
      <div class="field"><label for="r-mat">자재</label><select id="r-mat" name="materialId" required>${options(mats, mats[0]?.id, { label })}</select></div>
      <div class="field"><label for="r-qty">수량</label><input id="r-qty" name="qty" type="number" step="any" min="0" inputmode="decimal" value="1" required></div>
      <div class="conflict-box" hidden></div>
      ${forceBox('경고를 알고도 예약')}
      <p class="form-error" hidden></p>
    </form>`,
    foot: html`<div class="modal-foot"><button type="button" class="btn" data-act="modal-close">취소</button><button class="btn btn-primary" type="submit" form="res-form">예약</button></div>`,
    actions: {
      async 'merge-dup'(cc, el) {
        await cc.run('PATCH', `/api/reservations/${el.dataset.id}`, { qty: Number(el.dataset.qty) });
        cc.modal.close();
        cc.toast('기존 예약 수량을 늘렸습니다.');
      },
    },
    forms: {
      async save(cc, f, form) {
        try {
          await cc.run('POST', `/api/jobs/${job.id}/reservations`, { materialId: f.materialId, qty: Number(f.qty), force: f.force === '1', reason: f.reason });
          cc.modal.close();
          cc.toast('예약했습니다.');
        } catch (err) {
          if (err.code === 'DUPLICATE_RESERVATION') {
            const merged = Number(err.details.qty) + Number(f.qty);
            showConflict(form, err, html`<div class="alert alert-warning"><div class="alert-body"><div class="alert-title">${err.message}</div>
              <div class="row"><button type="button" class="btn btn-sm btn-primary" data-act="merge-dup" data-id="${err.details.reservationId}" data-qty="${merged}">기존 예약을 ${fmtQty(merged)}(으)로 변경</button></div></div></div>`);
          } else if (['INSUFFICIENT_STOCK', 'EQUIPMENT_BOOKED'].includes(err.code)) {
            showConflict(form, err, html`<div class="alert alert-critical"><div class="alert-body"><div class="alert-title">${err.message}</div><div class="small">입고를 먼저 기록하거나 다른 작업의 예약·일정을 조정하세요. 그대로 예약하면 '자재 중복 예약'으로 계속 표시됩니다.</div></div></div>`);
          } else throw err;
        }
      },
    },
  });
}

function usageModal(c, d) {
  const job = d.job;
  const reserved = new Map(d.reservations.filter((r) => r.status === 'active').map((r) => [r.materialId, r.outstanding]));
  const quoted = approvedQuantities(c.state, job.id);
  const mats = [...c.state.materials].sort((a, b) => (reserved.has(b.id) - reserved.has(a.id)) || (quoted.has(b.id) - quoted.has(a.id)));
  const cos = d.changeOrders.filter((x) => ['requested', 'approved'].includes(x.status));
  c.modal.open({
    title: '자재 사용 기록',
    body: html`<form class="modal-body" data-form="save" id="use-form">
      <div class="field"><label for="u-mat">자재</label><select id="u-mat" name="materialId" required>${options(mats, mats[0]?.id, { label: (m) => `${m.name}${reserved.has(m.id) ? ` · 예약 ${fmtQty(reserved.get(m.id))}${m.unit}` : ''}${quoted.has(m.id) ? ` · 승인 ${fmtQty(quoted.get(m.id))}${m.unit}` : ''}` })}</select></div>
      <div class="field"><label for="u-qty">사용 수량</label><input id="u-qty" name="qty" type="number" step="any" min="0" inputmode="decimal" value="1" required></div>
      <div class="field"><label for="u-co">추가 작업에 쓴 자재인가요?</label><select id="u-co" name="changeOrderId">${options(cos, '', { label: (x) => `${x.title} (${CO_STATUS_LABEL[x.status]})`, placeholder: '아니요 — 기본 견적 작업' })}</select>
        <span class="hint">승인 전 추가 작업에 자재를 쓰면 '승인 누락'으로 표시됩니다.</span></div>
      <div class="field"><label for="u-note">메모</label><input id="u-note" name="note" type="text" maxlength="200"></div>
      <p class="form-error" hidden></p>
    </form>`,
    foot: html`<div class="modal-foot"><button type="button" class="btn" data-act="modal-close">취소</button><button class="btn btn-primary" type="submit" form="use-form">기록</button></div>`,
    forms: {
      async save(cc, f) {
        await cc.run('POST', `/api/jobs/${job.id}/usages`, { materialId: f.materialId, qty: Number(f.qty), changeOrderId: f.changeOrderId || null, note: f.note });
        cc.modal.close();
        cc.toast('사용 기록을 남겼습니다.');
      },
    },
  });
}

function changeOrderModal(c, d) {
  openEditor('co-new', []);
  c.modal.open({
    title: '추가 작업 요청',
    wide: true,
    body: html`<form class="modal-body" data-form="save" id="co-form">
      <div class="alert alert-warning"><div class="alert-body">추가 작업은 <strong>고객 승인을 받은 뒤</strong>에 하세요. 승인 없이 작업하면 청구할 근거가 없고 '승인 누락'으로 표시됩니다.</div></div>
      <div class="field"><label for="co-title">추가 작업명</label><input id="co-title" name="title" type="text" required maxlength="60" placeholder="예: 싱크대 배수 트랩 교체"></div>
      <div class="field"><label for="co-reason">사유 (고객에게 보이는 설명)</label><input id="co-reason" name="reason" type="text" maxlength="300" placeholder="예: 수전 교체 중 트랩 부식·누수 발견"></div>
      <div class="field"><span class="label">항목</span>${editorHtml(c, 'co-new')}</div>
      <p class="form-error" hidden></p>
    </form>`,
    foot: html`<div class="modal-foot"><button type="button" class="btn" data-act="modal-close">취소</button><button class="btn btn-primary" type="submit" form="co-form">요청 만들기</button></div>`,
    actions: editorActions,
    inputs: editorInputs,
    forms: {
      async save(cc, f) {
        const co = await cc.run('POST', `/api/jobs/${d.job.id}/change-orders`, { title: f.title, reason: f.reason, items: payloadItems('co-new') });
        cc.modal.close();
        approveModal(cc, { kind: 'co', id: co.id, title: co.title, amount: totals(co.items).total, by: d.customer?.name || '', note: '고객이 현장에 있으면 지금 서명을 받으세요. 없으면 "나중에"를 누르고 추가 작업 탭에서 승인 링크를 보내세요.' });
      },
    },
  });
}

function completeModal(c, d) {
  c.modal.open({
    title: '작업 완료',
    body: html`<form class="modal-body" data-form="save" id="done-form">
      <p class="small muted">완료하면 남은 자재 예약이 자동으로 해제되고, 정산 단계로 넘어갑니다. 승인 없이 수행된 추가 작업이나 견적 초과 사용 자재가 있으면 완료할 수 없습니다.</p>
      <div class="field"><label for="d-note">완료 메모</label><textarea id="d-note" name="note" placeholder="예: 누수 없음 확인, 고객 입회"></textarea></div>
      <div class="block-box" hidden></div>
      <p class="form-error" hidden></p>
    </form>`,
    foot: html`<div class="modal-foot"><button type="button" class="btn" data-act="modal-close">취소</button><button class="btn btn-primary" type="submit" form="done-form">완료 처리</button></div>`,
    forms: {
      async save(cc, f, form) {
        try {
          await cc.run('POST', `/api/jobs/${d.job.id}/complete`, { note: f.note });
          cc.modal.close();
          cc.toast('작업을 완료했습니다. 청구서를 발행하세요.');
          cc.go(`/jobs/${d.job.id}/billing`);
        } catch (err) {
          if (['UNAPPROVED_CHANGE_ORDER', 'PENDING_CHANGE_ORDER', 'UNAPPROVED_EXCESS_USAGE'].includes(err.code)) {
            const box = form.querySelector('.block-box');
            box.innerHTML = String(html`<div class="alert alert-critical"><div class="alert-body"><div class="alert-title">완료할 수 없습니다</div><div class="small">${err.message}</div>
              <div><a class="btn btn-sm" href="#/jobs/${d.job.id}/change">추가 작업 탭에서 처리</a></div></div></div>`);
            box.hidden = false;
          } else throw err;
        }
      },
    },
  });
}

function paymentModal(c, inv) {
  c.modal.open({
    title: `수금 기록 — ${inv.id}`,
    body: html`<form class="modal-body" data-form="save" id="pay-form">
      <div class="doc-total"><span>잔액</span><span class="v">${won(inv.totals.balance)}</span></div>
      <div class="fields-2">
        <div class="field"><label for="p-amt">입금액</label><input id="p-amt" name="amount" type="number" min="1" step="1" inputmode="numeric" value="${inv.totals.balance}" required></div>
        <div class="field"><label for="p-m">방법</label><select id="p-m" name="method">${options(PAYMENT_METHODS.map((x) => ({ id: x, name: x })), '계좌이체')}</select></div>
      </div>
      <p class="form-error" hidden></p>
    </form>`,
    foot: html`<div class="modal-foot"><button type="button" class="btn" data-act="modal-close">취소</button><button class="btn btn-primary" type="submit" form="pay-form">수금 기록</button></div>`,
    forms: {
      async save(cc, f) {
        await cc.run('POST', `/api/invoices/${inv.id}/payments`, { amount: Number(f.amount), method: f.method });
        cc.modal.close();
        cc.toast('수금을 기록했습니다.');
      },
    },
  });
}

// ─── 탭 ─────────────────────────────────────────────────

function nextActions(c, d) {
  const j = d.job;
  const latest = d.quotes.filter((q) => q.status !== 'superseded').at(-1);
  const btn = (act, label, primary = false, extra = '') => html`<button type="button" class="btn ${primary ? 'btn-primary' : ''}" data-act="${act}" ${raw(extra)}>${label}</button>`;
  const link = (href, label, primary = false) => html`<a class="btn ${primary ? 'btn-primary' : ''}" href="${href}">${label}</a>`;
  switch (j.status) {
    case 'RECEIVED': return [btn('survey', '현장 확인 예약', true), btn('new-quote', '바로 견적 작성')];
    case 'SURVEY_SCHEDULED': return [btn('survey-done', '현장 확인 결과 입력', true), btn('survey', '방문 일정 변경')];
    case 'SURVEYED':
    case 'REJECTED': return latest?.status === 'draft' ? [link(`#/jobs/${j.id}/quote`, '견적 편집', true)] : [btn('new-quote', '견적 작성', true)];
    case 'QUOTED': return [btn('approve-quote', '고객 승인 기록', true, `data-id="${latest?.id}"`), btn('quote-link', '승인 링크 보내기', false, `data-token="${latest?.token}"`)];
    case 'APPROVED': return [btn('schedule', '작업 배정', true)];
    case 'SCHEDULED': return [btn('start', '작업 시작', true), btn('reserve', '자재 예약'), btn('schedule', '일정 변경')];
    case 'IN_PROGRESS': return [btn('usage', '자재 사용 기록', true), btn('co-new', '추가 작업 요청'), btn('complete', '작업 완료')];
    case 'COMPLETED': return [link(`#/jobs/${j.id}/billing`, '청구서 발행', true)];
    case 'INVOICED': return d.activeInvoice ? [btn('pay', '수금 기록', true, `data-id="${d.activeInvoice.id}"`)] : [];
    default: return [];
  }
}

function overviewTab(c, d) {
  const j = d.job;
  const approvedCO = d.changeOrders.filter((x) => x.status === 'approved');
  const waivedCO = d.changeOrders.filter((x) => x.status === 'waived');
  const inv = d.activeInvoice;
  const aq = d.approvedQuote;
  const supply = inv ? inv.totals.supply : d.basis.supply;
  return html`<div class="grid-2">
    <section class="card"><div class="card-head"><h2>문의 내용</h2><span class="chip">${j.channel}</span></div>
      <div class="card-body">
        <p>${j.symptom || '상세 내용 없음'}</p>
        <dl class="kv">
          <dt>접수</dt><dd>${fmtDateTime(j.createdAt)}</dd>
          ${j.preferredAt ? html`<dt>희망 방문</dt><dd>${fmtDateTime(j.preferredAt)}</dd>` : ''}
          <dt>현장 확인</dt><dd>${j.survey ? html`${crewDot(d.surveyCrew)} ${d.surveyCrew?.name} · ${fmtRange(j.survey.start, j.survey.end)} · ${j.survey.status === 'done' ? '완료' : '예정'}` : '없음'}</dd>
          ${j.survey?.findings ? html`<dt>확인 결과</dt><dd>${j.survey.findings}</dd>` : ''}
          <dt>작업 일정</dt><dd>${j.schedule ? html`${crewDot(d.workCrew)} ${d.workCrew?.name} · ${fmtRange(j.schedule.start, j.schedule.end)}` : '미배정'}</dd>
          ${j.completedAt ? html`<dt>완료</dt><dd>${fmtDateTime(j.completedAt)}${j.completionNote ? ` · ${j.completionNote}` : ''}</dd>` : ''}
          ${j.canceledReason ? html`<dt>취소 사유</dt><dd>${j.canceledReason}</dd>` : ''}
        </dl>
      </div>
    </section>
    <section class="card"><div class="card-head"><h2>금액 요약</h2>${inv ? html`<span class="chip chip-info">${inv.id}</span>` : ''}</div>
      <div class="card-body">
        <dl class="kv num">
          <dt>승인 견적</dt><dd>${aq ? won(totals(aq.items).total) : '미승인'}</dd>
          <dt>승인 추가 작업</dt><dd>${won(approvedCO.reduce((s, x) => s + x.totals.total, 0))} (${approvedCO.length}건)</dd>
          ${waivedCO.length ? html`<dt>무상 처리</dt><dd>${won(waivedCO.reduce((s, x) => s + x.totals.total, 0))} (${waivedCO.length}건)</dd>` : ''}
          <dt>청구 대상</dt><dd class="strong">${won(d.basis.total)}</dd>
          <dt>청구액</dt><dd>${inv ? won(inv.totals.total) : '미발행'}</dd>
          <dt>수금 / 잔액</dt><dd>${inv ? `${won(inv.totals.paid)} / ${won(inv.totals.balance)}` : '-'}</dd>
        </dl>
        <hr class="divider">
        <dl class="kv num">
          <dt>자재 원가</dt><dd>${won(d.cost.materialCost)}</dd>
          <dt>인건비 원가</dt><dd>${won(d.cost.laborCost)} (${fmtQty(d.cost.hours)}시간)</dd>
          <dt>예상 이익</dt><dd class="strong">${won(supply - d.cost.total)}${supply ? ` (${Math.round(((supply - d.cost.total) / supply) * 100)}%)` : ''}</dd>
        </dl>
      </div>
    </section>
  </div>`;
}

function quoteTab(c, d) {
  const j = d.job;
  const quotes = d.quotes.slice().reverse();
  const draft = quotes.find((q) => q.status === 'draft');
  if (draft) ensureEditor(`quote-${draft.id}`, draft.items);
  const canQuote = ['RECEIVED', 'SURVEY_SCHEDULED', 'SURVEYED', 'QUOTED', 'REJECTED'].includes(j.status);
  return html`<div class="stack-lg">
    <section class="card"><div class="card-head"><h2>현장 확인</h2>
      <div class="row">${j.status === 'RECEIVED' || j.status === 'SURVEY_SCHEDULED' ? html`<button class="btn btn-sm" data-act="survey">${j.survey ? '일정 변경' : '방문 예약'}</button>` : ''}
      ${j.status === 'SURVEY_SCHEDULED' ? html`<button class="btn btn-sm btn-primary" data-act="survey-done">결과 입력</button>` : ''}</div></div>
      <div class="card-body">${j.survey ? html`<dl class="kv">
        <dt>방문</dt><dd>${crewDot(d.surveyCrew)} ${d.surveyCrew?.name} · ${fmtRange(j.survey.start, j.survey.end)}${j.survey.forced ? html` <span class="chip chip-warn">충돌 무시: ${j.survey.forceReason}</span>` : ''}</dd>
        <dt>상태</dt><dd>${j.survey.status === 'done' ? `완료 (${fmtDateTime(j.survey.doneAt)})` : '방문 예정'}</dd>
        ${j.survey.findings ? html`<dt>결과</dt><dd>${j.survey.findings}</dd>` : ''}
      </dl>` : empty('현장 확인 없이 바로 견적을 낼 수도 있습니다 (전화 견적·단순 작업).')}</div>
    </section>

    ${draft ? html`<section class="card" data-testid="quote-editor"><div class="card-head"><h2>견적 v${draft.version} 작성</h2><span class="chip">${QUOTE_STATUS_LABEL.draft}</span></div>
      <div class="card-body">
        ${editorHtml(c, `quote-${draft.id}`)}
        <div class="field"><label for="q-note">견적 메모 (고객에게 보임)</label><input id="q-note" type="text" data-quote-note value="${draft.note || ''}" placeholder="예: 부가세 포함, 견적 유효기간 14일"></div>
      </div>
      <div class="card-foot">
        <button class="btn" data-act="quote-save" data-id="${draft.id}">저장</button>
        <button class="btn" data-act="quote-sign" data-id="${draft.id}">${icon('sign')}현장 서명으로 바로 승인</button>
        <button class="btn btn-primary" data-act="quote-send" data-id="${draft.id}">${icon('link')}저장하고 고객에게 발송</button>
      </div>
    </section>` : canQuote ? html`<div class="row"><button class="btn btn-primary" data-act="new-quote">${d.quotes.length ? '새 견적 버전 작성' : '견적 작성'}</button></div>` : ''}

    ${quotes.filter((q) => q.status !== 'draft').map((q) => html`<section class="card ${q.status === 'superseded' ? 'row-muted' : ''}">
      <div class="card-head"><h2>견적 v${q.version}</h2><div class="row"><span class="chip ${q.status === 'approved' ? 'chip-ok' : q.status === 'sent' ? 'chip-warn' : ''}">${QUOTE_STATUS_LABEL[q.status]}</span><span class="num strong">${won(q.totals.total)}</span></div></div>
      <div class="card-body">
        ${q.status === 'superseded' ? html`<p class="small faint">새 버전으로 교체된 견적입니다.</p>` : itemsTable(q.items)}
        ${q.note ? html`<p class="note">${q.note}</p>` : ''}
        ${q.approval ? html`<div class="row"><span class="chip chip-ok">${icon('check', 'ico')} ${q.approval.method}</span><span>${q.approval.by} · ${fmtDateTime(q.approval.at)}</span>${q.approval.signature ? html`<img class="sig-img" src="${q.approval.signature}" alt="${q.approval.by} 서명">` : ''}${q.approval.memo ? html`<span class="small muted">${q.approval.memo}</span>` : ''}</div>` : ''}
        ${q.status === 'rejected' ? html`<p class="small">거절 사유: ${q.rejectReason || '-'}</p>` : ''}
      </div>
      ${q.status === 'sent' ? html`<div class="card-foot">
        <button class="btn btn-danger" data-act="reject-quote" data-id="${q.id}">거절 처리</button>
        <button class="btn" data-act="quote-link" data-token="${q.token}">${icon('link')}승인 링크</button>
        <button class="btn btn-primary" data-act="approve-quote" data-id="${q.id}">고객 승인 기록</button>
      </div>` : ''}
    </section>`)}
  </div>`;
}

function materialTab(c, d) {
  const j = d.job;
  const flagged = new Set(d.findings.filter((f) => f.category === 'MATERIAL').flatMap((f) => f.refs));
  const approved = approvedQuantities(c.state, j.id);
  const used = usedQuantities(c.state, j.id);
  const reservedBy = new Map();
  d.reservations.filter((r) => r.status === 'active').forEach((r) => reservedBy.set(r.materialId, (reservedBy.get(r.materialId) || 0) + r.outstanding));
  const matIds = [...new Set([...approved.keys(), ...used.keys(), ...reservedBy.keys()])];
  const canReserve = ['APPROVED', 'SCHEDULED', 'IN_PROGRESS'].includes(j.status);
  const canUse = ['IN_PROGRESS', 'COMPLETED'].includes(j.status);
  return html`<div class="stack-lg">
    <section class="card"><div class="card-head"><h2>작업 배정</h2>${['APPROVED', 'SCHEDULED'].includes(j.status) ? html`<button class="btn btn-sm ${j.schedule ? '' : 'btn-primary'}" data-act="schedule">${j.schedule ? '일정 변경' : '작업 배정'}</button>` : ''}</div>
      <div class="card-body">${j.schedule ? html`<dl class="kv">
        <dt>팀</dt><dd>${crewDot(d.workCrew)} ${d.workCrew?.name} (${d.workCrew?.members.join(', ')})</dd>
        <dt>일정</dt><dd>${fmtRange(j.schedule.start, j.schedule.end)}</dd>
        ${j.schedule.forced ? html`<dt>경고</dt><dd><span class="chip chip-crit">충돌 무시 배정</span> ${j.schedule.forceReason}</dd>` : ''}
      </dl>` : empty(j.status === 'APPROVED' ? '고객 승인이 끝났습니다. 팀과 일정을 배정하세요.' : '고객 승인 후 배정할 수 있습니다.')}</div>
    </section>

    ${matIds.length ? html`<section class="card"><div class="card-head"><h2>승인·예약·사용 대조</h2><span class="small muted">승인보다 많이 쓰면 추가 작업 승인이 필요합니다</span></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>자재</th><th class="num">고객 승인</th><th class="num">예약(남음)</th><th class="num">사용</th><th>판정</th></tr></thead>
      <tbody>${matIds.map((id) => {
        const m = c.state.materials.find((x) => x.id === id);
        const a = approved.get(id) || 0;
        const u = used.get(id) || 0;
        const over = u - a;
        const coPending = d.changeOrders.some((co) => co.status === 'requested' && co.items.some((it) => it.materialId === id));
        return html`<tr class="${over > 0 ? (coPending ? 'row-warn' : 'row-crit') : ''}"><td>${m?.name}</td><td class="num">${fmtQty(a)}${m?.unit}</td><td class="num">${fmtQty(reservedBy.get(id) || 0)}</td><td class="num">${fmtQty(u)}${m?.unit}</td>
          <td>${over > 0 ? html`<span class="chip ${coPending ? 'chip-warn' : 'chip-crit'}">+${fmtQty(over)}${m?.unit} ${coPending ? '승인 대기' : '승인 없음'}</span>` : u ? html`<span class="chip chip-ok">정상</span>` : ''}</td></tr>`;
      })}</tbody></table></div>
      ${d.excess.length ? html`<div class="card-foot"><button class="btn btn-warn" data-act="co-excess">초과분을 추가 작업으로 만들기</button></div>` : ''}
    </section>` : ''}

    <section class="card" data-testid="reservations"><div class="card-head"><h2>자재·장비 예약</h2>${canReserve ? html`<button class="btn btn-sm btn-primary" data-act="reserve">${icon('plus')}예약</button>` : ''}</div>
      ${d.reservations.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>번호</th><th>자재</th><th class="num">예약</th><th class="num">사용</th><th>상태</th><th></th></tr></thead>
        <tbody>${d.reservations.map((r) => html`<tr class="${flagged.has(r.id) && r.status === 'active' ? 'row-crit' : r.status !== 'active' ? 'row-muted' : ''}">
          <td class="mono">${r.id}</td><td>${r.material?.name}${r.forced ? html` <span class="chip chip-warn" title="${r.forceReason}">경고 무시</span>` : ''}</td>
          <td class="num">${fmtQty(r.qty)}${r.material?.unit}</td><td class="num">${fmtQty(r.usedQty)}</td><td>${RESERVATION_STATUS_LABEL[r.status]}</td>
          <td class="right nowrap">${r.status === 'active' ? html`<button class="btn btn-sm" data-act="res-adjust" data-id="${r.id}" data-qty="${r.qty}">수량</button> <button class="btn btn-sm btn-ghost" data-act="res-release" data-id="${r.id}">해제</button>` : ''}</td></tr>`)}</tbody></table></div>` : html`<div class="card-body">${empty('예약된 자재가 없습니다.')}</div>`}
    </section>

    <section class="card"><div class="card-head"><h2>자재 사용 기록</h2>${canUse ? html`<button class="btn btn-sm btn-primary" data-act="usage">${icon('plus')}사용 기록</button>` : ''}</div>
      ${d.usages.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>시각</th><th>자재</th><th class="num">수량</th><th>추가 작업</th><th>기록자</th><th>메모</th></tr></thead>
        <tbody>${d.usages.map((u) => html`<tr class="${u.changeOrder && !['approved', 'waived'].includes(u.changeOrder.status) ? 'row-crit' : ''}"><td class="nowrap">${fmtDateTime(u.at)}</td><td>${u.material?.name}</td><td class="num">${fmtQty(u.qty)}${u.material?.unit}</td>
          <td>${u.changeOrder ? html`${u.changeOrder.title} <span class="chip">${CO_STATUS_LABEL[u.changeOrder.status]}</span>` : '-'}</td><td class="small">${u.by}</td><td class="small muted">${u.note}</td></tr>`)}</tbody></table></div>` : html`<div class="card-body">${empty(canUse ? '현장에서 쓴 자재를 바로 기록하세요.' : '작업 시작 후 기록합니다.')}</div>`}
    </section>
  </div>`;
}

function changeTab(c, d) {
  const j = d.job;
  const canRequest = ['SCHEDULED', 'IN_PROGRESS'].includes(j.status);
  return html`<div class="stack-lg">
    <div class="row-between">
      <p class="small muted" style="max-width:640px">현장에서 견적에 없던 작업이 생기면 먼저 요청을 만들고, 고객 서명이나 링크 승인을 받은 뒤 작업하세요. 승인된 추가 작업은 청구서에 자동으로 들어갑니다.</p>
      <div class="row">${d.excess.length ? html`<button class="btn btn-warn" data-act="co-excess">초과 사용분 추가 작업 만들기</button>` : ''}${canRequest ? html`<button class="btn btn-primary" data-act="co-new">${icon('plus')}추가 작업 요청</button>` : ''}</div>
    </div>
    ${d.changeOrders.length ? d.changeOrders.map((co) => {
      const unapproved = co.performed && !['approved', 'waived'].includes(co.status);
      return html`<section class="card" data-testid="co-${co.id}" style="${unapproved ? 'border-color:var(--crit-line)' : ''}">
        <div class="card-head"><div class="row"><span class="mono xs faint">${co.id}</span><h2>${co.title}</h2></div>
          <div class="row"><span class="chip ${co.status === 'approved' ? 'chip-ok' : co.status === 'requested' ? 'chip-warn' : co.status === 'rejected' ? 'chip-crit' : ''}">${CO_STATUS_LABEL[co.status]}</span>
          ${co.performed ? html`<span class="chip ${unapproved ? 'chip-crit' : 'chip-info'}">${unapproved ? '승인 없이 수행됨' : '수행됨'}</span>` : html`<span class="chip">미수행</span>`}
          <span class="num strong">${won(co.totals.total)}</span></div></div>
        <div class="card-body">
          ${co.reason ? html`<p>${co.reason}</p>` : ''}
          ${itemsTable(co.items)}
          <div class="small muted">요청 ${fmtDateTime(co.requestedAt)} · ${co.requestedBy}</div>
          ${co.approval ? html`<div class="row"><span class="chip chip-ok">${co.approval.method}</span><span>${co.approval.by} · ${fmtDateTime(co.approval.at)}</span>${co.approval.signature ? html`<img class="sig-img" src="${co.approval.signature}" alt="${co.approval.by} 서명">` : ''}</div>` : ''}
          ${co.status === 'waived' ? html`<p class="note">무상 처리: ${co.waiveReason} (${co.waivedBy})</p>` : ''}
          ${co.status === 'rejected' ? html`<p class="note">고객 거절${co.rejectReason ? `: ${co.rejectReason}` : ''}</p>` : ''}
        </div>
        ${['requested', 'rejected', 'approved'].includes(co.status) && !['INVOICED', 'PAID', 'CANCELED'].includes(j.status) ? html`<div class="card-foot">
          ${co.status === 'requested' && !co.performed ? html`<button class="btn btn-ghost" data-act="co-cancel" data-id="${co.id}">요청 철회</button>` : ''}
          ${co.status === 'requested' ? html`<button class="btn btn-danger" data-act="co-reject" data-id="${co.id}">거절 처리</button>` : ''}
          ${co.status !== 'approved' ? html`<button class="btn" data-act="co-waive" data-id="${co.id}">무상 처리</button>` : ''}
          ${co.status !== 'approved' && co.token ? html`<button class="btn" data-act="co-link" data-token="${co.token}">${icon('link')}승인 링크</button>` : ''}
          ${!co.performed && j.status === 'IN_PROGRESS' ? html`<button class="btn" data-act="co-perform" data-id="${co.id}" data-approved="${co.status === 'approved'}">수행 표시</button>` : ''}
          ${co.status !== 'approved' ? html`<button class="btn btn-primary" data-act="co-approve" data-id="${co.id}">${icon('sign')}고객 승인 받기</button>` : ''}
        </div>` : ''}
      </section>`;
    }) : empty('추가 작업 요청이 없습니다.')}
  </div>`;
}

function billingTab(c, d) {
  const j = d.job;
  const inv = d.activeInvoice;
  const building = j.status === 'COMPLETED' && !inv;
  const groups = [...new Set(d.basis.lines.map((l) => l.group))];
  return html`<div class="stack-lg">
    ${building ? html`<form class="card" data-form="invoice" data-change="inv-recalc" data-input="inv-recalc" id="inv-form">
      <div class="card-head"><h2>청구서 발행</h2><span class="small muted">승인 견적과 승인된 추가 작업이 자동으로 모두 들어갑니다</span></div>
      <div class="card-body">
        ${groups.map((g) => html`<div class="stack" style="gap:6px"><div class="small strong muted">${g}</div>
          ${d.basis.lines.filter((l) => l.group === g).map((l) => html`<label class="check row-between" style="padding:6px 0;border-bottom:1px dashed var(--line)">
            <span class="row"><input type="checkbox" name="include[]" value="${l.refId}" checked data-amount="${lineAmount(l)}"> ${l.name} <span class="faint small">${fmtQty(l.qty)}${l.unit} × ${won(l.unitPrice)}</span></span>
            <span class="num">${won(lineAmount(l))}</span></label>`)}</div>`)}
        <div class="stack" style="gap:6px"><div class="small strong muted">추가 청구 (선택)</div>
          <div class="fields-3"><input type="text" name="x_name" placeholder="항목명 (예: 주차비)" aria-label="추가 항목명"><input type="number" name="x_qty" min="0" step="any" placeholder="수량" aria-label="추가 항목 수량"><input type="number" name="x_price" min="0" step="1" placeholder="단가" aria-label="추가 항목 단가"></div></div>
        <div class="alert alert-critical omit-warn" hidden><div class="alert-body"><div class="alert-title">승인된 항목을 빼면 '청구 누락'으로 기록됩니다</div>
          <div class="field"><label for="i-omit">제외 사유 (필수)</label><input id="i-omit" name="omissionReason" type="text" maxlength="300" placeholder="예: 고객과 합의해 할인"></div></div></div>
        <div class="row-between"><div class="field" style="max-width:160px"><label for="i-due">결제 기한(일)</label><input id="i-due" name="dueDays" type="number" min="1" value="${settingsOf(c.state).paymentDueDays}"></div>
          <div class="doc-total" style="min-width:260px"><span>청구 합계</span><span class="v" data-inv-total>${won(d.basis.total)}</span></div></div>
        <p class="form-error" hidden></p>
      </div>
      <div class="card-foot"><button class="btn btn-primary btn-lg" type="submit">청구서 발행</button></div>
    </form>` : ''}

    ${!inv && !building ? html`<section class="card"><div class="card-head"><h2>청구 예정 내역</h2><span class="small muted">작업 완료 후 발행할 수 있습니다</span></div>
      <div class="card-body">${d.basis.lines.length ? itemsTable(d.basis.lines) : empty('고객 승인 견적이 생기면 청구 예정 내역이 표시됩니다.')}</div></section>` : ''}

    ${d.invoices.map((i) => html`<section class="card ${i.status === 'void' ? 'row-muted' : ''}" data-testid="invoice-${i.id}">
      <div class="card-head"><div class="row"><h2>청구서 ${i.id}</h2><span class="chip ${i.status === 'paid' ? 'chip-ok' : i.status === 'void' ? '' : 'chip-warn'}">${INVOICE_STATUS_LABEL[i.status]}</span></div>
        <span class="small muted">발행 ${fmtDateTime(i.issuedAt)} · 결제 기한 ${i.dueDate}</span></div>
      <div class="card-body">
        ${i.omissionReason ? html`<div class="alert alert-warning"><div class="alert-body"><div class="alert-title">승인 항목 일부 제외</div><div class="small">${i.omissionReason}</div></div></div>` : ''}
        ${itemsTable(i.items)}
        ${i.payments.length ? html`<dl class="kv num">${i.payments.map((p) => html`<dt>${fmtDateTime(p.at)}</dt><dd>${won(p.amount)} · ${p.method}</dd>`)}</dl>` : ''}
        <div class="doc-total"><span>잔액</span><span class="v">${won(i.totals.balance)}</span></div>
        ${i.voidReason ? html`<p class="note">취소 사유: ${i.voidReason}</p>` : ''}
      </div>
      ${['issued', 'partial'].includes(i.status) ? html`<div class="card-foot">
        ${i.status === 'issued' ? html`<button class="btn btn-ghost" data-act="inv-void" data-id="${i.id}">청구서 취소</button>` : ''}
        <button class="btn btn-primary" data-act="pay" data-id="${i.id}">수금 기록</button></div>` : ''}
    </section>`)}
  </div>`;
}

function historyTab(c, d) {
  return html`<section class="card"><div class="card-head"><h2>처리 이력</h2><span class="small muted">누가 언제 무엇을 했는지 모두 남습니다</span></div>
    <div class="card-body">${d.events.length ? html`<ul class="timeline-list">${d.events.map((e) => html`<li class="${e.level === 'warn' ? 'warn' : ''}"><span class="when">${fmtDateTime(e.at)}</span><span class="what">${e.message} <span class="faint">— ${e.actor}</span></span></li>`)}</ul>` : empty('이력이 없습니다.')}</div>
  </section>`;
}

// ─── 뷰 ─────────────────────────────────────────────────

function detail(c) {
  return jobDetail(c.state, c.params.id, c.now);
}

export default {
  title: (c) => c.params.id,
  back: () => '#/jobs',
  render(c) {
    const d = detail(c);
    const j = d.job;
    const tab = TABS.some((t) => t.key === c.params.tab) ? c.params.tab : 'overview';
    const open = d.findings.filter((f) => !f.acked);
    const counts = {};
    open.forEach((f) => { const t = tabOf(f); counts[t] = (counts[t] || 0) + 1; });
    const body = { overview: overviewTab, quote: quoteTab, material: materialTab, change: changeTab, billing: billingTab, history: historyTab }[tab](c, d);
    const actions = nextActions(c, d);
    const cancellable = !['COMPLETED', 'INVOICED', 'PAID', 'CANCELED'].includes(j.status);
    return html`
      <section class="card">
        <div class="card-body">
          <div class="row-between">
            <div class="row"><span class="mono faint">${j.id}</span>${statusChip(j.status)}${j.urgency === 'urgent' ? html`<span class="chip chip-crit">긴급</span>` : ''}<span class="chip chip-outline">${j.channel}</span></div>
            ${cancellable ? html`<button class="btn btn-ghost btn-sm" data-act="cancel-job">작업 취소</button>` : ''}
          </div>
          <h1 data-testid="job-title">${j.title}</h1>
          <div class="row small muted"><span>${d.customer?.name} (${d.customer?.type})</span><a href="tel:${d.customer?.phone}" class="row" style="gap:4px">${icon('phone')}${d.customer?.phone}</a><span class="row" style="gap:4px">${icon('pin')}${j.address}</span></div>
          ${stepper(j, { blocked: open.some((f) => f.severity === 'critical') })}
          ${actions.length ? html`<div class="row" data-testid="next-actions">${actions}</div>` : ''}
        </div>
      </section>
      ${open.length ? html`<div class="stack" data-testid="job-findings">${open.map((f) => findingAlert(f))}</div>` : ''}
      <nav class="tabs" role="tablist" aria-label="작업건 메뉴">${TABS.map((t) => html`<a role="tab" href="#/jobs/${j.id}/${t.key}" aria-selected="${t.key === tab}">${t.label}${counts[t.key] ? html`<span class="badge">${counts[t.key]}</span>` : ''}</a>`)}</nav>
      ${body}
    `;
  },
  actions: {
    ...editorActions,
    survey(c) { scheduleModal(c, detail(c).job, 'survey'); },
    schedule(c) { scheduleModal(c, detail(c).job, 'work'); },
    'survey-done'(c) {
      textModal(c, { title: '현장 확인 결과', label: '확인 결과와 필요한 작업', placeholder: '예: 배수 트랩 균열, 연결관 노후. 트랩·연결관 교체 필요.', submit: '저장', onSubmit: async (cc, v) => { await cc.run('POST', `/api/jobs/${c.params.id}/survey/complete`, { findings: v }); cc.toast('현장 확인 결과를 저장했습니다. 견적을 작성하세요.'); } });
    },
    async 'new-quote'(c) {
      const q = await c.run('POST', `/api/jobs/${c.params.id}/quotes`, { items: [] });
      openEditor(`quote-${q.id}`, q.items);
      c.go(`/jobs/${c.params.id}/quote`);
    },
    async 'quote-save'(c, el) {
      await saveQuote(c, el.dataset.id);
      c.toast('견적을 저장했습니다.');
    },
    async 'quote-send'(c, el) {
      await saveQuote(c, el.dataset.id);
      const q = await c.run('POST', `/api/quotes/${el.dataset.id}/send`);
      linkModal(c, { title: '견적 발송 — 고객 승인 링크', url: customerUrl('q', q.token) });
    },
    async 'quote-sign'(c, el) {
      const q = await saveQuote(c, el.dataset.id);
      const d = detail(c);
      approveModal(c, { kind: 'quote', id: q.id, title: `견적 v${q.version}`, amount: totals(q.items).total, by: d.customer?.name || '' });
    },
    'approve-quote'(c, el) {
      const d = detail(c);
      const q = d.quotes.find((x) => x.id === el.dataset.id);
      approveModal(c, { kind: 'quote', id: q.id, title: `견적 v${q.version}`, amount: q.totals.total, by: d.customer?.name || '' });
    },
    'reject-quote'(c, el) {
      textModal(c, { title: '견적 거절 처리', label: '거절 사유', required: false, submit: '거절 처리', onSubmit: async (cc, v) => { await cc.run('POST', `/api/quotes/${el.dataset.id}/reject`, { reason: v }); cc.toast('거절로 기록했습니다.'); } });
    },
    'quote-link'(c, el) { linkModal(c, { title: '견적 승인 링크', url: customerUrl('q', el.dataset.token) }); },
    async start(c) {
      await c.run('POST', `/api/jobs/${c.params.id}/start`);
      c.toast('작업을 시작했습니다.');
    },
    reserve(c) { reserveModal(c, detail(c)); },
    'res-adjust'(c, el) {
      textModal(c, { title: '예약 수량 변경', label: '새 수량', value: el.dataset.qty, multiline: false, submit: '변경', onSubmit: async (cc, v) => { await cc.run('PATCH', `/api/reservations/${el.dataset.id}`, { qty: Number(v) }); cc.toast('수량을 바꿨습니다.'); } });
    },
    async 'res-release'(c, el) {
      if (!(await c.confirm({ title: '예약 해제', message: '이 예약을 해제하면 재고가 다른 작업에 풀립니다.', confirmLabel: '해제' }))) return;
      await c.run('POST', `/api/reservations/${el.dataset.id}/release`);
      c.toast('예약을 해제했습니다.');
    },
    usage(c) { usageModal(c, detail(c)); },
    'co-new'(c) { changeOrderModal(c, detail(c)); },
    async 'co-excess'(c) {
      const co = await c.run('POST', `/api/jobs/${c.params.id}/change-orders/from-excess`);
      c.go(`/jobs/${c.params.id}/change`);
      approveModal(c, { kind: 'co', id: co.id, title: co.title, amount: totals(co.items).total, by: detail(c).customer?.name || '', note: '견적보다 더 쓴 자재를 추가 작업으로 만들었습니다. 고객 승인을 받거나, 받을 수 없으면 무상 처리하세요.' });
    },
    'co-approve'(c, el) {
      const d = detail(c);
      const co = d.changeOrders.find((x) => x.id === el.dataset.id);
      approveModal(c, { kind: 'co', id: co.id, title: co.title, amount: co.totals.total, by: d.customer?.name || '' });
    },
    'co-link'(c, el) { linkModal(c, { title: '추가 작업 승인 링크', url: customerUrl('co', el.dataset.token) }); },
    'co-reject'(c, el) {
      textModal(c, { title: '추가 작업 거절 처리', label: '거절 사유', required: false, submit: '거절 처리', onSubmit: async (cc, v) => { await cc.run('POST', `/api/change-orders/${el.dataset.id}/reject`, { reason: v }); cc.toast('거절로 기록했습니다.'); } });
    },
    'co-waive'(c, el) {
      textModal(c, { title: '무상 처리', label: '무상 처리 사유 (청구하지 않는 이유)', placeholder: '예: 단골 고객 서비스, 당사 과실', submit: '무상 처리', onSubmit: async (cc, v) => { await cc.run('POST', `/api/change-orders/${el.dataset.id}/waive`, { reason: v }); cc.toast('무상 처리했습니다.'); } });
    },
    async 'co-cancel'(c, el) {
      await c.run('POST', `/api/change-orders/${el.dataset.id}/cancel`);
      c.toast('요청을 철회했습니다.');
    },
    async 'co-perform'(c, el) {
      if (el.dataset.approved !== 'true') {
        const ok = await c.confirm({ title: '승인 전 작업', message: '아직 고객 승인이 없습니다. 지금 수행 표시하면 "승인 누락"으로 기록되고, 승인을 받거나 무상 처리하기 전에는 작업을 완료할 수 없습니다.', confirmLabel: '그래도 수행 표시', danger: true });
        if (!ok) return;
      }
      await c.run('POST', `/api/change-orders/${el.dataset.id}/perform`, {});
      c.toast('수행으로 표시했습니다.');
    },
    complete(c) { completeModal(c, detail(c)); },
    pay(c, el) {
      const inv = detail(c).invoices.find((x) => x.id === el.dataset.id);
      paymentModal(c, inv);
    },
    'inv-void'(c, el) {
      textModal(c, { title: '청구서 취소', label: '취소 사유', submit: '청구서 취소', onSubmit: async (cc, v) => { await cc.run('POST', `/api/invoices/${el.dataset.id}/void`, { reason: v }); cc.toast('청구서를 취소했습니다. 다시 발행할 수 있습니다.'); } });
    },
    'cancel-job'(c) {
      textModal(c, { title: '작업 취소', label: '취소 사유', submit: '작업 취소', onSubmit: async (cc, v) => { await cc.run('POST', `/api/jobs/${c.params.id}/cancel`, { reason: v }); cc.toast('작업을 취소했습니다.'); } });
    },
  },
  inputs: {
    ...editorInputs,
    'inv-recalc': recalcInvoice,
  },
  changes: {
    'inv-recalc': recalcInvoice,
  },
  forms: {
    async invoice(c, f, form) {
      const d = detail(c);
      const include = new Set(f.include || []);
      const excludeRefs = d.basis.lines.map((l) => l.refId).filter((r) => !include.has(r));
      const extraItems = f.x_name ? [{ name: f.x_name, qty: Number(f.x_qty || 1), unitPrice: Number(f.x_price || 0), kind: 'etc' }] : [];
      try {
        const inv = await c.run('POST', `/api/jobs/${d.job.id}/invoices`, { excludeRefs, extraItems, omissionReason: f.omissionReason, dueDays: Number(f.dueDays) });
        c.toast(`청구서 ${inv.id} 발행`);
      } catch (err) {
        const box = form.querySelector('.form-error');
        box.textContent = err.message;
        box.hidden = false;
      }
    },
  },
};

function recalcInvoice(c, el) {
  const form = el.closest ? el.closest('form') || el : el;
  const boxes = [...form.querySelectorAll('input[name="include[]"]')];
  let supply = boxes.filter((b) => b.checked).reduce((s, b) => s + Number(b.dataset.amount), 0);
  const xq = Number(form.x_qty?.value || 0);
  const xp = Number(form.x_price?.value || 0);
  if (form.x_name?.value) supply += Math.round((xq || 1) * xp);
  const total = totals([{ qty: 1, unitPrice: supply }]).total;
  form.querySelector('[data-inv-total]').textContent = won(total);
  form.querySelector('.omit-warn').hidden = boxes.every((b) => b.checked);
}

async function saveQuote(c, quoteId) {
  const note = document.querySelector('[data-quote-note]')?.value;
  const q = await c.run('PUT', `/api/quotes/${quoteId}`, { items: payloadItems(`quote-${quoteId}`), note });
  openEditor(`quote-${q.id}`, q.items);
  return q;
}

