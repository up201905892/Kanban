import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activityEventDataSchema,
  apiErrorSchema,
  boardResponseSchema,
  cardResponseSchema,
  projectResponseSchema,
  sprintEventDataSchema,
  sprintListResponseSchema,
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
const sprintOf = (res: { json: () => unknown }) => sprintResponseSchema.parse(res.json()).sprint;
const dates = { startDate: '2026-11-16', endDate: '2026-11-27' };

async function projectWithBoard(owner: TestUser, wsId: string, key: string) {
  const project = projectResponseSchema.parse(
    (
      await call('POST', `/api/workspaces/${wsId}/projects`, owner, { name: `P ${key}`, key })
    ).json(),
  ).project;
  const board = boardResponseSchema.parse(
    (await call('GET', `/api/projects/${project.id}/board`, owner)).json(),
  );
  return { project, board };
}

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
  const main = await projectWithBoard(owner, ws.id, 'KB');
  const other = await projectWithBoard(owner, ws.id, 'OT');
  const todo = main.board.columns[0];
  const done = main.board.columns.find((c) => c.isDone);
  if (!todo || !done) throw new Error('no columns');
  const newCard = async (title: string, estimate?: number) => {
    const card = cardResponseSchema.parse(
      (await call('POST', `/api/columns/${todo.id}/cards`, owner, { title })).json(),
    ).card;
    if (estimate !== undefined) {
      await call('PATCH', `/api/cards/${card.id}`, owner, { estimate });
    }
    return card;
  };
  const newSprint = async (who: TestUser = owner, name = 'Sprint 1', projectId = main.project.id) =>
    sprintOf(await call('POST', `/api/projects/${projectId}/sprints`, who, { name, ...dates }));
  return { owner, member, viewer, outsider, ws, main, other, todo, done, newCard, newSprint };
}

describe('POST /api/projects/:pid/sprints', () => {
  it('creates a planned sprint for owners and members', async () => {
    const { owner, member, main } = await setup();
    const res = await call('POST', `/api/projects/${main.project.id}/sprints`, owner, {
      name: ' Sprint 1 ',
      goal: 'Ship the backlog',
      ...dates,
    });
    expect(res.statusCode).toBe(201);
    const sprint = sprintOf(res);
    expect(sprint).toMatchObject({
      projectId: main.project.id,
      name: 'Sprint 1',
      goal: 'Ship the backlog',
      status: 'planned',
      committedPoints: null,
      completedPoints: null,
      closedAt: null,
      ...dates,
    });
    const asMember = await call('POST', `/api/projects/${main.project.id}/sprints`, member, {
      name: 'Sprint 2',
      startDate: '2026-11-30',
      endDate: '2026-12-11',
    });
    expect(asMember.statusCode).toBe(201);
  });

  it('answers a repeated create with the same client id by returning the sprint (A6)', async () => {
    const { owner, main } = await setup();
    const id = randomUUID();
    const body = { id, name: 'Sprint 1', ...dates };
    const first = await call('POST', `/api/projects/${main.project.id}/sprints`, owner, body);
    const second = await call('POST', `/api/projects/${main.project.id}/sprints`, owner, body);
    expect([first.statusCode, second.statusCode]).toEqual([201, 200]);
    expect(await prisma.sprint.count()).toBe(1);
    const elsewhere = await call('POST', `/api/projects/${main.project.id}/sprints`, owner, {
      ...body,
      id: sprintOf(second).id,
    });
    expect(elsewhere.statusCode).toBe(200);
  });

  it('rejects an id that belongs to another project with 409', async () => {
    const { owner, main, other } = await setup();
    const existing = await call('POST', `/api/projects/${other.project.id}/sprints`, owner, {
      name: 'Theirs',
      ...dates,
    });
    const res = await call('POST', `/api/projects/${main.project.id}/sprints`, owner, {
      id: sprintOf(existing).id,
      name: 'Mine',
      ...dates,
    });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('CONFLICT');
  });

  it('rejects an end before the start, an impossible date and unknown fields with 400', async () => {
    const { owner, main } = await setup();
    const url = `/api/projects/${main.project.id}/sprints`;
    const reversed = await call('POST', url, owner, {
      name: 'S',
      startDate: '2026-11-20',
      endDate: '2026-11-19',
    });
    expect(reversed.statusCode).toBe(400);
    expect(errorOf(reversed).code).toBe('VALIDATION_ERROR');
    const impossible = await call('POST', url, owner, {
      name: 'S',
      startDate: '2026-02-30',
      endDate: '2026-03-10',
    });
    expect(impossible.statusCode).toBe(400);
    const status = await call('POST', url, owner, { name: 'S', ...dates, status: 'active' });
    expect(status.statusCode).toBe(400);
    const noName = await call('POST', url, owner, { name: ' ', ...dates });
    expect(noName.statusCode).toBe(400);
  });

  it('is 401 without a session, 403 for a viewer and 404 for a non-member', async () => {
    const { viewer, outsider, main } = await setup();
    const url = `/api/projects/${main.project.id}/sprints`;
    const body = { name: 'S', ...dates };
    expect((await call('POST', url, undefined, body)).statusCode).toBe(401);
    const forViewer = await call('POST', url, viewer, body);
    expect(forViewer.statusCode).toBe(403);
    expect(errorOf(forViewer).code).toBe('FORBIDDEN');
    const forOutsider = await call('POST', url, outsider, body);
    const missing = await call('POST', `/api/projects/${randomUUID()}/sprints`, outsider, body);
    expect(forOutsider.statusCode).toBe(404);
    expect(forOutsider.json()).toEqual(missing.json());
  });

  it('is refused without a matching Origin (CSRF)', async () => {
    const { owner, main } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${main.project.id}/sprints`,
      headers: { cookie: owner.cookie, origin: 'http://evil.example' },
      payload: { name: 'S', ...dates },
    });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('CSRF_REJECTED');
  });

  it('refuses at the database an end before the start that skipped the API', async () => {
    const { main } = await setup();
    await expect(
      prisma.sprint.create({
        data: {
          projectId: main.project.id,
          name: 'Bad',
          startDate: new Date('2026-11-20T00:00:00Z'),
          endDate: new Date('2026-11-19T00:00:00Z'),
        },
      }),
    ).rejects.toThrow();
  });

  it('publishes a sprint_updated board event after the commit', async () => {
    const { owner, main } = await setup();
    const seen: BoardEvent[] = [];
    const off = onBoardEvent((e) => seen.push(e));
    const sprint = sprintOf(
      await call('POST', `/api/projects/${main.project.id}/sprints`, owner, {
        name: 'S',
        ...dates,
      }),
    );
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: 'sprint_updated',
      boardId: main.board.board.id,
      actorId: owner.user.id,
      entity: { id: sprint.id, status: 'planned' },
    });
  });
});

describe('GET /api/projects/:pid/sprints', () => {
  it('lists every role, ordered by start date, with cursor pagination and no gaps', async () => {
    const { owner, viewer, main } = await setup();
    for (let i = 0; i < 5; i++) {
      await call('POST', `/api/projects/${main.project.id}/sprints`, owner, {
        name: `Sprint ${i}`,
        startDate: `2026-12-0${5 - i}`,
        endDate: '2026-12-20',
      });
    }
    // Two sprints on the same day: the id breaks the tie.
    const names: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const url: string =
        `/api/projects/${main.project.id}/sprints?limit=2` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const res = await call('GET', url, viewer);
      expect(res.statusCode).toBe(200);
      const body = sprintListResponseSchema.parse(res.json());
      names.push(...body.sprints.map((s) => s.name));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(names).toEqual(['Sprint 4', 'Sprint 3', 'Sprint 2', 'Sprint 1', 'Sprint 0']);
  });

  it('pages through sprints that share a start date without duplicates', async () => {
    const { owner, main } = await setup();
    for (let i = 0; i < 5; i++) {
      await call('POST', `/api/projects/${main.project.id}/sprints`, owner, {
        name: `S${i}`,
        ...dates,
      });
    }
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string =
        `/api/projects/${main.project.id}/sprints?limit=2` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const body = sprintListResponseSchema.parse((await call('GET', url, owner)).json());
      ids.push(...body.sprints.map((s) => s.id));
      cursor = body.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it('filters by status, caps the limit and rejects a bad cursor', async () => {
    const { owner, main, newSprint } = await setup();
    const first = await newSprint(owner, 'One');
    await newSprint(owner, 'Two');
    await call('POST', `/api/sprints/${first.id}/start`, owner);
    const active = sprintListResponseSchema.parse(
      (await call('GET', `/api/projects/${main.project.id}/sprints?status=active`, owner)).json(),
    );
    expect(active.sprints.map((s) => s.name)).toEqual(['One']);
    const tooMany = await call('GET', `/api/projects/${main.project.id}/sprints?limit=101`, owner);
    expect(tooMany.statusCode).toBe(400);
    const badCursor = await call(
      'GET',
      `/api/projects/${main.project.id}/sprints?cursor=garbage`,
      owner,
    );
    expect(badCursor.statusCode).toBe(400);
  });

  it('is 401 without a session and 404 for a non-member', async () => {
    const { outsider, main } = await setup();
    const url = `/api/projects/${main.project.id}/sprints`;
    expect((await call('GET', url)).statusCode).toBe(401);
    expect((await call('GET', url, outsider)).statusCode).toBe(404);
  });
});

describe('PATCH /api/sprints/:id', () => {
  it('edits the name, goal and dates for owners and members', async () => {
    const { member, newSprint } = await setup();
    const sprint = await newSprint();
    const res = await call('PATCH', `/api/sprints/${sprint.id}`, member, {
      name: 'Renamed',
      goal: 'New goal',
      endDate: '2026-12-04',
    });
    expect(res.statusCode).toBe(200);
    expect(sprintOf(res)).toMatchObject({
      name: 'Renamed',
      goal: 'New goal',
      startDate: '2026-11-16',
      endDate: '2026-12-04',
    });
  });

  it('rejects a merged range that ends before the start with 400', async () => {
    const { owner, newSprint } = await setup();
    const sprint = await newSprint();
    const res = await call('PATCH', `/api/sprints/${sprint.id}`, owner, { endDate: '2026-11-01' });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).code).toBe('VALIDATION_ERROR');
  });

  it('refuses to change a closed sprint with 409', async () => {
    const { owner, newSprint } = await setup();
    const sprint = await newSprint();
    await prisma.sprint.update({
      where: { id: sprint.id },
      data: { status: 'closed', closedAt: new Date() },
    });
    const res = await call('PATCH', `/api/sprints/${sprint.id}`, owner, { name: 'Nope' });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('SPRINT_CLOSED');
  });

  it('is 401, 403 for a viewer, 404 for a non-member and 400 for an empty body', async () => {
    const { owner, viewer, outsider, newSprint } = await setup();
    const sprint = await newSprint();
    const url = `/api/sprints/${sprint.id}`;
    expect((await call('PATCH', url, undefined, { name: 'x' })).statusCode).toBe(401);
    expect((await call('PATCH', url, viewer, { name: 'x' })).statusCode).toBe(403);
    const hidden = await call('PATCH', url, outsider, { name: 'x' });
    const missing = await call('PATCH', `/api/sprints/${randomUUID()}`, outsider, { name: 'x' });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual(missing.json());
    expect((await call('PATCH', url, owner, {})).statusCode).toBe(400);
  });
});

describe('POST /api/sprints/:id/start', () => {
  it('starts a planned sprint, stores the committed points and writes the snapshot', async () => {
    const { owner, member, newSprint, newCard } = await setup();
    const sprint = await newSprint();
    const a = await newCard('A', 5);
    const b = await newCard('B', 3);
    const c = await newCard('Unestimated');
    const outside = await newCard('Not in the sprint', 8);
    for (const card of [a, b, c]) {
      await call('PUT', `/api/cards/${card.id}/sprint`, owner, { sprintId: sprint.id });
    }
    const res = await call('POST', `/api/sprints/${sprint.id}/start`, member);
    expect(res.statusCode).toBe(200);
    expect(sprintOf(res)).toMatchObject({ status: 'active', committedPoints: 8 });

    const events = await prisma.sprintEvent.findMany({ where: { sprintId: sprint.id } });
    expect(events).toHaveLength(1);
    const snapshot = sprintEventDataSchema.parse({ type: events[0]?.type, data: events[0]?.data });
    expect(snapshot.type).toBe('sprint_started');
    expect(snapshot.data.committedPoints).toBe(8);
    expect(snapshot.data.cards.map((x) => x.cardId).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(snapshot.data.cards.map((x) => x.cardId)).not.toContain(outside.id);
    expect(events[0]?.actorId).toBe(member.user.id);
  });

  it('starts an empty sprint with 0 committed points', async () => {
    const { owner, newSprint } = await setup();
    const sprint = await newSprint();
    const res = await call('POST', `/api/sprints/${sprint.id}/start`, owner);
    expect(sprintOf(res)).toMatchObject({ status: 'active', committedPoints: 0 });
  });

  it('answers 409 SPRINT_ALREADY_ACTIVE for a second active sprint', async () => {
    const { owner, newSprint } = await setup();
    const first = await newSprint(owner, 'One');
    const second = await newSprint(owner, 'Two');
    expect((await call('POST', `/api/sprints/${first.id}/start`, owner)).statusCode).toBe(200);
    const res = await call('POST', `/api/sprints/${second.id}/start`, owner);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('SPRINT_ALREADY_ACTIVE');
    expect((await prisma.sprint.findUnique({ where: { id: second.id } }))?.status).toBe('planned');
  });

  it('lets exactly one of two parallel starts win', async () => {
    const { owner, member, newSprint } = await setup();
    const first = await newSprint(owner, 'One');
    const second = await newSprint(owner, 'Two');
    const results = await Promise.all([
      call('POST', `/api/sprints/${first.id}/start`, owner),
      call('POST', `/api/sprints/${second.id}/start`, member),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.statusCode === 409);
    expect(loser && errorOf(loser).code).toBe('SPRINT_ALREADY_ACTIVE');
    expect(await prisma.sprint.count({ where: { status: 'active' } })).toBe(1);
  });

  it('refuses a second active sprint at the database too', async () => {
    const { main, newSprint } = await setup();
    const first = await newSprint();
    const second = await newSprint(undefined, 'Two');
    await prisma.sprint.update({ where: { id: first.id }, data: { status: 'active' } });
    await expect(
      prisma.sprint.update({ where: { id: second.id }, data: { status: 'active' } }),
    ).rejects.toThrow();
    expect(main.project.id).toBe(first.projectId);
  });

  it('allows one active sprint in each project', async () => {
    const { owner, other, newSprint } = await setup();
    const a = await newSprint(owner, 'A');
    const b = await newSprint(owner, 'B', other.project.id);
    expect((await call('POST', `/api/sprints/${a.id}/start`, owner)).statusCode).toBe(200);
    expect((await call('POST', `/api/sprints/${b.id}/start`, owner)).statusCode).toBe(200);
  });

  it('refuses to start a sprint that is already active or closed with 409 SPRINT_NOT_PLANNED', async () => {
    const { owner, newSprint } = await setup();
    const sprint = await newSprint();
    await call('POST', `/api/sprints/${sprint.id}/start`, owner);
    const again = await call('POST', `/api/sprints/${sprint.id}/start`, owner);
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).code).toBe('SPRINT_NOT_PLANNED');
    await prisma.sprint.update({
      where: { id: sprint.id },
      data: { status: 'closed', closedAt: new Date() },
    });
    const closed = await call('POST', `/api/sprints/${sprint.id}/start`, owner);
    expect(errorOf(closed).code).toBe('SPRINT_NOT_PLANNED');
  });

  it('is 401, 403 for a viewer and 404 for a non-member', async () => {
    const { viewer, outsider, newSprint } = await setup();
    const sprint = await newSprint();
    const url = `/api/sprints/${sprint.id}/start`;
    expect((await call('POST', url)).statusCode).toBe(401);
    expect((await call('POST', url, viewer)).statusCode).toBe(403);
    const hidden = await call('POST', url, outsider);
    const missing = await call('POST', `/api/sprints/${randomUUID()}/start`, outsider);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual(missing.json());
  });

  it('publishes the started sprint as a board event', async () => {
    const { owner, newSprint } = await setup();
    const sprint = await newSprint();
    const seen: BoardEvent[] = [];
    const off = onBoardEvent((e) => seen.push(e));
    await call('POST', `/api/sprints/${sprint.id}/start`, owner);
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: 'sprint_updated',
      entity: { id: sprint.id, status: 'active', committedPoints: 0 },
    });
  });
});

describe('PUT /api/cards/:id/sprint', () => {
  it('adds a card to a planned sprint, then moves it between sprints and back to the backlog', async () => {
    const { owner, member, newSprint, newCard } = await setup();
    const one = await newSprint(owner, 'One');
    const two = await newSprint(owner, 'Two');
    const card = await newCard('A');

    const added = await call('PUT', `/api/cards/${card.id}/sprint`, member, { sprintId: one.id });
    expect(added.statusCode).toBe(200);
    expect(cardResponseSchema.parse(added.json()).card).toMatchObject({
      sprintId: one.id,
      version: card.version + 1,
    });

    const moved = await call('PUT', `/api/cards/${card.id}/sprint`, owner, { sprintId: two.id });
    expect(cardResponseSchema.parse(moved.json()).card.sprintId).toBe(two.id);
    const removed = await call('PUT', `/api/cards/${card.id}/sprint`, owner, { sprintId: null });
    expect(cardResponseSchema.parse(removed.json()).card.sprintId).toBeNull();

    const log = (
      await prisma.activityEvent.findMany({
        where: { cardId: card.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    )
      .map((e) => activityEventDataSchema.parse({ type: e.type, data: e.data }))
      .filter((e) => e.type === 'sprint_added' || e.type === 'sprint_removed')
      .map((e) => [e.type, e.data.sprintName]);
    expect(log).toEqual([
      ['sprint_added', 'One'],
      ['sprint_removed', 'One'],
      ['sprint_added', 'Two'],
      ['sprint_removed', 'Two'],
    ]);
  });

  it('accepts an active sprint and does nothing (no version, no event) when the sprint is the same', async () => {
    const { owner, newSprint, newCard } = await setup();
    const sprint = await newSprint();
    await call('POST', `/api/sprints/${sprint.id}/start`, owner);
    const card = await newCard('A');
    const first = await call('PUT', `/api/cards/${card.id}/sprint`, owner, {
      sprintId: sprint.id,
    });
    expect(first.statusCode).toBe(200);
    const before = await prisma.activityEvent.count({ where: { cardId: card.id } });
    const seen: BoardEvent[] = [];
    const off = onBoardEvent((e) => seen.push(e));
    const again = await call('PUT', `/api/cards/${card.id}/sprint`, owner, {
      sprintId: sprint.id,
    });
    off();
    expect(cardResponseSchema.parse(again.json()).card.version).toBe(
      cardResponseSchema.parse(first.json()).card.version,
    );
    expect(await prisma.activityEvent.count({ where: { cardId: card.id } })).toBe(before);
    expect(seen).toHaveLength(0);
  });

  it('publishes a card_updated board event with the sprint and the new version', async () => {
    const { owner, newSprint, newCard } = await setup();
    const sprint = await newSprint();
    const card = await newCard('A');
    const seen: BoardEvent[] = [];
    const off = onBoardEvent((e) => seen.push(e));
    await call('PUT', `/api/cards/${card.id}/sprint`, owner, { sprintId: sprint.id });
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: 'card_updated',
      entity: { id: card.id, sprintId: sprint.id },
      version: card.version + 1,
    });
  });

  it('refuses a closed sprint with 409 SPRINT_CLOSED and changes nothing', async () => {
    const { owner, newSprint, newCard } = await setup();
    const sprint = await newSprint();
    await prisma.sprint.update({
      where: { id: sprint.id },
      data: { status: 'closed', closedAt: new Date() },
    });
    const card = await newCard('A');
    const res = await call('PUT', `/api/cards/${card.id}/sprint`, owner, { sprintId: sprint.id });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('SPRINT_CLOSED');
    expect((await prisma.card.findUnique({ where: { id: card.id } }))?.sprintId).toBeNull();
  });

  it('keeps a finished card in its closed sprint (409 when asked to remove or move it)', async () => {
    const { owner, newSprint, newCard } = await setup();
    const closed = await newSprint(owner, 'Closed');
    const open = await newSprint(owner, 'Open');
    const card = await newCard('A');
    await call('PUT', `/api/cards/${card.id}/sprint`, owner, { sprintId: closed.id });
    await prisma.sprint.update({
      where: { id: closed.id },
      data: { status: 'closed', closedAt: new Date() },
    });
    const removed = await call('PUT', `/api/cards/${card.id}/sprint`, owner, { sprintId: null });
    expect(errorOf(removed).code).toBe('SPRINT_CLOSED');
    const moved = await call('PUT', `/api/cards/${card.id}/sprint`, owner, { sprintId: open.id });
    expect(moved.statusCode).toBe(409);
  });

  it("rejects another project's sprint and an unknown sprint with the same 400", async () => {
    const { owner, other, newSprint, newCard } = await setup();
    const foreign = await newSprint(owner, 'Foreign', other.project.id);
    const card = await newCard('A');
    const res = await call('PUT', `/api/cards/${card.id}/sprint`, owner, { sprintId: foreign.id });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).code).toBe('INVALID_SPRINT');
    const unknown = await call('PUT', `/api/cards/${card.id}/sprint`, owner, {
      sprintId: randomUUID(),
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toEqual(res.json());
    expect((await prisma.card.findUnique({ where: { id: card.id } }))?.sprintId).toBeNull();
  });

  it('never links a sprint of another workspace the caller cannot see', async () => {
    const { owner, outsider, ws, newCard } = await setup();
    const card = await newCard('A');
    const theirWs = workspaceResponseSchema.parse(
      (await call('POST', '/api/workspaces', outsider, { name: 'Theirs' })).json(),
    ).workspace;
    const theirs = await projectWithBoard(outsider, theirWs.id, 'TH');
    const sprint = sprintOf(
      await call('POST', `/api/projects/${theirs.project.id}/sprints`, outsider, {
        name: 'Secret',
        ...dates,
      }),
    );
    const res = await call('PUT', `/api/cards/${card.id}/sprint`, owner, { sprintId: sprint.id });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).code).toBe('INVALID_SPRINT');
    expect(ws.id).not.toBe(theirWs.id);
  });

  it('is 401, 403 for a viewer, 404 for a non-member and 404 for a deleted card', async () => {
    const { owner, viewer, outsider, newSprint, newCard } = await setup();
    const sprint = await newSprint();
    const card = await newCard('A');
    const url = `/api/cards/${card.id}/sprint`;
    const body = { sprintId: sprint.id };
    expect((await call('PUT', url, undefined, body)).statusCode).toBe(401);
    expect((await call('PUT', url, viewer, body)).statusCode).toBe(403);
    expect((await call('PUT', url, outsider, body)).statusCode).toBe(404);
    await call('DELETE', `/api/cards/${card.id}`, owner);
    expect((await call('PUT', url, owner, body)).statusCode).toBe(404);
  });

  it('is 400 for a body without sprintId or with extra fields', async () => {
    const { owner, newCard } = await setup();
    const card = await newCard('A');
    const url = `/api/cards/${card.id}/sprint`;
    expect((await call('PUT', url, owner, {})).statusCode).toBe(400);
    expect((await call('PUT', url, owner, { sprintId: null, extra: 1 })).statusCode).toBe(400);
    expect((await call('PUT', url, owner, { sprintId: 'nope' })).statusCode).toBe(400);
  });
});

describe('board response', () => {
  it('carries the planned and active sprints and the sprint of each card', async () => {
    const { owner, main, newSprint, newCard } = await setup();
    const one = await newSprint(owner, 'One');
    const two = await newSprint(owner, 'Two');
    const closed = await newSprint(owner, 'Old');
    await prisma.sprint.update({
      where: { id: closed.id },
      data: { status: 'closed', closedAt: new Date() },
    });
    await call('POST', `/api/sprints/${one.id}/start`, owner);
    const card = await newCard('A');
    await call('PUT', `/api/cards/${card.id}/sprint`, owner, { sprintId: two.id });
    const board = boardResponseSchema.parse(
      (await call('GET', `/api/projects/${main.project.id}/board`, owner)).json(),
    );
    expect(board.sprints.map((s) => [s.name, s.status])).toEqual([
      ['One', 'active'],
      ['Two', 'planned'],
    ]);
    expect(board.cards.find((c) => c.id === card.id)?.sprintId).toBe(two.id);
  });
});
