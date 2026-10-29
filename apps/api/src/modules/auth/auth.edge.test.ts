import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apiErrorSchema } from '@kanban/shared';
import { buildApp } from '../../app.js';
import { createPrismaClient } from '../../db.js';
import { TEST_ORIGIN, TEST_PASSWORD, createUserAndLogin } from '../../test-utils/auth.js';
import { resetDatabase } from '../../test-utils/reset-database.js';
import { SESSION_COOKIE_NAME } from './tokens.js';

const prisma = createPrismaClient(process.env['DATABASE_URL'] ?? '');
let app: FastifyInstance;
const lines: string[] = [];

beforeEach(async () => {
  lines.length = 0;
  await resetDatabase(prisma);
  app = buildApp({
    prisma,
    webOrigin: TEST_ORIGIN,
    logStream: { write: (l: string) => void lines.push(l) },
  });
  await app.ready();
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

const origin = { origin: TEST_ORIGIN };

describe('auth edge cases (tester)', () => {
  it('rejects Origin "null" and a look-alike origin with 403 in the error format', async () => {
    for (const o of ['null', `${TEST_ORIGIN}.evil.com`, 'http://localhost:5173/']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: o },
        payload: { email: 'a@b.co', password: 'x' },
      });
      expect(res.statusCode, o).toBe(403);
      apiErrorSchema.parse(res.json());
    }
  });

  it('returns 400 in the error format for malformed JSON, arrays and empty bodies', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      headers: { ...origin, 'content-type': 'application/json' },
      payload: '{"email":',
    });
    expect(bad.statusCode).toBe(400);
    apiErrorSchema.parse(bad.json());
    for (const payload of [[], 'null', '']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { ...origin, 'content-type': 'application/json' },
        payload: payload as string,
      });
      expect(res.statusCode).toBe(400);
      apiErrorSchema.parse(res.json());
    }
  });

  it('enforces password length boundaries 10 and 128', async () => {
    const mk = (n: number, e: string) => ({
      email: e,
      name: 'A',
      password: 'p'.repeat(n),
    });
    const post = (b: object) =>
      app.inject({ method: 'POST', url: '/api/auth/signup', headers: origin, payload: b });
    expect((await post(mk(9, 'a1@x.co'))).statusCode).toBe(400);
    expect((await post(mk(10, 'a2@x.co'))).statusCode).toBe(201);
    expect((await post(mk(128, 'a3@x.co'))).statusCode).toBe(201);
    expect((await post(mk(129, 'a4@x.co'))).statusCode).toBe(400);
  });

  it('treats email case differences as the same account', async () => {
    await createUserAndLogin(app, { email: 'case@example.com' });
    const dup = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      headers: origin,
      payload: { email: 'CASE@example.com', name: 'X', password: TEST_PASSWORD },
    });
    expect(dup.statusCode).toBe(409);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: origin,
      payload: { email: ' CASE@Example.com ', password: TEST_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it('never logs passwords or session cookies, and 400 bodies do not echo the password', async () => {
    const secret = 'super-secret-pass-123';
    const short = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      headers: origin,
      payload: { email: 'nope', name: 'A', password: secret },
    });
    expect(short.body).not.toContain(secret);
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: origin,
      payload: { email: 'ghost@example.com', password: secret },
    });
    const u = await createUserAndLogin(app, { password: secret });
    await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: u.cookie } });
    const all = lines.join('\n');
    expect(all).not.toContain(secret);
    expect(all).not.toContain(u.cookie.split('=')[1]);
    expect(all).not.toContain('passwordHash');
  });

  it('a cookie with an empty value, a duplicated name or junk is rejected with 401', async () => {
    const u = await createUserAndLogin(app);
    for (const cookie of [
      `${SESSION_COOKIE_NAME}=`,
      `${SESSION_COOKIE_NAME}=%00`,
      `${SESSION_COOKIE_NAME}=${'a'.repeat(5000)}`,
      `xx${u.cookie}`,
    ]) {
      const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
      expect(res.statusCode, cookie.slice(0, 40)).toBe(401);
      apiErrorSchema.parse(res.json());
    }
  });

  it('logout without Origin is 403, without a session 401, and deletes only that session', async () => {
    const u = await createUserAndLogin(app, { email: 'multi@example.com' });
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: origin,
      payload: { email: u.email, password: u.password },
    });
    const secondCookie = (second.headers['set-cookie'] as string).split(';')[0] ?? '';
    expect(
      (await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: u.cookie } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: '/api/auth/logout', headers: origin })).statusCode,
    ).toBe(401);
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: u.headers,
    });
    expect(out.statusCode).toBe(204);
    expect(out.body).toBe('');
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: secondCookie },
    });
    expect(me.statusCode).toBe(200);
    expect(await prisma.session.count()).toBe(1);
  });

  it('wrong-password and unknown-email 401 bodies are byte-identical', async () => {
    const u = await createUserAndLogin(app);
    const a = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: origin,
      payload: { email: u.email, password: 'wrong-password-1' },
    });
    const b = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: origin,
      payload: { email: 'ghost@example.com', password: 'wrong-password-1' },
    });
    expect(a.statusCode).toBe(401);
    expect(b.body).toBe(a.body);
  });

  it('protected-by-default: an unknown POST route without Origin does not leak, and /health is public', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/nothing' });
    expect(res.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});
