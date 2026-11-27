import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type BoardEvent,
  activityEventDataSchema,
  apiErrorSchema,
  boardResponseSchema,
  cardResponseSchema,
  labelListResponseSchema,
  labelResponseSchema,
  projectResponseSchema,
  workspaceResponseSchema,
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

async function makeProject(owner: TestUser, wsId: string, key: string) {
  const project = projectResponseSchema.parse(
    (await call('POST', `/api/workspaces/${wsId}/projects`, owner, { name: key, key })).json(),
  ).project;
  const board = boardResponseSchema.parse(
    (await call('GET', `/api/projects/${project.id}/board`, owner)).json(),
  );
  const column = board.columns[0];
  if (!column) throw new Error('no column');
  const card = cardResponseSchema.parse(
    (await call('POST', `/api/columns/${column.id}/cards`, owner, { title: 'A card' })).json(),
  ).card;
  return { project, board, card };
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
  const first = await makeProject(owner, ws.id, 'KB');
  const second = await makeProject(owner, ws.id, 'OT');
  return { owner, member, viewer, outsider, ws, ...first, other: second };
}

async function newLabel(who: TestUser, projectId: string, name: string, color = 'red') {
  const res = await call('POST', `/api/projects/${projectId}/labels`, who, { name, color });
  expect(res.statusCode).toBe(201);
  return labelResponseSchema.parse(res.json()).label;
}

async function activityOf(cardId: string) {
  const rows = await prisma.activityEvent.findMany({
    where: { cardId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((row) => activityEventDataSchema.parse({ type: row.type, data: row.data }));
}

describe('POST /api/projects/:pid/labels', () => {
  it('creates a label (201) as owner and as member', async () => {
    const { owner, member, project } = await setup();
    const a = await newLabel(owner, project.id, 'Bug', 'red');
    expect(a).toMatchObject({ projectId: project.id, name: 'Bug', color: 'red' });
    const b = await newLabel(member, project.id, 'Feature', 'blue');
    expect(b.name).toBe('Feature');
  });

  it('answers 400 for an invalid colour, name or unknown field', async () => {
    const { owner, project } = await setup();
    const url = `/api/projects/${project.id}/labels`;
    for (const body of [
      { name: 'Bug', color: 'pink' },
      { name: 'Bug', color: '#ff0000' },
      { name: '', color: 'red' },
      { name: 'x'.repeat(31), color: 'red' },
      { name: 'Bug', color: 'red', extra: 1 },
    ]) {
      const res = await call('POST', url, owner, body);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    }
  });

  it('answers 409 LABEL_NAME_TAKEN for a duplicate, ignoring case', async () => {
    const { owner, project, other } = await setup();
    await newLabel(owner, project.id, 'Bug');
    const res = await call('POST', `/api/projects/${project.id}/labels`, owner, {
      name: 'bUG',
      color: 'blue',
    });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe('LABEL_NAME_TAKEN');
    // The same name in another project is fine.
    await newLabel(owner, other.project.id, 'Bug');
  });

  it('is idempotent with a client id (200, no duplicate)', async () => {
    const { owner, project, other } = await setup();
    const id = randomUUID();
    const body = { id, name: 'Bug', color: 'red' };
    const first = await call('POST', `/api/projects/${project.id}/labels`, owner, body);
    const second = await call('POST', `/api/projects/${project.id}/labels`, owner, body);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(await prisma.label.count({ where: { projectId: project.id } })).toBe(1);
    // An id used by another project is a conflict, never linked.
    const clash = await call('POST', `/api/projects/${other.project.id}/labels`, owner, body);
    expect(clash.statusCode).toBe(409);
    expect(errorOf(clash).code).toBe('CONFLICT');
  });

  it('answers 403 to a viewer, 404 to a non-member, 401 without a session', async () => {
    const { viewer, outsider, project } = await setup();
    const url = `/api/projects/${project.id}/labels`;
    const body = { name: 'Bug', color: 'red' };
    expect((await call('POST', url, viewer, body)).statusCode).toBe(403);
    const hidden = await call('POST', url, outsider, body);
    const missing = await call('POST', `/api/projects/${randomUUID()}/labels`, outsider, body);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual(missing.json());
    expect((await call('POST', url, undefined, body)).statusCode).toBe(401);
  });

  it('answers 403 CSRF_REJECTED for a foreign Origin', async () => {
    const { owner, project } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/labels`,
      headers: { ...owner.headers, origin: 'http://evil.example' },
      payload: { name: 'Bug', color: 'red' },
    });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('CSRF_REJECTED');
  });
});

describe('GET /api/projects/:pid/labels and the board', () => {
  it('lists labels (any member, viewer included) ordered by name; 404 for a non-member', async () => {
    const { owner, viewer, outsider, project } = await setup();
    await newLabel(owner, project.id, 'Zeta');
    await newLabel(owner, project.id, 'Alpha');
    const res = await call('GET', `/api/projects/${project.id}/labels`, viewer);
    expect(res.statusCode).toBe(200);
    expect(labelListResponseSchema.parse(res.json()).labels.map((l) => l.name)).toEqual([
      'Alpha',
      'Zeta',
    ]);
    expect((await call('GET', `/api/projects/${project.id}/labels`, outsider)).statusCode).toBe(
      404,
    );
  });

  it('puts the labels and each card labelIds in the board response', async () => {
    const { owner, project, card } = await setup();
    const bug = await newLabel(owner, project.id, 'Bug');
    await call('PUT', `/api/cards/${card.id}/labels`, owner, { labelIds: [bug.id] });
    const board = boardResponseSchema.parse(
      (await call('GET', `/api/projects/${project.id}/board`, owner)).json(),
    );
    expect(board.labels).toEqual([bug]);
    expect(board.cards[0]?.labelIds).toEqual([bug.id]);
  });
});

describe('PATCH and DELETE /api/labels/:id', () => {
  it('renames and recolours (200); a taken name is 409; the own name in another case is fine', async () => {
    const { owner, member, project } = await setup();
    const bug = await newLabel(owner, project.id, 'Bug');
    await newLabel(owner, project.id, 'Feature');
    const ok = await call('PATCH', `/api/labels/${bug.id}`, member, { name: 'BUG', color: 'teal' });
    expect(ok.statusCode).toBe(200);
    expect(labelResponseSchema.parse(ok.json()).label).toMatchObject({
      name: 'BUG',
      color: 'teal',
    });
    const taken = await call('PATCH', `/api/labels/${bug.id}`, owner, { name: 'feature' });
    expect(taken.statusCode).toBe(409);
    expect(errorOf(taken).code).toBe('LABEL_NAME_TAKEN');
    expect(
      (await call('PATCH', `/api/labels/${bug.id}`, owner, { color: 'pink' })).statusCode,
    ).toBe(400);
  });

  it('enforces roles: 403 viewer, 404 non-member (same body as a missing label)', async () => {
    const { owner, viewer, outsider, project } = await setup();
    const bug = await newLabel(owner, project.id, 'Bug');
    expect((await call('PATCH', `/api/labels/${bug.id}`, viewer, { name: 'x' })).statusCode).toBe(
      403,
    );
    expect((await call('DELETE', `/api/labels/${bug.id}`, viewer)).statusCode).toBe(403);
    const hidden = await call('DELETE', `/api/labels/${bug.id}`, outsider);
    const missing = await call('DELETE', `/api/labels/${randomUUID()}`, outsider);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual(missing.json());
    expect((await call('DELETE', `/api/labels/${bug.id}`)).statusCode).toBe(401);
  });

  it('deletes (204), removes it from cards and records the change on each card', async () => {
    const { owner, project, card } = await setup();
    const bug = await newLabel(owner, project.id, 'Bug');
    const keep = await newLabel(owner, project.id, 'Keep', 'green');
    await call('PUT', `/api/cards/${card.id}/labels`, owner, { labelIds: [bug.id, keep.id] });
    const events: BoardEvent[] = [];
    const off = onBoardEvent((e) => events.push(e));
    const res = await call('DELETE', `/api/labels/${bug.id}`, owner);
    off();
    expect(res.statusCode).toBe(204);
    const after = cardResponseSchema.parse(
      (await call('GET', `/api/cards/${card.id}`, owner)).json(),
    ).card;
    expect(after.labelIds).toEqual([keep.id]);
    expect((await activityOf(card.id)).at(-1)).toEqual({
      type: 'labels_changed',
      data: { added: [], removed: [{ id: bug.id, name: 'Bug' }] },
    });
    expect(events.map((e) => e.type)).toEqual(['card_updated', 'label_deleted']);
    expect(await call('DELETE', `/api/labels/${bug.id}`, owner).then((r) => r.statusCode)).toBe(
      404,
    );
  });
});

describe('PUT /api/cards/:id/labels', () => {
  it('sets the labels (200), bumps the version, writes labels_changed and publishes card_updated', async () => {
    const { owner, member, project, card } = await setup();
    const bug = await newLabel(owner, project.id, 'Bug');
    const events: BoardEvent[] = [];
    const off = onBoardEvent((e) => events.push(e));
    const res = await call('PUT', `/api/cards/${card.id}/labels`, member, { labelIds: [bug.id] });
    off();
    expect(res.statusCode).toBe(200);
    const updated = cardResponseSchema.parse(res.json()).card;
    expect(updated).toMatchObject({ labelIds: [bug.id], version: card.version + 1 });
    expect((await activityOf(card.id)).at(-1)).toEqual({
      type: 'labels_changed',
      data: { added: [{ id: bug.id, name: 'Bug' }], removed: [] },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'card_updated', version: card.version + 1 });
  });

  it('is idempotent: the same labels twice change nothing', async () => {
    const { owner, project, card } = await setup();
    const a = await newLabel(owner, project.id, 'A');
    const b = await newLabel(owner, project.id, 'B', 'blue');
    const first = await call('PUT', `/api/cards/${card.id}/labels`, owner, {
      labelIds: [a.id, b.id],
    });
    const version = cardResponseSchema.parse(first.json()).card.version;
    const events: BoardEvent[] = [];
    const off = onBoardEvent((e) => events.push(e));
    const again = await call('PUT', `/api/cards/${card.id}/labels`, owner, {
      labelIds: [b.id, a.id],
    });
    off();
    expect(again.statusCode).toBe(200);
    expect(cardResponseSchema.parse(again.json()).card.version).toBe(version);
    expect(events).toEqual([]);
    expect((await activityOf(card.id)).filter((e) => e.type === 'labels_changed')).toHaveLength(1);
    expect(await prisma.cardLabel.count({ where: { cardId: card.id } })).toBe(2);
  });

  it('removes labels, and an empty list clears them', async () => {
    const { owner, project, card } = await setup();
    const a = await newLabel(owner, project.id, 'A');
    const b = await newLabel(owner, project.id, 'B', 'blue');
    await call('PUT', `/api/cards/${card.id}/labels`, owner, { labelIds: [a.id, b.id] });
    const res = await call('PUT', `/api/cards/${card.id}/labels`, owner, { labelIds: [] });
    expect(cardResponseSchema.parse(res.json()).card.labelIds).toEqual([]);
    expect((await activityOf(card.id)).at(-1)).toEqual({
      type: 'labels_changed',
      data: {
        added: [],
        removed: expect.arrayContaining([
          { id: a.id, name: 'A' },
          { id: b.id, name: 'B' },
        ]),
      },
    });
  });

  it('rejects a label of another project or a missing one with 400 and links nothing', async () => {
    const { owner, project, card, other } = await setup();
    const mine = await newLabel(owner, project.id, 'Mine');
    const foreign = await newLabel(owner, other.project.id, 'Foreign');
    for (const labelIds of [[foreign.id], [mine.id, foreign.id], [randomUUID()]]) {
      const res = await call('PUT', `/api/cards/${card.id}/labels`, owner, { labelIds });
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe('INVALID_LABEL');
    }
    expect(await prisma.cardLabel.count({ where: { cardId: card.id } })).toBe(0);
  });

  it('allows at most 10 labels and no duplicates (400)', async () => {
    const { owner, project, card } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) ids.push((await newLabel(owner, project.id, `L${i}`)).id);
    const eleven = await call('PUT', `/api/cards/${card.id}/labels`, owner, { labelIds: ids });
    expect(eleven.statusCode).toBe(400);
    const ten = await call('PUT', `/api/cards/${card.id}/labels`, owner, {
      labelIds: ids.slice(0, 10),
    });
    expect(ten.statusCode).toBe(200);
    const dup = await call('PUT', `/api/cards/${card.id}/labels`, owner, {
      labelIds: [ids[0], ids[0]],
    });
    expect(dup.statusCode).toBe(400);
  });

  it('enforces roles: 403 viewer, 404 non-member and for a missing card, 401 without a session', async () => {
    const { owner, viewer, outsider, project, card } = await setup();
    const bug = await newLabel(owner, project.id, 'Bug');
    const body = { labelIds: [bug.id] };
    expect((await call('PUT', `/api/cards/${card.id}/labels`, viewer, body)).statusCode).toBe(403);
    const hidden = await call('PUT', `/api/cards/${card.id}/labels`, outsider, body);
    const missing = await call('PUT', `/api/cards/${randomUUID()}/labels`, outsider, body);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual(missing.json());
    expect((await call('PUT', `/api/cards/${card.id}/labels`, undefined, body)).statusCode).toBe(
      401,
    );
  });
});

describe('label board events', () => {
  it('publishes label_created, label_updated and label_deleted with the client mutation id', async () => {
    const { owner, project } = await setup();
    const events: BoardEvent[] = [];
    const off = onBoardEvent((e) => events.push(e));
    const mutationId = randomUUID();
    const created = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/labels`,
      headers: { ...owner.headers, 'x-client-mutation-id': mutationId },
      payload: { name: 'Bug', color: 'red' },
    });
    const label = labelResponseSchema.parse(created.json()).label;
    await call('PATCH', `/api/labels/${label.id}`, owner, { color: 'blue' });
    await call('DELETE', `/api/labels/${label.id}`, owner);
    off();
    expect(events.map((e) => e.type)).toEqual(['label_created', 'label_updated', 'label_deleted']);
    expect(events[0]).toMatchObject({ clientMutationId: mutationId, version: null });
  });

  it('publishes nothing when the request fails (no event on rollback)', async () => {
    const { owner, project } = await setup();
    await newLabel(owner, project.id, 'Bug');
    const events: BoardEvent[] = [];
    const off = onBoardEvent((e) => events.push(e));
    await call('POST', `/api/projects/${project.id}/labels`, owner, { name: 'bug', color: 'red' });
    off();
    expect(events).toEqual([]);
  });
});
