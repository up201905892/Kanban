import * as Y from 'yjs';
import { roomName, type RoomRef } from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import type { RoomPersistence } from './rooms.js';

/** Where the bytes live. The PostgreSQL implementation is below; tests use an in-memory fake. */
export interface DocumentStore {
  /** The snapshot (null when the document was never stored) and the updates appended since. */
  loadDocument(name: string): Promise<{ snapshot: Uint8Array | null; updates: Uint8Array[] }>;
  /** Appends one update and returns how many updates the document has since its last compaction. */
  appendUpdate(name: string, update: Uint8Array): Promise<number>;
  /**
   * Merges the snapshot and the stored updates into a new snapshot and deletes exactly the
   * updates it merged. Returns the snapshot size in bytes.
   */
  compact(name: string): Promise<number>;
}

export interface PersistenceLogger {
  error(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface PersistenceOptions {
  /** Longest time an update waits in memory before it is written (R7). */
  batchMs?: number;
  /** Updates since the last snapshot that trigger a compaction. */
  compactAfter?: number;
  /** Snapshot size above which a warning is logged. */
  warnBytes?: number;
  log?: PersistenceLogger;
  /** First retry delay after a failed write (doubles up to `retryMaxMs`). */
  retryInitialMs?: number;
  retryMaxMs?: number;
}

export const DEFAULT_BATCH_MS = 500;
export const DEFAULT_COMPACT_AFTER = 100;
export const DEFAULT_WARN_BYTES = 5 * 1024 * 1024;

/** The origin used for updates read from the database, so they are not written back. */
const FROM_STORE = Symbol('from-store');

interface DocState {
  doc: Y.Doc;
  pending: Uint8Array[];
  timer: NodeJS.Timeout | null;
  /** Serialises writes for this document so they stay in order and never overlap. */
  chain: Promise<void>;
  /** Failed write attempts in a row; drives the backoff and the log. Reset by a success. */
  failures: number;
  onUpdate: (update: Uint8Array, origin: unknown) => void;
}

export const RETRY_INITIAL_MS = 1000;
export const RETRY_MAX_MS = 30_000;

/** 1 s, 2 s, 4 s ... capped at 30 s, for the n-th failure in a row (n starts at 1). */
export const backoffMs = (
  failures: number,
  initial = RETRY_INITIAL_MS,
  max = RETRY_MAX_MS,
): number => Math.min(max, initial * 2 ** Math.max(0, failures - 1));

const noopLog: PersistenceLogger = { error: () => {}, warn: () => {} };

/** Only card rooms hold a document that clients write; board rooms are awareness and events only. */
const isPersisted = (ref: RoomRef): boolean => ref.type === 'card-description';

export interface YjsPersistence extends RoomPersistence {
  /** Writes every pending batch now (graceful shutdown). */
  flush(): Promise<void>;
}

export function createYjsPersistence(
  store: DocumentStore,
  options: PersistenceOptions = {},
): YjsPersistence {
  const batchMs = options.batchMs ?? DEFAULT_BATCH_MS;
  const compactAfter = options.compactAfter ?? DEFAULT_COMPACT_AFTER;
  const warnBytes = options.warnBytes ?? DEFAULT_WARN_BYTES;
  const log = options.log ?? noopLog;
  const retryInitialMs = options.retryInitialMs ?? RETRY_INITIAL_MS;
  const retryMaxMs = options.retryMaxMs ?? RETRY_MAX_MS;
  const states = new Map<string, DocState>();

  const compact = async (name: string): Promise<void> => {
    const bytes = await store.compact(name);
    if (bytes > warnBytes) {
      log.warn(
        { doc: name, bytes },
        'collaborative document is larger than the size warning limit',
      );
    }
  };

  /** Compaction only tidies the rows: a failure is logged and the next load merges them as usual. */
  const compactSafely = async (name: string): Promise<void> => {
    try {
      await compact(name);
    } catch (err) {
      log.error({ err, doc: name }, 'could not compact collaborative document');
    }
  };

  /** Queues the write of everything pending. Returns the promise of the whole chain. */
  const flushState = (name: string, state: DocState): Promise<void> => {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    const batch = state.pending.splice(0);
    if (batch.length > 0) {
      const merged = batch.length === 1 ? (batch[0] as Uint8Array) : Y.mergeUpdates(batch);
      state.chain = state.chain
        .catch(() => {})
        .then(async () => {
          let count: number;
          try {
            count = await store.appendUpdate(name, merged);
          } catch (err) {
            state.failures += 1;
            log.error(
              { err, doc: name, attempt: state.failures },
              'could not persist collaborative document updates',
            );
            // Keep the edits for the next attempt; they are still in the live document too.
            state.pending.unshift(merged);
            schedule(name, state, backoffMs(state.failures, retryInitialMs, retryMaxMs));
            throw err;
          }
          state.failures = 0;
          // The rows are written: a failed compaction must not keep the batch (it would be written twice).
          if (count >= compactAfter) await compactSafely(name);
        });
      // The caller of a timer flush has nobody to throw to; explicit callers await `chain`.
      state.chain.catch(() => {});
    }
    return state.chain;
  };

  const schedule = (name: string, state: DocState, ms: number): void => {
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      void flushState(name, state).catch(() => {});
    }, ms);
    state.timer.unref();
  };

  return {
    async load(ref, doc) {
      if (!isPersisted(ref)) return;
      const name = roomName(ref);
      const { snapshot, updates } = await store.loadDocument(name);
      doc.transact(() => {
        if (snapshot && snapshot.length > 0) Y.applyUpdate(doc, snapshot, FROM_STORE);
        for (const update of updates) Y.applyUpdate(doc, update, FROM_STORE);
      }, FROM_STORE);

      const state: DocState = {
        doc,
        pending: [],
        timer: null,
        chain: Promise.resolve(),
        failures: 0,
        onUpdate: (update, origin) => {
          if (origin === FROM_STORE) return;
          state.pending.push(update);
          schedule(name, state, batchMs);
        },
      };
      doc.on('update', state.onUpdate);
      doc.on('destroy', () => {
        if (state.timer) clearTimeout(state.timer);
        if (states.get(name) === state) states.delete(name);
      });
      states.set(name, state);
    },

    async store(ref, doc) {
      if (!isPersisted(ref)) return;
      const name = roomName(ref);
      const state = states.get(name);
      if (!state || state.doc !== doc) return;
      try {
        await flushState(name, state);
      } catch (err) {
        // The caller (the room manager) owns the retry of an unload: no second retry timer here.
        // `resume` restarts the batching path if a client joins meanwhile.
        if (state.timer) clearTimeout(state.timer);
        state.timer = null;
        throw err;
      }
      // Compaction on unload; it runs after the last append of this document.
      state.chain = state.chain.catch(() => {}).then(() => compactSafely(name));
      await state.chain;
    },

    resume(ref, doc) {
      if (!isPersisted(ref)) return;
      const name = roomName(ref);
      const state = states.get(name);
      if (state && state.doc === doc && state.pending.length > 0) {
        schedule(name, state, backoffMs(state.failures, retryInitialMs, retryMaxMs));
      }
    },

    async flush() {
      const all = [...states.entries()];
      await Promise.all(
        all.map(async ([name, state]) => {
          await flushState(name, state);
        }),
      );
    },
  };
}

/** PostgreSQL implementation (tables `y_documents` and `y_document_updates`). */
export function createPrismaDocumentStore(prisma: PrismaClient): DocumentStore {
  return {
    async loadDocument(name) {
      // One snapshot-isolated read: a compaction committing between the two queries must not
      // show the new snapshot without its updates, or the old snapshot without them.
      const [doc, updates] = await prisma.$transaction(
        [
          prisma.yDocument.findUnique({ where: { name } }),
          prisma.yDocumentUpdate.findMany({ where: { docName: name }, orderBy: { id: 'asc' } }),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
      return {
        snapshot: doc ? new Uint8Array(doc.snapshot) : null,
        updates: updates.map((u) => new Uint8Array(u.update)),
      };
    },

    async appendUpdate(name, update) {
      await prisma.yDocument.upsert({
        where: { name },
        update: {},
        create: { name, snapshot: Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())) },
      });
      await prisma.yDocumentUpdate.create({ data: { docName: name, update: Buffer.from(update) } });
      return prisma.yDocumentUpdate.count({ where: { docName: name } });
    },

    async compact(name) {
      return prisma.$transaction(async (tx) => {
        // Serialises compactions of one document. FOR NO KEY UPDATE does not block the
        // foreign-key check of a concurrent append, so incoming updates are never delayed.
        const rows = await tx.$queryRaw<{ name: string }[]>`
          SELECT name FROM y_documents WHERE name = ${name} FOR NO KEY UPDATE`;
        if (rows.length === 0) return 0;
        const doc = await tx.yDocument.findUniqueOrThrow({ where: { name } });
        // Only the updates read here are merged and deleted: one that is appended while this
        // transaction runs has a higher id, is not in the list and stays for the next load.
        const updates = await tx.yDocumentUpdate.findMany({
          where: { docName: name },
          orderBy: { id: 'asc' },
        });
        if (updates.length === 0) return doc.snapshot.length;
        const merged = Y.mergeUpdates([
          new Uint8Array(doc.snapshot),
          ...updates.map((u) => new Uint8Array(u.update)),
        ]);
        await tx.yDocument.update({ where: { name }, data: { snapshot: Buffer.from(merged) } });
        await tx.yDocumentUpdate.deleteMany({ where: { id: { in: updates.map((u) => u.id) } } });
        return merged.length;
      });
    },
  };
}
