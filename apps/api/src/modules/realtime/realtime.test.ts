import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { WebSocket } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WS_CLOSE,
  WS_MAX_MESSAGE_BYTES,
  WS_MESSAGE,
  boardEventMessageSchema,
  boardResponseSchema,
  cardResponseSchema,
  presenceColorOf,
  projectResponseSchema,
  workspaceResponseSchema,
  type RoomRef,
} from '@kanban/shared';
import { buildApp, type AppOptions } from '../../app.js';
import { createPrismaClient } from '../../db.js';
import { TEST_ORIGIN, createUserAndLogin, type TestUser } from '../../test-utils/auth.js';
import { resetDatabase } from '../../test-utils/reset-database.js';
import type { RealtimeOptions } from './routes.js';

const prisma = createPrismaClient(process.env['DATABASE_URL'] ?? '');
let app: FastifyInstance;
let port = 0;
const clients: TestClient[] = [];

async function start(realtime?: RealtimeOptions): Promise<void> {
  const options: AppOptions = { prisma, webOrigin: TEST_ORIGIN, ...(realtime ? { realtime } : {}) };
  app = buildApp(options);
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as AddressInfo).port;
}

beforeEach(async () => {
  await resetDatabase(prisma);
  await start();
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  await app.close();
});
afterAll(() => prisma.$disconnect());

/** A minimal y-websocket client: the standard handshake over a plain `ws` socket. */
class TestClient {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly received: Uint8Array[] = [];
  readonly boardEvents: unknown[] = [];
  closeCode: number | null = null;
  readonly closed: Promise<number>;

  constructor(readonly ws: WebSocket) {
    this.closed = new Promise((resolve) => {
      ws.on('close', (code) => {
        this.closeCode = code;
        resolve(code);
      });
    });
    ws.on('message', (raw: Buffer) => this.onMessage(new Uint8Array(raw)));
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, WS_MESSAGE.sync);
      syncProtocol.writeUpdate(e, update);
      this.send(encoding.toUint8Array(e));
    });
    this.awareness.on('update', ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
      if (origin !== 'local') return;
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, WS_MESSAGE.awareness);
      encoding.writeVarUint8Array(
        e,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]),
      );
      this.send(encoding.toUint8Array(e));
    });
  }

  send(data: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  /** The client half of the opening handshake. */
  handshake(): void {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, WS_MESSAGE.sync);
    syncProtocol.writeSyncStep1(e, this.doc);
    this.send(encoding.toUint8Array(e));
  }

  private onMessage(data: Uint8Array): void {
    this.received.push(data);
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    if (type === WS_MESSAGE.sync) {
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, WS_MESSAGE.sync);
      syncProtocol.readSyncMessage(decoder, reply, this.doc, this);
      if (encoding.length(reply) > 1) this.send(encoding.toUint8Array(reply));
    } else if (type === WS_MESSAGE.awareness) {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(decoder),
        this,
      );
    } else if (type === WS_MESSAGE.boardEvent) {
      this.boardEvents.push(JSON.parse(decoding.readVarString(decoder)));
    }
  }

  get text(): string {
    return this.doc.getText('t').toString();
  }

  type(text: string): void {
    const t = this.doc.getText('t');
    t.insert(t.length, text);
  }
}

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

type Outcome = { kind: 'open'; client: TestClient } | { kind: 'rejected'; status: number };

function connect(
  room: string,
  who: TestUser | null,
  opts: { origin?: string | null; cookie?: string; autoPong?: boolean } = {},
): Promise<Outcome> {
  const headers: Record<string, string> = {};
  const origin = opts.origin === undefined ? TEST_ORIGIN : opts.origin;
  if (origin) headers['origin'] = origin;
  const cookie = opts.cookie ?? who?.cookie;
  if (cookie) headers['cookie'] = cookie;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${room}`, {
    headers,
    autoPong: opts.autoPong ?? true,
  });
  const client = new TestClient(ws);
  clients.push(client);
  return new Promise((resolve, reject) => {
    ws.once('open', () => {
      client.handshake();
      resolve({ kind: 'open', client });
    });
    ws.once('unexpected-response', (_req, res) => {
      resolve({ kind: 'rejected', status: res.statusCode ?? 0 });
      res.resume();
    });
    ws.once('error', (err) => {
      if (!/Unexpected server response/.test(err.message)) reject(err);
    });
  });
}

async function open(room: string, who: TestUser): Promise<TestClient> {
  const out = await connect(room, who);
  if (out.kind !== 'open') throw new Error(`upgrade rejected with ${out.status}`);
  return out.client;
}

async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('condition not met in time');
}

/** A valid awareness state (the server overwrites the identity fields). */
const presence = (userId: string, name: string) => ({
  userId,
  name,
  color: '#aabbcc',
  activeCardId: null,
  editing: false,
});

/** Lets the server process what was sent (a round trip is not observable when updates are dropped). */
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  who: TestUser,
  body?: object,
) {
  return app.inject({
    method,
    url,
    headers: who.headers,
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
  const column = board.columns[0];
  if (!column) throw new Error('no column');
  const card = cardResponseSchema.parse(
    (await call('POST', `/api/columns/${column.id}/cards`, owner, { title: 'A card' })).json(),
  ).card;
  return {
    owner,
    member,
    viewer,
    outsider,
    ws,
    boardRoom: `board:${board.board.id}`,
    boardId: board.board.id,
    cardRoom: `card:${card.id}:description`,
    cardId: card.id,
  };
}

describe('upgrade authentication and authorization', () => {
  it('closes with 4401 when there is no session cookie', async () => {
    const s = await setup();
    const out = await connect(s.cardRoom, null);
    expect(out.kind).toBe('open');
    if (out.kind !== 'open') return;
    expect(await out.client.closed).toBe(WS_CLOSE.unauthenticated);
    expect(out.client.received).toHaveLength(0);
  });

  it('closes with 4401 for an unknown session token', async () => {
    const s = await setup();
    const out = await connect(s.cardRoom, null, { cookie: 'kanban_session=nope' });
    if (out.kind !== 'open') throw new Error('expected upgrade');
    expect(await out.client.closed).toBe(WS_CLOSE.unauthenticated);
  });

  it('rejects a wrong or missing Origin before the upgrade', async () => {
    const s = await setup();
    const wrong = await connect(s.cardRoom, s.owner, { origin: 'http://evil.example' });
    expect(wrong).toEqual({ kind: 'rejected', status: 403 });
    const missing = await connect(s.cardRoom, s.owner, { origin: null });
    expect(missing).toEqual({ kind: 'rejected', status: 403 });
  });

  it('closes with 4400 for a malformed room name', async () => {
    const s = await setup();
    const out = await connect('card:123:description', s.owner);
    if (out.kind !== 'open') throw new Error('expected upgrade');
    expect(await out.client.closed).toBe(WS_CLOSE.invalidRoom);
    const other = await connect('lobby', s.owner);
    if (other.kind !== 'open') throw new Error('expected upgrade');
    expect(await other.client.closed).toBe(WS_CLOSE.invalidRoom);
  });

  it('closes a non-member with 4403 and sends no document bytes, for cards and boards', async () => {
    const s = await setup();
    for (const room of [s.cardRoom, s.boardRoom]) {
      const out = await connect(room, s.outsider);
      if (out.kind !== 'open') throw new Error('expected upgrade');
      expect(await out.client.closed).toBe(WS_CLOSE.forbidden);
      expect(out.client.received).toHaveLength(0);
    }
    expect(app.realtime.rooms.size).toBe(0);
  });

  it('answers a room that does not exist exactly like one the user may not see', async () => {
    const s = await setup();
    const out = await connect(`card:${crypto.randomUUID()}:description`, s.owner);
    if (out.kind !== 'open') throw new Error('expected upgrade');
    expect(await out.client.closed).toBe(WS_CLOSE.forbidden);
    expect(out.client.received).toHaveLength(0);
  });

  it('does not serve a soft-deleted card', async () => {
    const s = await setup();
    expect((await call('DELETE', `/api/cards/${s.cardId}`, s.owner)).statusCode).toBe(204);
    const out = await connect(s.cardRoom, s.owner);
    if (out.kind !== 'open') throw new Error('expected upgrade');
    expect(await out.client.closed).toBe(WS_CLOSE.forbidden);
  });

  it('refuses text frames', async () => {
    const s = await setup();
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.received.length > 0);
    c.ws.send('hello');
    expect(await c.closed).toBe(1003);
  });

  it('closes on a malformed binary message with 1007', async () => {
    const s = await setup();
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.received.length > 0);
    c.ws.send(new Uint8Array([0, 9, 1, 2]));
    expect(await c.closed).toBe(1007);
  });
});

describe('document sync', () => {
  it('two members converge on the same document (R4)', async () => {
    const s = await setup();
    const a = await open(s.cardRoom, s.owner);
    const b = await open(s.cardRoom, s.member);
    await waitFor(() => a.received.length > 0 && b.received.length > 0);

    a.type('Hello');
    await waitFor(() => b.text === 'Hello');
    b.type(' world');
    await waitFor(() => a.text === 'Hello world');

    // Concurrent edits made while both are connected still converge.
    a.type('!');
    b.type('?');
    await waitFor(() => a.text === b.text && a.text.length === 'Hello world!?'.length);
    expect(Y.encodeStateVector(a.doc)).toEqual(Y.encodeStateVector(b.doc));
  });

  it('gives a late joiner the current state and keeps the room until the last client leaves', async () => {
    const s = await setup();
    const a = await open(s.cardRoom, s.owner);
    await waitFor(() => a.received.length > 0);
    a.type('draft');
    await settle();
    const late = await open(s.cardRoom, s.member);
    await waitFor(() => late.text === 'draft');
    expect(app.realtime.rooms.size).toBe(1);

    a.ws.close();
    await a.closed;
    await settle();
    expect(app.realtime.rooms.size).toBe(1);
    late.ws.close();
    await late.closed;
    await waitFor(() => app.realtime.rooms.size === 0);
  });

  it('discards a viewer update: not applied on the server, not seen by others (R3)', async () => {
    const s = await setup();
    const editor = await open(s.cardRoom, s.owner);
    const viewer = await open(s.cardRoom, s.viewer);
    await waitFor(() => editor.received.length > 0 && viewer.received.length > 0);

    viewer.type('sneaky');
    await settle();
    expect(editor.text).toBe('');
    expect(app.realtime.rooms.doc(s.cardRoom)?.getText('t').toString()).toBe('');

    // A fresh client still sees nothing, and the viewer does receive editors' changes.
    editor.type('real');
    await waitFor(() => viewer.text.includes('real'));
    const fresh = await open(s.cardRoom, s.member);
    await waitFor(() => fresh.text === 'real');
  });

  it('lets a viewer use awareness and shows it to the others', async () => {
    const s = await setup();
    const editor = await open(s.cardRoom, s.owner);
    const viewer = await open(s.cardRoom, s.viewer);
    await waitFor(() => editor.received.length > 0 && viewer.received.length > 0);
    viewer.awareness.setLocalState({ ...presence('x', 'Vera'), editing: true });
    await waitFor(
      () => editor.awareness.getStates().get(viewer.doc.clientID)?.['editing'] === true,
    );

    // Leaving clears the state for the others.
    viewer.ws.close();
    await waitFor(() => !editor.awareness.getStates().has(viewer.doc.clientID));
  });

  it('replaces a spoofed userId, name and color with the session values', async () => {
    const s = await setup();
    const watcher = await open(s.boardRoom, s.owner);
    const liar = await open(s.boardRoom, s.member);
    await waitFor(() => watcher.received.length > 0 && liar.received.length > 0);
    const cardId = '8c0e3f4e-4b0a-4a53-9a39-0f5d0c4e8a11';
    liar.awareness.setLocalState({
      ...presence(s.owner.user.id, 'Olivia the Owner'),
      color: '#000000',
      activeCardId: cardId,
    });
    await waitFor(() => watcher.awareness.getStates().has(liar.doc.clientID));
    const seen = watcher.awareness.getStates().get(liar.doc.clientID);
    expect(seen?.['userId']).toBe(s.member.user.id);
    expect(seen?.['name']).toBe('Mark');
    expect(seen?.['color']).toBe(presenceColorOf(s.member.user.id));
    expect(seen?.['activeCardId']).toBe(cardId);
  });

  it('drops invalid awareness states and refuses to touch other people states', async () => {
    const s = await setup();
    const a = await open(s.boardRoom, s.owner);
    const b = await open(s.boardRoom, s.member);
    await waitFor(() => a.received.length > 0 && b.received.length > 0);
    a.awareness.setLocalState(presence(s.owner.user.id, 'Olivia'));
    await waitFor(() => b.awareness.getStates().has(a.doc.clientID));

    // Not valid state: ignored, not stored.
    b.awareness.setLocalState({ name: 'no other fields' });
    await settle();
    expect(a.awareness.getStates().has(b.doc.clientID)).toBe(false);

    // B forges updates for A's client ID: first an overwrite, then a removal.
    const forge = (state: object | null): Uint8Array => {
      const inner = encoding.createEncoder();
      encoding.writeVarUint(inner, 1);
      encoding.writeVarUint(inner, a.doc.clientID);
      encoding.writeVarUint(inner, 1_000_000);
      encoding.writeVarString(inner, JSON.stringify(state));
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, WS_MESSAGE.awareness);
      encoding.writeVarUint8Array(e, encoding.toUint8Array(inner));
      return encoding.toUint8Array(e);
    };
    b.send(forge({ ...presence(s.member.user.id, 'Mark'), editing: true }));
    b.send(forge(null));
    await settle();
    expect(b.closeCode).toBeNull();
    const stillThere = b.awareness.getStates().get(a.doc.clientID);
    expect(stillThere?.['userId']).toBe(s.owner.user.id);
    expect(stillThere?.['editing']).toBe(false);
  });

  it('clears presence at once when a client closes cleanly', async () => {
    const s = await setup();
    const a = await open(s.boardRoom, s.owner);
    const b = await open(s.boardRoom, s.member);
    await waitFor(() => a.received.length > 0 && b.received.length > 0);
    a.awareness.setLocalState(presence(s.owner.user.id, 'Olivia'));
    await waitFor(() => b.awareness.getStates().has(a.doc.clientID));
    a.ws.close();
    await waitFor(() => !b.awareness.getStates().has(a.doc.clientID), 1000);
  });

  it('keeps board rooms server-written only and pushes board events to every client', async () => {
    const s = await setup();
    const a = await open(s.boardRoom, s.owner);
    const b = await open(s.boardRoom, s.viewer);
    await waitFor(() => a.received.length > 0 && b.received.length > 0);

    a.type('not allowed');
    await settle();
    expect(b.text).toBe('');
    expect(app.realtime.rooms.doc(s.boardRoom)?.getText('t').toString()).toBe('');

    app.realtime.broadcastBoardEvent(s.boardId, { type: 'card.created', data: { id: 'x' } });
    await waitFor(() => a.boardEvents.length === 1 && b.boardEvents.length === 1);
    expect(boardEventMessageSchema.parse(b.boardEvents[0])).toEqual({
      type: 'card.created',
      data: { id: 'x' },
    });
  });

  it('ignores a board-event message sent by a client', async () => {
    const s = await setup();
    const a = await open(s.boardRoom, s.owner);
    const b = await open(s.boardRoom, s.member);
    await waitFor(() => a.received.length > 0 && b.received.length > 0);
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, WS_MESSAGE.boardEvent);
    encoding.writeVarString(e, JSON.stringify({ type: 'forged', data: {} }));
    a.send(encoding.toUint8Array(e));
    await settle();
    expect(b.boardEvents).toHaveLength(0);
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe('membership changes close or re-authorize sockets', () => {
  it('closes the sockets of a removed member within 1 s and keeps the others', async () => {
    const s = await setup();
    const owner = await open(s.cardRoom, s.owner);
    const member = await open(s.cardRoom, s.member);
    const memberBoard = await open(s.boardRoom, s.member);
    await waitFor(() => member.received.length > 0);

    const started = Date.now();
    const res = await call(
      'DELETE',
      `/api/workspaces/${s.ws.id}/members/${s.member.user.id}`,
      s.owner,
    );
    expect(res.statusCode).toBe(204);
    expect(await member.closed).toBe(WS_CLOSE.forbidden);
    expect(await memberBoard.closed).toBe(WS_CLOSE.forbidden);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(owner.closeCode).toBeNull();
  });

  it('closes the socket of a member who leaves', async () => {
    const s = await setup();
    const member = await open(s.cardRoom, s.member);
    await waitFor(() => member.received.length > 0);
    const res = await call(
      'DELETE',
      `/api/workspaces/${s.ws.id}/members/${s.member.user.id}`,
      s.member,
    );
    expect(res.statusCode).toBe(204);
    expect(await member.closed).toBe(WS_CLOSE.forbidden);
  });

  it('leaves the socket open when the change is refused (last owner)', async () => {
    const s = await setup();
    const owner = await open(s.cardRoom, s.owner);
    await waitFor(() => owner.received.length > 0);
    const res = await call(
      'DELETE',
      `/api/workspaces/${s.ws.id}/members/${s.owner.user.id}`,
      s.owner,
    );
    expect(res.statusCode).toBe(409);
    await settle();
    expect(owner.closeCode).toBeNull();
  });

  it('re-authorizes a demoted member: later edits are discarded, a promoted viewer can edit', async () => {
    const s = await setup();
    const owner = await open(s.cardRoom, s.owner);
    const member = await open(s.cardRoom, s.member);
    const viewer = await open(s.cardRoom, s.viewer);
    await waitFor(() => [owner, member, viewer].every((c) => c.received.length > 0));

    member.type('before ');
    await waitFor(() => owner.text === 'before ');

    const demote = await call(
      'PATCH',
      `/api/workspaces/${s.ws.id}/members/${s.member.user.id}`,
      s.owner,
      {
        role: 'viewer',
      },
    );
    expect(demote.statusCode).toBe(200);
    member.type('after');
    await settle();
    expect(owner.text).toBe('before ');

    const promote = await call(
      'PATCH',
      `/api/workspaces/${s.ws.id}/members/${s.viewer.user.id}`,
      s.owner,
      {
        role: 'member',
      },
    );
    expect(promote.statusCode).toBe(200);
    // The promoted viewer's local edit only arrives as an update after the role changed.
    viewer.type('now');
    await waitFor(() => owner.text.includes('now'));
    expect(member.closeCode).toBeNull();
  });
});

describe('limits and liveness', () => {
  it('closes with 1009 on a message over 1 MB', async () => {
    const s = await setup();
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.received.length > 0);
    c.ws.send(new Uint8Array(WS_MAX_MESSAGE_BYTES + 1));
    expect(await c.closed).toBe(WS_CLOSE.messageTooBig);
  });

  it('accepts a message at the limit', async () => {
    const s = await setup();
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.received.length > 0);
    // A query-awareness message padded to just under 1 MB is valid and must not be refused.
    const filler = new Uint8Array(WS_MAX_MESSAGE_BYTES - 8);
    const a = encoding.createEncoder();
    encoding.writeVarUint(a, WS_MESSAGE.queryAwareness);
    encoding.writeUint8Array(a, filler);
    c.send(encoding.toUint8Array(a));
    await settle();
    expect(c.closeCode).toBeNull();
  });

  it('terminates a connection that stops answering pings', async () => {
    await app.close();
    await start({ heartbeatMs: 60 });
    const s = await setup();
    const out = await connect(s.cardRoom, s.owner, { autoPong: false });
    if (out.kind !== 'open') throw new Error('expected upgrade');
    await out.client.closed;
    await waitFor(() => app.realtime.rooms.size === 0);
  });

  it('keeps a responsive connection alive across several heartbeats', async () => {
    await app.close();
    await start({ heartbeatMs: 40 });
    const s = await setup();
    const c = await open(s.cardRoom, s.owner);
    await settle(400);
    expect(c.closeCode).toBeNull();
  });
});

describe('persistence hook', () => {
  it('loads on the first connection and stores when the last client leaves', async () => {
    await app.close();
    const calls: string[] = [];
    await start({
      persistence: {
        load: async (room: RoomRef, doc: Y.Doc) => {
          calls.push(`load ${room.type}`);
          doc.getText('t').insert(0, 'stored');
        },
        store: async (room: RoomRef, doc: Y.Doc) => {
          calls.push(`store ${room.type}:${doc.getText('t').toString()}`);
        },
      },
    });
    const s = await setup();
    const a = await open(s.cardRoom, s.owner);
    const b = await open(s.cardRoom, s.member);
    await waitFor(() => a.text === 'stored' && b.text === 'stored');
    expect(calls).toEqual(['load card-description']);

    a.type('+');
    await waitFor(() => b.text === 'stored+');
    a.ws.close();
    await a.closed;
    await settle();
    expect(calls).toEqual(['load card-description']);
    b.ws.close();
    await b.closed;
    await waitFor(() => calls.length === 2);
    expect(calls[1]).toBe('store card-description:stored+');
    await waitFor(() => app.realtime.rooms.size === 0);
  });

  it('closes the socket with 1011 when loading fails and leaves no room behind', async () => {
    await app.close();
    await start({
      persistence: {
        load: async () => {
          throw new Error('boom');
        },
        store: async () => {},
      },
    });
    const s = await setup();
    const c = await open(s.cardRoom, s.owner);
    expect(await c.closed).toBe(1011);
    await waitFor(() => app.realtime.rooms.size === 0);
  });
});
