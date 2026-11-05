import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  boardResponseSchema,
  columnResponseSchema,
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
  return { owner, member, viewer, outsider, ws, project, board };
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

const errorOf = (res: { json: () => unknown }) => apiErrorSchema.parse(res.json()).error;
const names = (b: { columns: { name: string }[] }) => b.columns.map((c) => c.name);

describe('default board', () => {
  it('creates the board with To do, In progress and Done (flagged) with the project', async () => {
    const { board } = await setup();
    expect(names(board)).toEqual(['To do', 'In progress', 'Done']);
    expect(board.columns.map((c) => c.isDone)).toEqual([false, false, true]);
  });

  it('removes the board and columns with the project (cascade)', async () => {
    const { owner, project } = await setup();
    expect((await call('DELETE', `/api/projects/${project.id}`, owner)).statusCode).toBe(204);
    expect(await prisma.board.count()).toBe(0);
    expect(await prisma.column.count()).toBe(0);
  });
});

describe('GET /api/projects/:pid/board', () => {
  it('returns the board to every role (200)', async () => {
    const { member, viewer, project, board } = await setup();
    for (const who of [member, viewer]) {
      expect(await getBoard(who, project.id)).toEqual(board);
    }
    expect(board.board.projectId).toBe(project.id);
  });

  it('answers 401 without a session', async () => {
    const { project } = await setup();
    const res = await call('GET', `/api/projects/${project.id}/board`);
    expect(res.statusCode).toBe(401);
    expect(errorOf(res).code).toBe('UNAUTHENTICATED');
  });

  it('answers 404 for a non-member exactly like an unknown project', async () => {
    const { outsider, project } = await setup();
    const a = await call('GET', `/api/projects/${project.id}/board`, outsider);
    const b = await call('GET', `/api/projects/${randomUUID()}/board`, outsider);
    expect(a.statusCode).toBe(404);
    expect(a.json()).toEqual(b.json());
  });

  it('answers 400 for a malformed id', async () => {
    const { owner } = await setup();
    expect((await call('GET', '/api/projects/nope/board', owner)).statusCode).toBe(400);
  });

  it('returns keys that differ only in letter case in code-unit order (binary collation)', async () => {
    const { owner, board } = await setup();
    const boardId = board.board.id;
    await prisma.column.deleteMany({ where: { boardId } });
    // In a case-insensitive collation 'a0' < 'Z0'; by code unit 'Z0' < 'a0'.
    await prisma.column.createMany({
      data: [
        { boardId, name: 'lower', position: 'a0', isDone: true },
        { boardId, name: 'upper', position: 'Z0' },
      ],
    });
    const result = await getBoard(owner, board.board.projectId);
    expect(names(result)).toEqual(['upper', 'lower']);
  });
});

describe('POST /api/boards/:bid/columns', () => {
  it('appends a column as owner and as member (201)', async () => {
    const { owner, member, board, project } = await setup();
    for (const [who, name] of [
      [owner, 'Review'],
      [member, 'QA'],
    ] as const) {
      const res = await call('POST', `/api/boards/${board.board.id}/columns`, who, { name });
      expect(res.statusCode).toBe(201);
      expect(columnResponseSchema.parse(res.json()).column).toMatchObject({
        name,
        isDone: false,
        boardId: board.board.id,
      });
    }
    expect(names(await getBoard(owner, project.id))).toEqual([
      'To do',
      'In progress',
      'Done',
      'Review',
      'QA',
    ]);
  });

  it('inserts between neighbours', async () => {
    const { owner, board, project } = await setup();
    const [todo, progress] = board.columns;
    const res = await call('POST', `/api/boards/${board.board.id}/columns`, owner, {
      name: 'Between',
      afterColumnId: todo?.id,
      beforeColumnId: progress?.id,
    });
    expect(res.statusCode).toBe(201);
    expect(names(await getBoard(owner, project.id))).toEqual([
      'To do',
      'Between',
      'In progress',
      'Done',
    ]);
  });

  it('is idempotent for a client-generated id (200, no duplicate)', async () => {
    const { owner, board } = await setup();
    const id = randomUUID();
    const url = `/api/boards/${board.board.id}/columns`;
    const first = await call('POST', url, owner, { id, name: 'Review' });
    const again = await call('POST', url, owner, { id, name: 'Review' });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(columnResponseSchema.parse(again.json()).column.id).toBe(id);
    expect(await prisma.column.count({ where: { boardId: board.board.id } })).toBe(4);
  });

  it('rejects an id already used on another board (409)', async () => {
    const { owner, ws, board } = await setup();
    const other = await newProject(owner, ws.id, 'OT');
    const otherBoard = await getBoard(owner, other.id);
    const id = otherBoard.columns[0]?.id;
    const res = await call('POST', `/api/boards/${board.board.id}/columns`, owner, {
      id,
      name: 'Steal',
    });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('CONFLICT');
  });

  it('never links a neighbour from another board (404)', async () => {
    const { owner, ws, board } = await setup();
    const other = await newProject(owner, ws.id, 'OT');
    const foreign = (await getBoard(owner, other.id)).columns[0];
    const res = await call('POST', `/api/boards/${board.board.id}/columns`, owner, {
      name: 'X',
      afterColumnId: foreign?.id,
    });
    expect(res.statusCode).toBe(404);
  });

  it.each([
    ['empty name', { name: '' }],
    ['blank name', { name: '   ' }],
    ['name too long', { name: 'x'.repeat(51) }],
    ['missing name', {}],
    ['bad id', { name: 'A', id: 'nope' }],
    ['unknown field', { name: 'A', isDone: true }],
  ])('rejects %s (400)', async (_label, body) => {
    const { owner, board } = await setup();
    const res = await call('POST', `/api/boards/${board.board.id}/columns`, owner, body);
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    expect(await prisma.column.count()).toBe(3);
  });

  it('answers 401, 403 for a viewer and 404 for a non-member', async () => {
    const { viewer, outsider, board } = await setup();
    const url = `/api/boards/${board.board.id}/columns`;
    const body = { name: 'Nope' };
    expect((await call('POST', url, undefined, body)).statusCode).toBe(401);
    const forbidden = await call('POST', url, viewer, body);
    expect(forbidden.statusCode).toBe(403);
    expect(errorOf(forbidden).code).toBe('FORBIDDEN');
    const a = await call('POST', url, outsider, body);
    const b = await call('POST', `/api/boards/${randomUUID()}/columns`, outsider, body);
    expect(a.statusCode).toBe(404);
    expect(a.json()).toEqual(b.json());
    expect(await prisma.column.count()).toBe(3);
  });

  it('rejects a request without the allowed Origin (403 CSRF_REJECTED)', async () => {
    const { owner, board } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/api/boards/${board.board.id}/columns`,
      headers: { ...owner.headers, origin: 'https://evil.example' },
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('CSRF_REJECTED');
  });
});

describe('PATCH /api/columns/:id', () => {
  it('renames a column (200)', async () => {
    const { owner, member, board } = await setup();
    const id = board.columns[0]?.id;
    const res = await call('PATCH', `/api/columns/${id}`, member, { name: ' Backlog ' });
    expect(res.statusCode).toBe(200);
    expect(columnResponseSchema.parse(res.json()).column.name).toBe('Backlog');
    const again = await call('PATCH', `/api/columns/${id}`, owner, { name: 'Ideas' });
    expect(again.statusCode).toBe(200);
  });

  it('moves a column using its neighbours', async () => {
    const { owner, board, project } = await setup();
    const [todo, progress, done] = board.columns;
    // Move "Done" between "To do" and "In progress".
    let res = await call('PATCH', `/api/columns/${done?.id}`, owner, {
      afterColumnId: todo?.id,
      beforeColumnId: progress?.id,
    });
    expect(res.statusCode).toBe(200);
    expect(names(await getBoard(owner, project.id))).toEqual(['To do', 'Done', 'In progress']);
    // Move "In progress" to the very start.
    res = await call('PATCH', `/api/columns/${progress?.id}`, owner, {
      afterColumnId: null,
      beforeColumnId: todo?.id,
    });
    expect(res.statusCode).toBe(200);
    expect(names(await getBoard(owner, project.id))).toEqual(['In progress', 'To do', 'Done']);
    // Move "In progress" to the very end.
    res = await call('PATCH', `/api/columns/${progress?.id}`, owner, {
      afterColumnId: done?.id,
      beforeColumnId: null,
    });
    expect(res.statusCode).toBe(200);
    expect(names(await getBoard(owner, project.id))).toEqual(['To do', 'Done', 'In progress']);
  });

  it('survives many insertions at the same spot (rebalancing keeps keys short)', async () => {
    const { owner, board, project } = await setup();
    const todo = board.columns[0];
    // Always insert right after "To do": the adversarial pattern of ADR 0001.
    for (let i = 0; i < 320; i += 1) {
      const res = await call('POST', `/api/boards/${board.board.id}/columns`, owner, {
        name: `c${i}`,
        afterColumnId: todo?.id,
      });
      expect(res.statusCode).toBe(201);
    }
    const result = await getBoard(owner, project.id);
    expect(result.columns).toHaveLength(323);
    expect(names(result).slice(0, 2)).toEqual(['To do', 'c319']);
    expect(Math.max(...result.columns.map((c) => c.position.length))).toBeLessThanOrEqual(50);
  }, 60_000);

  it('moves the Done flag in one step (exactly one Done column)', async () => {
    const { owner, board, project } = await setup();
    const [, progress, done] = board.columns;
    const res = await call('PATCH', `/api/columns/${progress?.id}`, owner, { isDone: true });
    expect(res.statusCode).toBe(200);
    expect(columnResponseSchema.parse(res.json()).column.isDone).toBe(true);
    const after = await getBoard(owner, project.id);
    expect(after.columns.filter((c) => c.isDone).map((c) => c.id)).toEqual([progress?.id]);
    expect(after.columns.find((c) => c.id === done?.id)?.isDone).toBe(false);
  });

  it('answers 409 DONE_COLUMN_REQUIRED when removing the flag without another', async () => {
    const { owner, board } = await setup();
    const done = board.columns[2];
    const res = await call('PATCH', `/api/columns/${done?.id}`, owner, { isDone: false });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('DONE_COLUMN_REQUIRED');
    expect((await prisma.column.findUniqueOrThrow({ where: { id: done?.id } })).isDone).toBe(true);
  });

  it('keeps one Done column when two requests race', async () => {
    const { owner, board } = await setup();
    const [todo, progress] = board.columns;
    const results = await Promise.all(
      [todo, progress].map((c) => call('PATCH', `/api/columns/${c?.id}`, owner, { isDone: true })),
    );
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(await prisma.column.count({ where: { boardId: board.board.id, isDone: true } })).toBe(1);
  });

  it('never links a neighbour from another board (404)', async () => {
    const { owner, ws, board } = await setup();
    const other = await newProject(owner, ws.id, 'OT');
    const foreign = (await getBoard(owner, other.id)).columns[0];
    const res = await call('PATCH', `/api/columns/${board.columns[0]?.id}`, owner, {
      afterColumnId: foreign?.id,
    });
    expect(res.statusCode).toBe(404);
  });

  it.each([
    ['empty body', {}],
    ['empty name', { name: '' }],
    ['name too long', { name: 'x'.repeat(51) }],
    ['unknown field', { name: 'A', position: 'zz' }],
    ['non-boolean isDone', { isDone: 'yes' }],
  ])('rejects %s (400)', async (_label, body) => {
    const { owner, board } = await setup();
    const res = await call('PATCH', `/api/columns/${board.columns[0]?.id}`, owner, body);
    expect(res.statusCode).toBe(400);
  });

  it('answers 401, 403 for a viewer and 404 for a non-member or an unknown id', async () => {
    const { viewer, outsider, board } = await setup();
    const url = `/api/columns/${board.columns[0]?.id}`;
    expect((await call('PATCH', url, undefined, { name: 'X' })).statusCode).toBe(401);
    expect((await call('PATCH', url, viewer, { name: 'X' })).statusCode).toBe(403);
    const a = await call('PATCH', url, outsider, { name: 'X' });
    const b = await call('PATCH', `/api/columns/${randomUUID()}`, outsider, { name: 'X' });
    expect(a.statusCode).toBe(404);
    expect(a.json()).toEqual(b.json());
    expect((await prisma.column.findFirstOrThrow({ where: { position: 'a0' } })).name).toBe(
      'To do',
    );
  });
});

describe('DELETE /api/columns/:id', () => {
  it('deletes a column (204) and repeating it is 404', async () => {
    const { owner, member, board, project } = await setup();
    const id = board.columns[0]?.id;
    expect((await call('DELETE', `/api/columns/${id}`, member)).statusCode).toBe(204);
    expect(names(await getBoard(owner, project.id))).toEqual(['In progress', 'Done']);
    expect((await call('DELETE', `/api/columns/${id}`, owner)).statusCode).toBe(404);
  });

  it('refuses to delete the Done column (409 DONE_COLUMN_REQUIRED)', async () => {
    const { owner, board } = await setup();
    const res = await call('DELETE', `/api/columns/${board.columns[2]?.id}`, owner);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('DONE_COLUMN_REQUIRED');
    expect(await prisma.column.count()).toBe(3);
  });

  it('answers 401, 403 for a viewer and 404 for a non-member', async () => {
    const { viewer, outsider, board } = await setup();
    const url = `/api/columns/${board.columns[0]?.id}`;
    expect((await call('DELETE', url)).statusCode).toBe(401);
    expect((await call('DELETE', url, viewer)).statusCode).toBe(403);
    expect((await call('DELETE', url, outsider)).statusCode).toBe(404);
    expect((await call('DELETE', `/api/columns/${randomUUID()}`, outsider)).statusCode).toBe(404);
    expect(await prisma.column.count()).toBe(3);
  });

  it('answers 400 for a malformed id', async () => {
    const { owner } = await setup();
    expect((await call('DELETE', '/api/columns/nope', owner)).statusCode).toBe(400);
  });
});

describe('database invariants', () => {
  it('rejects two Done columns on one board and names longer than 50 characters', async () => {
    const { board } = await setup();
    const boardId = board.board.id;
    await expect(
      prisma.column.create({
        data: { boardId, name: 'Second done', position: 'b0', isDone: true },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.column.create({ data: { boardId, name: 'x'.repeat(51), position: 'b1' } }),
    ).rejects.toThrow();
  });
});
