import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env['CI']);
const WEB_URL = 'http://localhost:5173';
const API_URL = 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
  },
  // Chromium only (see KB-003).
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @kanban/api dev',
      url: `${API_URL}/health`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @kanban/web dev',
      url: WEB_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
