import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { WebSocket } from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WS_MESSAGE,
  boardResponseSchema,
  cardResponseSchema,
  projectResponseSchema,
  workspaceResponseSchema,
} from '@kanban/shared';
import { buildApp } from '../../app.js';
import { createPrismaClient } from '../../db.js';
import { gracefulShutdown } from '../../lib/graceful-shutdown.js';
import { TEST_ORIGIN, createUserAndLogin, type TestUser } from '../../test-utils/auth.js';
import { resetDatabase } from '../../test-utils/reset-database.js';
import {
  createPrismaDocumentStore,
  createYjsPersistence,
  type DocumentStore,
} from './persistence.js';
import type { RoomManagerOptions } from './rooms.js';

const prisma = createPrismaClient(process.env['DATABASE_URL'] ?? '');
let app: FastifyInstance;
let port = 0;
const clients: Client[] = [];

async function start(
  persistence?: ReturnType<typeof createYjsPersistence>,
  rooms?: RoomManagerOptions,
): Promise<void> {
  app = buildApp({
    prisma,
    webOrigin: TEST_ORIGIN,
    ...(persistence ? { realtime: { persistence, ...(rooms ? { rooms } : {}) } } : {}),
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as AddressInfo).port;
}

beforeEach(async () => {
  await resetDatabase(prisma);
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  await app.close();
});
afterAll(() => prisma.$disconnect());

/** A minimal y-websocket client. */
class Client {
  readonly doc = new Y.Doc();
  readonly closed: Promise<number>;

  constructor(readonly ws: WebSocket) {
    this.closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
    ws.on('message', (raw: Buffer) => {
      const decoder = decoding.createDecoder(new Uint8Array(raw));
      if (decoding.readVarUint(decoder) !== WS_MESSAGE.sync) return;
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, WS_MESSAGE.sync);
      syncProtocol.readSyncMessage(decoder, reply, this.doc, this);
      if (encoding.length(reply) > 1) this.send(encoding.toUint8Array(reply));
    });
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, WS_MESSAGE.sync);
      syncProtocol.writeUpdate(e, update);
      this.send(encoding.toUint8Array(e));
    });
  }

  send(data: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  get text(): string {
    return this.doc.getText('t').toString();
  }

  type(text: string): void {
    const t = this.doc.getText('t');
    t.insert(t.length, text);
  }
}

async function open(room: string, who: TestUser): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${room}`, {
    headers: { origin: TEST_ORIGIN, cookie: who.cookie },
  });
  const client = new Client(ws);
  clients.push(client);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, WS_MESSAGE.sync);
  syncProtocol.writeSyncStep1(e, client.doc);
  client.send(encoding.toUint8Array(e));
  return client;
}

async function waitFor(check: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('condition not met in time');
}

async function setup() {
  const owner = await createUserAndLogin(app, { name: 'Olivia' });
  const call = (method: 'GET' | 'POST', url: string, body?: object) =>
    app.inject({ method, url, headers: owner.headers, ...(body ? { payload: body } : {}) });
  const ws = workspaceResponseSchema.parse(
    (await call('POST', '/api/workspaces', { name: 'Acme' })).json(),
  ).workspace;
  const project = projectResponseSchema.parse(
    (await call('POST', `/api/workspaces/${ws.id}/projects`, { name: 'P', key: 'KB' })).json(),
  ).project;
  const board = boardResponseSchema.parse(
    (await call('GET', `/api/projects/${project.id}/board`)).json(),
  );
  const column = board.columns[0];
  if (!column) throw new Error('no column');
  const card = cardResponseSchema.parse(
    (await call('POST', `/api/columns/${column.id}/cards`, { title: 'A card' })).json(),
  ).card;
  return { owner, cardRoom: `card:${card.id}:description` };
}

const storedState = async (name: string): Promise<Y.Doc> => {
  const { snapshot, updates } = await createPrismaDocumentStore(prisma).loadDocument(name);
  const doc = new Y.Doc();
  if (snapshot) Y.applyUpdate(doc, snapshot);
  for (const u of updates) Y.applyUpdate(doc, u);
  return doc;
};

/** The real PostgreSQL store with appends that fail while `down` is true. */
function flakyStore() {
  const real = createPrismaDocumentStore(prisma);
  const control = { down: false };
  const store: DocumentStore = {
    ...real,
    appendUpdate: async (name, update) => {
      if (control.down) throw new Error('database down');
      return real.appendUpdate(name, update);
    },
  };
  return { store, control };
}

const liveLength = (room: string): number | undefined =>
  app.realtime.rooms.doc(room)?.getText('t').length;

describe('a failing final flush keeps the edits (KB-037)', () => {
  it('serves the unsaved edit to a second client, then stores it once the database recovers', async () => {
    const { store, control } = flakyStore();
    const persistence = createYjsPersistence(store, {
      batchMs: 20,
      retryInitialMs: 40,
      retryMaxMs: 80,
    });
    await start(persistence, { retryInitialMs: 40, retryMaxMs: 80 });
    const s = await setup();
    const first = await open(s.cardRoom, s.owner);
    await waitFor(() => first.ws.readyState === WebSocket.OPEN);
    control.down = true;
    first.type('edit during outage');
    await waitFor(() => (liveLength(s.cardRoom) ?? 0) > 0);
    first.ws.close();
    await first.closed;
    await waitFor(() => app.realtime.rooms.retainedRooms().includes(s.cardRoom));
    expect(await prisma.yDocumentUpdate.count()).toBe(0);

    // A second client joins while the store is failing and sees the edit.
    const second = await open(s.cardRoom, s.owner);
    await waitFor(() => second.text === 'edit during outage');
    expect(app.realtime.rooms.retainedRooms()).toEqual([]);

    control.down = false;
    await waitFor(async () => (await prisma.yDocumentUpdate.count()) > 0);
    second.ws.close();
    await second.closed;
    await waitFor(() => !app.realtime.rooms.has(s.cardRoom));

    // Rebuild the app on the same database: a new client gets the edit.
    await app.close();
    await start();
    const third = await open(s.cardRoom, s.owner);
    await waitFor(() => third.text.length > 0);
    expect(third.text).toBe('edit during outage');
  });

  it('retries after the last client left until the database recovers, then drops the room', async () => {
    const { store, control } = flakyStore();
    await start(createYjsPersistence(store, { batchMs: 20 }), {
      retryInitialMs: 30,
      retryMaxMs: 60,
    });
    const s = await setup();
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.ws.readyState === WebSocket.OPEN);
    control.down = true;
    c.type('retry me');
    await waitFor(() => (liveLength(s.cardRoom) ?? 0) > 0);
    c.ws.close();
    await c.closed;
    await waitFor(() => app.realtime.rooms.retainedRooms().includes(s.cardRoom));
    control.down = false;
    await waitFor(() => !app.realtime.rooms.has(s.cardRoom));
    expect((await storedState(s.cardRoom)).getText('t').toString()).toBe('retry me');
  });

  it('shutdown with a store that never recovers exits with code 1 and names the document', async () => {
    const { store, control } = flakyStore();
    await start(createYjsPersistence(store, { batchMs: 20 }), {
      retryInitialMs: 20,
      retryMaxMs: 40,
      shutdownDeadlineMs: 300,
    });
    const s = await setup();
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.ws.readyState === WebSocket.OPEN);
    control.down = true;
    c.type('never saved');
    await waitFor(() => (liveLength(s.cardRoom) ?? 0) > 0);

    const errors: object[] = [];
    const spy = vi.spyOn(app.log, 'error').mockImplementation(((obj: object) => {
      errors.push(obj);
    }) as typeof app.log.error);
    const code = await gracefulShutdown(app, 'SIGTERM');
    spy.mockRestore();
    expect(code).toBe(1);
    expect(errors).toContainEqual({ doc: s.cardRoom });
    // The app is closed already; start a fresh one for the shared afterEach.
    await start();
  });

  it('shutdown with a store that recovers inside the deadline exits with code 0 and saves the edit', async () => {
    const { store, control } = flakyStore();
    await start(createYjsPersistence(store, { batchMs: 60_000 }), {
      retryInitialMs: 30,
      retryMaxMs: 60,
      shutdownDeadlineMs: 5000,
    });
    const s = await setup();
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.ws.readyState === WebSocket.OPEN);
    c.type('saved in time');
    await waitFor(() => (liveLength(s.cardRoom) ?? 0) > 0);
    control.down = true;
    setTimeout(() => {
      control.down = false;
    }, 200);

    expect(await gracefulShutdown(app, 'SIGTERM')).toBe(0);
    expect((await storedState(s.cardRoom)).getText('t').toString()).toBe('saved in time');
    await start();
  });
});
