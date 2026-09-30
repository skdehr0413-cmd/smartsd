// 화면 공통 도구: 안전한 HTML 템플릿, 아이콘, 배지, 금액·날짜 표시
import { STATUS_LABEL, STEPS, STATUS_STEP, SEVERITY, CATEGORIES, ITEM_KINDS } from '../core/constants.js';
import { won, fmtNumber, fmtQty, totals, lineAmount } from '../core/money.js';
import { fmtDateTime, fmtDate, fmtRange, fmtRelative } from '../core/time.js';

export { won, fmtNumber, fmtQty, totals, lineAmount, fmtDateTime, fmtDate, fmtRange, fmtRelative };

// ─── 템플릿 ──────────────────────────────────────────────
class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s ?? ''));
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function val(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  return esc(v);
}

export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += val(values[i]);
  });
  return new Raw(out);
}

export const when = (cond, a, b = '') => (cond ? a : b);

/** 조사 '(으)로': 받침이 있으면(ㄹ 제외) '으로' */
export function withRo(word) {
  const code = String(word).trim().charCodeAt(String(word).trim().length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}로`;
  const jong = code % 28;
  return `${word}${jong === 0 || jong === 8 ? '로' : '으로'}`;
}

// ─── 폼 ──────────────────────────────────────────────────
export function formData(form) {
  const fd = new FormData(form);
  const out = {};
  for (const key of new Set(fd.keys())) {
    const all = fd.getAll(key);
    out[key.replace(/\[\]$/, '')] = key.endsWith('[]') ? all : all.at(-1);
  }
  return out;
}

export const combine = (date, time) => (date && time ? `${date}T${time}` : '');

// ─── 아이콘 (선 아이콘, currentColor) ─────────────────────
const P = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  jobs: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  box: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 8v5M12 16.5v.5"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  phone: '<path d="M5 4h4l2 5-3 2a11 11 0 005 5l2-3 5 2v4a2 2 0 01-2 2A17 17 0 013 6a2 2 0 012-2z"/>',
  pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  sign: '<path d="M3 17c3-4 5-9 7-9s-1 9 2 9 3-5 5-5 1 3 4 3"/><path d="M3 21h18"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 00-5.3 5.3L3 18l3 3 6.2-6.2a4 4 0 005.3-5.3l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
};
export function icon(name, cls = 'ico') {
  return raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`);
}

/** 브랜드 마크: 동관 엘보 + 물방울 */
export const brandMark = raw(`<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
  <rect width="40" height="40" rx="9" fill="var(--copper)"/>
  <path d="M9 12h11a8 8 0 018 8v11" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
  <path d="M9 9v6M25 31h6" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
  <path d="M14 26c0 2 1.3 3.3 3 3.3s3-1.3 3-3.3c0-1.6-3-5.3-3-5.3s-3 3.7-3 5.3z" fill="#fff"/>
</svg>`);

// ─── 배지 ────────────────────────────────────────────────
const STATUS_TONE = {
  RECEIVED: 'chip', SURVEY_SCHEDULED: 'chip', SURVEYED: 'chip',
  QUOTED: 'chip chip-warn', APPROVED: 'chip chip-brand', SCHEDULED: 'chip chip-brand',
  IN_PROGRESS: 'chip chip-copper', COMPLETED: 'chip chip-warn', INVOICED: 'chip chip-info',
  PAID: 'chip chip-ok', REJECTED: 'chip chip-outline', CANCELED: 'chip chip-outline',
};
export const statusChip = (status) => html`<span class="${STATUS_TONE[status] || 'chip'}">${STATUS_LABEL[status] || status}</span>`;
export const sevPill = (sev) => html`<span class="sev sev-${sev}">${SEVERITY[sev]}</span>`;
export const catLabel = (key) => CATEGORIES.find((c) => c.key === key)?.label || key;
export const kindLabel = (k) => ITEM_KINDS[k] || k;
export const crewDot = (crew) => (crew ? html`<span class="dot" style="background:var(--crew-${crew.color ?? 0})"></span>` : '');
export const crewVar = (crew) => `--crew: var(--crew-${crew?.color ?? 0})`;
export const money = (n) => html`<span class="num">${won(n)}</span>`;
export const empty = (text) => html`<div class="empty">${text}</div>`;

export function stepper(job, { blocked = false } = {}) {
  const cur = STATUS_STEP[job.status] ?? 0;
  const canceled = job.status === 'CANCELED';
  return html`<div class="stepper" role="list" aria-label="업무 단계">
    ${STEPS.map((s, i) => {
      const cls = canceled ? '' : i < cur ? 'done' : i === cur ? (blocked ? 'current blocked' : 'current') : '';
      return html`<div class="step ${cls}" role="listitem" ${i === cur ? raw('aria-current="step"') : ''}><div class="bar"></div><span class="lbl">${s.label}</span></div>`;
    })}
  </div>`;
}

export function itemsTable(items, { showKind = true } = {}) {
  const t = totals(items);
  return html`<div class="table-wrap"><table class="tbl">
    <thead><tr>${showKind ? html`<th class="col-kind">구분</th>` : ''}<th>품명</th><th class="num">수량</th><th class="num col-price">단가</th><th class="num">금액</th></tr></thead>
    <tbody>${items.map((it) => html`<tr>${showKind ? html`<td class="col-kind"><span class="chip">${kindLabel(it.kind)}</span></td>` : ''}<td>${it.name}</td><td class="num">${fmtQty(it.qty)}${it.unit}</td><td class="num col-price">${won(it.unitPrice)}</td><td class="num">${won(lineAmount(it))}</td></tr>`)}</tbody>
  </table></div>
  <dl class="totals items-summary"><dt>공급가액</dt><dd>${won(t.supply)}</dd><dt>부가세(10%)</dt><dd>${won(t.vat)}</dd><dt class="grand">합계</dt><dd class="grand">${won(t.total)}</dd></dl>`;
}

export function findingAlert(f, { compact = false } = {}) {
  return html`<div class="alert alert-${f.severity}">
    ${icon(f.severity === 'critical' ? 'alert' : 'shield')}
    <div class="alert-body">
      <div class="alert-title">${f.title}</div>
      ${compact ? '' : html`<div class="small muted">${f.detail}</div>`}
    </div>
    ${f.fix ? html`<a class="btn btn-sm" href="${f.fix.href}">${f.fix.label}</a>` : ''}
  </div>`;
}

export function signaturePad(name, hint = '여기에 손가락이나 마우스로 서명하세요') {
  return html`<div class="field">
    <div class="row-between"><span class="label">서명</span><button type="button" class="btn btn-ghost btn-sm" data-act="sig-clear" data-sig="${name}">지우기</button></div>
    <div class="sigpad" data-sig="${name}"><canvas aria-label="서명 입력"></canvas><div class="sig-hint">${hint}</div></div>
  </div>`;
}

export function options(list, selected, { value = (x) => x.id, label = (x) => x.name, placeholder } = {}) {
  return html`${placeholder !== undefined ? html`<option value="">${placeholder}</option>` : ''}${list.map((x) => html`<option value="${value(x)}" ${value(x) === selected ? raw('selected') : ''}>${label(x)}</option>`)}`;
}
