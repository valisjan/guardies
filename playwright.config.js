import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT) || 4174;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/visual',
  timeout: 30_000,
  expect: { timeout: 7_500 },
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    colorScheme: 'dark',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    env: { VITE_E2E_AUTH_BYPASS: 'true' },
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'chromium-mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    ...(process.env.GUARDIES_WEBKIT === '1'
      ? [{ name: 'webkit-mobile', use: { ...devices['iPhone 13'], browserName: 'webkit' } }]
      : []),
  ],
});
