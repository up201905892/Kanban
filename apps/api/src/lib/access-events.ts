import { EventEmitter } from 'node:events';
import { roomName } from '@kanban/shared';

/** A session ended in this process (logout). Expiry and CLI deletions are caught by revalidation. */
export interface SessionEnded {
  sessionId: string;
}

/** A resource was deleted and its transaction committed. Server-internal, so no shared schema. */
export type ResourceDeleted =
  | { type: 'workspace'; workspaceId: string }
  | { type: 'project'; workspaceId: string; boardId: string; cardIds: readonly string[] }
  | { type: 'card'; cardId: string };

/**
 * In-process bus (single-instance constraint, ADR 0004 section 10), next to `membership-events.ts`.
 * Services publish after their transaction commits; the real-time layer closes the affected sockets.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);
const SESSION_ENDED = 'session-ended';
const RESOURCE_DELETED = 'resource-deleted';

export function publishSessionEnded(event: SessionEnded): void {
  bus.emit(SESSION_ENDED, event);
}

/** Returns an unsubscribe function. */
export function onSessionEnded(listener: (event: SessionEnded) => void): () => void {
  bus.on(SESSION_ENDED, listener);
  return () => {
    bus.off(SESSION_ENDED, listener);
  };
}

export function publishResourceDeleted(event: ResourceDeleted): void {
  bus.emit(RESOURCE_DELETED, event);
}

/** Returns an unsubscribe function. */
export function onResourceDeleted(listener: (event: ResourceDeleted) => void): () => void {
  bus.on(RESOURCE_DELETED, listener);
  return () => {
    bus.off(RESOURCE_DELETED, listener);
  };
}

/**
 * Names of the rooms a deletion closes, when they can be named. A workspace has no list: every
 * room whose connections belong to it closes (`null`). A project closes its board room and its
 * cards' rooms; a card closes only its description room (the board room stays open).
 */
export function roomsClosedBy(event: ResourceDeleted): string[] | null {
  switch (event.type) {
    case 'workspace':
      return null;
    case 'project':
      return [
        roomName({ type: 'board', id: event.boardId }),
        ...event.cardIds.map((id) => roomName({ type: 'card-description', id })),
      ];
    case 'card':
      return [roomName({ type: 'card-description', id: event.cardId })];
  }
}
