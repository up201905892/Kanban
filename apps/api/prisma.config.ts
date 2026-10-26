import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Load the repository-root .env for local development (CI sets real environment variables).
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

// DATABASE_URL is read leniently so `prisma generate` works without a database
// (CI runs build before any database is used).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] ?? '' },
});
