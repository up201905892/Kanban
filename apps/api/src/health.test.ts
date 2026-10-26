import { afterAll, describe, expect, it } from 'vitest';
import { readyResponseSchema } from '@kanban/shared';
import { buildApp } from './app.js';
import { createPrismaClient } from './db.js';

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});

describe('GET /health/ready', () => {
  const good = createPrismaClient(process.env['DATABASE_URL'] ?? '');
  // Port 1 is never listening: the connection is refused.
  const bad = createPrismaClient('postgresql://kanban:kanban@127.0.0.1:1/kanban_test');
  afterAll(async () => {
    await good.$disconnect();
    await bad.$disconnect();
  });

  it('returns 200 { db: "ok" } when the database answers', async () => {
    const app = buildApp({ prisma: good });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(readyResponseSchema.parse(res.json())).toEqual({ db: 'ok' });
    await app.close();
  });

  it('returns 503 when the database is unreachable', async () => {
    const app = buildApp({ prisma: bad });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(readyResponseSchema.parse(res.json())).toEqual({ db: 'unavailable' });
    await app.close();
  });
});
