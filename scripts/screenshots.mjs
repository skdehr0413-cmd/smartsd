// 제출용 화면 캡처: 데모 서버를 고정 시각(2026-09-29 10:30)으로 띄워 PC·휴대폰 화면을 찍는다.
//   npm run screenshots  →  docs/screenshots/*.png
import { chromium, devices } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server/app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs/screenshots');
fs.mkdirSync(outDir, { recursive: true });

const { server } = createApp({ dataFile: null, now: '2026-09-29T10:30' });
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const reset = () => fetch(`${base}/api/admin/reset`, { method: 'POST' });

const browser = await chromium.launch();

async function signPad(page, scope, pointerType) {
  await scope.locator('.sigpad canvas').first().evaluate((el, type) => {
    const r = el.getBoundingClientRect();
    const fire = (t, i) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 3, pointerType: type, isPrimary: true, clientX: r.left + 24 + i * ((r.width - 48) / 16), clientY: r.top + r.height * (0.55 + Math.sin(i * 0.9) * 0.22) }));
    fire('pointerdown', 0);
    for (let i = 1; i <= 16; i += 1) fire('pointermove', i);
    fire('pointerup', 16);
  }, pointerType);
}

const shots = {
  pc: [
    ['01-오늘-대시보드', '#/'],
    ['02-작업건-보드', '#/jobs'],
    ['03-작업상세-승인누락', '#/jobs/J-0009/change'],
    ['04-견적-작성', '#/jobs/J-0003/quote'],
    ['05-일정-충돌', '#/schedule?d=2026-09-30'],
    ['06-자재-중복예약', '#/materials'],
    ['07-정산', '#/billing'],
    ['08-누락충돌-점검', '#/checks'],
    ['09-청구서-발행-누락경고', '#/jobs/J-0011/billing', async (page) => {
      await page.locator('#inv-form input[name="include[]"]').nth(1).uncheck();
    }],
    ['10-배정-충돌-제안', '#/jobs/J-0005/material', async (page) => {
      await page.getByRole('button', { name: '작업 배정' }).first().click();
      const m = page.locator('#modal-root .modal');
      await m.getByLabel('작업팀').selectOption('T1');
      await m.getByLabel('날짜', { exact: true }).fill('2026-09-30');
      await m.getByLabel('시작').fill('10:00');
      await m.getByLabel('종료', { exact: true }).fill('14:00');
      await m.getByLabel('종료일 (여러 날 작업일 때)').fill('2026-09-30');
      await m.getByRole('button', { name: '배정' }).click();
      await m.locator('.conflict-box').waitFor();
    }],
    ['11-고객-견적승인', '#/c/q/demo001'],
    ['12-다크모드', '#/', null, 'dark'],
  ],
  mobile: [
    ['01-오늘', '#/'],
    ['02-작업건', '#/jobs'],
    ['03-작업상세', '#/jobs/J-0009'],
    ['04-추가작업-현장서명', '#/jobs/J-0009/change', async (page) => {
      await page.getByTestId('co-CO-002').getByRole('button', { name: '고객 승인 받기' }).click();
      const m = page.locator('#modal-root .modal');
      await signPad(page, m, 'touch');
      await m.locator('.sigpad').scrollIntoViewIfNeeded();
    }],
    ['05-일정', '#/schedule?d=2026-09-30'],
    ['06-점검', '#/checks'],
    ['07-고객-견적승인', '#/c/q/demo001', async (page) => {
      await signPad(page, page, 'touch');
      await page.getByLabel('위 작업 내용과 금액에 동의합니다.').check();
    }, null, true],
    ['08-청구서-발행', '#/jobs/J-0011/billing'],
    ['09-자재', '#/materials'],
    ['10-완료-차단', '#/jobs/J-0009', async (page) => {
      await page.getByRole('button', { name: '작업 완료' }).click();
      const m = page.locator('#modal-root .modal');
      await m.getByRole('button', { name: '완료 처리' }).click();
      await m.locator('.block-box').waitFor();
    }],
    ['11-다크모드', '#/jobs/J-0009', null, 'dark'],
  ],
};

for (const [kind, list] of Object.entries(shots)) {
  const opts = kind === 'pc'
    ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }
    : { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
  for (const [name, route, act, theme, scrollBottom] of list) {
    await reset();
    const ctx = await browser.newContext({ ...opts, locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: theme === 'dark' ? 'dark' : 'light' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/${route}`);
    await page.waitForLoadState('networkidle');
    if (act) await act(page);
    if (scrollBottom) await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(250);
    const file = path.join(outDir, `${kind}-${name}.png`);
    await page.screenshot({ path: file });
    if (errors.length) throw new Error(`${name}: ${errors.join(', ')}`);
    console.log('저장', path.relative(root, file));
    await ctx.close();
  }
}

await browser.close();
server.close();
