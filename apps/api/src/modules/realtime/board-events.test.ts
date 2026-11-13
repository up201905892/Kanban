import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import * as decoding from 'lib0/decoding';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENT_MUTATION_HEADER,
  WS_CLOSE,
  WS_MESSAGE,
  boardEventSchema,
  boardResponseSchema,
  cardResponseSchema,
  columnResponseSchema,
  keysBetween,
  projectResponseSchema,
  workspaceResponseSchema,
  type BoardEvent,
} from '@kanban/shared';
import { buildApp } from '../../app.js';
import { createPrismaClient } from '../../db.js';
import { TEST_ORIGIN, createUserAndLogin, type TestUser } from '../../test-utils/auth.js';
import { resetDatabase } from '../../test-utils/reset-database.js';

const prisma = createPrismaClient(process.env['DATABASE_URL'] ?? '');
let app: FastifyInstance;
let port = 0;
const sockets: Listener[] = [];

beforeEach(async () => {
  await resetDatabase(prisma);
  app = buildApp({ prisma, webOrigin: TEST_ORIGIN });
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as AddressInfo).port;
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.ws.terminate();
  await app.close();
});
afterAll(() => prisma.$disconnect());

/** Collects the parsed board events a socket receives. */
class Listener {
  readonly events: BoardEvent[] = [];
  closeCode: number | null = null;
  constructor(readonly ws: WebSocket) {
    ws.on('close', (code) => {
      this.closeCode = code;
    });
    ws.on('message', (raw: Buffer) => {
      const decoder = decoding.createDecoder(new Uint8Array(raw));
      if (decoding.readVarUint(decoder) !== WS_MESSAGE.boardEvent) return;
      const message = JSON.parse(decoding.readVarString(decoder)) as { data: unknown };
      this.events.push(boardEventSchema.parse(message.data));
    });
  }
  get types(): string[] {
    return this.events.map((e) => e.type);
  }
}

async function listen(boardId: string, who: TestUser): Promise<Listener> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/board:${boardId}`, {
    headers: { origin: TEST_ORIGIN, cookie: who.cookie },
  });
  const listener = new Listener(ws);
  sockets.push(listener);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  // The server sends sync step 1 once the socket is joined.
  await waitFor(() => ws.readyState === WebSocket.OPEN);
  await new Promise((r) => setTimeout(r, 100));
  return listener;
}

async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('condition not met in time');
}
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  who: TestUser,
  body?: object,
  extraHeaders: Record<string, string> = {},
) {
  return app.inject({
    method,
    url,
    headers: { ...who.headers, ...extraHeaders },
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
  const project = projectResponseSchema.parse(
    (
      await call('POST', `/api/workspaces/${ws.id}/projects`, owner, { name: 'P', key: 'KB' })
    ).json(),
  ).project;
  const board = boardResponseSchema.parse(
    (await call('GET', `/api/projects/${project.id}/board`, owner)).json(),
  );
  const [todo, doing, done] = board.columns;
  if (!todo || !doing || !done) throw new Error('columns missing');
  return { owner, member, viewer, outsider, boardId: board.board.id, todo, doing, done, ws };
}

const MUTATION_ID = '0192f000-0000-7000-8000-00000000aaaa';

describe('board events published after commit', () => {
  it('publishes create, update, move and delete of a card with versions, actor and mutation id', async () => {
    const s = await setup();
    const member = await listen(s.boardId, s.member);
    const viewer = await listen(s.boardId, s.viewer);

    const created = cardResponseSchema.parse(
      (
        await call(
          'POST',
          `/api/columns/${s.todo.id}/cards`,
          s.owner,
          { title: 'First' },
          { [CLIENT_MUTATION_HEADER]: MUTATION_ID },
        )
      ).json(),
    ).card;
    await call('PATCH', `/api/cards/${created.id}`, s.owner, {
      title: 'Renamed',
      priority: 'high',
      estimate: 3,
    });
    await call('POST', `/api/cards/${created.id}/move`, s.owner, { columnId: s.doing.id });
    await call('DELETE', `/api/cards/${created.id}`, s.owner);

    await waitFor(() => member.events.length === 4 && viewer.events.length === 4);
    expect(member.types).toEqual(['card_created', 'card_updated', 'card_moved', 'card_deleted']);
    expect(viewer.events).toEqual(member.events);

    const [c, u, m, d] = member.events;
    expect(c).toMatchObject({
      boardId: s.boardId,
      actorId: s.owner.user.id,
      clientMutationId: MUTATION_ID,
      version: 1,
      entity: { id: created.id, title: 'First', columnId: s.todo.id },
    });
    expect(u).toMatchObject({
      version: 2,
      entity: { title: 'Renamed', priority: 'high', estimate: 3 },
    });
    expect(u?.clientMutationId).toBeUndefined();
    expect(m).toMatchObject({ version: 3, entity: { columnId: s.doing.id } });
    expect(d).toMatchObject({
      version: 4,
      entity: { id: created.id, number: created.number, title: 'Renamed' },
    });
  });

  it('publishes column create, rename, Done change, move and delete', async () => {
    const s = await setup();
    const listener = await listen(s.boardId, s.viewer);

    const column = columnResponseSchema.parse(
      (await call('POST', `/api/boards/${s.boardId}/columns`, s.owner, { name: 'QA' })).json(),
    ).column;
    await call('PATCH', `/api/columns/${column.id}`, s.owner, { name: 'Review', isDone: true });
    await call('DELETE', `/api/columns/${s.todo.id}`, s.owner);

    // created, the old Done column cleared, the renamed one, deleted
    await waitFor(() => listener.events.length === 4);
    expect(listener.types).toEqual([
      'column_created',
      'column_updated',
      'column_updated',
      'column_deleted',
    ]);
    const [, oldDone, renamed, deleted] = listener.events;
    expect(oldDone).toMatchObject({ entity: { id: s.done.id, isDone: false }, version: null });
    expect(renamed).toMatchObject({ entity: { name: 'Review', isDone: true } });
    expect(deleted).toMatchObject({ entity: { id: s.todo.id } });
  });

  it('publishes the moved cards when a column is deleted with a destination', async () => {
    const s = await setup();
    const card = cardResponseSchema.parse(
      (await call('POST', `/api/columns/${s.todo.id}/cards`, s.owner, { title: 'Moves' })).json(),
    ).card;
    const listener = await listen(s.boardId, s.member);
    const res = await call(
      'DELETE',
      `/api/columns/${s.todo.id}?moveCardsTo=${s.doing.id}`,
      s.owner,
    );
    expect(res.statusCode, res.body).toBe(204);
    await waitFor(() => listener.events.length === 2);
    expect(listener.types).toEqual(['card_moved', 'column_deleted']);
    expect(listener.events[0]).toMatchObject({
      version: 2,
      entity: { id: card.id, columnId: s.doing.id },
    });
  });

  it('publishes respaced siblings with bumped versions on a column delete (KB-034)', async () => {
    const s = await setup();
    const one = cardResponseSchema.parse(
      (await call('POST', `/api/columns/${s.doing.id}/cards`, s.owner, { title: 'One' })).json(),
    ).card;
    await prisma.card.update({ where: { id: one.id }, data: { position: 'z'.repeat(27) } });
    await prisma.card.createMany({
      data: keysBetween(null, null, 120).map((position, i) => ({
        boardId: s.boardId,
        columnId: s.todo.id,
        number: 1000 + i,
        title: `s${i}`,
        position,
        createdById: s.owner.user.id,
      })),
    });
    const listener = await listen(s.boardId, s.member);
    const res = await call(
      'DELETE',
      `/api/columns/${s.todo.id}?moveCardsTo=${s.doing.id}`,
      s.owner,
    );
    expect(res.statusCode, res.body).toBe(204);
    await waitFor(() => listener.events.length === 122);
    expect(listener.events[0]).toMatchObject({
      type: 'card_moved',
      version: 2,
      entity: { id: one.id },
    });
    const moves = listener.events.filter((e) => e.type === 'card_moved');
    expect(moves).toHaveLength(121);
    expect(moves.every((e) => e.version === 2)).toBe(true);
    expect(listener.events.at(-1)?.type).toBe('column_deleted');
  });

  it('publishes respaced siblings with bumped versions on a card create (KB-034)', async () => {
    const s = await setup();
    const first = cardResponseSchema.parse(
      (await call('POST', `/api/columns/${s.todo.id}/cards`, s.owner, { title: 'first' })).json(),
    ).card;
    const last = cardResponseSchema.parse(
      (await call('POST', `/api/columns/${s.todo.id}/cards`, s.owner, { title: 'last' })).json(),
    ).card;
    const long = `a0${'V'.repeat(49)}`;
    await prisma.card.update({ where: { id: first.id }, data: { position: long } });
    await prisma.card.update({ where: { id: last.id }, data: { position: `${long}W` } });
    const listener = await listen(s.boardId, s.member);
    const res = await call('POST', `/api/columns/${s.todo.id}/cards`, s.owner, {
      title: 'mid',
      afterCardId: first.id,
    });
    expect(res.statusCode, res.body).toBe(201);
    await waitFor(() => listener.events.length === 3);
    expect(listener.types).toEqual(['card_moved', 'card_moved', 'card_created']);
    expect(listener.events[0]).toMatchObject({ version: 2, entity: { id: first.id } });
    expect(listener.events[1]).toMatchObject({ version: 2, entity: { id: last.id } });
  });

  it('publishes assignee changes when a member is removed', async () => {
    const s = await setup();
    const card = cardResponseSchema.parse(
      (await call('POST', `/api/columns/${s.todo.id}/cards`, s.owner, { title: 'Mine' })).json(),
    ).card;
    await call('PATCH', `/api/cards/${card.id}`, s.owner, { assigneeId: s.member.user.id });
    const listener = await listen(s.boardId, s.viewer);
    const res = await call(
      'DELETE',
      `/api/workspaces/${s.ws.id}/members/${s.member.user.id}`,
      s.owner,
    );
    expect(res.statusCode).toBe(204);
    await waitFor(() => listener.events.length === 1);
    expect(listener.events[0]).toMatchObject({
      type: 'card_updated',
      version: 3,
      entity: { id: card.id, assigneeId: null },
      actorId: s.owner.user.id,
    });
  });

  it('publishes nothing for a change that did not happen', async () => {
    const s = await setup();
    const card = cardResponseSchema.parse(
      (await call('POST', `/api/columns/${s.todo.id}/cards`, s.owner, { title: 'Same' })).json(),
    ).card;
    const listener = await listen(s.boardId, s.member);

    // Rolled back or refused: a column that still has cards, a viewer, an unknown card, a no-op.
    await call('POST', `/api/columns/${s.todo.id}/cards`, s.owner, { title: 'Extra' });
    await waitFor(() => listener.events.length === 1);
    listener.events.length = 0;

    const refused = [
      await call('DELETE', `/api/columns/${s.todo.id}`, s.owner),
      await call('PATCH', `/api/cards/${card.id}`, s.viewer, { title: 'Nope' }),
      await call('POST', `/api/cards/${card.id}/move`, s.viewer, { columnId: s.doing.id }),
      await call('DELETE', `/api/cards/${card.id}`, s.viewer),
      await call('PATCH', `/api/cards/${card.id}`, s.owner, { assigneeId: s.viewer.user.id }),
      await call('PATCH', `/api/cards/${card.id}`, s.owner, { title: 'Same' }),
      await call('PATCH', `/api/columns/${s.todo.id}`, s.viewer, { name: 'Nope' }),
      await call('POST', `/api/boards/${s.boardId}/columns`, s.outsider, { name: 'Nope' }),
    ];
    expect(refused.map((r) => r.statusCode)).toEqual([409, 403, 403, 403, 400, 200, 403, 404]);
    await settle();
    expect(listener.events).toEqual([]);
  });

  it('does not deliver events to a non-member and stops after removal from the workspace', async () => {
    const s = await setup();
    const outsider = new Listener(
      new WebSocket(`ws://127.0.0.1:${port}/ws/board:${s.boardId}`, {
        headers: { origin: TEST_ORIGIN, cookie: s.outsider.cookie },
      }),
    );
    sockets.push(outsider);
    expect(await new Promise((r) => outsider.ws.once('close', r))).toBe(WS_CLOSE.forbidden);

    const member = await listen(s.boardId, s.member);
    await call('DELETE', `/api/workspaces/${s.ws.id}/members/${s.member.user.id}`, s.owner);
    await waitFor(() => member.closeCode !== null);
    await call('POST', `/api/columns/${s.todo.id}/cards`, s.owner, { title: 'After' });
    await settle();
    expect(member.events).toEqual([]);
    expect(outsider.events).toEqual([]);
  });

  it('keeps events out of other boards', async () => {
    const s = await setup();
    const other = projectResponseSchema.parse(
      (
        await call('POST', `/api/workspaces/${s.ws.id}/projects`, s.owner, {
          name: 'Other',
          key: 'OT',
        })
      ).json(),
    ).project;
    const otherBoard = boardResponseSchema.parse(
      (await call('GET', `/api/projects/${other.id}/board`, s.owner)).json(),
    );
    const listener = await listen(otherBoard.board.id, s.owner);
    await call('POST', `/api/columns/${s.todo.id}/cards`, s.owner, { title: 'Elsewhere' });
    await settle();
    expect(listener.events).toEqual([]);
  });
});
