import { QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { App } from '../../App';
import { ApiError, apiClient, createQueryClient } from '../../lib/api';
import { createTestRouter } from '../../router';
import { jsonResponse, stubFetch, USER } from '../../test-utils/fetch';
import { currentUserKey } from './api';
import { handleUnauthorized } from './unauthorized';

describe('createQueryClient onUnauthorized', () => {
  it('fires for a 401 UNAUTHENTICATED query error but not for INVALID_CREDENTIALS', async () => {
    const onUnauthorized = vi.fn();
    const client = createQueryClient({ onUnauthorized });
    await client
      .fetchQuery({
        queryKey: ['a'],
        queryFn: () => Promise.reject(new ApiError(401, 'INVALID_CREDENTIALS', 'Nope')),
        retry: false,
      })
      .catch(() => undefined);
    expect(onUnauthorized).not.toHaveBeenCalled();
    await client
      .fetchQuery({
        queryKey: ['b'],
        queryFn: () => Promise.reject(new ApiError(401, 'UNAUTHENTICATED', 'Expired')),
        retry: false,
      })
      .catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

function Probe() {
  const { error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.get('/api/projects'),
    retry: false,
  });
  const save = useMutation({ mutationFn: () => apiClient.post('/api/projects', {}) });
  return (
    <>
      <p>{error ? 'failed' : 'ok'}</p>
      <button onClick={() => save.mutate()}>Save</button>
    </>
  );
}

describe('401 from any API call', () => {
  it('clears the cache and redirects to login keeping the path', async () => {
    stubFetch({
      'GET /api/auth/me': () => jsonResponse(200, { user: USER }),
      'GET /api/projects': () =>
        jsonResponse(401, {
          error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
        }),
    });
    const router = createTestRouter(['/']);
    const client = createQueryClient({ onUnauthorized: (c) => handleUnauthorized(c, router) });
    client.setQueryData(['secret'], 'cached');
    render(
      <QueryClientProvider client={client}>
        <App router={router} queryClient={client} />
        <Probe />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('');
    expect(client.getQueryData(['secret'])).toBeUndefined();
    expect(client.getQueryData(currentUserKey)).toBeNull();
  });

  it('keeps a deep path in next', () => {
    const router = createTestRouter(['/projects/1?x=2']);
    const client = createQueryClient();
    handleUnauthorized(client, router);
    return waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
      expect(router.state.location.search).toBe('?next=%2Fprojects%2F1%3Fx%3D2');
    });
  });
});
