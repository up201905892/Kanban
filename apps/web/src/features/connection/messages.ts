import { onlineManager } from '@tanstack/react-query';
import { isApiError } from '../../lib/api';
import type { ConnectionStatus } from '../../lib/realtime/connection';

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

/** True while the browser has no network: a change made now waits (paused) and replays later. */
export const isOffline = (): boolean => !onlineManager.isOnline();

/** "1 change pending" / "3 changes pending". */
export const pendingText = (count: number): string =>
  `${count} ${count === 1 ? 'change' : 'changes'} pending`;

/** The message for a session that expired while changes were still waiting. */
export function sessionExpiredMessage(pending: number): string {
  if (pending <= 0) return 'Your session expired; please log in again';
  return `Your session expired; ${pending} pending ${
    pending === 1 ? 'change was' : 'changes were'
  } not saved`;
}

/**
 * What to tell the person when a change that waited offline is refused on replay. A target that no
 * longer exists (404) becomes "Card KB-12 was deleted while you were offline"; anything else (and
 * any failure of a change that was sent online) falls back to `fallback`.
 */
export function replayFailureMessage(
  error: unknown,
  options: { queuedOffline: boolean; reference: string; fallback: string },
): string {
  if (options.queuedOffline && isApiError(error) && error.status === 404) {
    return `${options.reference} was deleted while you were offline`;
  }
  return options.fallback;
}
