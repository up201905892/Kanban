import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, contentSecurityPolicy } from './app.js';
import { createPrismaClient } from './db.js';
import { isDummyHashReady } from './modules/auth/password.js';
import { AUTH_RATE_LIMIT } from './modules/auth/routes.js';
import { TEST_ORIGIN } from './test-utils/auth.js';

const prisma = createPrismaClient(process.env['DATABASE_URL'] ?? '');
const apps: FastifyInstance[] = [];
let dist = '';

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'kanban-web-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(
    join(dist, 'index.html'),
    '<!doctype html><title>Kanban</title><div id="root"></div>',
  );
  writeFileSync(join(dist, 'assets', 'app-abc123.js'), 'console.log("app");');
  writeFileSync(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
});
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});
afterAll(async () => {
  rmSync(dist, { recursive: true, force: true });
  await prisma.$disconnect();
});

function build(options: Parameters<typeof buildApp>[0] = {}): FastifyInstance {
  const app = buildApp({ prisma, webOrigin: TEST_ORIGIN, ...options });
  apps.push(app);
  return app;
}

describe('dummy hash warm-up', () => {
  it('is computed by app.ready(), before any login request', async () => {
    expect(isDummyHashReady()).toBe(false);
    const app = build();
    expect(isDummyHashReady()).toBe(false);
    await app.ready();
    expect(isDummyHashReady()).toBe(true);
  });
});

describe('serving the web app from the api', () => {
  it('serves index.html at / and for client-side routes (SPA fallback)', async () => {
    const app = build({ webDistDir: dist });
    for (const url of ['/', '/workspaces/abc/projects/xyz', '/login?next=%2F']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('<div id="root">');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('needs no session and serves real files with their own type and long cache for assets', async () => {
    const app = build({ webDistDir: dist });
    const js = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.headers['cache-control']).toContain('immutable');
    const svg = await app.inject({ method: 'GET', url: '/favicon.svg' });
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-type']).toMatch(/svg/);
  });

  it('keeps the A1 404 for unknown /api, /ws and /health paths, other methods and missing files', async () => {
    const app = build({ webDistDir: dist });
    const notFound = { error: { code: 'NOT_FOUND', message: 'Resource not found' } };
    for (const url of ['/api/nope', '/api', '/ws', '/health/nope', '/assets/missing.js']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json(), url).toEqual(notFound);
    }
    const post = await app.inject({
      method: 'POST',
      url: '/somewhere',
      headers: { origin: TEST_ORIGIN },
      payload: {},
    });
    expect(post.statusCode).toBe(404);
    expect(post.json()).toEqual(notFound);
  });

  it('does not escape the web directory', async () => {
    const app = build({ webDistDir: dist });
    for (const url of ['/..%2F..%2Fetc%2Fpasswd', '/%2e%2e/%2e%2e/etc/passwd', '/%E0%A4%A']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.body, url).not.toContain('root:');
      expect([404, 400, 200]).toContain(res.statusCode);
    }
  });

  it('keeps the API routes working next to the web app', async () => {
    const app = build({ webDistDir: dist });
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok' });
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
  });

  it('refuses a directory without index.html', () => {
    expect(() => buildApp({ prisma, webDistDir: tmpdir() })).toThrow(/index\.html/);
  });

  it('serves nothing when no directory is configured', async () => {
    const app = build();
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
  });
});

describe('security headers and limits', () => {
  it('sends helmet headers and a CSP that allows the app and its WebSocket only', async () => {
    const app = build({ webDistDir: dist, webOrigin: 'https://kanban.example.com' });
    for (const url of ['/', '/health', '/api/auth/me']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['x-content-type-options'], url).toBe('nosniff');
      expect(res.headers['x-frame-options'], url).toBeDefined();
      expect(res.headers['referrer-policy'], url).toBeDefined();
      expect(res.headers['strict-transport-security'], url).toContain('max-age=');
      const csp = String(res.headers['content-security-policy']);
      expect(csp, url).toContain("default-src 'self'");
      expect(csp, url).toContain("script-src 'self'");
      expect(csp, url).toContain("connect-src 'self' wss://kanban.example.com");
      expect(csp, url).toContain("frame-ancestors 'none'");
      expect(csp, url).toContain("object-src 'none'");
      expect(csp, url).not.toContain('unsafe-eval');
    }
  });

  it('adds neither HSTS nor upgrade-insecure-requests over plain http', async () => {
    const app = build();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expect(String(res.headers['content-security-policy'])).not.toContain('upgrade-insecure');
    expect(String(res.headers['content-security-policy'])).toContain('ws://localhost:5173');
  });

  it('builds the policy from the public origin', () => {
    expect(contentSecurityPolicy('https://a.example.com:8443')['connect-src']).toEqual([
      "'self'",
      'wss://a.example.com:8443',
    ]);
  });

  it('rejects a request body over the limit as a framework-level 400 (A1 format, no field details)', async () => {
    const app = build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'a@example.com', password: 'x'.repeat(2 * 1024 * 1024) }),
    });
    expect(res.statusCode).toBe(400);
    // Field validation would list details; the size limit fails before the body is parsed.
    expect(res.json().error.details).toBeUndefined();
  });
});

describe('TRUST_PROXY and the auth rate limit', () => {
  const login = (app: FastifyInstance, forwardedFor: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: TEST_ORIGIN, 'x-forwarded-for': forwardedFor },
      payload: { email: 'nobody@example.com', password: 'wrong-password-1' },
    });

  it('uses the client address from X-Forwarded-For when on: separate buckets per client', async () => {
    const app = build({ trustProxy: 1 });
    for (let i = 0; i < AUTH_RATE_LIMIT; i++) {
      expect((await login(app, '203.0.113.1')).statusCode).toBe(401);
    }
    expect((await login(app, '203.0.113.1')).statusCode).toBe(429);
    // Another client behind the same proxy still has its own bucket.
    expect((await login(app, '203.0.113.2')).statusCode).toBe(401);
  });

  it('trusts only the configured number of hops (a spoofed leftmost entry does not count)', async () => {
    const app = build({ trustProxy: 1 });
    for (let i = 0; i < AUTH_RATE_LIMIT; i++) {
      expect((await login(app, `198.51.100.${i}, 203.0.113.9`)).statusCode).toBe(401);
    }
    expect((await login(app, '198.51.100.200, 203.0.113.9')).statusCode).toBe(429);
  });

  it('ignores X-Forwarded-For when off: a changing header does not get around the limit', async () => {
    const app = build();
    for (let i = 0; i < AUTH_RATE_LIMIT; i++) {
      expect((await login(app, `203.0.113.${i}`)).statusCode).toBe(401);
    }
    expect((await login(app, '203.0.113.200')).statusCode).toBe(429);
  });

  it('a hop count of 0 is the same as off', async () => {
    const app = build({ trustProxy: 0 });
    for (let i = 0; i < AUTH_RATE_LIMIT; i++) await login(app, `203.0.113.${i}`);
    expect((await login(app, '203.0.113.200')).statusCode).toBe(429);
  });
});
