import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activityEventDataSchema,
  apiErrorSchema,
  boardResponseSchema,
  cardResponseSchema,
  MAX_KEY_LENGTH,
  projectResponseSchema,
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

async function newProject(who: TestUser, workspaceId: string, key: string) {
  const res = await call('POST', `/api/workspaces/${workspaceId}/projects`, who, {
    name: `Project ${key}`,
    key,
  });
  expect(res.statusCode).toBe(201);
  return projectResponseSchema.parse(res.json()).project;
}

async function getBoard(who: TestUser, projectId: string) {
  const res = await call('GET', `/api/projects/${projectId}/board`, who);
  expect(res.statusCode).toBe(200);
  return boardResponseSchema.parse(res.json());
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
  const project = await newProject(owner, ws.id, 'KB');
  const board = await getBoard(owner, project.id);
  const [todo, doing, done] = board.columns as [
    (typeof board.columns)[number],
    (typeof board.columns)[number],
    (typeof board.columns)[number],
  ];
  return { owner, member, viewer, outsider, ws, project, todo, doing, done };
}

async function addCard(who: TestUser, columnId: string, title: string) {
  const res = await call('POST', `/api/columns/${columnId}/cards`, who, { title });
  expect(res.statusCode).toBe(201);
  return cardResponseSchema.parse(res.json()).card;
}

const move = (who: TestUser | undefined, id: string, body: object) =>
  call('POST', `/api/cards/${id}/move`, who, body);

const errorOf = (res: { json: () => unknown }) => apiErrorSchema.parse(res.json()).error;

/** Titles of a column in board order. */
async function titles(who: TestUser, projectId: string, columnId: string) {
  const board = await getBoard(who, projectId);
  return board.cards.filter((c) => c.columnId === columnId).map((c) => c.title);
}

describe('POST /api/cards/:id/move', () => {
  it('reorders inside a column, increments version and returns the final position', async () => {
    const { owner, todo, project } = await setup();
    const a = await addCard(owner, todo.id, 'A');
    const b = await addCard(owner, todo.id, 'B');
    const c = await addCard(owner, todo.id, 'C');
    const res = await move(owner, c.id, {
      columnId: todo.id,
      afterCardId: null,
      beforeCardId: a.id,
    });
    expect(res.statusCode).toBe(200);
    const moved = cardResponseSchema.parse(res.json()).card;
    expect(moved.version).toBe(c.version + 1);
    expect(moved.columnId).toBe(todo.id);
    expect(moved.position < a.position).toBe(true);
    expect(await titles(owner, project.id, todo.id)).toEqual(['C', 'A', 'B']);
    void b;
  });

  it('moves between columns, records one moved event and none for a plain reorder', async () => {
    const { member, todo, doing, project } = await setup();
    const a = await addCard(member, todo.id, 'A');
    const x = await addCard(member, doing.id, 'X');
    const y = await addCard(member, doing.id, 'Y');
    const res = await move(member, a.id, {
      columnId: doing.id,
      afterCardId: x.id,
      beforeCardId: y.id,
    });
    expect(res.statusCode).toBe(200);
    expect(cardResponseSchema.parse(res.json()).card.columnId).toBe(doing.id);
    expect(await titles(member, project.id, doing.id)).toEqual(['X', 'A', 'Y']);
    expect(await titles(member, project.id, todo.id)).toEqual([]);

    await move(member, a.id, { columnId: doing.id, afterCardId: y.id });
    const events = (await prisma.activityEvent.findMany({ where: { cardId: a.id } })).map((e) =>
      activityEventDataSchema.parse({ type: e.type, data: e.data }),
    );
    expect(events.filter((e) => e.type === 'moved')).toEqual([
      { type: 'moved', data: { fromColumnId: todo.id, toColumnId: doing.id } },
    ]);
  });

  it('puts the card at the end of an empty or neighbour-less target', async () => {
    const { owner, todo, doing, project } = await setup();
    const a = await addCard(owner, todo.id, 'A');
    const x = await addCard(owner, doing.id, 'X');
    expect((await move(owner, a.id, { columnId: doing.id })).statusCode).toBe(200);
    expect(await titles(owner, project.id, doing.id)).toEqual(['X', 'A']);
    void x;
  });

  it('uses the remaining neighbour when the other one is stale', async () => {
    const { owner, todo, doing, project } = await setup();
    const a = await addCard(owner, todo.id, 'A');
    const b = await addCard(owner, todo.id, 'B');
    const c = await addCard(owner, todo.id, 'C');
    await call('DELETE', `/api/cards/${b.id}`, owner);
    // `after` is deleted, `before` (C) remains: the card goes right before C.
    const d = await addCard(owner, doing.id, 'D');
    const res = await move(owner, d.id, {
      columnId: todo.id,
      afterCardId: b.id,
      beforeCardId: c.id,
    });
    expect(res.statusCode).toBe(200);
    expect(await titles(owner, project.id, todo.id)).toEqual(['A', 'D', 'C']);
    void a;
  });

  it('treats a neighbour that moved to another column as stale', async () => {
    const { owner, todo, doing, project } = await setup();
    const a = await addCard(owner, todo.id, 'A');
    const b = await addCard(owner, todo.id, 'B');
    const x = await addCard(owner, doing.id, 'X');
    // B is no longer in `todo`; moving X after B falls back to the end of the column.
    await move(owner, b.id, { columnId: doing.id });
    const res = await move(owner, x.id, { columnId: todo.id, afterCardId: b.id });
    expect(res.statusCode).toBe(200);
    expect(await titles(owner, project.id, todo.id)).toEqual(['A', 'X']);
    void a;
  });

  it('answers 404 for a column on another board, another workspace or a missing one', async () => {
    const { owner, todo, ws } = await setup();
    const other = await newProject(owner, ws.id, 'OT');
    const otherBoard = await getBoard(owner, other.id);
    const a = await addCard(owner, todo.id, 'A');
    const otherColumn = otherBoard.columns[0] as { id: string };
    expect((await move(owner, a.id, { columnId: otherColumn.id })).statusCode).toBe(404);
    expect((await move(owner, a.id, { columnId: randomUUID() })).statusCode).toBe(404);

    const stranger = await createUserAndLogin(app, { name: 'Sam' });
    const strangerWs = workspaceResponseSchema.parse(
      (await call('POST', '/api/workspaces', stranger, { name: 'Other' })).json(),
    ).workspace;
    const strangerProject = await newProject(stranger, strangerWs.id, 'ST');
    const strangerColumn = (await getBoard(stranger, strangerProject.id)).columns[0] as {
      id: string;
    };
    expect((await move(owner, a.id, { columnId: strangerColumn.id })).statusCode).toBe(404);
  });

  it('answers 404 for a neighbour from another board', async () => {
    const { owner, todo, ws } = await setup();
    const other = await newProject(owner, ws.id, 'OT');
    const otherColumn = (await getBoard(owner, other.id)).columns[0] as { id: string };
    const foreign = await addCard(owner, otherColumn.id, 'Foreign');
    const a = await addCard(owner, todo.id, 'A');
    const res = await move(owner, a.id, { columnId: todo.id, afterCardId: foreign.id });
    expect(res.statusCode).toBe(404);
  });

  it('answers 403 for a viewer, 404 for a non-member and 404 for a deleted card', async () => {
    const { owner, viewer, outsider, todo, doing } = await setup();
    const a = await addCard(owner, todo.id, 'A');
    const forViewer = await move(viewer, a.id, { columnId: doing.id });
    expect(forViewer.statusCode).toBe(403);
    expect(errorOf(forViewer).code).toBe('FORBIDDEN');
    const forOutsider = await move(outsider, a.id, { columnId: doing.id });
    const forUnknown = await move(outsider, randomUUID(), { columnId: doing.id });
    expect(forOutsider.statusCode).toBe(404);
    expect(forOutsider.json()).toEqual(forUnknown.json());
    await call('DELETE', `/api/cards/${a.id}`, owner);
    expect((await move(owner, a.id, { columnId: doing.id })).statusCode).toBe(404);
  });

  it('answers 401 without a session and 400 for a bad body', async () => {
    const { owner, todo } = await setup();
    const a = await addCard(owner, todo.id, 'A');
    expect((await move(undefined, a.id, { columnId: todo.id })).statusCode).toBe(401);
    expect((await move(owner, a.id, {})).statusCode).toBe(400);
    expect((await move(owner, a.id, { columnId: 'nope' })).statusCode).toBe(400);
    expect((await move(owner, a.id, { columnId: todo.id, extra: 1 })).statusCode).toBe(400);
    expect((await move(owner, 'not-a-uuid', { columnId: todo.id })).statusCode).toBe(400);
  });

  it('keeps both cards, once each, in a deterministic order for parallel moves into one gap', async () => {
    const { owner, member, todo, doing, project } = await setup();
    const a = await addCard(owner, todo.id, 'A');
    const b = await addCard(owner, todo.id, 'B');
    const p = await addCard(owner, doing.id, 'P');
    const q = await addCard(owner, doing.id, 'Q');
    const results = await Promise.all([
      move(owner, p.id, { columnId: todo.id, afterCardId: a.id, beforeCardId: b.id }),
      move(member, q.id, { columnId: todo.id, afterCardId: a.id, beforeCardId: b.id }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    const order = await titles(owner, project.id, todo.id);
    expect(order).toHaveLength(4);
    expect(new Set(order)).toEqual(new Set(['A', 'B', 'P', 'Q']));
    expect(order[0]).toBe('A');
    expect(order[3]).toBe('B');
    expect(await titles(owner, project.id, doing.id)).toEqual([]);
    // Reading again gives the same order every time.
    expect(await titles(member, project.id, todo.id)).toEqual(order);
  });

  it('leaves a card that is moved twice in parallel exactly once on the board', async () => {
    const { owner, member, todo, doing, done, project } = await setup();
    const a = await addCard(owner, todo.id, 'A');
    const results = await Promise.all([
      move(owner, a.id, { columnId: doing.id }),
      move(member, a.id, { columnId: done.id }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    const board = await getBoard(owner, project.id);
    expect(board.cards.filter((c) => c.id === a.id)).toHaveLength(1);
    expect(board.cards).toHaveLength(1);
  });

  it('rebalances the column without changing the order when keys outgrow the limit', async () => {
    const { owner, todo, doing, project } = await setup();
    const first = await addCard(owner, todo.id, 'c0');
    await addCard(owner, todo.id, 'c1');
    const expected = ['c0'];
    // Insert each new card right after the first one: the key keeps growing in the same gap.
    for (let i = 0; i < 320; i += 1) {
      const card = await addCard(owner, doing.id, `m${i}`);
      const res = await move(owner, card.id, { columnId: todo.id, afterCardId: first.id });
      expect(res.statusCode).toBe(200);
      expected.splice(1, 0, `m${i}`);
    }
    expected.push('c1');
    const board = await getBoard(owner, project.id);
    const cards = board.cards.filter((c) => c.columnId === todo.id);
    expect(cards.map((c) => c.title)).toEqual(expected);
    expect(Math.max(...cards.map((c) => c.position.length))).toBeLessThanOrEqual(MAX_KEY_LENGTH);
  }, 60_000);
});
