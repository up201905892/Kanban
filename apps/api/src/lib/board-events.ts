import { EventEmitter } from 'node:events';
import {
  CLIENT_MUTATION_HEADER,
  clientMutationIdSchema,
  type BoardEvent,
  type CardSummary,
  type Column,
} from '@kanban/shared';

/** Who made a change and which client request it came from (the echo filter of that client). */
export interface MutationMeta {
  clientMutationId?: string | undefined;
}

/** The echo-filter id of a request: a valid `X-Client-Mutation-Id` header, otherwise none. */
export function mutationMetaOf(req: { headers: Record<string, unknown> }): MutationMeta {
  const parsed = clientMutationIdSchema.safeParse(req.headers[CLIENT_MUTATION_HEADER]);
  return parsed.success ? { clientMutationId: parsed.data } : {};
}

/**
 * In-process bus (single-instance constraint, ADR 0004), like `membership-events.ts`. Services
 * build their events inside the transaction but publish them only after it commits, so a rolled
 * back change never reaches anyone. The real-time layer subscribes and pushes each event to the
 * `board:<id>` room. Several instances would replace this with Redis pub/sub.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);
const EVENT = 'board-event';

/** Publishes in order. Call only after the transaction that produced the events committed. */
export function publishBoardEvents(events: readonly BoardEvent[]): void {
  for (const event of events) bus.emit(EVENT, event);
}

/** Returns an unsubscribe function. */
export function onBoardEvent(listener: (event: BoardEvent) => void): () => void {
  bus.on(EVENT, listener);
  return () => {
    bus.off(EVENT, listener);
  };
}

const common = (boardId: string, actorId: string, meta: MutationMeta) => ({
  boardId,
  actorId,
  ...(meta.clientMutationId && { clientMutationId: meta.clientMutationId }),
  at: new Date().toISOString(),
});

export function cardEvent(
  type: 'card_created' | 'card_updated' | 'card_moved',
  boardId: string,
  card: CardSummary,
  actorId: string,
  meta: MutationMeta,
): BoardEvent {
  return { type, ...common(boardId, actorId, meta), entity: card, version: card.version };
}

export function cardDeletedEvent(
  boardId: string,
  card: { id: string; columnId: string; number: number; title: string; version: number },
  actorId: string,
  meta: MutationMeta,
): BoardEvent {
  return {
    type: 'card_deleted',
    ...common(boardId, actorId, meta),
    entity: { id: card.id, columnId: card.columnId, number: card.number, title: card.title },
    version: card.version,
  };
}

export function columnEvent(
  type: 'column_created' | 'column_updated',
  column: Column,
  actorId: string,
  meta: MutationMeta,
): BoardEvent {
  return { type, ...common(column.boardId, actorId, meta), entity: column, version: null };
}

export function columnDeletedEvent(
  boardId: string,
  column: { id: string; name: string },
  actorId: string,
  meta: MutationMeta,
): BoardEvent {
  return {
    type: 'column_deleted',
    ...common(boardId, actorId, meta),
    entity: { id: column.id, name: column.name },
    version: null,
  };
}
