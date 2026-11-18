import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  boardResponseSchema,
  burndownResponseSchema,
  cardResponseSchema,
  projectResponseSchema,
  sprintResponseSchema,
  toCalendarDate,
  workspaceResponseSchema,
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
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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

const DAY = 24 * 60 * 60 * 1000;
const today = toCalendarDate(new Date());
const dayOffset = (n: number) => toCalendarDate(new Date(Date.now() + n * DAY));

async function setup() {
  const [owner, member, viewer, outsider] = await Promise.all([
    createUserAndLogin(app, { name: 'Olivia' }),
    createUserAndLogin(app, { name: 'Mark' }),
    createUserAndLogin(app, { name: 'Vera' }),
    createUserAndLogin(app, { name: 'Eve' }),
  ]);
  const ws = workspaceResponseSchema.parse(
    (await call('POST', '/api/workspaces', owner, { name: 'Acme' })).json(),
  ).workspace;
  await prisma.membership.createMany({
    data: [
      { workspaceId: ws.id, userId: member.user.id, role: 'member' },
      { workspaceId: ws.id, userId: viewer.user.id, role: 'viewer' },
    ],
  });
  const project = projectResponseSchema.parse(
    (
      await call('POST', `/api/workspaces/${ws.id}/projects`, owner, { name: 'P', key: 'KB' })
    ).json(),
  ).project;
  const board = boardResponseSchema.parse(
    (await call('GET', `/api/projects/${project.id}/board`, owner)).json(),
  );
  const todo = board.columns[0];
  const done = board.columns.find((c) => c.isDone);
  if (!todo || !done) throw new Error('no columns');
  const newCard = async (title: string, estimate?: number) => {
    const card = cardResponseSchema.parse(
      (await call('POST', `/api/columns/${todo.id}/cards`, owner, { title })).json(),
    ).card;
    if (estimate !== undefined) await call('PATCH', `/api/cards/${card.id}`, owner, { estimate });
    return card;
  };
  const sprint = sprintResponseSchema.parse(
    (
      await call('POST', `/api/projects/${project.id}/sprints`, owner, {
        name: 'S1',
        startDate: dayOffset(-1),
        endDate: dayOffset(3),
      })
    ).json(),
  ).sprint;
  return { owner, member, viewer, outsider, todo, done, newCard, sprint };
}

describe('GET /api/sprints/:id/burndown', () => {
  it('replays the sprint: scope, moves into Done and unestimated cards', async () => {
    const { owner, done, newCard, sprint } = await setup();
    const a = await newCard('A', 5);
    const b = await newCard('B', 3);
    const c = await newCard('C');
    for (const card of [a, b, c]) {
      await call('PUT', `/api/cards/${card.id}/sprint`, owner, { sprintId: sprint.id });
    }
    await call('POST', `/api/sprints/${sprint.id}/start`, owner);
    await call('POST', `/api/cards/${a.id}/move`, owner, { columnId: done.id });
    const late = await newCard('Late', 2);
    await call('PUT', `/api/cards/${late.id}/sprint`, owner, { sprintId: sprint.id });

    const res = await call('GET', `/api/sprints/${sprint.id}/burndown`, owner);
    expect(res.statusCode).toBe(200);
    const body = burndownResponseSchema.parse(res.json());
    // Starts yesterday, so there are two days: yesterday (no events) and today.
    expect(body.days.map((d) => d.date)).toEqual([dayOffset(-1), today]);
    expect(body.days.at(-1)).toEqual({ date: today, remainingPoints: 5, scopePoints: 10 });
    expect(body.ideal).toHaveLength(5);
    expect(body.ideal[4]).toEqual({ date: dayOffset(3), points: 0 });
    expect(body.unestimatedCount).toBe(1);
  });

  it('drops a deleted card from the scope and follows a card moved back out of Done', async () => {
    const { owner, done, todo, newCard, sprint } = await setup();
    const a = await newCard('A', 5);
    const b = await newCard('B', 3);
    for (const card of [a, b]) {
      await call('PUT', `/api/cards/${card.id}/sprint`, owner, { sprintId: sprint.id });
    }
    await call('POST', `/api/sprints/${sprint.id}/start`, owner);
    await call('POST', `/api/cards/${a.id}/move`, owner, { columnId: done.id });
    await call('POST', `/api/cards/${a.id}/move`, owner, { columnId: todo.id });
    await call('DELETE', `/api/cards/${b.id}`, owner);
    const body = burndownResponseSchema.parse(
      (await call('GET', `/api/sprints/${sprint.id}/burndown`, owner)).json(),
    );
    expect(body.days.at(-1)).toMatchObject({ remainingPoints: 5, scopePoints: 5 });
  });

  it('is empty for a planned sprint', async () => {
    const { owner, sprint } = await setup();
    const planned = burndownResponseSchema.parse(
      (await call('GET', `/api/sprints/${sprint.id}/burndown`, owner)).json(),
    );
    expect(planned).toEqual({ days: [], ideal: [], unestimatedCount: 0 });
  });

  it('answers 200 for owner, member and viewer', async () => {
    const { owner, member, viewer, sprint } = await setup();
    await call('POST', `/api/sprints/${sprint.id}/start`, owner);
    for (const who of [owner, member, viewer]) {
      const res = await call('GET', `/api/sprints/${sprint.id}/burndown`, who);
      expect(res.statusCode).toBe(200);
      burndownResponseSchema.parse(res.json());
    }
  });

  it('answers 404 for a non-member (same as an unknown id), 401 without a session, 400 for a bad id', async () => {
    const { outsider, sprint } = await setup();
    const hidden = await call('GET', `/api/sprints/${sprint.id}/burndown`, outsider);
    const missing = await call(
      'GET',
      '/api/sprints/019a0000-0000-7000-8000-000000000000/burndown',
      outsider,
    );
    expect(hidden.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(apiErrorSchema.parse(hidden.json())).toEqual(apiErrorSchema.parse(missing.json()));
    expect((await call('GET', `/api/sprints/${sprint.id}/burndown`)).statusCode).toBe(401);
    expect((await call('GET', '/api/sprints/nope/burndown', outsider)).statusCode).toBe(400);
  });
});
