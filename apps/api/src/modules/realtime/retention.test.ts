import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESCRIPTION_TEXT_NAME, roomName, type RoomRef } from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { createDescriptionPersistence } from './description.js';
import { backoffMs, createYjsPersistence, type DocumentStore } from './persistence.js';
import { RoomManager, type Connection } from './rooms.js';

const CARD: RoomRef = { type: 'card-description', id: '0192f3a0-0000-7000-8000-000000000001' };
const NAME = roomName(CARD);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function conn(): Connection {
  return {
    socket: { readyState: 1, send: () => {}, close: () => {} },
    userId: 'u1',
    workspaceId: 'w1',
    name: 'Ana',
    role: 'owner',
    awarenessIds: new Set(),
    room: null,
  };
}

/** In-memory store whose append (and compaction) can be made to fail on demand. */
function fakeStore() {
  const appended: Uint8Array[] = [];
  const calls: string[] = [];
  const store: DocumentStore & {
    appended: Uint8Array[];
    calls: string[];
    failAppends: number;
    failCompact: boolean;
  } = {
    appended,
    calls,
    failAppends: 0,
    failCompact: false,
    loadDocument: async () => ({ snapshot: null, updates: [] }),
    appendUpdate: async (_n, update) => {
      calls.push('append');
      if (store.failAppends > 0) {
        store.failAppends -= 1;
        throw new Error('database down');
      }
      appended.push(update);
      return appended.length;
    },
    compact: async () => {
      calls.push('compact');
      if (store.failCompact) throw new Error('compaction failed');
      return 10;
    },
  };
  return store;
}

const logger = () => ({ error: vi.fn(), warn: vi.fn() });

async function joinAndType(rooms: RoomManager, text: string) {
  const c = conn();
  await rooms.join(CARD, c);
  const doc = rooms.doc(NAME) as Y.Doc;
  doc.getText(DESCRIPTION_TEXT_NAME).insert(0, text);
  return { c, doc };
}

describe('backoffMs', () => {
  it('doubles from 1 s and caps at 30 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => backoffMs(n))).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });
});

describe('a failing final store keeps the room (KB-037)', () => {
  it('retains the room, retries with backoff and drops it after the third attempt', async () => {
    const store = fakeStore();
    const log = logger();
    const persistence = createYjsPersistence(store, { log });
    const rooms = new RoomManager(persistence, { log });
    const { c, doc } = await joinAndType(rooms, 'unsaved');
    store.failAppends = 2;

    await rooms.leave(c); // attempt 1 fails
    expect(rooms.retainedRooms()).toEqual([NAME]);
    expect(rooms.has(NAME)).toBe(true);
    expect(rooms.doc(NAME)).toBe(doc);
    expect(doc.getText(DESCRIPTION_TEXT_NAME).toString()).toBe('unsaved');

    await vi.advanceTimersByTimeAsync(999);
    expect(store.calls).toEqual(['append']);
    await vi.advanceTimersByTimeAsync(1); // 1 s: attempt 2 fails
    expect(store.calls).toEqual(['append', 'append']);
    expect(rooms.retainedRooms()).toEqual([NAME]);
    await vi.advanceTimersByTimeAsync(1999);
    expect(store.calls).toEqual(['append', 'append']);
    await vi.advanceTimersByTimeAsync(1); // 2 s later: attempt 3 writes
    expect(store.calls).toEqual(['append', 'append', 'append', 'compact']);
    const check = new Y.Doc();
    Y.applyUpdate(check, store.appended[0] as Uint8Array);
    expect(check.getText(DESCRIPTION_TEXT_NAME).toString()).toBe('unsaved');
    expect(rooms.has(NAME)).toBe(false);
    expect(rooms.retainedRooms()).toEqual([]);

    const attempts = log.error.mock.calls.map((call) => call[0]);
    expect(attempts).toMatchObject([
      { doc: NAME, attempt: 1 },
      { doc: NAME, attempt: 2 },
    ]);
    expect(JSON.stringify(attempts)).not.toContain('unsaved');
  });

  it('caps the retry delay at 30 s', async () => {
    const store = fakeStore();
    const persistence = createYjsPersistence(store);
    const rooms = new RoomManager(persistence);
    const { c } = await joinAndType(rooms, 'x');
    store.failAppends = 1000;
    await rooms.leave(c);
    // Delays: 1, 2, 4, 8, 16 s, then 30 s every time.
    for (const delay of [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]) {
      const before = store.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(store.calls.length).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(store.calls.length).toBe(before + 1);
    }
    expect(rooms.retainedRooms()).toEqual([NAME]);
  });

  it('gives a client that joins the in-memory document and goes back to normal batching', async () => {
    const store = fakeStore();
    const persistence = createYjsPersistence(store);
    const rooms = new RoomManager(persistence);
    const first = await joinAndType(rooms, 'unsaved');
    store.failAppends = 1;
    await rooms.leave(first.c);
    expect(rooms.retainedRooms()).toEqual([NAME]);

    const second = conn();
    await rooms.join(CARD, second);
    expect(rooms.retainedRooms()).toEqual([]);
    expect(rooms.doc(NAME)).toBe(first.doc);
    expect(first.doc.getText(DESCRIPTION_TEXT_NAME).toString()).toBe('unsaved');

    // The pending batch is written by the batching path, the room stays while the client is in.
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.appended).toHaveLength(1);
    expect(rooms.has(NAME)).toBe(true);

    await rooms.leave(second);
    expect(rooms.has(NAME)).toBe(false);
    expect(store.calls.at(-1)).toBe('compact');
  });

  it('does not keep the room when only the compaction fails', async () => {
    const store = fakeStore();
    store.failCompact = true;
    const log = logger();
    const rooms = new RoomManager(createYjsPersistence(store, { log }), { log });
    const { c } = await joinAndType(rooms, 'saved');
    await rooms.leave(c);
    expect(store.appended).toHaveLength(1);
    expect(rooms.has(NAME)).toBe(false);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ doc: NAME }),
      'could not compact collaborative document',
    );
  });

  it('logs the retention warning once after 5 minutes', async () => {
    const store = fakeStore();
    store.failAppends = 1_000_000;
    const log = logger();
    const rooms = new RoomManager(createYjsPersistence(store, { log }), { log });
    const { c } = await joinAndType(rooms, 'x');
    await rooms.leave(c);
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(log.warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      { doc: NAME },
      'collaborative document retained after failed stores',
    );
  });

  it('keeps no timer that could hold the process open', async () => {
    const store = fakeStore();
    store.failAppends = 1_000_000;
    const rooms = new RoomManager(createYjsPersistence(store));
    const { c } = await joinAndType(rooms, 'x');
    await rooms.leave(c);
    // Fake timers count the pending ones; every one of them was created with unref().
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    const unref = vi.spyOn(globalThis, 'setTimeout');
    await vi.advanceTimersByTimeAsync(1000);
    for (const result of unref.mock.results) {
      expect(typeof (result.value as { hasRef?: () => boolean }).hasRef).toBe('function');
      expect((result.value as { hasRef: () => boolean }).hasRef()).toBe(false);
    }
  });
});

describe('shutdown with retained rooms (KB-037)', () => {
  it('reports the documents that could not be saved before the deadline', async () => {
    const store = fakeStore();
    store.failAppends = 1_000_000;
    const rooms = new RoomManager(createYjsPersistence(store), { shutdownDeadlineMs: 5000 });
    await joinAndType(rooms, 'lost');
    const result = rooms.shutdown();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toEqual({ unsaved: [NAME] });
    expect(rooms.size).toBe(0);
    // Calling again returns the same result without waiting again.
    expect(await rooms.shutdown()).toEqual({ unsaved: [NAME] });
  });

  it('succeeds when the store recovers inside the deadline', async () => {
    const store = fakeStore();
    store.failAppends = 2;
    const rooms = new RoomManager(createYjsPersistence(store), { shutdownDeadlineMs: 10_000 });
    await joinAndType(rooms, 'kept');
    const result = rooms.shutdown();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toEqual({ unsaved: [] });
    expect(store.appended).toHaveLength(1);
  });
});

/** A fake Prisma that holds one card and can fail the projection transaction. */
function fakePrisma(initial: { description: string } | null) {
  const state = { card: initial, fail: 0, events: 0 };
  const tx = {
    card: {
      findFirst: async () => (state.card ? { ...state.card } : null),
      update: async ({ data }: { data: { description: string } }) => {
        if (state.card) state.card.description = data.description;
      },
    },
    activityEvent: {
      findFirst: async () => null,
      create: async () => {
        state.events += 1;
      },
      update: async () => {},
    },
  };
  const prisma = {
    $transaction: async (fn: (t: typeof tx) => Promise<void>) => {
      if (state.fail > 0) {
        state.fail -= 1;
        throw new Error('database down');
      }
      return fn(tx);
    },
    card: { findFirst: async () => (state.card ? { ...state.card } : null) },
  } as unknown as PrismaClient;
  return { state, prisma };
}

describe('description projection on unload (KB-037)', () => {
  it('retries a projection that failed on unload until Card.description equals the text', async () => {
    const { state, prisma } = fakePrisma({ description: '' });
    const log = logger();
    const persistence = createDescriptionPersistence(
      prisma,
      createYjsPersistence(fakeStore(), { log }),
      { log, debounceMs: 60_000 },
    );
    const rooms = new RoomManager(persistence, { log });
    const { c } = await joinAndType(rooms, 'projected');
    state.fail = 1;
    await rooms.leave(c);
    // The Yjs append succeeded; the projection did not: the room is kept.
    expect(rooms.retainedRooms()).toEqual([NAME]);
    expect(state.card?.description).toBe('');
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.card?.description).toBe('projected');
    expect(rooms.has(NAME)).toBe(false);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ doc: NAME, attempt: 1 }),
      'could not project the card description',
    );
  });

  it('stops retrying and drops the room when the card was deleted meanwhile', async () => {
    const { state, prisma } = fakePrisma({ description: '' });
    const persistence = createDescriptionPersistence(prisma, createYjsPersistence(fakeStore()), {
      debounceMs: 60_000,
    });
    const rooms = new RoomManager(persistence);
    const { c } = await joinAndType(rooms, 'orphan');
    state.fail = 1;
    await rooms.leave(c);
    expect(rooms.retainedRooms()).toEqual([NAME]);
    state.card = null;
    await vi.advanceTimersByTimeAsync(1000);
    expect(rooms.has(NAME)).toBe(false);
    expect(rooms.retainedRooms()).toEqual([]);
  });
});
