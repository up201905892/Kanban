import * as Y from 'yjs';
import {
  CARD_DESCRIPTION_MAX_LENGTH,
  DESCRIPTION_ACTIVITY_WINDOW_MS,
  DESCRIPTION_TEXT_NAME,
  roomName,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import type { Connection, RoomPersistence } from './rooms.js';

/** Name of the `Y.Map` that holds the "seeded" marker next to the text. */
export const META_MAP_NAME = 'meta';
const SEEDED_KEY = 'seeded';
/** Origin of the seeding update, so nothing mistakes it for something a person typed. */
const SEED = Symbol('seed');

export const DEFAULT_PROJECTION_DEBOUNCE_MS = 1000;
const RETRY_MS = 2000;

export interface PreviousDescriptionEvent {
  from: number;
  to: number;
  at: Date;
}

export type DescriptionActivityPlan =
  | { action: 'create'; data: { from: number; to: number } }
  | { action: 'update'; data: { from: number; to: number } };

/**
 * The coalescing rule for `description_changed` (G5): the same person changing the description
 * again within the window extends their last event (keeping its `from`) instead of adding one.
 * `previous` is that person's latest `description_changed` event for the card, if any.
 */
export function planDescriptionActivity(
  previous: PreviousDescriptionEvent | null,
  change: { from: number; to: number },
  now: Date,
  windowMs: number = DESCRIPTION_ACTIVITY_WINDOW_MS,
): DescriptionActivityPlan {
  if (previous && now.getTime() - previous.at.getTime() <= windowMs) {
    return { action: 'update', data: { from: previous.from, to: change.to } };
  }
  return { action: 'create', data: change };
}

export interface ProjectionLogger {
  error(obj: object, msg: string): void;
}

export interface ProjectionOptions {
  /** Quiet time after the last change before `Card.description` is written (must stay under 2 s). */
  debounceMs?: number;
  log?: ProjectionLogger;
  now?: () => Date;
}

interface DescriptionState {
  doc: Y.Doc;
  cardId: string;
  timer: NodeJS.Timeout | null;
  /** The person behind the changes made since the last projection. */
  actorId: string | null;
  dirty: boolean;
  chain: Promise<void>;
}

const userIdOf = (origin: unknown): string | null =>
  origin && typeof origin === 'object' && 'userId' in origin ? (origin as Connection).userId : null;

/**
 * Wraps the document persistence of KB-017 with what the card description needs (KB-019):
 *  - seeding: a document that was never seeded gets its `Y.Text` from `Card.description`, once, inside
 *    the room load (the room manager loads each room once, so two simultaneous clients share it);
 *  - projection: the text is written back to `Card.description` shortly after the last change and
 *    when the room unloads, and the change is recorded as a coalesced `description_changed` event.
 */
export function createDescriptionPersistence(
  prisma: PrismaClient,
  inner: RoomPersistence,
  options: ProjectionOptions = {},
): RoomPersistence {
  const debounceMs = options.debounceMs ?? DEFAULT_PROJECTION_DEBOUNCE_MS;
  const now = options.now ?? (() => new Date());
  const log = options.log;
  const states = new Map<string, DescriptionState>();

  const projectNow = async (state: DescriptionState): Promise<void> => {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (!state.dirty) return state.chain;
    state.dirty = false;
    const actorId = state.actorId;
    state.actorId = null;
    // Everything beyond the limit is cut (the editor stops input earlier; this is the backstop).
    const text = state.doc
      .getText(DESCRIPTION_TEXT_NAME)
      .toString()
      .slice(0, CARD_DESCRIPTION_MAX_LENGTH);
    state.chain = state.chain
      .catch(() => {})
      .then(async () => {
        try {
          await prisma.$transaction(async (tx) => {
            const card = await tx.card.findFirst({
              where: { id: state.cardId, deletedAt: null },
              select: { description: true },
            });
            if (!card || card.description === text) return;
            await tx.card.update({ where: { id: state.cardId }, data: { description: text } });
            if (!actorId) return;
            const previous = await tx.activityEvent.findFirst({
              where: { cardId: state.cardId, actorId, type: 'description_changed' },
              orderBy: { createdAt: 'desc' },
            });
            const data = previous?.data as { from?: number; to?: number } | null | undefined;
            const plan = planDescriptionActivity(
              previous && typeof data?.from === 'number' && typeof data.to === 'number'
                ? { from: data.from, to: data.to, at: previous.createdAt }
                : null,
              { from: card.description.length, to: text.length },
              now(),
            );
            if (plan.action === 'update' && previous) {
              await tx.activityEvent.update({
                where: { id: previous.id },
                data: { data: plan.data },
              });
            } else {
              await tx.activityEvent.create({
                data: {
                  cardId: state.cardId,
                  actorId,
                  type: 'description_changed',
                  data: plan.data,
                },
              });
            }
          });
        } catch (err) {
          log?.error({ err, card: state.cardId }, 'could not project the card description');
          state.dirty = true;
          state.actorId ??= actorId;
          schedule(state, RETRY_MS);
          throw err;
        }
      });
    state.chain.catch(() => {});
    return state.chain;
  };

  const schedule = (state: DescriptionState, ms: number): void => {
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      void projectNow(state).catch(() => {});
    }, ms);
    state.timer.unref();
  };

  return {
    async load(ref, doc) {
      await inner.load(ref, doc);
      if (ref.type !== 'card-description') return;
      const text = doc.getText(DESCRIPTION_TEXT_NAME);
      const meta = doc.getMap<boolean>(META_MAP_NAME);
      if (meta.get(SEEDED_KEY) !== true) {
        const card = await prisma.card.findFirst({
          where: { id: ref.id, deletedAt: null },
          select: { description: true },
        });
        if (card) {
          doc.transact(() => {
            if (card.description.length > 0) text.insert(0, card.description);
            meta.set(SEEDED_KEY, true);
          }, SEED);
        }
      }
      const name = roomName(ref);
      const state: DescriptionState = {
        doc,
        cardId: ref.id,
        timer: null,
        actorId: null,
        dirty: false,
        chain: Promise.resolve(),
      };
      doc.on('update', (_update: Uint8Array, origin: unknown) => {
        if (origin === SEED) return;
        // Only changes to the text matter (the marker never changes after seeding).
        state.dirty = true;
        state.actorId = userIdOf(origin) ?? state.actorId;
        schedule(state, debounceMs);
      });
      doc.on('destroy', () => {
        if (state.timer) clearTimeout(state.timer);
        if (states.get(name) === state) states.delete(name);
      });
      states.set(name, state);
    },

    async store(ref, doc) {
      const state = states.get(roomName(ref));
      if (state && state.doc === doc) {
        try {
          await projectNow(state);
        } catch {
          // Logged; the document itself is still stored below and the projection is retried.
        }
      }
      await inner.store(ref, doc);
    },

    async flush() {
      await Promise.all(
        [...states.values()].map(async (state) => {
          try {
            await projectNow(state);
          } catch {
            // Logged above.
          }
        }),
      );
      await inner.flush?.();
    },
  };
}
