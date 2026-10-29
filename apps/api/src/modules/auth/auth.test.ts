import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apiErrorSchema, authResponseSchema } from '@kanban/shared';
import { buildApp } from '../../app.js';
import { createPrismaClient } from '../../db.js';
import {
  TEST_ORIGIN,
  TEST_PASSWORD,
  cookiePair,
  createUserAndLogin,
} from '../../test-utils/auth.js';
import { resetDatabase } from '../../test-utils/reset-database.js';
import { resetPassword } from './admin.js';
import { getSessionFromCookieHeader } from './session.js';
import { SESSION_COOKIE_NAME, SESSION_TTL_MS, hashToken } from './tokens.js';

const prisma = createPrismaClient(process.env['DATABASE_URL'] ?? '');
let app: FastifyInstance;

beforeEach(async () => {
  await resetDatabase(prisma);
  app = buildApp({ prisma, webOrigin: TEST_ORIGIN });
  await app.ready();
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

const origin = { origin: TEST_ORIGIN };
const signupBody = { email: 'ana@example.com', name: 'Ana', password: TEST_PASSWORD };

const post = (url: string, payload: unknown, headers: Record<string, string> = origin) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers });

describe('POST /api/auth/signup', () => {
  it('creates the user and a session cookie (201)', async () => {
    const res = await post('/api/auth/signup', { ...signupBody, email: 'Ana@Example.COM' });
    expect(res.statusCode).toBe(201);
    const { user } = authResponseSchema.parse(res.json());
    expect(user.email).toBe('ana@example.com');
    expect(user.name).toBe('Ana');
    const cookie = res.headers['set-cookie'] as string;
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Secure');
    expect(await prisma.session.count()).toBe(1);
  });

  it('stores an argon2id hash, and only the SHA-256 of the token', async () => {
    const res = await post('/api/auth/signup', signupBody);
    const token = cookiePair(res.headers['set-cookie']).split('=')[1] ?? '';
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@example.com' } });
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(stored.passwordHash).not.toContain(TEST_PASSWORD);
    const session = await prisma.session.findFirstOrThrow();
    expect(session.tokenHash).toBe(hashToken(token));
    expect(session.tokenHash).not.toBe(token);
    const ttl = session.expiresAt.getTime() - session.createdAt.getTime();
    expect(Math.abs(ttl - SESSION_TTL_MS)).toBeLessThan(60_000);
  });

  it('never returns the password hash', async () => {
    const res = await post('/api/auth/signup', signupBody);
    expect(res.body).not.toContain('passwordHash');
    expect(res.body).not.toContain('argon2');
  });

  it.each([
    ['invalid email', { ...signupBody, email: 'not-an-email' }],
    ['short password', { ...signupBody, password: 'x'.repeat(9) }],
    ['long password', { ...signupBody, password: 'x'.repeat(129) }],
    ['missing name', { email: signupBody.email, password: signupBody.password }],
    ['unknown field', { ...signupBody, isAdmin: true }],
  ])('rejects %s with 400 VALIDATION_ERROR', async (_label, body) => {
    const res = await post('/api/auth/signup', body);
    expect(res.statusCode).toBe(400);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.user.count()).toBe(0);
  });

  it('accepts password boundaries of 10 and 128 characters', async () => {
    expect(
      (await post('/api/auth/signup', { ...signupBody, password: 'x'.repeat(10) })).statusCode,
    ).toBe(201);
    expect(
      (
        await post('/api/auth/signup', {
          ...signupBody,
          email: 'b@example.com',
          password: 'x'.repeat(128),
        })
      ).statusCode,
    ).toBe(201);
  });

  it('returns 409 EMAIL_TAKEN for a duplicate, ignoring case', async () => {
    await post('/api/auth/signup', signupBody);
    const res = await post('/api/auth/signup', { ...signupBody, email: 'ANA@example.com' });
    expect(res.statusCode).toBe(409);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('EMAIL_TAKEN');
    expect(await prisma.user.count()).toBe(1);
  });

  it('allows only one of two concurrent signups for the same email', async () => {
    const results = await Promise.all([
      post('/api/auth/signup', signupBody),
      post('/api/auth/signup', signupBody),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });

  it('is rate limited to 10 attempts per minute per IP and email', async () => {
    for (let i = 0; i < 10; i++) await post('/api/auth/signup', signupBody);
    const res = await post('/api/auth/signup', signupBody);
    expect(res.statusCode).toBe(429);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    // A different email is not affected.
    expect(
      (await post('/api/auth/signup', { ...signupBody, email: 'other@example.com' })).statusCode,
    ).toBe(201);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await post('/api/auth/signup', signupBody);
  });

  it('returns 200 with the user and a new session cookie', async () => {
    const res = await post('/api/auth/login', {
      email: 'ANA@example.com',
      password: TEST_PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    expect(authResponseSchema.parse(res.json()).user.email).toBe('ana@example.com');
    expect(res.headers['set-cookie']).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(res.body).not.toContain('passwordHash');
    expect(await prisma.session.count()).toBe(2);
  });

  it('answers unknown email and wrong password with the identical 401 body', async () => {
    const unknown = await post('/api/auth/login', {
      email: 'nobody@example.com',
      password: TEST_PASSWORD,
    });
    const wrong = await post('/api/auth/login', {
      email: 'ana@example.com',
      password: 'wrong-password-1',
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.body).toBe(wrong.body);
    expect(apiErrorSchema.parse(unknown.json()).error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.headers['set-cookie']).toBeUndefined();
  });

  it('rejects invalid bodies with 400', async () => {
    expect((await post('/api/auth/login', { email: 'ana@example.com' })).statusCode).toBe(400);
    expect(
      (await post('/api/auth/login', { email: 'ana@example.com', password: 'x', extra: 1 }))
        .statusCode,
    ).toBe(400);
  });

  it('returns 429 after 10 attempts per minute for the same IP and email', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await post('/api/auth/login', {
        email: 'ana@example.com',
        password: 'wrong-password-1',
      });
      expect(r.statusCode).toBe(401);
    }
    const blocked = await post('/api/auth/login', {
      email: 'ana@example.com',
      password: TEST_PASSWORD,
    });
    expect(blocked.statusCode).toBe(429);
    expect(apiErrorSchema.parse(blocked.json()).error.code).toBe('RATE_LIMITED');
  });
});

describe('logout and me', () => {
  it('logout returns 204, deletes the session and clears the cookie; me is then 401', async () => {
    const u = await createUserAndLogin(app);
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: u.cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(authResponseSchema.parse(me.json()).user.id).toBe(u.user.id);

    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: u.headers });
    expect(out.statusCode).toBe(204);
    expect(out.body).toBe('');
    expect(out.headers['set-cookie']).toContain('Max-Age=0');
    expect(await prisma.session.count()).toBe(0);

    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: u.cookie },
    });
    expect(after.statusCode).toBe(401);
  });

  it('me is 401 UNAUTHENTICATED with no cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('UNAUTHENTICATED');
  });

  it('me is 401 with a tampered cookie', async () => {
    const u = await createUserAndLogin(app);
    const flipped = u.cookie.slice(0, -1) + (u.cookie.endsWith('A') ? 'B' : 'A');
    for (const cookie of [flipped, `${SESSION_COOKIE_NAME}=garbage`, `${SESSION_COOKIE_NAME}=`]) {
      const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
      expect(res.statusCode).toBe(401);
    }
  });

  it('me is 401 for an expired session, which is also deleted', async () => {
    const u = await createUserAndLogin(app);
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it('logout without a session is 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: origin });
    expect(res.statusCode).toBe(401);
  });

  it('deleting the user cascades to its sessions', async () => {
    const u = await createUserAndLogin(app);
    await prisma.user.delete({ where: { id: u.user.id } });
    expect(await prisma.session.count()).toBe(0);
  });
});

describe('sliding expiry', () => {
  it('does not renew within a day', async () => {
    const u = await createUserAndLogin(app);
    const before = await prisma.session.findFirstOrThrow();
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: u.cookie },
    });
    expect(res.headers['set-cookie']).toBeUndefined();
    const after = await prisma.session.findFirstOrThrow();
    expect(after.expiresAt).toEqual(before.expiresAt);
  });

  it('renews a session last used over a day ago and re-sends the cookie', async () => {
    const u = await createUserAndLogin(app);
    const old = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    await prisma.session.updateMany({
      data: { lastUsedAt: old, expiresAt: new Date(old.getTime() + SESSION_TTL_MS) },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: u.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(cookiePair(res.headers['set-cookie'])).toBe(u.cookie);
    const s = await prisma.session.findFirstOrThrow();
    expect(s.lastUsedAt.getTime()).toBeGreaterThan(old.getTime() + 24 * 3600 * 1000);
    expect(Math.abs(s.expiresAt.getTime() - (Date.now() + SESSION_TTL_MS))).toBeLessThan(60_000);
  });
});

describe('Origin check (CSRF)', () => {
  it.each([
    ['without Origin', {}],
    ['with a foreign Origin', { origin: 'http://evil.example' }],
  ])('rejects a POST %s with 403 CSRF_REJECTED', async (_l, headers) => {
    const res = await post('/api/auth/login', { email: 'a@b.co', password: 'x' }, headers);
    expect(res.statusCode).toBe(403);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('CSRF_REJECTED');
  });

  it('rejects an authenticated logout with a wrong Origin and keeps the session', async () => {
    const u = await createUserAndLogin(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: u.cookie, origin: 'http://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(await prisma.session.count()).toBe(1);
  });

  it('does not require an Origin for GET', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});

describe('public routes and unknown routes', () => {
  it('health stays public; unknown routes are still 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/nope' })).statusCode).toBe(404);
  });
});

describe('getSessionFromCookieHeader (WebSocket helper)', () => {
  it('resolves the user from a raw Cookie header and returns null otherwise', async () => {
    const u = await createUserAndLogin(app);
    const ok = await getSessionFromCookieHeader(prisma, `other=1; ${u.cookie}`);
    expect(ok?.user.id).toBe(u.user.id);
    expect(await getSessionFromCookieHeader(prisma, undefined)).toBeNull();
    expect(await getSessionFromCookieHeader(prisma, `${SESSION_COOKIE_NAME}=nope`)).toBeNull();
  });
});

describe('operator password reset', () => {
  it('sets a new password, prints it once and deletes all sessions of the user', async () => {
    const u = await createUserAndLogin(app, { email: 'ana@example.com' });
    await post('/api/auth/login', { email: u.email, password: u.password });
    const other = await createUserAndLogin(app);
    expect(await prisma.session.count()).toBe(3);

    const temp = await resetPassword(prisma, 'ANA@example.com');
    expect(temp).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(await prisma.session.count()).toBe(1);

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: u.cookie },
    });
    expect(me.statusCode).toBe(401);
    const otherMe = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: other.cookie },
    });
    expect(otherMe.statusCode).toBe(200);

    expect(
      (await post('/api/auth/login', { email: u.email, password: u.password })).statusCode,
    ).toBe(401);
    expect(
      (await post('/api/auth/login', { email: u.email, password: temp ?? '' })).statusCode,
    ).toBe(200);
  });

  it('returns null for an unknown email and rejects a malformed one', async () => {
    expect(await resetPassword(prisma, 'nobody@example.com')).toBeNull();
    await expect(resetPassword(prisma, 'not-an-email')).rejects.toThrow();
  });
});
