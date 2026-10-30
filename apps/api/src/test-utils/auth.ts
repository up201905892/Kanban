import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { authResponseSchema, type User } from '@kanban/shared';

/** The origin the test apps accept (the default web origin). */
export const TEST_ORIGIN = 'http://localhost:5173';
export const TEST_PASSWORD = 'correct-horse-battery';

export interface TestUser {
  user: User;
  email: string;
  password: string;
  /** `name=value` pair of the session cookie, ready for a `cookie` header. */
  cookie: string;
  /** Headers for an authenticated state-changing request. */
  headers: { cookie: string; origin: string };
}

/** Extracts `name=value` from the first `set-cookie` header of a response. */
export function cookiePair(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const pair = raw?.split(';')[0];
  if (!pair) throw new Error('Response has no set-cookie header');
  return pair;
}

/** Signs up a fresh user through the real route and returns its session cookie. */
export async function createUserAndLogin(
  app: FastifyInstance,
  overrides: { email?: string; name?: string; password?: string } = {},
): Promise<TestUser> {
  const email = overrides.email ?? `user-${randomUUID()}@example.com`;
  const password = overrides.password ?? TEST_PASSWORD;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    headers: { origin: TEST_ORIGIN },
    payload: { email, name: overrides.name ?? 'Test User', password },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed in test helper: ${res.statusCode}`);
  const cookie = cookiePair(res.headers['set-cookie']);
  return {
    user: authResponseSchema.parse(res.json()).user,
    email,
    password,
    cookie,
    headers: { cookie, origin: TEST_ORIGIN },
  };
}
