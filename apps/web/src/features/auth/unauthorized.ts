import type { QueryClient } from '@tanstack/react-query';
import type { DataRouter } from 'react-router';
import { currentUserKey } from './api';
import { connectionStore } from '../../lib/realtime/connection';
import { sessionExpiredMessage } from '../connection/messages';
import { loginPathFor } from './safe-next';
import { setSessionNotice } from './session-notice';

/**
 * The server says the session is gone: drop every cached answer, remember that nobody is
 * logged in and go to the login page, keeping the current path in `next`.
 */
export function handleUnauthorized(client: QueryClient, router: DataRouter): void {
  const { pathname, search, hash } = router.state.location;
  // Changes that waited for the network (KB-021) die with the session: say so, never silently.
  const waiting =
    client.getMutationCache().findAll({ status: 'pending' }).length +
    connectionStore.getSnapshot().unsyncedSources;
  if (waiting > 0) setSessionNotice(sessionExpiredMessage(waiting));
  client.clear();
  client.setQueryData(currentUserKey, null);
  if (pathname === '/login' || pathname === '/signup') return;
  void router.navigate(loginPathFor(`${pathname}${search}${hash}`), { replace: true });
}
