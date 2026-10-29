import { vi } from 'vitest';

export const USER = {
  id: '3f0f6a52-1c3e-4f6e-9a0e-6f1b6a3f2a11',
  email: 'ada@example.com',
  name: 'Ada',
  createdAt: '2026-10-29T10:00:00.000Z',
};

type Handler = (body: unknown) => Response | Promise<Response>;

export function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Replaces `fetch` with a table of handlers keyed by "METHOD /path". Unknown requests fail the
 * test. Returns the mock so tests can inspect the calls.
 */
export function stubFetch(handlers: Record<string, Handler>) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(input);
    const handler = handlers[`${method} ${path}`];
    if (!handler) throw new Error(`Unexpected request: ${method} ${path}`);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    return handler(body);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
