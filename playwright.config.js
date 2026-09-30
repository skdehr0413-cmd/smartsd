// E2E 테스트: 실제 서버를 띄우고 PC(1440×900)와 휴대폰(390×844, 터치) 화면에서 검증한다.
import { defineConfig, devices } from '@playwright/test';

const PORT = 3210;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'pc', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `node src/server/index.js`,
    env: { PORT: String(PORT), DATA_FILE: ':memory:', SMARTSD_NOW: '2026-09-29T10:30' },
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
