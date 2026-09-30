// 실제 브라우저 E2E: PC·휴대폰 두 화면에서 업무 흐름과 누락·충돌 탐지를 끝까지 확인한다.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request, page }) => {
  await request.post('/api/admin/reset');
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* 무시 */ } });
});

const isMobile = (testInfo) => testInfo.project.name === 'mobile';

/** 서명 패드에 획을 긋는다 (휴대폰은 터치 포인터로) */
async function sign(page, scope = page) {
  const canvas = scope.locator('.sigpad canvas').first();
  await canvas.scrollIntoViewIfNeeded();
  await canvas.evaluate((el, pointerType) => {
    const r = el.getBoundingClientRect();
    const fire = (type, i) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, pointerType, isPrimary: true,
      clientX: r.left + 20 + i * ((r.width - 40) / 12), clientY: r.top + r.height * (0.5 + Math.sin(i) * 0.25),
    }));
    fire('pointerdown', 0);
    for (let i = 1; i <= 12; i += 1) fire('pointermove', i);
    fire('pointerup', 12);
  }, test.info().project.name === 'mobile' ? 'touch' : 'mouse');
  await expect(scope.locator('.sigpad.signed').first()).toBeVisible();
}

const modal = (page) => page.locator('#modal-root .modal');
const toast = (page) => page.locator('#toasts .toast').last();

test('오늘 화면: 4대 위험 건수와 놓치고 있는 금액을 보여준다', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.getByTestId('risk-amount')).toHaveText('1,567,500원');
  for (const k of ['APPROVAL', 'MATERIAL', 'SCHEDULE', 'BILLING']) {
    await expect(page.getByTestId(`risk-${k}`)).toContainText('4건');
  }
  await page.getByTestId('risk-SCHEDULE').click();
  await expect(page).toHaveURL(/#\/checks\?c=SCHEDULE/);
  await expect(page.getByTestId('finding')).toHaveCount(4);
});

test('전체 흐름: 문의 접수부터 수금까지 화면으로 처리한다', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto('/#/jobs/new');
  await page.getByLabel('고객명').fill('E2E 고객');
  await page.getByLabel('연락처').fill('010-1234-0000');
  await page.getByLabel('현장 주소').fill('성남시 분당구 테스트로 7');
  await page.getByLabel('문의 요약').fill('보일러실 배관 누수');
  await page.getByRole('button', { name: '접수하기' }).click();
  await expect(page).toHaveURL(/#\/jobs\/J-0020/);
  await expect(page.getByTestId('job-title')).toHaveText('보일러실 배관 누수');

  // 2. 현장 확인 — 1팀 충돌 → 제안된 빈 팀으로 변경
  await page.getByRole('button', { name: '현장 확인 예약' }).click();
  await modal(page).getByLabel('방문 팀').selectOption('T1');
  await modal(page).getByLabel('날짜').fill('2026-09-30');
  await modal(page).getByLabel('시작').fill('10:00');
  await modal(page).getByLabel('종료').fill('11:00');
  await modal(page).getByRole('button', { name: '예약' }).click();
  await expect(modal(page).locator('.conflict-box')).toContainText('일정 충돌');
  await modal(page).getByRole('button', { name: '2팀으로 변경' }).click();
  await modal(page).getByRole('button', { name: '예약' }).click();
  await expect(modal(page)).toHaveCount(0);
  await page.getByRole('button', { name: '현장 확인 결과 입력' }).click();
  await modal(page).locator('textarea').fill('보일러 분배기 누수, 교체 필요');
  await modal(page).getByRole('button', { name: '저장' }).click();

  // 3. 견적 작성·발송
  await page.getByRole('button', { name: '견적 작성' }).first().click();
  await expect(page.getByTestId('quote-editor')).toBeVisible();
  await page.locator('[data-ed-mat]').selectOption('M06');
  await page.getByRole('button', { name: '자재 추가' }).click();
  await page.getByRole('button', { name: '+ 기사 2인 반일' }).click();
  await expect(page.getByTestId('quote-editor')).toContainText('660,000원');
  await page.getByRole('button', { name: '저장하고 고객에게 발송' }).click();
  const url = await modal(page).getByLabel('고객 승인 링크').inputValue();
  expect(url).toMatch(/#\/c\/q\//);

  // 4. 고객 승인 — 고객 화면에서 서명
  await modal(page).getByRole('link', { name: '고객 화면 미리 보기' }).click();
  await expect(page.getByTestId('doc-total')).toHaveText('660,000원');
  await sign(page);
  await page.getByLabel('위 작업 내용과 금액에 동의합니다.').check();
  await page.getByRole('button', { name: '서명하고 승인' }).click();
  await expect(page.getByTestId('customer-result')).toHaveText('승인이 완료되었습니다. 감사합니다.');
  await page.getByRole('link', { name: '업체 화면으로 돌아가기' }).click();
  await expect(page.locator('.chip', { hasText: '배정 대기' }).first()).toBeVisible();

  // 5. 작업 배정
  await page.getByRole('button', { name: '작업 배정' }).first().click();
  await modal(page).getByLabel('작업팀').selectOption('T2');
  await modal(page).getByLabel('날짜', { exact: true }).fill('2026-10-02');
  await modal(page).getByLabel('시작').fill('09:00');
  await modal(page).getByLabel('종료', { exact: true }).fill('13:00');
  await modal(page).getByLabel('종료일 (여러 날 작업일 때)').fill('2026-10-02');
  await modal(page).getByRole('button', { name: '배정' }).click();
  await expect(modal(page)).toHaveCount(0);

  // 6. 작업 시작·자재 사용·추가 작업(현장 서명)
  await page.getByRole('button', { name: '작업 시작' }).click();
  await page.getByRole('button', { name: '자재 사용 기록' }).click();
  await modal(page).getByLabel('자재', { exact: true }).selectOption('M06');
  await modal(page).getByLabel('사용 수량').fill('1');
  await modal(page).getByRole('button', { name: '기록' }).click();
  await expect(modal(page)).toHaveCount(0);
  await page.getByRole('button', { name: '추가 작업 요청' }).first().click();
  await modal(page).getByLabel('추가 작업명').fill('난방수 교체');
  await modal(page).getByRole('button', { name: '+ 출장비' }).click();
  await modal(page).getByRole('button', { name: '요청 만들기' }).click();
  await expect(modal(page)).toContainText('고객 승인 기록');
  await sign(page, modal(page));
  await modal(page).getByRole('button', { name: '승인 기록' }).click();
  await expect(toast(page)).toContainText('고객 승인이 기록되었습니다');

  // 7. 완료 → 청구 → 수금
  await page.getByRole('button', { name: '작업 완료' }).click();
  await modal(page).getByRole('button', { name: '완료 처리' }).click();
  await expect(page).toHaveURL(/\/billing$/);
  await expect(page.locator('#inv-form')).toContainText('난방수 교체');
  await expect(page.locator('[data-inv-total]')).toHaveText('693,000원');
  await page.getByRole('button', { name: '청구서 발행' }).click();
  await expect(page.locator('[data-testid^="invoice-INV-"]')).toBeVisible();
  await page.getByRole('button', { name: '수금 기록' }).first().click();
  await modal(page).getByRole('button', { name: '수금 기록' }).click();
  await expect(page.locator('.chip', { hasText: '수금 완료' }).first()).toBeVisible();
  await expect(page.getByTestId('job-findings')).toHaveCount(0);

  if (isMobile(testInfo)) {
    await expect(page.locator('.tabbar')).toBeVisible();
    await expect(page.locator('.sidebar')).toBeHidden();
  }
});

test('승인 누락: 승인 없이 한 추가 작업이 있으면 완료가 막히고, 현장 서명 후 청구에 포함된다', async ({ page }) => {
  await page.goto('/#/jobs/J-0009');
  await expect(page.getByTestId('job-findings')).toContainText('승인 없이 수행된 추가 작업');
  await page.getByRole('button', { name: '작업 완료' }).click();
  await modal(page).getByRole('button', { name: '완료 처리' }).click();
  await expect(modal(page).locator('.block-box')).toContainText('완료할 수 없습니다');
  await modal(page).getByRole('link', { name: '추가 작업 탭에서 처리' }).click();
  await page.getByTestId('co-CO-002').getByRole('button', { name: '고객 승인 받기' }).click();
  await sign(page, modal(page));
  await modal(page).getByRole('button', { name: '승인 기록' }).click();
  await expect(page.getByTestId('co-CO-002')).toContainText('승인');
  await expect(page.getByTestId('job-findings')).not.toContainText('승인 없이 수행된');
  await page.getByRole('button', { name: '작업 완료' }).click();
  await modal(page).getByRole('button', { name: '완료 처리' }).click();
  await expect(page.locator('#inv-form')).toContainText('추가 작업 · 싱크대 배수 트랩 교체');
});

test('청구 누락 예방: 승인 항목을 빼면 경고하고 사유가 없으면 발행하지 않는다', async ({ page }) => {
  await page.goto('/#/jobs/J-0011/billing');
  const form = page.locator('#inv-form');
  await expect(form.locator('.omit-warn')).toBeHidden();
  await form.locator('input[name="include[]"]').first().uncheck();
  await expect(form.locator('.omit-warn')).toBeVisible();
  await form.getByRole('button', { name: '청구서 발행' }).click();
  await expect(form.locator('.form-error')).toContainText('사유');
  await form.getByLabel('제외 사유 (필수)').fill('고객과 합의해 자재비 할인');
  await form.getByRole('button', { name: '청구서 발행' }).click();
  await expect(page.getByText('승인 항목 일부 제외')).toBeVisible();
  await page.goto('/#/checks?c=BILLING');
  await expect(page.locator('[data-code="UNDER_BILLED"]')).toContainText('고객과 합의해 자재비 할인');
});

test('일정 충돌: 내일 일정에서 충돌한 일정이 빨갛게 표시된다', async ({ page }, testInfo) => {
  await page.goto('/#/schedule?d=2026-09-30');
  await expect(page.locator('.alert-critical')).toHaveCount(3);
  if (isMobile(testInfo)) {
    await expect(page.locator('.agenda-item.conflict')).toHaveCount(3);
  } else {
    await expect(page.locator('.tl-block.conflict')).toHaveCount(3);
    await expect(page.getByTestId('timeline')).toContainText('지하주차장 배수관 고압 세척');
  }
});

test('자재 중복 예약: 가용 재고보다 많이 예약하면 막고, 사유를 남기면 강제 예약된다', async ({ page }) => {
  await page.goto('/#/materials');
  await expect(page.locator('.alert-critical').first()).toContainText('PVC 하수관');
  await page.goto('/#/jobs/J-0005/material');
  await page.getByRole('button', { name: '작업 배정' }).first().click();
  await modal(page).getByLabel('작업팀').selectOption('T2');
  await modal(page).getByLabel('날짜', { exact: true }).fill('2026-10-05');
  await modal(page).getByLabel('시작').fill('09:00');
  await modal(page).getByLabel('종료', { exact: true }).fill('17:00');
  await modal(page).getByLabel('종료일 (여러 날 작업일 때)').fill('2026-10-05');
  await modal(page).getByRole('button', { name: '배정' }).click();
  await expect(modal(page)).toHaveCount(0);
  await page.getByRole('button', { name: '예약' }).first().click();
  await modal(page).getByLabel('자재').selectOption('M03');
  await modal(page).getByLabel('수량').fill('2');
  await modal(page).getByRole('button', { name: '예약' }).click();
  await expect(modal(page).locator('.conflict-box')).toContainText('가용 재고가 부족');
  await modal(page).getByLabel('경고를 알고도 예약').check();
  await modal(page).getByLabel(/사유/).fill('월요일 입고 예정');
  await modal(page).getByRole('button', { name: '예약' }).click();
  await expect(modal(page)).toHaveCount(0);
  await expect(page.getByTestId('reservations')).toContainText('PVC 하수관 100A (4m) 경고 무시');
});

test('점검 센터: 주의 항목을 메모와 함께 확인 처리한다', async ({ page }) => {
  await page.goto('/#/checks?c=SCHEDULE');
  const travel = page.locator('[data-code="TRAVEL_TIME_SHORT"]');
  await travel.getByRole('button', { name: '확인 처리' }).click();
  await modal(page).getByLabel('확인 메모 (필수)').fill('같은 단지라 이동 5분');
  await modal(page).getByRole('button', { name: '확인 처리' }).click();
  await expect(page.getByText('확인 처리된 항목 1건')).toBeVisible();
  await expect(page.locator('.finding:not(.acked)')).toHaveCount(3);
  await expect(page.locator('.finding.acked')).toContainText('같은 단지라 이동 5분');
});

test('반응형: 주요 화면에서 가로 스크롤이 생기지 않는다', async ({ page }, testInfo) => {
  for (const r of ['#/', '#/jobs', '#/jobs/J-0009', '#/jobs/J-0003/quote', '#/jobs/J-0009/material', '#/schedule', '#/materials', '#/billing', '#/checks', '#/more', '#/jobs/new', '#/c/q/demo002']) {
    await page.goto(`/${r}`);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${r} 가로 넘침`).toBeLessThanOrEqual(0);
  }
  if (isMobile(testInfo)) {
    await page.goto('/#/');
    await page.locator('.tabbar').getByText('점검').click();
    await expect(page).toHaveURL(/#\/checks/);
  }
});

test('어두운 테마로 바꿀 수 있다', async ({ page }) => {
  await page.goto('/#/more');
  await page.getByLabel('어둡게').check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(15, 23, 29)');
});
