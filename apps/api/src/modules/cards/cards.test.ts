import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activityEventDataSchema,
  apiErrorSchema,
  boardResponseSchema,
  cardResponseSchema,
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
  return { owner, member, viewer, outsider, ws, project, board, todo, doing, done };
}

async function addCard(who: TestUser, columnId: string, body: object = { title: 'A card' }) {
  const res = await call('POST', `/api/columns/${columnId}/cards`, who, body);
  expect([200, 201]).toContain(res.statusCode);
  return cardResponseSchema.parse(res.json()).card;
}

const errorOf = (res: { json: () => unknown }) => apiErrorSchema.parse(res.json()).error;

async function eventsOf(cardId: string) {
  const rows = await prisma.activityEvent.findMany({
    where: { cardId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((row) => activityEventDataSchema.parse({ type: row.type, data: row.data }));
}

describe('POST /api/columns/:cid/cards', () => {
  it('creates a card (201) appended to the column with the next number', async () => {
    const { owner, todo, project } = await setup();
    const first = await addCard(owner, todo.id, { title: '  First  ', description: '# Hi' });
    const second = await addCard(owner, todo.id, { title: 'Second' });
    expect(first).toMatchObject({
      title: 'First',
      description: '# Hi',
      number: 1,
      version: 1,
      columnId: todo.id,
      createdById: owner.user.id,
    });
    expect(second.number).toBe(2);
    expect(second.position > first.position).toBe(true);
    const board = await getBoard(owner, project.id);
    expect(board.cards.map((c) => c.title)).toEqual(['First', 'Second']);
  });

  it('records a created event in the same transaction', async () => {
    const { owner, todo } = await setup();
    const card = await addCard(owner, todo.id);
    expect(await eventsOf(card.id)).toEqual([
      {
        type: 'created',
        data: { title: 'A card', column: { columnId: todo.id, columnName: 'To do' } },
      },
    ]);
    const row = await prisma.activityEvent.findFirstOrThrow({ where: { cardId: card.id } });
    expect(row.actorId).toBe(owner.user.id);
  });

  it('lets members create and rejects viewers (403)', async () => {
    const { member, viewer, todo } = await setup();
    expect(
      (await call('POST', `/api/columns/${todo.id}/cards`, member, { title: 'x' })).statusCode,
    ).toBe(201);
    const res = await call('POST', `/api/columns/${todo.id}/cards`, viewer, { title: 'x' });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('FORBIDDEN');
  });

  it('answers 400 for an empty, blank or 201-character title and for unknown fields', async () => {
    const { owner, todo } = await setup();
    for (const body of [
      { title: '' },
      { title: '   ' },
      { title: 'x'.repeat(201) },
      { title: 'ok', extra: 1 },
      { title: 'ok', description: 'x'.repeat(20_001) },
      {},
    ]) {
      const res = await call('POST', `/api/columns/${todo.id}/cards`, owner, body);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    }
    const edge = await call('POST', `/api/columns/${todo.id}/cards`, owner, {
      title: 'x'.repeat(200),
      description: 'y'.repeat(20_000),
    });
    expect(edge.statusCode).toBe(201);
    expect(
      (await call('POST', `/api/columns/not-a-uuid/cards`, owner, { title: 'x' })).statusCode,
    ).toBe(400);
  });

  it('answers 401 without a session', async () => {
    const { todo } = await setup();
    const res = await call('POST', `/api/columns/${todo.id}/cards`, undefined, { title: 'x' });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res).code).toBe('UNAUTHENTICATED');
  });

  it('rejects a foreign Origin (CSRF)', async () => {
    const { owner, todo } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/api/columns/${todo.id}/cards`,
      headers: { cookie: owner.cookie, origin: 'http://evil.example' },
      payload: { title: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('CSRF_REJECTED');
  });

  it('answers 404 for a non-member exactly like an unknown column', async () => {
    const { outsider, todo } = await setup();
    const a = await call('POST', `/api/columns/${todo.id}/cards`, outsider, { title: 'x' });
    const b = await call('POST', `/api/columns/${randomUUID()}/cards`, outsider, { title: 'x' });
    expect(a.statusCode).toBe(404);
    expect(a.json()).toEqual(b.json());
    expect(await prisma.card.count()).toBe(0);
  });

  it('rejects a column of another workspace (404) and never creates the card', async () => {
    const { owner, outsider } = await setup();
    const otherWs = workspaceResponseSchema.parse(
      (await call('POST', '/api/workspaces', outsider, { name: 'Other' })).json(),
    ).workspace;
    const otherProject = await newProject(outsider, otherWs.id, 'OT');
    const otherBoard = await getBoard(outsider, otherProject.id);
    const foreignColumn = otherBoard.columns[0]!;
    const res = await call('POST', `/api/columns/${foreignColumn.id}/cards`, owner, { title: 'x' });
    expect(res.statusCode).toBe(404);
    expect(await prisma.card.count()).toBe(0);
  });

  it('is idempotent for a client id (200, no duplicate, no second event or number)', async () => {
    const { owner, todo, doing } = await setup();
    const id = randomUUID();
    const a = await call('POST', `/api/columns/${todo.id}/cards`, owner, { id, title: 'Once' });
    expect(a.statusCode).toBe(201);
    const b = await call('POST', `/api/columns/${todo.id}/cards`, owner, { id, title: 'Once' });
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    expect(await prisma.card.count()).toBe(1);
    expect(await prisma.activityEvent.count()).toBe(1);
    const next = await addCard(owner, doing.id, { title: 'Next' });
    expect(next.number).toBe(2);
  });

  it('answers 409 for an id used on another board or by a deleted card', async () => {
    const { owner, outsider, todo } = await setup();
    const ws2 = workspaceResponseSchema.parse(
      (await call('POST', '/api/workspaces', outsider, { name: 'Other' })).json(),
    ).workspace;
    const p2 = await newProject(outsider, ws2.id, 'OT');
    const b2 = await getBoard(outsider, p2.id);
    const id = randomUUID();
    await addCard(outsider, b2.columns[0]!.id, { id, title: 'Theirs' });
    const clash = await call('POST', `/api/columns/${todo.id}/cards`, owner, { id, title: 'Mine' });
    expect(clash.statusCode).toBe(409);
    expect(errorOf(clash).code).toBe('CONFLICT');

    const mine = await addCard(owner, todo.id, { id: randomUUID(), title: 'Gone' });
    await call('DELETE', `/api/cards/${mine.id}`, owner);
    const again = await call('POST', `/api/columns/${todo.id}/cards`, owner, {
      id: mine.id,
      title: 'Gone',
    });
    expect(again.statusCode).toBe(409);
  });

  it('hands out 20 distinct numbers to 20 parallel creates', async () => {
    const { owner, todo, project } = await setup();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        call('POST', `/api/columns/${todo.id}/cards`, owner, { title: `Card ${i}` }),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual(Array(20).fill(201));
    const numbers = results.map((r) => cardResponseSchema.parse(r.json()).card.number);
    expect(new Set(numbers).size).toBe(20);
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const row = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(row.nextCardNumber).toBe(21);
    const board = await getBoard(owner, project.id);
    expect(new Set(board.cards.map((c) => c.position)).size).toBe(20);
  });

  it('numbers cards per project', async () => {
    const { owner, ws, todo } = await setup();
    const other = await newProject(owner, ws.id, 'ZZ');
    const otherBoard = await getBoard(owner, other.id);
    await addCard(owner, todo.id);
    const first = await addCard(owner, otherBoard.columns[0]!.id);
    expect(first.number).toBe(1);
  });

  it('places a card between the given neighbours and falls back for stale ones', async () => {
    const { owner, todo, project } = await setup();
    const a = await addCard(owner, todo.id, { title: 'A' });
    const c = await addCard(owner, todo.id, { title: 'C' });
    await addCard(owner, todo.id, { title: 'B', afterCardId: a.id, beforeCardId: c.id });
    await addCard(owner, todo.id, { title: 'First', afterCardId: null, beforeCardId: a.id });
    await addCard(owner, todo.id, { title: 'Stale', afterCardId: randomUUID() });
    const board = await getBoard(owner, project.id);
    expect(board.cards.map((x) => x.title)).toEqual(['First', 'A', 'B', 'C', 'Stale']);
  });

  it('rejects a neighbour that lives in another column (404)', async () => {
    const { owner, todo, doing } = await setup();
    const elsewhere = await addCard(owner, doing.id);
    const res = await call('POST', `/api/columns/${todo.id}/cards`, owner, {
      title: 'x',
      afterCardId: elsewhere.id,
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.card.count()).toBe(1);
  });

  it('rebalances siblings when keys outgrow the limit', async () => {
    const { owner, todo, project } = await setup();
    const first = await addCard(owner, todo.id, { title: 'first' });
    await addCard(owner, todo.id, { title: 'last' });
    // Always insert right after the first card: keys keep getting longer until a rebalance.
    for (let i = 0; i < 70; i++) {
      await addCard(owner, todo.id, { title: `n${i}`, afterCardId: first.id });
    }
    const board = await getBoard(owner, project.id);
    expect(board.cards).toHaveLength(72);
    expect(board.cards[0]?.title).toBe('first');
    expect(board.cards.at(-1)?.title).toBe('last');
    expect(Math.max(...board.cards.map((c) => c.position.length))).toBeLessThanOrEqual(50);
  }, 30_000);
});

describe('GET /api/cards/:id', () => {
  it('returns the full card to every role', async () => {
    const { owner, member, viewer, todo } = await setup();
    const card = await addCard(owner, todo.id, { title: 'Read me', description: 'Body' });
    for (const who of [owner, member, viewer]) {
      const res = await call('GET', `/api/cards/${card.id}`, who);
      expect(res.statusCode).toBe(200);
      expect(cardResponseSchema.parse(res.json()).card).toEqual(card);
    }
  });

  it('answers 401, 400 and an identical 404 for non-members and unknown ids', async () => {
    const { owner, outsider, todo } = await setup();
    const card = await addCard(owner, todo.id);
    expect((await call('GET', `/api/cards/${card.id}`)).statusCode).toBe(401);
    expect((await call('GET', '/api/cards/nope', owner)).statusCode).toBe(400);
    const a = await call('GET', `/api/cards/${card.id}`, outsider);
    const b = await call('GET', `/api/cards/${randomUUID()}`, outsider);
    expect(a.statusCode).toBe(404);
    expect(a.json()).toEqual(b.json());
  });
});

describe('PATCH /api/cards/:id', () => {
  it('changes the title, increments the version and records title_changed', async () => {
    const { owner, member, todo } = await setup();
    const card = await addCard(owner, todo.id, { title: 'Old' });
    const res = await call('PATCH', `/api/cards/${card.id}`, member, { title: ' New ' });
    expect(res.statusCode).toBe(200);
    const updated = cardResponseSchema.parse(res.json()).card;
    expect(updated).toMatchObject({ title: 'New', version: 2 });
    expect(await eventsOf(card.id)).toEqual([
      expect.objectContaining({ type: 'created' }),
      { type: 'title_changed', data: { from: 'Old', to: 'New' } },
    ]);
    const row = await prisma.activityEvent.findFirstOrThrow({ where: { type: 'title_changed' } });
    expect(row.actorId).toBe(member.user.id);
  });

  it('stores description lengths, never the text', async () => {
    const { owner, todo } = await setup();
    const card = await addCard(owner, todo.id, { title: 'T', description: 'abc' });
    const res = await call('PATCH', `/api/cards/${card.id}`, owner, {
      description: 'a secret description',
    });
    expect(cardResponseSchema.parse(res.json()).card).toMatchObject({
      description: 'a secret description',
      version: 2,
    });
    const events = await prisma.activityEvent.findMany({ where: { type: 'description_changed' } });
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toEqual({ from: 3, to: 20 });
    expect(JSON.stringify(events[0]?.data)).not.toContain('secret');
  });

  it('writes both events (and one version step) when title and description change together', async () => {
    const { owner, todo } = await setup();
    const card = await addCard(owner, todo.id, { title: 'T' });
    const res = await call('PATCH', `/api/cards/${card.id}`, owner, {
      title: 'U',
      description: 'd',
    });
    expect(cardResponseSchema.parse(res.json()).card.version).toBe(2);
    expect((await eventsOf(card.id)).map((e) => e.type)).toEqual([
      'created',
      'title_changed',
      'description_changed',
    ]);
  });

  it('does nothing (same version, no event) when the values are unchanged', async () => {
    const { owner, todo } = await setup();
    const card = await addCard(owner, todo.id, { title: 'Same', description: 'd' });
    const res = await call('PATCH', `/api/cards/${card.id}`, owner, {
      title: 'Same',
      description: 'd',
    });
    expect(res.statusCode).toBe(200);
    expect(cardResponseSchema.parse(res.json()).card.version).toBe(1);
    expect(await prisma.activityEvent.count()).toBe(1);
  });

  it('leaves neither the change nor the event when the event write fails', async () => {
    const { owner, todo } = await setup();
    const card = await addCard(owner, todo.id, { title: 'Stable' });
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION fail_title_events() RETURNS trigger AS $$
      BEGIN
        IF NEW.type = 'title_changed' THEN RAISE EXCEPTION 'injected failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER fail_title_events BEFORE INSERT ON "activity_events" FOR EACH ROW EXECUTE FUNCTION fail_title_events()`,
    );
    try {
      const res = await call('PATCH', `/api/cards/${card.id}`, owner, { title: 'Broken' });
      expect(res.statusCode).toBe(500);
      expect(errorOf(res).code).toBe('INTERNAL_ERROR');
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER fail_title_events ON "activity_events"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION fail_title_events()`);
    }
    const row = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(row).toMatchObject({ title: 'Stable', version: 1 });
    expect(await prisma.activityEvent.count({ where: { type: 'title_changed' } })).toBe(0);
  });

  it('answers 400 for an empty body, an empty title, too long input and unknown fields', async () => {
    const { owner, todo } = await setup();
    const card = await addCard(owner, todo.id);
    for (const body of [
      {},
      { title: '' },
      { title: 'x'.repeat(201) },
      { description: 'x'.repeat(20_001) },
      { version: 5 },
      { columnId: randomUUID() },
    ]) {
      const res = await call('PATCH', `/api/cards/${card.id}`, owner, body);
      expect(res.statusCode).toBe(400);
    }
  });

  it('answers 401, 403 (viewer) and 404 (non-member)', async () => {
    const { owner, viewer, outsider, todo } = await setup();
    const card = await addCard(owner, todo.id);
    expect(
      (await call('PATCH', `/api/cards/${card.id}`, undefined, { title: 'x' })).statusCode,
    ).toBe(401);
    const forbidden = await call('PATCH', `/api/cards/${card.id}`, viewer, { title: 'x' });
    expect(forbidden.statusCode).toBe(403);
    expect(errorOf(forbidden).code).toBe('FORBIDDEN');
    const a = await call('PATCH', `/api/cards/${card.id}`, outsider, { title: 'x' });
    const b = await call('PATCH', `/api/cards/${randomUUID()}`, outsider, { title: 'x' });
    expect(a.statusCode).toBe(404);
    expect(a.json()).toEqual(b.json());
  });
});

describe('DELETE /api/cards/:id', () => {
  it('soft deletes (204), then GET and PATCH answer 404 and the board omits the card', async () => {
    const { owner, todo, project } = await setup();
    const card = await addCard(owner, todo.id);
    const keep = await addCard(owner, todo.id, { title: 'Keep' });
    expect((await call('DELETE', `/api/cards/${card.id}`, owner)).statusCode).toBe(204);
    expect((await call('GET', `/api/cards/${card.id}`, owner)).statusCode).toBe(404);
    expect((await call('PATCH', `/api/cards/${card.id}`, owner, { title: 'x' })).statusCode).toBe(
      404,
    );
    expect((await call('DELETE', `/api/cards/${card.id}`, owner)).statusCode).toBe(404);
    const board = await getBoard(owner, project.id);
    expect(board.cards.map((c) => c.id)).toEqual([keep.id]);
    const row = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(row.deletedAt).not.toBeNull();
    expect((await eventsOf(card.id)).map((e) => e.type)).toEqual(['created', 'deleted']);
  });

  it('never reuses the number of a deleted card', async () => {
    const { owner, todo } = await setup();
    const card = await addCard(owner, todo.id);
    await call('DELETE', `/api/cards/${card.id}`, owner);
    expect((await addCard(owner, todo.id)).number).toBe(2);
  });

  it('answers 401, 403 (viewer) and 404 (non-member)', async () => {
    const { owner, viewer, outsider, todo } = await setup();
    const card = await addCard(owner, todo.id);
    expect((await call('DELETE', `/api/cards/${card.id}`)).statusCode).toBe(401);
    expect((await call('DELETE', `/api/cards/${card.id}`, viewer)).statusCode).toBe(403);
    expect((await call('DELETE', `/api/cards/${card.id}`, outsider)).statusCode).toBe(404);
    expect((await call('GET', `/api/cards/${card.id}`, owner)).statusCode).toBe(200);
  });

  it('lets members delete', async () => {
    const { owner, member, todo } = await setup();
    const card = await addCard(owner, todo.id);
    expect((await call('DELETE', `/api/cards/${card.id}`, member)).statusCode).toBe(204);
  });
});

describe('GET /api/projects/:pid/board with cards', () => {
  it('lists live cards per column in (position, id) order, in code-unit order of the key', async () => {
    const { owner, viewer, todo, doing, project } = await setup();
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const board = await prisma.board.findUniqueOrThrow({ where: { projectId: project.id } });
    // "Z0" sorts before "a0" in code-unit order (the "C" collation), unlike in most locales.
    await prisma.card.createMany({
      data: [
        {
          id: ids[0]!,
          boardId: board.id,
          columnId: todo.id,
          number: 1,
          title: 'lower',
          position: 'a0',
          createdById: owner.user.id,
        },
        {
          id: ids[1]!,
          boardId: board.id,
          columnId: todo.id,
          number: 2,
          title: 'upper',
          position: 'Z0',
          createdById: owner.user.id,
        },
        {
          id: ids[2]!,
          boardId: board.id,
          columnId: doing.id,
          number: 3,
          title: 'other',
          position: 'a0',
          createdById: owner.user.id,
        },
      ],
    });
    const result = await getBoard(viewer, project.id);
    const inTodo = result.cards.filter((c) => c.columnId === todo.id).map((c) => c.title);
    expect(inTodo).toEqual(['upper', 'lower']);
    expect(result.cards.filter((c) => c.columnId === doing.id).map((c) => c.title)).toEqual([
      'other',
    ]);
  });
});

describe('DELETE /api/columns/:id with cards', () => {
  it('answers 409 COLUMN_NOT_EMPTY without moveCardsTo and changes nothing', async () => {
    const { owner, todo, project } = await setup();
    await addCard(owner, todo.id);
    const res = await call('DELETE', `/api/columns/${todo.id}`, owner);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('COLUMN_NOT_EMPTY');
    expect((await getBoard(owner, project.id)).columns).toHaveLength(3);
    expect((await getBoard(owner, project.id)).cards).toHaveLength(1);
  });

  it('moves the cards to the end of the destination in order (204) and records events', async () => {
    const { owner, member, todo, doing, project } = await setup();
    const existing = await addCard(owner, doing.id, { title: 'Already there' });
    const a = await addCard(owner, todo.id, { title: 'A' });
    const b = await addCard(owner, todo.id, { title: 'B' });
    const res = await call('DELETE', `/api/columns/${todo.id}?moveCardsTo=${doing.id}`, member);
    expect(res.statusCode).toBe(204);
    const board = await getBoard(owner, project.id);
    expect(board.columns.map((c) => c.name)).toEqual(['In progress', 'Done']);
    expect(board.cards.map((c) => [c.title, c.columnId])).toEqual([
      ['Already there', doing.id],
      ['A', doing.id],
      ['B', doing.id],
    ]);
    expect(board.cards.find((c) => c.id === a.id)?.version).toBe(2);
    expect(board.cards.find((c) => c.id === existing.id)?.version).toBe(1);
    expect(await eventsOf(b.id)).toEqual([
      expect.objectContaining({ type: 'created' }),
      {
        type: 'column_deleted_moved',
        data: {
          from: { columnId: todo.id, columnName: 'To do' },
          to: { columnId: doing.id, columnName: 'In progress' },
        },
      },
    ]);
  });

  it('ignores soft-deleted cards when deciding whether the column is empty', async () => {
    const { owner, todo, project } = await setup();
    const card = await addCard(owner, todo.id);
    await call('DELETE', `/api/cards/${card.id}`, owner);
    expect((await call('DELETE', `/api/columns/${todo.id}`, owner)).statusCode).toBe(204);
    expect((await getBoard(owner, project.id)).columns).toHaveLength(2);
  });

  it('accepts moveCardsTo for an empty column and still validates it', async () => {
    const { owner, outsider, todo, doing } = await setup();
    const ws2 = workspaceResponseSchema.parse(
      (await call('POST', '/api/workspaces', outsider, { name: 'Other' })).json(),
    ).workspace;
    const p2 = await newProject(outsider, ws2.id, 'OT');
    const foreign = (await getBoard(outsider, p2.id)).columns[0]!;
    const bad = await call('DELETE', `/api/columns/${todo.id}?moveCardsTo=${foreign.id}`, owner);
    expect(bad.statusCode).toBe(404);
    expect(
      (await call('DELETE', `/api/columns/${todo.id}?moveCardsTo=${doing.id}`, owner)).statusCode,
    ).toBe(204);
  });

  it('rejects a destination from another board (404), the column itself (400) and bad input', async () => {
    const { owner, ws, todo } = await setup();
    await addCard(owner, todo.id);
    const other = await newProject(owner, ws.id, 'ZZ');
    const otherColumn = (await getBoard(owner, other.id)).columns[0]!;
    const cross = await call(
      'DELETE',
      `/api/columns/${todo.id}?moveCardsTo=${otherColumn.id}`,
      owner,
    );
    expect(cross.statusCode).toBe(404);
    const self = await call('DELETE', `/api/columns/${todo.id}?moveCardsTo=${todo.id}`, owner);
    expect(self.statusCode).toBe(400);
    expect(
      (await call('DELETE', `/api/columns/${todo.id}?moveCardsTo=nope`, owner)).statusCode,
    ).toBe(400);
    expect((await call('DELETE', `/api/columns/${todo.id}?other=1`, owner)).statusCode).toBe(400);
    expect(await prisma.card.count({ where: { columnId: todo.id } })).toBe(1);
  });

  it('keeps the Done rule first and the viewer rule', async () => {
    const { owner, viewer, done, todo } = await setup();
    await addCard(owner, done.id);
    const res = await call('DELETE', `/api/columns/${done.id}?moveCardsTo=${todo.id}`, owner);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('DONE_COLUMN_REQUIRED');
    expect(
      (await call('DELETE', `/api/columns/${todo.id}?moveCardsTo=${done.id}`, viewer)).statusCode,
    ).toBe(403);
  });
});

describe('database constraints', () => {
  it('refuses titles and descriptions outside the limits and cards without a project board', async () => {
    const { owner, todo, project } = await setup();
    const board = await prisma.board.findUniqueOrThrow({ where: { projectId: project.id } });
    const base = {
      boardId: board.id,
      columnId: todo.id,
      position: 'a0',
      createdById: owner.user.id,
    };
    await expect(prisma.card.create({ data: { ...base, number: 1, title: '' } })).rejects.toThrow();
    await expect(
      prisma.card.create({ data: { ...base, number: 1, title: 'x'.repeat(201) } }),
    ).rejects.toThrow();
    await expect(
      prisma.card.create({
        data: { ...base, number: 1, title: 'ok', description: 'x'.repeat(20_001) },
      }),
    ).rejects.toThrow();
    await prisma.card.create({ data: { ...base, number: 1, title: 'ok' } });
    await expect(
      prisma.card.create({ data: { ...base, number: 1, title: 'dup' } }),
    ).rejects.toThrow();
  });
});
