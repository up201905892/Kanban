import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activityListResponseSchema,
  apiErrorSchema,
  boardResponseSchema,
  cardResponseSchema,
  projectResponseSchema,
  workspaceResponseSchema,
  type ActivityEntry,
} from '@kanban/shared';
import { buildApp } from '../../app.js';
import { createPrismaClient } from '../../db.js';
import { TEST_ORIGIN, createUserAndLogin, type TestUser } from '../../test-utils/auth.js';
import { resetDatabase } from '../../test-utils/reset-database.js';

const prisma = createPrismaClient(process.env['DATABASE_URL'] ?? '');
let app: FastifyInstance;

beforeEach(async () => {
  await resetDatabase(prisma);
  app = buildApp({ prisma, webOrigin: TEST_ORIGIN });
  await app.ready();
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  who?: TestUser,
  body?: object,
) {
  return app.inject({
    method,
    url,
    headers: who ? who.headers : { origin: TEST_ORIGIN },
    ...(body ? { payload: body } : {}),
  });
}

async function setup() {
  const [owner, viewer, outsider] = await Promise.all([
    createUserAndLogin(app, { name: 'Olivia' }),
    createUserAndLogin(app, { name: 'Vera' }),
    createUserAndLogin(app, { name: 'Eve' }),
  ]);
  const ws = workspaceResponseSchema.parse(
    (await call('POST', '/api/workspaces', owner, { name: 'Acme' })).json(),
  ).workspace;
  await prisma.membership.create({
    data: { workspaceId: ws.id, userId: viewer.user.id, role: 'viewer' },
  });
  const project = projectResponseSchema.parse(
    (
      await call('POST', `/api/workspaces/${ws.id}/projects`, owner, { name: 'P', key: 'KB' })
    ).json(),
  ).project;
  const board = boardResponseSchema.parse(
    (await call('GET', `/api/projects/${project.id}/board`, owner)).json(),
  );
  const card = cardResponseSchema.parse(
    (
      await call('POST', `/api/columns/${board.columns[0]?.id}/cards`, owner, { title: 'A' })
    ).json(),
  ).card;
  return { owner, viewer, outsider, board, card };
}

const activity = (who: TestUser | undefined, id: string, query = '') =>
  call('GET', `/api/cards/${id}/activity${query}`, who);

describe('GET /api/cards/:id/activity', () => {
  it('lists events newest first with the actor, for any role', async () => {
    const { owner, viewer, board, card } = await setup();
    await call('PATCH', `/api/cards/${card.id}`, owner, { title: 'B' });
    await call('POST', `/api/cards/${card.id}/move`, owner, { columnId: board.columns[1]?.id });
    for (const who of [owner, viewer]) {
      const res = await activity(who, card.id);
      expect(res.statusCode).toBe(200);
      const body = activityListResponseSchema.parse(res.json());
      expect(body.events.map((e) => e.type)).toEqual(['moved', 'title_changed', 'created']);
      expect(body.events[0]?.actor).toEqual({ id: owner.user.id, name: 'Olivia' });
      expect(body.nextCursor).toBeNull();
    }
  });

  it('pages without duplicates or gaps, even when events share a timestamp', async () => {
    const { owner, card } = await setup();
    const at = new Date('2026-11-01T10:00:00.000Z');
    await prisma.activityEvent.deleteMany({ where: { cardId: card.id } });
    await prisma.activityEvent.createMany({
      data: Array.from({ length: 7 }, (_, i) => ({
        cardId: card.id,
        actorId: owner.user.id,
        type: 'title_changed',
        data: { from: `t${i}`, to: `t${i + 1}` },
        // Pairs of events share a timestamp.
        createdAt: new Date(at.getTime() + Math.floor(i / 2) * 1000),
      })),
    });
    const all = await prisma.activityEvent.findMany({
      where: { cardId: card.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const seen: ActivityEntry[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await activity(owner, card.id, `?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.statusCode).toBe(200);
      const body = activityListResponseSchema.parse(res.json());
      seen.push(...body.events);
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen.map((e) => e.id)).toEqual(all.map((e) => e.id));
  });

  it('rejects a bad cursor or limit with 400', async () => {
    const { owner, card } = await setup();
    expect((await activity(owner, card.id, '?cursor=nope')).statusCode).toBe(400);
    expect((await activity(owner, card.id, '?limit=101')).statusCode).toBe(400);
    expect((await activity(owner, card.id, '?limit=0')).statusCode).toBe(400);
  });

  it('answers 401 without a session', async () => {
    const { card } = await setup();
    expect((await activity(undefined, card.id)).statusCode).toBe(401);
  });

  it('answers 404 to a non-member and for unknown ids', async () => {
    const { outsider, card } = await setup();
    const res = await activity(outsider, card.id);
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('NOT_FOUND');
    expect((await activity(outsider, randomUUID())).statusCode).toBe(404);
  });

  it('answers 404 for a soft-deleted card, even to the owner', async () => {
    const { owner, card } = await setup();
    expect((await call('DELETE', `/api/cards/${card.id}`, owner)).statusCode).toBe(204);
    expect((await activity(owner, card.id)).statusCode).toBe(404);
  });
});
