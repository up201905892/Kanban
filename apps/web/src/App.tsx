import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider } from 'react-router';
import type { QueryClient } from '@tanstack/react-query';
import type { DataRouter } from 'react-router';
import { AnnouncerProvider } from './components';
import { handleUnauthorized } from './features/auth/unauthorized';
import { createQueryClient } from './lib/api';
import { createAppRouter } from './router';

export interface AppProps {
  /** Injected in tests; defaults to a browser router and a fresh query client. */
  router?: DataRouter;
  queryClient?: QueryClient;
}

export function App({ router, queryClient }: AppProps) {
  const [appRouter] = useState(() => router ?? createAppRouter());
  const [client] = useState(
    () =>
      queryClient ?? createQueryClient({ onUnauthorized: (c) => handleUnauthorized(c, appRouter) }),
  );
  return (
    <QueryClientProvider client={client}>
      <AnnouncerProvider>
        <RouterProvider router={appRouter} />
      </AnnouncerProvider>
    </QueryClientProvider>
  );
}
