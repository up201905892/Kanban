import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isApiError } from './api-error';

const MAX_RETRIES = 2;

/** Never retry client errors (4xx); retry network and server errors a couple of times. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}

/** True for "your session is gone" answers (not for a wrong password, which is a different code). */
export function isUnauthenticated(error: unknown): boolean {
  return isApiError(error) && error.status === 401 && error.code === 'UNAUTHENTICATED';
}

export interface QueryClientOptions {
  /** Called once for any query or mutation that fails with a 401 `UNAUTHENTICATED`. */
  onUnauthorized?: (client: QueryClient) => void;
}

export function createQueryClient({ onUnauthorized }: QueryClientOptions = {}): QueryClient {
  const handle = (error: unknown, meta: Record<string, unknown> | undefined) => {
    if (onUnauthorized && !meta?.['skipUnauthorizedRedirect'] && isUnauthenticated(error)) {
      onUnauthorized(client);
    }
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => handle(error, query.meta) }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => handle(error, mutation.meta),
    }),
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return client;
}
