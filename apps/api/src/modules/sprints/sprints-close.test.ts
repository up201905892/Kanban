import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activityEventDataSchema,
  apiErrorSchema,
  boardResponseSchema,
  cardResponseSchema,
  closeSprintResponseSchema,
  projectResponseSchema,
  sprintEventDataSchema,
  sprintResponseSchema,
  workspaceResponseSchema,
  type BoardEvent,
} from '@kanban/shared';
import { buildApp } from '../../app.js';
import { createPrismaClient } from '../../db.js';
import { onBoardEvent } from '../../lib/board-events.js';
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

const errorOf = (res: { json: () => unknown }) => apiErrorSchema.parse(res.json()).error;
const dates = { startDate: '2026-11-16', endDate: '2026-11-27' };

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
  const newSprint = async (name = 'Sprint 1') =>
    sprintResponseSchema.parse(
      (await call('POST', `/api/projects/${project.id}/sprints`, owner, { name, ...dates })).json(),
    ).sprint;
  const assign = (cardId: string, sprintId: string | null) =>
    call('PUT', `/api/cards/${cardId}/sprint`, owner, { sprintId });
  const finish = (cardId: string) =>
    call('POST', `/api/cards/${cardId}/move`, owner, { columnId: done.id });

  /** An active sprint with two cards in Done (5 + 3 points) and two unfinished (2 points + 1 unestimated). */
  const activeSprint = async () => {
    const sprint = await newSprint();
    const a = await newCard('A', 5);
    const b = await newCard('B', 3);
    const c = await newCard('C', 2);
    const d = await newCard('D');
    const outside = await newCard('Outside', 8);
    for (const card of [a, b, c, d]) await assign(card.id, sprint.id);
    await call('POST', `/api/sprints/${sprint.id}/start`, owner);
    await finish(a.id);
    await finish(b.id);
    return { sprint, a, b, c, d, outside };
  };
  return { owner, member, viewer, outsider, project, todo, done, newCard, newSprint, activeSprint };
}

describe('POST /api/sprints/:id/close', () => {
  it('keeps finished cards, returns the others and records the numbers', async () => {
    const { member, activeSprint } = await setup();
    const { sprint, a, b, c, d, outside } = await activeSprint();
    const before = await prisma.card.findMany({ where: { id: { in: [a.id, b.id, c.id, d.id] } } });
    const versions = new Map(before.map((row) => [row.id, row.version]));

    const res = await call('POST', `/api/sprints/${sprint.id}/close`, member);
    expect(res.statusCode).toBe(200);
    expect(closeSprintResponseSchema.parse(res.json())).toEqual({
      completedCards: 2,
      completedPoints: 8,
      returnedCards: 2,
    });

    const row = await prisma.sprint.findUniqueOrThrow({ where: { id: sprint.id } });
    expect(row).toMatchObject({ status: 'closed', completedPoints: 8, committedPoints: 10 });
    expect(row.closedAt).toBeInstanceOf(Date);

    const cards = await prisma.card.findMany({
      where: { id: { in: [a.id, b.id, c.id, d.id, outside.id] } },
    });
    const sprintOf = (id: string) => cards.find((x) => x.id === id)?.sprintId;
    expect(sprintOf(a.id)).toBe(sprint.id);
    expect(sprintOf(b.id)).toBe(sprint.id);
    expect(sprintOf(c.id)).toBeNull();
    expect(sprintOf(d.id)).toBeNull();
    expect(sprintOf(outside.id)).toBeNull();
    for (const id of [c.id, d.id]) {
      expect(cards.find((x) => x.id === id)?.version).toBe((versions.get(id) ?? 0) + 1);
    }
    for (const id of [a.id, b.id]) {
      expect(cards.find((x) => x.id === id)?.version).toBe(versions.get(id));
    }

    // Returned cards get sprint_removed with the reason; finished ones get nothing.
    const removed = await prisma.activityEvent.findMany({
      where: { type: 'sprint_removed' },
      orderBy: { createdAt: 'asc' },
    });
    expect(removed.map((e) => e.cardId).sort()).toEqual([c.id, d.id].sort());
    for (const event of removed) {
      expect(event.actorId).toBe(member.user.id);
      expect(activityEventDataSchema.parse({ type: event.type, data: event.data })).toMatchObject({
        data: { sprintId: sprint.id, sprintName: 'Sprint 1', reason: 'sprint_closed' },
      });
    }

    const events = await prisma.sprintEvent.findMany({
      where: { sprintId: sprint.id, type: 'sprint_closed' },
    });
    expect(events).toHaveLength(1);
    const snapshot = sprintEventDataSchema.parse({ type: events[0]?.type, data: events[0]?.data });
    expect(snapshot).toMatchObject({
      type: 'sprint_closed',
      data: { completedCards: 2, completedPoints: 8, returnedCards: 2 },
    });
  });

  it('closes an empty sprint with zeros and lets another sprint start afterwards', async () => {
    const { owner, newSprint } = await setup();
    const first = await newSprint('One');
    await call('POST', `/api/sprints/${first.id}/start`, owner);
    const res = await call('POST', `/api/sprints/${first.id}/close`, owner);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ completedCards: 0, completedPoints: 0, returnedCards: 0 });

    const second = await newSprint('Two');
    expect((await call('POST', `/api/sprints/${second.id}/start`, owner)).statusCode).toBe(200);
  });

  it('ignores deleted cards and counts every column flagged as Done only once', async () => {
    const { owner, activeSprint } = await setup();
    const { sprint, c } = await activeSprint();
    await call('DELETE', `/api/cards/${c.id}`, owner);
    const res = await call('POST', `/api/sprints/${sprint.id}/close`, owner);
    expect(closeSprintResponseSchema.parse(res.json())).toEqual({
      completedCards: 2,
      completedPoints: 8,
      returnedCards: 1,
    });
  });

  it('is 409 SPRINT_NOT_ACTIVE for a planned or an already closed sprint', async () => {
    const { owner, newSprint } = await setup();
    const sprint = await newSprint();
    const planned = await call('POST', `/api/sprints/${sprint.id}/close`, owner);
    expect(planned.statusCode).toBe(409);
    expect(errorOf(planned).code).toBe('SPRINT_NOT_ACTIVE');

    await call('POST', `/api/sprints/${sprint.id}/start`, owner);
    expect((await call('POST', `/api/sprints/${sprint.id}/close`, owner)).statusCode).toBe(200);
    const again = await call('POST', `/api/sprints/${sprint.id}/close`, owner);
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).code).toBe('SPRINT_NOT_ACTIVE');
  });

  it('refuses viewers (403), non-members (404, same as a missing id) and anonymous calls (401)', async () => {
    const { owner, viewer, outsider, activeSprint } = await setup();
    const { sprint, c } = await activeSprint();

    const asViewer = await call('POST', `/api/sprints/${sprint.id}/close`, viewer);
    expect(asViewer.statusCode).toBe(403);
    const asOutsider = await call('POST', `/api/sprints/${sprint.id}/close`, outsider);
    const missing = await call(
      'POST',
      '/api/sprints/0192f000-0000-7000-8000-0000000000ff/close',
      outsider,
    );
    expect(asOutsider.statusCode).toBe(404);
    expect(asOutsider.json()).toEqual(missing.json());
    expect((await call('POST', `/api/sprints/${sprint.id}/close`)).statusCode).toBe(401);
    expect((await call('POST', '/api/sprints/not-a-uuid/close', owner)).statusCode).toBe(400);

    // Nothing changed.
    expect((await prisma.sprint.findUniqueOrThrow({ where: { id: sprint.id } })).status).toBe(
      'active',
    );
    expect((await prisma.card.findUniqueOrThrow({ where: { id: c.id } })).sprintId).toBe(sprint.id);
  });

  it('lets exactly one of two parallel closes succeed', async () => {
    const { owner, member, activeSprint } = await setup();
    const { sprint } = await activeSprint();
    const results = await Promise.all([
      call('POST', `/api/sprints/${sprint.id}/close`, owner),
      call('POST', `/api/sprints/${sprint.id}/close`, member),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.statusCode === 409);
    expect(loser && errorOf(loser).code).toBe('SPRINT_NOT_ACTIVE');
    // The work was done once: one history row per returned card, one closing snapshot.
    expect(await prisma.activityEvent.count({ where: { type: 'sprint_removed' } })).toBe(2);
    expect(await prisma.sprintEvent.count({ where: { type: 'sprint_closed' } })).toBe(1);
  });

  it('leaves the sprint and the cards untouched when something fails half way', async () => {
    const { owner, activeSprint } = await setup();
    const { sprint, c, d } = await activeSprint();
    // The closing snapshot is written last: make that insert fail after the cards were updated.
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION kb023_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER kb023_fail BEFORE INSERT ON sprint_events
       FOR EACH ROW WHEN (NEW.type = 'sprint_closed') EXECUTE FUNCTION kb023_fail()`,
    );
    const published: BoardEvent[] = [];
    const off = onBoardEvent((event) => published.push(event));
    try {
      const res = await call('POST', `/api/sprints/${sprint.id}/close`, owner);
      expect(res.statusCode).toBe(500);
    } finally {
      off();
      await prisma.$executeRawUnsafe('DROP TRIGGER kb023_fail ON sprint_events');
      await prisma.$executeRawUnsafe('DROP FUNCTION kb023_fail()');
    }

    const row = await prisma.sprint.findUniqueOrThrow({ where: { id: sprint.id } });
    expect(row).toMatchObject({ status: 'active', completedPoints: null, closedAt: null });
    const cards = await prisma.card.findMany({ where: { id: { in: [c.id, d.id] } } });
    expect(cards.every((card) => card.sprintId === sprint.id)).toBe(true);
    expect(await prisma.activityEvent.count({ where: { type: 'sprint_removed' } })).toBe(0);
    expect(published).toEqual([]);

    // Once the failure is gone the same close works.
    expect((await call('POST', `/api/sprints/${sprint.id}/close`, owner)).statusCode).toBe(200);
  });

  it('publishes the returned cards and the closed sprint after the commit', async () => {
    const { owner, activeSprint } = await setup();
    const { sprint, c, d, a } = await activeSprint();
    const published: BoardEvent[] = [];
    const off = onBoardEvent((event) => published.push(event));
    try {
      await call('POST', `/api/sprints/${sprint.id}/close`, owner);
    } finally {
      off();
    }
    const cardEvents = published.filter((e) => e.type === 'card_updated');
    expect(cardEvents.map((e) => (e.entity as { id: string }).id).sort()).toEqual(
      [c.id, d.id].sort(),
    );
    for (const e of cardEvents) {
      expect(e.entity).toMatchObject({ sprintId: null });
      expect((e.entity as { id: string }).id).not.toBe(a.id);
    }
    const closed = published.find((e) => e.type === 'sprint_updated');
    expect(closed?.entity).toMatchObject({ id: sprint.id, status: 'closed', completedPoints: 8 });
    expect(published.at(-1)?.type).toBe('sprint_updated');
  });

  it('keeps a finished card in the closed sprint: it cannot be moved out of it', async () => {
    const { owner, activeSprint } = await setup();
    const { sprint, a } = await activeSprint();
    await call('POST', `/api/sprints/${sprint.id}/close`, owner);
    const res = await call('PUT', `/api/cards/${a.id}/sprint`, owner, { sprintId: null });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('SPRINT_CLOSED');
  });
});
