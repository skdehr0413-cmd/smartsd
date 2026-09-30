// 금액 계산. 모든 금액은 원(KRW) 정수.
// 부가세는 공급가액의 10%이며 원 단위 미만은 절사한다.

export const VAT_RATE = 0.1;

export function lineAmount(item) {
  const qty = Number(item?.qty) || 0;
  const price = Number(item?.unitPrice) || 0;
  return Math.round(qty * price);
}

export function totals(items = []) {
  const supply = items.reduce((sum, it) => sum + lineAmount(it), 0);
  const vat = Math.floor(supply * VAT_RATE);
  return { supply, vat, total: supply + vat };
}

export const withVat = (supply) => supply + Math.floor(supply * VAT_RATE);

export function fmtNumber(n) {
  const v = Math.round(Number(n) || 0);
  const sign = v < 0 ? '-' : '';
  return sign + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export const won = (n) => `${fmtNumber(n)}원`;

/** 대시보드용 축약 표기: 1,250,000 → "125만원" */
export function wonShort(n) {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) >= 100000000) return `${(v / 100000000).toFixed(1).replace(/\.0$/, '')}억원`;
  if (Math.abs(v) >= 10000) return `${fmtNumber(Math.round(v / 10000))}만원`;
  return won(v);
}

export function fmtQty(q) {
  const v = Number(q) || 0;
  return Number.isInteger(v) ? fmtNumber(v) : String(Math.round(v * 100) / 100);
}
