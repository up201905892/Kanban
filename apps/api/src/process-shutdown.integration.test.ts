import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { WebSocket } from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  DESCRIPTION_TEXT_NAME,
  WS_MESSAGE,
  boardResponseSchema,
  cardResponseSchema,
  projectResponseSchema,
  workspaceResponseSchema,
} from '@kanban/shared';
import { buildApp } from './app.js';
import { createPrismaClient } from './db.js';
import { createPrismaDocumentStore } from './modules/realtime/persistence.js';
import { TEST_ORIGIN, createUserAndLogin } from './test-utils/auth.js';
import { resetDatabase } from './test-utils/reset-database.js';

/**
 * KB-031: real signal delivery. KB-017 and KB-019 only call `gracefulShutdown` directly; here the
 * built server runs as a child process (`node dist/server.js`, no shell in between) and receives
 * a real SIGTERM, as Railway sends on every redeploy. Needs `pnpm build` first.
 */
const SERVER = fileURLToPath(new URL('../dist/server.js', import.meta.url));
const prisma = createPrismaClient(process.env['DATABASE_URL'] ?? '');
let helper: FastifyInstance;
let child: ChildProcess | undefined;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  if (!existsSync(SERVER)) {
    throw new Error(`${SERVER} not found: run \`pnpm build\` before \`pnpm test\``);
  }
  helper = buildApp({ prisma, webOrigin: TEST_ORIGIN });
  await helper.ready();
  await resetDatabase(prisma);
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.terminate();
  child?.kill('SIGKILL');
  child = undefined;
});
afterAll(async () => {
  await helper.close();
  await prisma.$disconnect();
});

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });

const waitFor = async (check: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('condition not met in time');
};

function startServer(port: number): { output: () => string; exit: Promise<number | null> } {
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      HOST: '127.0.0.1',
      WEB_ORIGIN: TEST_ORIGIN,
      DATABASE_URL: process.env['DATABASE_URL'] ?? '',
      SESSION_SECRET: process.env['SESSION_SECRET'] ?? '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString()));
  const exit = new Promise<number | null>((resolve) =>
    child?.once('exit', (code) => resolve(code)),
  );
  return { output: () => out, exit };
}

function connect(port: number, room: string, cookie: string) {
  const doc = new Y.Doc();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${room}`, {
    headers: { origin: TEST_ORIGIN, cookie },
  });
  sockets.push(ws);
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  const send = (message: Uint8Array) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
  };
  ws.on('message', (raw: Buffer) => {
    const decoder = decoding.createDecoder(new Uint8Array(raw));
    if (decoding.readVarUint(decoder) !== WS_MESSAGE.sync) return;
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, WS_MESSAGE.sync);
    syncProtocol.readSyncMessage(decoder, reply, doc, ws);
    if (encoding.length(reply) > 1) send(encoding.toUint8Array(reply));
  });
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === ws) return;
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, WS_MESSAGE.sync);
    syncProtocol.writeUpdate(e, update);
    send(encoding.toUint8Array(e));
  });
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, WS_MESSAGE.sync);
      syncProtocol.writeSyncStep1(e, doc);
      send(encoding.toUint8Array(e));
      resolve();
    });
    ws.once('error', reject);
  });
  return { doc, ws, closed, opened, text: () => doc.getText(DESCRIPTION_TEXT_NAME).toString() };
}

describe('SIGTERM on the built server (process level)', () => {
  it('flushes the pending edit, closes sockets with 1012 and exits 0', async () => {
    const owner = await createUserAndLogin(helper, { name: 'Olivia' });
    const call = (method: 'GET' | 'POST', url: string, body?: object) =>
      helper.inject({ method, url, headers: owner.headers, ...(body ? { payload: body } : {}) });
    const workspace = workspaceResponseSchema.parse(
      (await call('POST', '/api/workspaces', { name: 'Acme' })).json(),
    ).workspace;
    const project = projectResponseSchema.parse(
      (
        await call('POST', `/api/workspaces/${workspace.id}/projects`, { name: 'P', key: 'KB' })
      ).json(),
    ).project;
    const board = boardResponseSchema.parse(
      (await call('GET', `/api/projects/${project.id}/board`)).json(),
    );
    const column = board.columns[0];
    if (!column) throw new Error('board has no column');
    const card = cardResponseSchema.parse(
      (await call('POST', `/api/columns/${column.id}/cards`, { title: 'A card' })).json(),
    ).card;
    const room = `card:${card.id}:description`;

    const port = await freePort();
    const server = startServer(port);
    await waitFor(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${port}/health/ready`)).ok;
      } catch {
        return false;
      }
    });

    const editor = connect(port, room, owner.cookie);
    const observer = connect(port, room, owner.cookie);
    await Promise.all([editor.opened, observer.opened]);
    await waitFor(() => editor.ws.readyState === WebSocket.OPEN);
    const edit = 'edited right before the redeploy';
    editor.doc.getText(DESCRIPTION_TEXT_NAME).insert(0, edit);
    // The observer receiving it proves the server holds the edit, still inside the 500 ms batch
    // window (the store is written when the window ends or on shutdown).
    await waitFor(() => observer.text() === edit);

    expect(child?.kill('SIGTERM')).toBe(true);
    const [code, editorClose, observerClose] = await Promise.all([
      server.exit,
      editor.closed,
      observer.closed,
    ]);

    expect(code, server.output()).toBe(0);
    expect(editorClose).toBe(1012);
    expect(observerClose).toBe(1012);

    // The last client leaving compacts the appended updates into the snapshot (KB-017), so the
    // edit is in the document tables as a snapshot plus any remaining updates.
    const { snapshot, updates } = await createPrismaDocumentStore(prisma).loadDocument(room);
    expect(snapshot !== null || updates.length > 0).toBe(true);
    const rebuilt = new Y.Doc();
    if (snapshot) Y.applyUpdate(rebuilt, snapshot);
    for (const u of updates) Y.applyUpdate(rebuilt, u);
    expect(rebuilt.getText(DESCRIPTION_TEXT_NAME).toString()).toBe(edit);
    const row = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(row.description).toBe(edit);
  }, 30_000);
});
