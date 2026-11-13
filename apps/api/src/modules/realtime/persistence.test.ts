import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomRef } from '@kanban/shared';
import { createYjsPersistence, type DocumentStore } from './persistence.js';

const CARD: RoomRef = { type: 'card-description', id: '0192f3a0-0000-7000-8000-000000000001' };
const BOARD: RoomRef = { type: 'board', id: '0192f3a0-0000-7000-8000-000000000002' };
const NAME = `card:${CARD.id}:description`;

/** In-memory store that records the calls. */
function fakeStore(initial?: { snapshot?: Uint8Array; updates?: Uint8Array[] }) {
  const appended: Uint8Array[] = [];
  let count = initial?.updates?.length ?? 0;
  const calls: string[] = [];
  const store: DocumentStore & { appended: Uint8Array[]; calls: string[]; failNext: boolean } = {
    appended,
    calls,
    failNext: false,
    loadDocument: async () => ({
      snapshot: initial?.snapshot ?? null,
      updates: initial?.updates ?? [],
    }),
    appendUpdate: async (_name, update) => {
      if (store.failNext) {
        store.failNext = false;
        throw new Error('database down');
      }
      calls.push('append');
      appended.push(update);
      count += 1;
      return count;
    },
    compact: async () => {
      calls.push('compact');
      count = 0;
      return 10;
    },
  };
  return store;
}

const type = (doc: Y.Doc, text: string) => {
  const t = doc.getText('t');
  t.insert(t.length, text);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('update batching', () => {
  it('writes the updates of a 500 ms window as one merged row', async () => {
    const store = fakeStore();
    const p = createYjsPersistence(store);
    const doc = new Y.Doc();
    await p.load(CARD, doc);

    type(doc, 'a');
    await vi.advanceTimersByTimeAsync(200);
    type(doc, 'b');
    await vi.advanceTimersByTimeAsync(200);
    type(doc, 'c');
    expect(store.appended).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(100);
    expect(store.appended).toHaveLength(1);
    const check = new Y.Doc();
    Y.applyUpdate(check, store.appended[0] as Uint8Array);
    expect(check.getText('t').toString()).toBe('abc');
  });

  it('starts a new window for an update after the flush', async () => {
    const store = fakeStore();
    const p = createYjsPersistence(store);
    const doc = new Y.Doc();
    await p.load(CARD, doc);
    type(doc, 'a');
    await vi.advanceTimersByTimeAsync(500);
    type(doc, 'b');
    await vi.advanceTimersByTimeAsync(499);
    expect(store.appended).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.appended).toHaveLength(2);
  });

  it('does not write back what it loaded', async () => {
    const source = new Y.Doc();
    type(source, 'stored');
    const store = fakeStore({ snapshot: Y.encodeStateAsUpdate(source) });
    const p = createYjsPersistence(store);
    const doc = new Y.Doc();
    await p.load(CARD, doc);
    expect(doc.getText('t').toString()).toBe('stored');
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.appended).toHaveLength(0);
  });

  it('merges the snapshot with the stored updates on load', async () => {
    const a = new Y.Doc();
    type(a, 'one');
    const snapshot = Y.encodeStateAsUpdate(a);
    const updates: Uint8Array[] = [];
    a.on('update', (u: Uint8Array) => updates.push(u));
    type(a, ' two');
    type(a, ' three');
    const p = createYjsPersistence(fakeStore({ snapshot, updates }));
    const doc = new Y.Doc();
    await p.load(CARD, doc);
    expect(doc.getText('t').toString()).toBe('one two three');
  });

  it('keeps the edits and retries after a failed write', async () => {
    const store = fakeStore();
    const error = vi.fn();
    const p = createYjsPersistence(store, { log: { error, warn: vi.fn() } });
    const doc = new Y.Doc();
    await p.load(CARD, doc);
    store.failNext = true;
    type(doc, 'x');
    await vi.advanceTimersByTimeAsync(500);
    expect(error).toHaveBeenCalledOnce();
    expect(store.appended).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.appended).toHaveLength(1);
  });

  it('does not persist board rooms', async () => {
    const store = fakeStore();
    const p = createYjsPersistence(store);
    const doc = new Y.Doc();
    await p.load(BOARD, doc);
    type(doc, 'x');
    await vi.advanceTimersByTimeAsync(1000);
    await p.store(BOARD, doc);
    expect(store.calls).toEqual([]);
  });
});

describe('compaction trigger', () => {
  it('compacts when the stored update count reaches the threshold', async () => {
    const store = fakeStore();
    const p = createYjsPersistence(store, { compactAfter: 3 });
    const doc = new Y.Doc();
    await p.load(CARD, doc);
    for (let i = 0; i < 3; i++) {
      type(doc, String(i));
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(store.calls).toEqual(['append', 'append', 'append', 'compact']);
  });

  it('does not compact below the threshold', async () => {
    const store = fakeStore();
    const p = createYjsPersistence(store, { compactAfter: 100 });
    const doc = new Y.Doc();
    await p.load(CARD, doc);
    for (let i = 0; i < 5; i++) {
      type(doc, String(i));
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(store.calls.filter((c) => c === 'compact')).toHaveLength(0);
  });

  it('flushes the pending batch and then compacts on unload', async () => {
    const store = fakeStore();
    const p = createYjsPersistence(store);
    const doc = new Y.Doc();
    await p.load(CARD, doc);
    type(doc, 'pending');
    await p.store(CARD, doc);
    expect(store.calls).toEqual(['append', 'compact']);
  });

  it('flush() writes every pending batch without compacting', async () => {
    const store = fakeStore();
    const p = createYjsPersistence(store);
    const doc = new Y.Doc();
    await p.load(CARD, doc);
    type(doc, 'pending');
    await p.flush();
    expect(store.calls).toEqual(['append']);
  });

  it('warns when a snapshot is larger than the limit', async () => {
    const store = fakeStore();
    const warn = vi.fn();
    const p = createYjsPersistence(store, { warnBytes: 5, log: { error: vi.fn(), warn } });
    const doc = new Y.Doc();
    await p.load(CARD, doc);
    await p.store(CARD, doc);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ doc: NAME, bytes: 10 });
  });
});
