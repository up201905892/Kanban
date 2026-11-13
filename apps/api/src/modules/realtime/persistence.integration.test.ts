import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { WebSocket } from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WS_CLOSE,
  WS_MESSAGE,
  boardResponseSchema,
  cardResponseSchema,
  projectResponseSchema,
  workspaceResponseSchema,
} from '@kanban/shared';
import { buildApp } from '../../app.js';
import { createPrismaClient } from '../../db.js';
import { gracefulShutdown, installShutdownHandlers } from '../../lib/graceful-shutdown.js';
import { TEST_ORIGIN, createUserAndLogin, type TestUser } from '../../test-utils/auth.js';
import { resetDatabase } from '../../test-utils/reset-database.js';
import { createPrismaDocumentStore, createYjsPersistence } from './persistence.js';

const prisma = createPrismaClient(process.env['DATABASE_URL'] ?? '');
let app: FastifyInstance;
let port = 0;
const clients: Client[] = [];

async function start(persistence?: ReturnType<typeof createYjsPersistence>): Promise<void> {
  app = buildApp({
    prisma,
    webOrigin: TEST_ORIGIN,
    ...(persistence ? { realtime: { persistence } } : {}),
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
  closeCode: number | null = null;
  readonly closed: Promise<number>;

  constructor(readonly ws: WebSocket) {
    this.closed = new Promise((resolve) => {
      ws.on('close', (code) => {
        this.closeCode = code;
        resolve(code);
      });
    });
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
  return { owner, cardRoom: `card:${card.id}:description`, boardRoom: `board:${board.board.id}` };
}

const storedState = async (name: string): Promise<Y.Doc> => {
  const { snapshot, updates } = await createPrismaDocumentStore(prisma).loadDocument(name);
  const doc = new Y.Doc();
  if (snapshot) Y.applyUpdate(doc, snapshot);
  for (const u of updates) Y.applyUpdate(doc, u);
  return doc;
};

describe('documents survive a restart', () => {
  it('serves the edits of a closed app to a new client of a rebuilt app', async () => {
    await start();
    const s = await setup();
    const first = await open(s.cardRoom, s.owner);
    await waitFor(() => first.ws.readyState === WebSocket.OPEN);
    first.type('Written before the restart. ');
    await new Promise((r) => setTimeout(r, 100));
    first.type('Second batch.');
    await new Promise((r) => setTimeout(r, 700));
    first.ws.close();
    await first.closed;
    await app.close();

    await start();
    const second = await open(s.cardRoom, s.owner);
    await waitFor(() => second.text.length > 0);
    expect(second.text).toBe('Written before the restart. Second batch.');
  });

  it('persists edits that are still inside the batching window when the last client leaves', async () => {
    await start();
    const s = await setup();
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.ws.readyState === WebSocket.OPEN);
    c.type('quick');
    await new Promise((r) => setTimeout(r, 50));
    c.ws.close();
    await c.closed;
    await waitFor(async () => (await storedState(s.cardRoom)).getText('t').toString() === 'quick');
    // Unload compacts: everything is in the snapshot and no update rows remain.
    await waitFor(async () => (await prisma.yDocumentUpdate.count()) === 0);
    expect(await prisma.yDocument.count({ where: { name: s.cardRoom } })).toBe(1);
  });

  it('stores nothing for board rooms', async () => {
    await start();
    const s = await setup();
    const c = await open(s.boardRoom, s.owner);
    await waitFor(() => c.ws.readyState === WebSocket.OPEN);
    c.ws.close();
    await c.closed;
    await new Promise((r) => setTimeout(r, 100));
    expect(await prisma.yDocument.count()).toBe(0);
  });
});

describe('compaction', () => {
  const store = () => createPrismaDocumentStore(prisma);
  const NAME = 'card:0192f3a0-0000-7000-8000-0000000000aa:description';

  function makeUpdates(count: number): { updates: Uint8Array[]; doc: Y.Doc } {
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    const t = doc.getText('t');
    for (let i = 0; i < count; i++) {
      t.insert(t.length, `line ${i}\n`);
      if (i % 7 === 3) t.delete(0, 2);
    }
    return { updates, doc };
  }

  it('keeps the document identical (text and state vector) and removes the merged rows', async () => {
    const { updates, doc } = makeUpdates(40);
    for (const u of updates) await store().appendUpdate(NAME, u);
    const before = await storedState(NAME);
    expect(before.getText('t').toString()).toBe(doc.getText('t').toString());

    const bytes = await store().compact(NAME);
    expect(bytes).toBeGreaterThan(0);
    expect(await prisma.yDocumentUpdate.count()).toBe(0);

    const after = await storedState(NAME);
    expect(after.getText('t').toString()).toBe(doc.getText('t').toString());
    expect(Y.encodeStateVector(after)).toEqual(Y.encodeStateVector(doc));
    // Compacting again changes nothing.
    await store().compact(NAME);
    expect(Y.encodeStateVector(await storedState(NAME))).toEqual(Y.encodeStateVector(doc));
  });

  it('never drops an update appended while a compaction runs', async () => {
    const { updates, doc } = makeUpdates(120);
    await store().appendUpdate(NAME, updates[0] as Uint8Array);
    const rest = updates.slice(1);
    const compactions: Promise<number>[] = [];
    const appends: Promise<number>[] = [];
    rest.forEach((u, i) => {
      appends.push(store().appendUpdate(NAME, u));
      if (i % 10 === 0) compactions.push(store().compact(NAME));
    });
    await Promise.all([...appends, ...compactions]);

    const state = await storedState(NAME);
    expect(state.getText('t').toString()).toBe(doc.getText('t').toString());
    expect(Y.encodeStateVector(state)).toEqual(Y.encodeStateVector(doc));
  });

  it('compacts from the live path after the configured number of updates', async () => {
    await start(
      createYjsPersistence(createPrismaDocumentStore(prisma), { batchMs: 20, compactAfter: 3 }),
    );
    const s = await setup();
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.ws.readyState === WebSocket.OPEN);
    for (let i = 0; i < 5; i++) {
      c.type(`edit ${i};`);
      await new Promise((r) => setTimeout(r, 80));
    }
    await waitFor(async () => (await prisma.yDocumentUpdate.count()) < 3);
    const state = await storedState(s.cardRoom);
    expect(state.getText('t').toString()).toBe('edit 0;edit 1;edit 2;edit 3;edit 4;');
  });
});

describe('graceful shutdown', () => {
  it('flushes the pending batch and closes sockets with 1012', async () => {
    // A long batching window: only the shutdown flush can write the edit.
    await start(createYjsPersistence(createPrismaDocumentStore(prisma), { batchMs: 60_000 }));
    const s = await setup();
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.ws.readyState === WebSocket.OPEN);
    c.type('last words');
    await new Promise((r) => setTimeout(r, 150));
    expect(await prisma.yDocumentUpdate.count()).toBe(0);

    const code = await gracefulShutdown(app, 'SIGTERM');
    expect(code).toBe(0);
    expect(await c.closed).toBe(WS_CLOSE.serviceRestart);
    expect((await storedState(s.cardRoom)).getText('t').toString()).toBe('last words');
    // The app is closed already; start a fresh one for the shared afterEach.
    await start();
  });

  it('installs SIGTERM and SIGINT handlers that shut down once and exit with code 0', async () => {
    await start(createYjsPersistence(createPrismaDocumentStore(prisma), { batchMs: 60_000 }));
    const s = await setup();
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.ws.readyState === WebSocket.OPEN);
    c.type('before sigterm');
    await new Promise((r) => setTimeout(r, 150));

    const handlers = new Map<string, () => void>();
    const spy = vi.spyOn(process, 'on').mockImplementation(((event: string, fn: () => void) => {
      handlers.set(event, fn);
      return process;
    }) as typeof process.on);
    const exited = new Promise<number>((resolve) => installShutdownHandlers(app, resolve));
    spy.mockRestore();
    expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM']);

    handlers.get('SIGTERM')?.();
    handlers.get('SIGINT')?.(); // a second signal while shutting down is ignored
    expect(await exited).toBe(0);
    expect(await c.closed).toBe(WS_CLOSE.serviceRestart);
    expect((await storedState(s.cardRoom)).getText('t').toString()).toBe('before sigterm');
    await start();
  });

  it('refuses new connections once shutting down', async () => {
    await start();
    const s = await setup();
    const first = await open(s.cardRoom, s.owner);
    await waitFor(() => first.ws.readyState === WebSocket.OPEN);
    const shutting = app.realtime.shutdown();
    const late = await open(s.cardRoom, s.owner).catch(() => null);
    await shutting;
    if (late) expect(await late.closed).toBe(WS_CLOSE.serviceRestart);
  });
});
