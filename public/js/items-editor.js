// 견적·추가 작업 항목 편집기 (행 추가/삭제, 자재·인건비 빠른 추가, 합계 즉시 계산)
import { html, raw, won, totals, lineAmount, options } from './ui.js';
import { ITEM_KINDS } from '../core/constants.js';

const editors = new Map();

export function openEditor(id, items = []) {
  const ed = { id, items: items.map((it) => ({ kind: it.kind || 'etc', materialId: it.materialId || null, name: it.name, qty: it.qty, unit: it.unit || '식', unitPrice: it.unitPrice })) };
  editors.set(id, ed);
  return ed;
}

export const getEditor = (id) => editors.get(id);

export function ensureEditor(id, items) {
  return editors.get(id) || openEditor(id, items);
}

export function payloadItems(id) {
  const ed = editors.get(id);
  return (ed?.items || []).map((it) => ({ ...it, qty: Number(it.qty), unitPrice: Number(it.unitPrice) }));
}

function rowHtml(ed, it, i) {
  const f = (field) => raw(`data-input="ed-field" data-ed="${ed.id}" data-row="${i}" data-field="${field}"`);
  return html`<div class="item-row" data-row="${i}">
    <select class="c-kind" ${f('kind')} aria-label="구분" ${it.materialId ? raw('disabled') : ''}>${options(Object.entries(ITEM_KINDS).map(([k, v]) => ({ id: k, name: v })), it.kind)}</select>
    <input class="c-name" type="text" value="${it.name}" ${f('name')} aria-label="품명" placeholder="품명">
    <input class="c-qty" type="number" step="any" min="0" inputmode="decimal" value="${it.qty}" ${f('qty')} aria-label="수량">
    <input class="c-unit" type="text" value="${it.unit}" ${f('unit')} aria-label="단위">
    <input class="c-price" type="number" step="1" min="0" inputmode="numeric" value="${it.unitPrice}" ${f('unitPrice')} aria-label="단가">
    <span class="amount" data-amount>${won(lineAmount(it))}</span>
    <button type="button" class="icon-btn c-del" data-act="ed-del" data-ed="${ed.id}" data-row="${i}" aria-label="${it.name} 삭제">✕</button>
  </div>`;
}

function totalsHtml(items) {
  const t = totals(items);
  return html`<dt>공급가액</dt><dd>${won(t.supply)}</dd><dt>부가세</dt><dd>${won(t.vat)}</dd><dt class="grand">합계</dt><dd class="grand">${won(t.total)}</dd>`;
}

export function editorHtml(c, id) {
  const ed = editors.get(id);
  const mats = c.state.materials;
  const catalog = c.state.meta.laborCatalog || [];
  return html`<div class="items-editor" data-editor="${id}">
    <div class="item-row head"><span>구분</span><span>품명</span><span>수량</span><span>단위</span><span>단가</span><span class="right">금액</span><span></span></div>
    ${ed.items.length ? ed.items.map((it, i) => rowHtml(ed, it, i)) : html`<div class="empty">아래에서 자재나 인건비를 추가하세요.</div>`}
    <div class="row">
      <select data-ed-mat="${id}" aria-label="추가할 자재" style="max-width:320px" class="grow">${options(mats, '', { label: (m) => `${m.kind === 'equipment' ? '[장비] ' : ''}${m.name} · ${won(m.price)}/${m.unit}`, placeholder: '자재·장비 선택' })}</select>
      <button type="button" class="btn btn-sm" data-act="ed-add-material" data-ed="${id}">자재 추가</button>
      <button type="button" class="btn btn-sm btn-ghost" data-act="ed-add-row" data-ed="${id}">빈 줄 추가</button>
    </div>
    <div class="quick" aria-label="인건비 빠른 추가">
      ${catalog.map((l) => html`<button type="button" class="btn btn-sm" data-act="ed-add-labor" data-ed="${id}" data-name="${l.name}" data-price="${l.unitPrice}" data-unit="${l.unit}">+ ${l.name}</button>`)}
    </div>
    <dl class="totals" data-ed-totals>${totalsHtml(ed.items)}</dl>
  </div>`;
}

function rerenderEditor(c, id) {
  const el = document.querySelector(`[data-editor="${id}"]`);
  if (el) el.outerHTML = String(editorHtml(c, id));
}

export const editorActions = {
  'ed-add-material'(c, el) {
    const id = el.dataset.ed;
    const sel = document.querySelector(`[data-ed-mat="${id}"]`);
    const m = c.state.materials.find((x) => x.id === sel?.value);
    if (!m) return c.toast('추가할 자재를 선택하세요.', 'warn');
    const ed = editors.get(id);
    const existing = ed.items.find((it) => it.materialId === m.id);
    if (existing) existing.qty = Number(existing.qty) + 1;
    else ed.items.push({ kind: m.kind === 'equipment' ? 'equipment' : 'material', materialId: m.id, name: m.name, qty: 1, unit: m.unit, unitPrice: m.price });
    rerenderEditor(c, id);
  },
  'ed-add-labor'(c, el) {
    const ed = editors.get(el.dataset.ed);
    ed.items.push({ kind: 'labor', materialId: null, name: el.dataset.name, qty: 1, unit: el.dataset.unit || '식', unitPrice: Number(el.dataset.price) });
    rerenderEditor(c, el.dataset.ed);
  },
  'ed-add-row'(c, el) {
    const ed = editors.get(el.dataset.ed);
    ed.items.push({ kind: 'etc', materialId: null, name: '', qty: 1, unit: '식', unitPrice: 0 });
    rerenderEditor(c, el.dataset.ed);
  },
  'ed-del'(c, el) {
    const ed = editors.get(el.dataset.ed);
    ed.items.splice(Number(el.dataset.row), 1);
    rerenderEditor(c, el.dataset.ed);
  },
};

export const editorInputs = {
  'ed-field'(c, el) {
    const ed = editors.get(el.dataset.ed);
    const it = ed?.items[Number(el.dataset.row)];
    if (!it) return;
    it[el.dataset.field] = el.value;
    const row = el.closest('.item-row');
    row.querySelector('[data-amount]').textContent = won(lineAmount(it));
    el.closest('[data-editor]').querySelector('[data-ed-totals]').innerHTML = String(totalsHtml(ed.items));
  },
};
