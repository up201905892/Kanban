import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type BoardEvent,
  activityEventDataSchema,
  apiErrorSchema,
  boardResponseSchema,
  cardResponseSchema,
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

const errorOf = (res: { json: () => unknown }) => apiErrorSchema.parse(res.json()).error;

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
  if (!todo) throw new Error('no column');
  const card = cardResponseSchema.parse(
    (await call('POST', `/api/columns/${todo.id}/cards`, owner, { title: 'A card' })).json(),
  ).card;
  return { owner, member, viewer, outsider, ws, project, card };
}

async function eventsOf(cardId: string) {
  const rows = await prisma.activityEvent.findMany({
    where: { cardId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((row) => activityEventDataSchema.parse({ type: row.type, data: row.data }));
}

describe('PATCH /api/cards/:id assignee, priority and estimate', () => {
  it('starts unassigned, no priority and not estimated', async () => {
    const { card } = await setup();
    expect(card).toMatchObject({ assigneeId: null, priority: 'none', estimate: null });
  });

  it('updates the three fields (200), bumps the version and writes one event each', async () => {
    const { owner, member, card, project } = await setup();
    const res = await call('PATCH', `/api/cards/${card.id}`, owner, {
      assigneeId: member.user.id,
      priority: 'urgent',
      estimate: 8,
    });
    expect(res.statusCode).toBe(200);
    const updated = cardResponseSchema.parse(res.json()).card;
    expect(updated).toMatchObject({
      assigneeId: member.user.id,
      priority: 'urgent',
      estimate: 8,
      version: 2,
    });
    expect(await eventsOf(card.id)).toEqual([
      expect.objectContaining({ type: 'created' }),
      { type: 'assignee_changed', data: { from: null, to: member.user.id } },
      { type: 'priority_changed', data: { from: 'none', to: 'urgent' } },
      { type: 'estimate_changed', data: { from: null, to: 8 } },
    ]);
    const board = boardResponseSchema.parse(
      (await call('GET', `/api/projects/${project.id}/board`, owner)).json(),
    );
    expect(board.cards[0]).toMatchObject({
      assigneeId: member.user.id,
      priority: 'urgent',
      estimate: 8,
    });
  });

  it('lets an owner be the assignee, and records from/to on a later change and on clearing', async () => {
    const { owner, member, card } = await setup();
    await call('PATCH', `/api/cards/${card.id}`, owner, { assigneeId: member.user.id });
    const res = await call('PATCH', `/api/cards/${card.id}`, member, {
      assigneeId: owner.user.id,
      estimate: 3,
    });
    expect(res.statusCode).toBe(200);
    const cleared = await call('PATCH', `/api/cards/${card.id}`, member, {
      assigneeId: null,
      estimate: null,
    });
    expect(cardResponseSchema.parse(cleared.json()).card).toMatchObject({
      assigneeId: null,
      estimate: null,
    });
    const events = await eventsOf(card.id);
    expect(events.slice(2)).toEqual([
      { type: 'assignee_changed', data: { from: member.user.id, to: owner.user.id } },
      { type: 'estimate_changed', data: { from: null, to: 3 } },
      { type: 'assignee_changed', data: { from: owner.user.id, to: null } },
      { type: 'estimate_changed', data: { from: 3, to: null } },
    ]);
  });

  it('accepts the estimate boundaries 0 and 100', async () => {
    const { owner, card } = await setup();
    for (const estimate of [0, 100]) {
      const res = await call('PATCH', `/api/cards/${card.id}`, owner, { estimate });
      expect(cardResponseSchema.parse(res.json()).card.estimate).toBe(estimate);
    }
  });

  it('writes no version and no event when nothing changes', async () => {
    const { owner, card } = await setup();
    await call('PATCH', `/api/cards/${card.id}`, owner, { priority: 'low', estimate: 2 });
    const again = await call('PATCH', `/api/cards/${card.id}`, owner, {
      priority: 'low',
      estimate: 2,
      assigneeId: null,
    });
    expect(cardResponseSchema.parse(again.json()).card.version).toBe(2);
    expect(await eventsOf(card.id)).toHaveLength(3);
  });

  it('rejects a viewer, an outsider and an unknown user as assignee (400 INVALID_ASSIGNEE)', async () => {
    const { owner, viewer, outsider, card } = await setup();
    for (const assigneeId of [
      viewer.user.id,
      outsider.user.id,
      '0192f000-0000-7000-8000-000000000001',
    ]) {
      const res = await call('PATCH', `/api/cards/${card.id}`, owner, { assigneeId });
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe('INVALID_ASSIGNEE');
    }
    const row = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(row.assigneeId).toBeNull();
    expect(await eventsOf(card.id)).toHaveLength(1);
  });

  it('rejects estimates -1, 101 and 1.5, and an unknown priority (400 VALIDATION_ERROR)', async () => {
    const { owner, card } = await setup();
    for (const body of [
      { estimate: -1 },
      { estimate: 101 },
      { estimate: 1.5 },
      { priority: 'x' },
    ]) {
      const res = await call('PATCH', `/api/cards/${card.id}`, owner, body);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    }
  });

  it('is atomic: a failed assignee check leaves the other fields unchanged', async () => {
    const { owner, viewer, card } = await setup();
    const res = await call('PATCH', `/api/cards/${card.id}`, owner, {
      assigneeId: viewer.user.id,
      priority: 'high',
      estimate: 5,
    });
    expect(res.statusCode).toBe(400);
    const row = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(row).toMatchObject({ priority: 'none', estimate: null, version: 1 });
  });

  it('answers 403 to a viewer, 404 to a non-member and 401 without a session', async () => {
    const { viewer, outsider, card } = await setup();
    const forbidden = await call('PATCH', `/api/cards/${card.id}`, viewer, { priority: 'low' });
    expect(forbidden.statusCode).toBe(403);
    expect(errorOf(forbidden).code).toBe('FORBIDDEN');
    const hidden = await call('PATCH', `/api/cards/${card.id}`, outsider, { priority: 'low' });
    const unknown = await call(
      'PATCH',
      '/api/cards/0192f000-0000-7000-8000-000000000001',
      outsider,
      { priority: 'low' },
    );
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual(unknown.json());
    expect(
      (await call('PATCH', `/api/cards/${card.id}`, undefined, { priority: 'low' })).statusCode,
    ).toBe(401);
  });

  it('the database refuses an estimate outside 0 to 100', async () => {
    const { card } = await setup();
    await expect(
      prisma.card.update({ where: { id: card.id }, data: { estimate: 101 } }),
    ).rejects.toThrow();
    await expect(
      prisma.card.update({ where: { id: card.id }, data: { estimate: -1 } }),
    ).rejects.toThrow();
  });
});

describe('removing a member unassigns their cards', () => {
  it('clears assignments in that workspace only, with events and a new version', async () => {
    const { owner, member, ws, card } = await setup();
    // A second workspace where the same person is also a member and assigned.
    const other = workspaceResponseSchema.parse(
      (await call('POST', '/api/workspaces', owner, { name: 'Other' })).json(),
    ).workspace;
    await prisma.membership.create({
      data: { workspaceId: other.id, userId: member.user.id, role: 'member' },
    });
    const otherProject = projectResponseSchema.parse(
      (
        await call('POST', `/api/workspaces/${other.id}/projects`, owner, { name: 'O', key: 'OT' })
      ).json(),
    ).project;
    const otherBoard = boardResponseSchema.parse(
      (await call('GET', `/api/projects/${otherProject.id}/board`, owner)).json(),
    );
    const otherCard = cardResponseSchema.parse(
      (
        await call('POST', `/api/columns/${otherBoard.columns[0]?.id}/cards`, owner, {
          title: 'Elsewhere',
        })
      ).json(),
    ).card;
    await call('PATCH', `/api/cards/${card.id}`, owner, { assigneeId: member.user.id });
    await call('PATCH', `/api/cards/${otherCard.id}`, owner, { assigneeId: member.user.id });

    const res = await call('DELETE', `/api/workspaces/${ws.id}/members/${member.user.id}`, owner);
    expect(res.statusCode).toBe(204);

    const cleared = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(cleared).toMatchObject({ assigneeId: null, version: 3 });
    const kept = await prisma.card.findUniqueOrThrow({ where: { id: otherCard.id } });
    expect(kept.assigneeId).toBe(member.user.id);
    expect((await eventsOf(card.id)).at(-1)).toEqual({
      type: 'assignee_changed',
      data: { from: member.user.id, to: null },
    });
    const last = await prisma.activityEvent.findFirstOrThrow({
      where: { cardId: card.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(last.actorId).toBe(owner.user.id);
  });

  it('also clears them when a member leaves', async () => {
    const { owner, member, ws, card } = await setup();
    await call('PATCH', `/api/cards/${card.id}`, owner, { assigneeId: member.user.id });
    const res = await call('DELETE', `/api/workspaces/${ws.id}/members/${member.user.id}`, member);
    expect(res.statusCode).toBe(204);
    const row = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(row.assigneeId).toBeNull();
  });

  it('keeps the assignment when the removal is refused (last owner)', async () => {
    const { owner, ws, card } = await setup();
    await call('PATCH', `/api/cards/${card.id}`, owner, { assigneeId: owner.user.id });
    const res = await call('DELETE', `/api/workspaces/${ws.id}/members/${owner.user.id}`, owner);
    expect(res.statusCode).toBe(409);
    const row = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(row.assigneeId).toBe(owner.user.id);
  });
});

describe('demoting a member to viewer unassigns their cards (KB-038)', () => {
  const patchRole = (wid: string, userId: string, who: TestUser, role: string) =>
    call('PATCH', `/api/workspaces/${wid}/members/${userId}`, who, { role });

  async function secondCard(owner: TestUser, projectId: string, title: string) {
    const board = boardResponseSchema.parse(
      (await call('GET', `/api/projects/${projectId}/board`, owner)).json(),
    );
    return cardResponseSchema.parse(
      (await call('POST', `/api/columns/${board.columns[0]?.id}/cards`, owner, { title })).json(),
    ).card;
  }

  function collect() {
    const events: BoardEvent[] = [];
    const off = onBoardEvent((e) => events.push(e));
    return { events, off };
  }

  it('unassigns only live cards, with a version bump and the owner as actor', async () => {
    const { owner, member, ws, project, card } = await setup();
    const deleted = await secondCard(owner, project.id, 'Gone');
    await call('PATCH', `/api/cards/${card.id}`, owner, { assigneeId: member.user.id });
    await call('PATCH', `/api/cards/${deleted.id}`, owner, { assigneeId: member.user.id });
    await call('DELETE', `/api/cards/${deleted.id}`, owner);
    const before = await prisma.card.findUniqueOrThrow({ where: { id: deleted.id } });

    const { events, off } = collect();
    const res = await patchRole(ws.id, member.user.id, owner, 'viewer');
    off();
    expect(res.statusCode).toBe(200);

    expect(await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({
      assigneeId: null,
      version: 3,
    });
    expect(await prisma.card.findUniqueOrThrow({ where: { id: deleted.id } })).toMatchObject({
      assigneeId: member.user.id,
      version: before.version,
    });
    expect((await eventsOf(card.id)).at(-1)).toEqual({
      type: 'assignee_changed',
      data: { from: member.user.id, to: null },
    });
    const last = await prisma.activityEvent.findFirstOrThrow({
      where: { cardId: card.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(last.actorId).toBe(owner.user.id);
    expect(events.map((e) => e.type)).toEqual(['card_updated']);
  });

  it('unassigns an owner who is demoted while another owner remains', async () => {
    const { owner, member, ws, card } = await setup();
    await prisma.membership.update({
      where: { workspaceId_userId: { workspaceId: ws.id, userId: member.user.id } },
      data: { role: 'owner' },
    });
    await call('PATCH', `/api/cards/${card.id}`, owner, { assigneeId: member.user.id });
    expect((await patchRole(ws.id, member.user.id, owner, 'viewer')).statusCode).toBe(200);
    expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).assigneeId).toBeNull();
  });

  it('writes nothing for other role changes and for viewer to viewer', async () => {
    const { owner, member, viewer, ws, card } = await setup();
    await call('PATCH', `/api/cards/${card.id}`, owner, { assigneeId: member.user.id });
    const { events, off } = collect();
    expect((await patchRole(ws.id, member.user.id, owner, 'owner')).statusCode).toBe(200);
    expect((await patchRole(ws.id, member.user.id, owner, 'member')).statusCode).toBe(200);
    expect((await patchRole(ws.id, viewer.user.id, owner, 'viewer')).statusCode).toBe(200);
    expect((await patchRole(ws.id, viewer.user.id, owner, 'member')).statusCode).toBe(200);
    expect((await patchRole(ws.id, viewer.user.id, owner, 'owner')).statusCode).toBe(200);
    off();
    expect(events).toEqual([]);
    expect(await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({
      assigneeId: member.user.id,
      version: 2,
    });
  });

  it('refuses the last owner (409) and a non-owner (403) and changes nothing', async () => {
    const { owner, member, ws, card } = await setup();
    await call('PATCH', `/api/cards/${card.id}`, owner, { assigneeId: owner.user.id });
    const { events, off } = collect();
    const last = await patchRole(ws.id, owner.user.id, owner, 'viewer');
    const forbidden = await patchRole(ws.id, owner.user.id, member, 'viewer');
    off();
    expect(last.statusCode).toBe(409);
    expect(forbidden.statusCode).toBe(403);
    expect(events).toEqual([]);
    expect(await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({
      assigneeId: owner.user.id,
      version: 2,
    });
  });

  it('leaves cards in other workspaces untouched', async () => {
    const { owner, member, ws, card } = await setup();
    const other = workspaceResponseSchema.parse(
      (await call('POST', '/api/workspaces', owner, { name: 'Other' })).json(),
    ).workspace;
    await prisma.membership.create({
      data: { workspaceId: other.id, userId: member.user.id, role: 'member' },
    });
    const otherProject = projectResponseSchema.parse(
      (
        await call('POST', `/api/workspaces/${other.id}/projects`, owner, { name: 'O', key: 'OT' })
      ).json(),
    ).project;
    const otherCard = await secondCard(owner, otherProject.id, 'Elsewhere');
    await call('PATCH', `/api/cards/${card.id}`, owner, { assigneeId: member.user.id });
    await call('PATCH', `/api/cards/${otherCard.id}`, owner, { assigneeId: member.user.id });
    await patchRole(ws.id, member.user.id, owner, 'viewer');
    expect(await prisma.card.findUniqueOrThrow({ where: { id: otherCard.id } })).toMatchObject({
      assigneeId: member.user.id,
      version: 2,
    });
  });

  it('rolls back the role and the assignments together when a write fails', async () => {
    const { owner, member, ws, card } = await setup();
    await call('PATCH', `/api/cards/${card.id}`, owner, { assigneeId: member.user.id });
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION kb038_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected'; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER kb038_fail BEFORE INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION kb038_fail()`,
    );
    const { events, off } = collect();
    try {
      const res = await patchRole(ws.id, member.user.id, owner, 'viewer');
      expect(res.statusCode).toBe(500);
    } finally {
      off();
      await prisma.$executeRawUnsafe(`DROP TRIGGER kb038_fail ON activity_events`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION kb038_fail()`);
    }
    expect(events).toEqual([]);
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: ws.id, userId: member.user.id } },
    });
    expect(membership.role).toBe('member');
    expect(await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({
      assigneeId: member.user.id,
      version: 2,
    });
  });
});
