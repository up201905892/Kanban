import { EventEmitter } from 'node:events';
import type { Role } from '@kanban/shared';

/** A membership changed after commit: `role` is the new role, or `null` when the user left or was removed. */
export interface MembershipChange {
  workspaceId: string;
  userId: string;
  role: Role | null;
}

/**
 * In-process bus (single-instance constraint, ADR 0004). Services publish after their transaction
 * commits; the real-time layer subscribes to close or re-authorize open sockets. Moving to several
 * instances means replacing this with Redis pub/sub behind the same two functions.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);
const EVENT = 'membership-changed';

export function publishMembershipChange(change: MembershipChange): void {
  bus.emit(EVENT, change);
}

/** Returns an unsubscribe function. */
export function onMembershipChange(listener: (change: MembershipChange) => void): () => void {
  bus.on(EVENT, listener);
  return () => {
    bus.off(EVENT, listener);
  };
}
