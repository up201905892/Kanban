import { z } from 'zod';
import { apiClient } from './api-client';
import { ApiError } from './api-error';
import { shouldRetry } from './query-client';

const itemSchema = z.object({ id: z.string() });

function mockFetch(status: number, body?: unknown) {
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(body === undefined ? null : JSON.stringify(body), { status }));
  return spy;
}

afterEach(() => vi.restoreAllMocks());

describe('apiClient', () => {
  it('turns an A1 error body into an ApiError', async () => {
    mockFetch(409, {
      error: {
        code: 'CONFLICT',
        message: 'Already exists',
        details: [{ path: 'name', message: 'taken' }],
      },
    });
    const error = await apiClient.get('/api/things').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'Already exists',
      details: [{ path: 'name', message: 'taken' }],
    });
  });

  it('reports an unparseable error body as INVALID_RESPONSE', async () => {
    mockFetch(502, { nope: true });
    await expect(apiClient.get('/api/things')).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_RESPONSE',
    });
  });

  it('sends cookies and a JSON body', async () => {
    const spy = mockFetch(201, { id: '1' });
    const result = await apiClient.post('/api/things', { name: 'x' }, itemSchema);
    expect(result).toEqual({ id: '1' });
    const [, init] = spy.mock.calls[0]!;
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', body: '{"name":"x"}' });
  });

  it('validates success responses with the shared schema', async () => {
    mockFetch(200, { id: 42 });
    await expect(apiClient.get('/api/things/1', itemSchema)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('accepts empty 204 responses', async () => {
    mockFetch(204);
    await expect(apiClient.delete('/api/things/1')).resolves.toBeUndefined();
  });

  it('maps network failures to NETWORK_ERROR', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(apiClient.get('/api/things')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
  });
});

describe('shouldRetry', () => {
  it('does not retry 4xx errors', () => {
    expect(shouldRetry(0, new ApiError(404, 'NOT_FOUND', 'nope'))).toBe(false);
  });

  it('retries 5xx and network errors a limited number of times', () => {
    expect(shouldRetry(0, new ApiError(500, 'INTERNAL_ERROR', 'x'))).toBe(true);
    expect(shouldRetry(1, new Error('network'))).toBe(true);
    expect(shouldRetry(2, new Error('network'))).toBe(false);
  });
});
