import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { WebSocket } from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DESCRIPTION_TEXT_NAME,
  WS_MESSAGE,
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
let port = 0;
const clients: Client[] = [];

beforeEach(async () => {
  await resetDatabase(prisma);
  app = buildApp({ prisma, webOrigin: TEST_ORIGIN });
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as AddressInfo).port;
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
    return this.doc.getText(DESCRIPTION_TEXT_NAME).toString();
  }

  append(text: string): void {
    const t = this.doc.getText(DESCRIPTION_TEXT_NAME);
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

async function waitFor(check: () => boolean | Promise<boolean>, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('condition not met in time');
}

async function setup(description?: string) {
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
    (
      await call('POST', `/api/columns/${column.id}/cards`, {
        title: 'A card',
        ...(description !== undefined ? { description } : {}),
      })
    ).json(),
  ).card;
  const description$ = async () =>
    cardResponseSchema.parse((await call('GET', `/api/cards/${card.id}`)).json()).card.description;
  return { owner, card, cardRoom: `card:${card.id}:description`, description$ };
}

describe('seeding from Card.description', () => {
  it('seeds the text once when two clients open the card at the same moment', async () => {
    const s = await setup('Existing **text**');
    const [a, b] = await Promise.all([open(s.cardRoom, s.owner), open(s.cardRoom, s.owner)]);
    await waitFor(() => a.text.length > 0 && b.text.length > 0);
    expect(a.text).toBe('Existing **text**');
    expect(b.text).toBe('Existing **text**');
    // A third client arriving later still sees one copy.
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.text.length > 0);
    expect(c.text).toBe('Existing **text**');
  });

  it('does not seed again after a restart of the room', async () => {
    const s = await setup('Seed');
    const first = await open(s.cardRoom, s.owner);
    await waitFor(() => first.text === 'Seed');
    first.ws.close();
    await first.closed;
    await waitFor(async () => (await prisma.yDocumentUpdate.count()) === 0);
    const second = await open(s.cardRoom, s.owner);
    await waitFor(() => second.text.length > 0);
    await new Promise((r) => setTimeout(r, 100));
    expect(second.text).toBe('Seed');
  });

  it('starts empty for a card without a description', async () => {
    const s = await setup();
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.doc.getMap('meta').get('seeded') === true);
    expect(c.text).toBe('');
  });
});

describe('projection into Card.description', () => {
  it('writes the text to the card within 2 s and REST reads are current', async () => {
    const s = await setup('Start');
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.text === 'Start');
    c.append(' and more');
    await waitFor(async () => (await s.description$()) === 'Start and more', 2000);
  });

  it('writes the text when the last client leaves before the debounce ended', async () => {
    const s = await setup('A');
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.text === 'A');
    c.append('B');
    await new Promise((r) => setTimeout(r, 30));
    c.ws.close();
    await c.closed;
    await waitFor(async () => (await s.description$()) === 'AB', 2000);
  });

  it('coalesces the activity events of one person and stores lengths, never the text', async () => {
    const s = await setup('abc');
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.text === 'abc');
    c.append('def');
    await waitFor(async () => (await s.description$()) === 'abcdef', 2000);
    c.append('ghi secret');
    await waitFor(async () => (await s.description$()) === 'abcdefghi secret', 2000);
    const events = await prisma.activityEvent.findMany({
      where: { cardId: s.card.id, type: 'description_changed' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toEqual({ from: 3, to: 16 });
    expect(events[0]?.actorId).toBe(s.owner.user.id);
    expect(JSON.stringify(events[0]?.data)).not.toContain('secret');
  });

  it('does not touch the card version', async () => {
    const s = await setup('v');
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.text === 'v');
    c.append('2');
    await waitFor(async () => (await s.description$()) === 'v2', 2000);
    const row = await prisma.card.findUniqueOrThrow({ where: { id: s.card.id } });
    expect(row.version).toBe(1);
  });

  it('cuts the projected text at the 20,000 character limit', async () => {
    const s = await setup();
    const c = await open(s.cardRoom, s.owner);
    await waitFor(() => c.doc.getMap('meta').get('seeded') === true);
    c.append('x'.repeat(20_050));
    await waitFor(async () => (await s.description$()).length === 20_000, 2500);
  });
});
