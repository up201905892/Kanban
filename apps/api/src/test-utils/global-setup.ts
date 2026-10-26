import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertTestDatabase } from './reset-database.js';

/** Applies all Prisma migrations to the test database once before the test run. */
export default function setup(): void {
  const url = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  assertTestDatabase(url);
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
