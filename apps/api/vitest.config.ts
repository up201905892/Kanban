import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Tests use TEST_DATABASE_URL when set (local development), otherwise DATABASE_URL (CI).
const databaseUrl = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '';

export default defineConfig({
  test: {
    globalSetup: ['./src/test-utils/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: process.env['SESSION_SECRET'] ?? 'test-only-session-secret-0123456789abcdef',
    },
    // Test files share one database.
    fileParallelism: false,
  },
});
