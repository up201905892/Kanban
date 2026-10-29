import { describe, expect, it } from 'vitest';
import { isOriginAllowed, normalizeOrigin } from '../../lib/origin-check.js';
import { RateLimiter } from '../../lib/rate-limiter.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password.js';
import {
  SESSION_COOKIE_NAME,
  SESSION_RENEW_INTERVAL_MS,
  SESSION_TTL_MS,
  generateToken,
  hashToken,
  isExpired,
  readCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  sessionCookieOptions,
  sessionExpiry,
  shouldRenew,
} from './tokens.js';

describe('password hashing', () => {
  it('round-trips with argon2id and rejects a wrong password', async () => {
    const h = await hashPassword('correct-horse-battery');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'correct-horse-battery')).toBe(true);
    expect(await verifyPassword(h, 'wrong-horse-battery')).toBe(false);
  });

  it('salts: the same password hashes differently', async () => {
    expect(await hashPassword('same-password-1')).not.toBe(await hashPassword('same-password-1'));
  });

  it('treats a malformed hash as a failed verification', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('the dummy verification completes without throwing', async () => {
    await expect(verifyAgainstDummy('anything')).resolves.toBeUndefined();
  });
});

describe('tokens', () => {
  it('generates 32 random bytes (43 base64url characters), unique each time', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });

  it('hashes with SHA-256 (hex, deterministic, differs from the token)', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
});

describe('session expiry rules', () => {
  const now = new Date('2026-10-29T12:00:00Z');

  it('expires 30 days after now', () => {
    expect(sessionExpiry(now).getTime() - now.getTime()).toBe(SESSION_TTL_MS);
    expect(SESSION_TTL_MS).toBe(30 * 24 * 3600 * 1000);
  });

  it('isExpired is true at and after the expiry instant, false before', () => {
    expect(isExpired(new Date(now.getTime() - 1), now)).toBe(true);
    expect(isExpired(now, now)).toBe(true);
    expect(isExpired(new Date(now.getTime() + 1), now)).toBe(false);
  });

  it('renews at most once a day (boundary)', () => {
    expect(shouldRenew(new Date(now.getTime() - SESSION_RENEW_INTERVAL_MS + 1), now)).toBe(false);
    expect(shouldRenew(new Date(now.getTime() - SESSION_RENEW_INTERVAL_MS), now)).toBe(true);
    expect(shouldRenew(now, now)).toBe(false);
  });
});

describe('cookie options', () => {
  it('is Secure only in production', () => {
    expect(sessionCookieOptions('production').secure).toBe(true);
    expect(sessionCookieOptions('development').secure).toBe(false);
    expect(sessionCookieOptions('test').secure).toBe(false);
    expect(sessionCookieOptions(undefined).secure).toBe(false);
  });

  it('serialises httpOnly, SameSite=Lax, Path=/ and Secure per environment', () => {
    const exp = new Date('2026-11-28T00:00:00Z');
    const dev = serializeSessionCookie('tok', exp, 'development');
    expect(dev).toContain(`${SESSION_COOKIE_NAME}=tok`);
    expect(dev).toContain('HttpOnly');
    expect(dev).toContain('SameSite=Lax');
    expect(dev).toContain('Path=/');
    expect(dev).not.toContain('Secure');
    expect(serializeSessionCookie('tok', exp, 'production')).toContain('Secure');
  });

  it('the cleared cookie expires immediately and keeps the attributes', () => {
    const c = serializeClearedSessionCookie('production');
    expect(c).toContain('Max-Age=0');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
  });

  it('reads a cookie from a header with several cookies', () => {
    expect(readCookie('a=1; kanban_session=xyz; b=2', 'kanban_session')).toBe('xyz');
    expect(readCookie('a=1', 'kanban_session')).toBeUndefined();
    expect(readCookie(undefined, 'kanban_session')).toBeUndefined();
    expect(readCookie('junk; kanban_session=', 'kanban_session')).toBe('');
  });
});

describe('origin check', () => {
  const allowed = normalizeOrigin('http://localhost:5173/');

  it('normalises the configured origin', () => {
    expect(allowed).toBe('http://localhost:5173');
  });

  it('lets safe methods through without an Origin', () => {
    expect(isOriginAllowed('GET', undefined, allowed)).toBe(true);
    expect(isOriginAllowed('HEAD', undefined, allowed)).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post'])('requires the Origin for %s', (m) => {
    expect(isOriginAllowed(m, undefined, allowed)).toBe(false);
    expect(isOriginAllowed(m, 'http://evil.example', allowed)).toBe(false);
    expect(isOriginAllowed(m, 'http://localhost:5173.evil.example', allowed)).toBe(false);
    expect(isOriginAllowed(m, 'null', allowed)).toBe(false);
    expect(isOriginAllowed(m, 'http://localhost:5173', allowed)).toBe(true);
  });
});

describe('RateLimiter', () => {
  it('allows the limit, blocks the next hit and reports Retry-After', () => {
    let t = 0;
    const l = new RateLimiter(3, 60_000, () => t);
    for (let i = 0; i < 3; i++) expect(l.hit('k').allowed).toBe(true);
    t = 10_000;
    const blocked = l.hit('k');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(50);
  });

  it('keeps keys independent and resets after the window', () => {
    let t = 0;
    const l = new RateLimiter(1, 1000, () => t);
    expect(l.hit('a').allowed).toBe(true);
    expect(l.hit('a').allowed).toBe(false);
    expect(l.hit('b').allowed).toBe(true);
    t = 1000;
    expect(l.hit('a').allowed).toBe(true);
  });
});
