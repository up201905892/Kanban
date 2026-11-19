import type { FastifyInstance } from 'fastify';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { boardResponseSchema } from '@kanban/shared';
import { buildApp } from '../../app.js';
import { PrismaClient } from '../../generated/prisma/client.js';
import { SEED_EMAIL, SEED_PASSWORD, seedLargeBoard } from '../../seed/large-board.js';
import { TEST_ORIGIN, cookiePair } from '../../test-utils/auth.js';
import { resetDatabase } from '../../test-utils/reset-database.js';

// A client that reports every SQL statement, so the test can count them.
const queries: string[] = [];
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' }),
  log: [{ emit: 'event', level: 'query' }],
});
prisma.$on('query', (event) => {
  queries.push(event.query);
});

let app: FastifyInstance;

beforeEach(async () => {
  await resetDatabase(prisma);
  app = buildApp({ prisma, webOrigin: TEST_ORIGIN });
  await app.ready();
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

describe('GET /api/projects/:pid/board with 600 cards', () => {
  it('uses at most 5 database queries, whatever the card count', async () => {
    const seed = await seedLargeBoard(prisma);
    expect(seed.cardCount).toBe(600);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: TEST_ORIGIN },
      payload: { email: SEED_EMAIL, password: SEED_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const headers = { cookie: cookiePair(login.headers['set-cookie']), origin: TEST_ORIGIN };

    queries.length = 0;
    const started = performance.now();
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${seed.projectId}/board`,
      headers,
    });
    const elapsedMs = performance.now() - started;
    const used = [...queries];

    expect(res.statusCode, res.body).toBe(200);
    const board = boardResponseSchema.parse(res.json());
    expect(board.columns).toHaveLength(5);
    expect(board.cards).toHaveLength(600);
    // Every statement of the whole request counts: session, authorization, board and sprints.
    expect(used.length, used.join('\n')).toBeLessThanOrEqual(5);
    process.stderr.write(
      `board of 600 cards: ${used.length} queries, ${elapsedMs.toFixed(0)} ms\n`,
    );
  });
});
