import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider } from 'react-router';
import type { QueryClient } from '@tanstack/react-query';
import type { DataRouter } from 'react-router';
import { AnnouncerProvider } from './components';
import { createQueryClient } from './lib/api';
import { createAppRouter } from './router';

export interface AppProps {
  /** Injected in tests; defaults to a browser router and a fresh query client. */
  router?: DataRouter;
  queryClient?: QueryClient;
}

export function App({ router, queryClient }: AppProps) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  const [appRouter] = useState(() => router ?? createAppRouter());
  return (
    <QueryClientProvider client={client}>
      <AnnouncerProvider>
        <RouterProvider router={appRouter} />
      </AnnouncerProvider>
    </QueryClientProvider>
  );
}
