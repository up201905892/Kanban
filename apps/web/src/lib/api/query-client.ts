import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './api-error';

const MAX_RETRIES = 2;

/** Never retry client errors (4xx); retry network and server errors a couple of times. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
