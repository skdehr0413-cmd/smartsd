// 고객용 화면: 문자로 받은 링크에서 견적·추가 작업을 확인하고 서명해 승인한다.
import { html, won, fmtDateTime, itemsTable, signaturePad, brandMark } from '../ui.js';

function key(c) {
  return `public:${c.params.kind}:${c.params.token}`;
}

async function load(c) {
  const k = key(c);
  const path = c.params.kind === 'co' ? `/api/public/change-orders/${c.params.token}` : `/api/public/quotes/${c.params.token}`;
  try {
    const r = await c.request('GET', path);
    c.cache.set(k, { data: r.data });
  } catch (err) {
    c.cache.set(k, { error: err.message });
  }
  c.render();
}

export default {
  title: () => '승인 요청',
  render(c) {
    const entry = c.cache.get(key(c));
    if (!entry) {
      load(c);
      return html`<div class="boot">불러오는 중…</div>`;
    }
    if (entry.error) return html`<div class="doc-page"><div class="card card-pad stack"><h1>링크를 열 수 없습니다</h1><p class="muted">${entry.error}</p></div></div>`;
    const d = entry.data;
    const isCo = d.kind === 'change';
    const pending = isCo ? d.status === 'requested' : d.status === 'sent';
    return html`<div class="doc-page">
      ${c.mode === 'standalone' || c.state ? html`<div class="alert alert-info"><div class="alert-body small">데모: 고객이 문자로 받은 링크를 열었을 때 보는 화면입니다. <a href="#/jobs/${d.job.id}">업체 화면으로 돌아가기</a></div></div>` : ''}
      <article class="doc">
        <header class="doc-head">
          <div class="row">${brandMark}<div><strong>${d.company.name}</strong><div class="small muted">${d.company.phone}</div></div></div>
          <div class="doc-type">${isCo ? '추가 작업' : '견 적 서'}</div>
        </header>
        <div class="doc-body">
          <p><strong>${d.customer.name}</strong> 고객님, ${isCo ? '작업 중 추가로 필요한 작업이 확인되어 승인을 요청드립니다.' : '요청하신 작업의 견적을 보내 드립니다.'}</p>
          <dl class="kv">
            <dt>작업</dt><dd>${d.job.title}</dd>
            <dt>현장</dt><dd>${d.job.address}</dd>
            ${isCo ? html`<dt>추가 작업</dt><dd><strong>${d.title}</strong></dd><dt>사유</dt><dd>${d.reason || '-'}</dd><dt>요청 시각</dt><dd>${fmtDateTime(d.requestedAt)}</dd>`
              : html`${d.job.findings ? html`<dt>현장 확인</dt><dd>${d.job.findings}</dd>` : ''}<dt>발행</dt><dd>${fmtDateTime(d.sentAt)} · 유효 ${d.validDays}일</dd>`}
          </dl>
          ${itemsTable(d.items, { showKind: false })}
          ${d.note ? html`<p class="note">${d.note}</p>` : ''}
          <div class="doc-total"><span>${isCo ? '추가 금액' : '견적 금액'} (부가세 포함)</span><span class="v" data-testid="doc-total">${won(d.totals.total)}</span></div>
          ${isCo && d.baseTotal ? html`<p class="small muted">기존 승인 금액 ${won(d.baseTotal)} → 승인 시 합계 ${won(d.baseTotal + d.totals.total)}</p>` : ''}
        </div>
      </article>
      ${pending ? html`<form class="card" data-form="approve" id="cust-form">
        <div class="card-body form">
          <h2>승인하기</h2>
          <div class="field"><label for="c-name">성함</label><input id="c-name" name="name" type="text" required value="${d.customer.name}"></div>
          ${signaturePad('customer-sig')}
          <label class="check"><input type="checkbox" name="agree" value="1" required> 위 작업 내용과 금액에 동의합니다.</label>
          <p class="form-error" hidden></p>
        </div>
        <div class="card-foot"><button type="button" class="btn btn-danger" data-act="reject">거절</button><button class="btn btn-primary btn-lg" type="submit">서명하고 승인</button></div>
      </form>` : html`<div class="alert ${d.status === 'approved' ? 'alert-ok' : 'alert-warning'}"><div class="alert-body">
        <div class="alert-title" data-testid="customer-result">${d.status === 'approved' ? '승인이 완료되었습니다. 감사합니다.' : d.status === 'rejected' ? '거절 처리되었습니다.' : '이미 처리되었거나 새 견적으로 바뀐 요청입니다.'}</div>
        ${d.approval ? html`<div class="small">${d.approval.by} · ${fmtDateTime(d.approval.at)} · ${d.approval.method}</div>` : ''}
      </div></div>`}
      <p class="xs faint" style="text-align:center">문의: ${d.company.name} ${d.company.phone}</p>
    </div>`;
  },
  forms: {
    async approve(c, f, form) {
      const pad = c.getPad('customer-sig');
      const box = form.querySelector('.form-error');
      if (!pad || pad.isEmpty()) {
        box.textContent = '서명을 해 주세요.';
        box.hidden = false;
        return;
      }
      const base = c.params.kind === 'co' ? '/api/public/change-orders' : '/api/public/quotes';
      try {
        await c.request('POST', `${base}/${c.params.token}/approve`, { name: f.name, signature: pad.toDataURL() });
        await refreshStaffState(c);
        await load(c);
      } catch (err) {
        box.textContent = err.message;
        box.hidden = false;
      }
    },
  },
  actions: {
    async reject(c) {
      if (!(await c.confirm({ title: '거절', message: '이 요청을 거절하시겠습니까? 업체에 거절로 전달됩니다.', confirmLabel: '거절', danger: true }))) return;
      const base = c.params.kind === 'co' ? '/api/public/change-orders' : '/api/public/quotes';
      await c.request('POST', `${base}/${c.params.token}/reject`, { reason: '고객 링크에서 거절' });
      await refreshStaffState(c);
      await load(c);
    },
  },
};

async function refreshStaffState(c) {
  // 단독 데모에서는 같은 브라우저의 업체 화면이 바로 바뀐 상태를 보도록 다시 불러온다.
  if (c.state) await c.reload().catch(() => {});
}
