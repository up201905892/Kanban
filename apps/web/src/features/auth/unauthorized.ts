import type { QueryClient } from '@tanstack/react-query';
import type { DataRouter } from 'react-router';
import { currentUserKey } from './api';
import { loginPathFor } from './safe-next';

/**
 * The server says the session is gone: drop every cached answer, remember that nobody is
 * logged in and go to the login page, keeping the current path in `next`.
 */
export function handleUnauthorized(client: QueryClient, router: DataRouter): void {
  const { pathname, search, hash } = router.state.location;
  client.clear();
  client.setQueryData(currentUserKey, null);
  if (pathname === '/login' || pathname === '/signup') return;
  void router.navigate(loginPathFor(`${pathname}${search}${hash}`), { replace: true });
}
