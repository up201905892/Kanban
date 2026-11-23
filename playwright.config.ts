import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env['CI']);
const API_URL = 'http://localhost:3000';
// `BASE_URL` points the tests at an already running instance (for example the production
// container, KB-031); then no development servers are started.
const EXTERNAL_URL = process.env['BASE_URL'];
const WEB_URL = EXTERNAL_URL ?? 'http://localhost:5173';

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
  webServer: EXTERNAL_URL
    ? undefined
    : [
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
