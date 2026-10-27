import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { apiErrorSchema } from '@kanban/shared';
import { buildApp } from './app.js';

const bodySchema = z.strictObject({ name: z.string().min(2), age: z.number().int().optional() });

function testApp(logStream?: { write(line: string): void }): FastifyInstance {
  return buildApp({
    ...(logStream ? { logStream } : {}),
    registerRoutes: (app) => {
      app.post('/__test/echo', { schema: { body: bodySchema } }, async (req) => req.body);
      app.post('/__test/login', async (req) => {
        req.log.info({ body: req.body }, 'login attempt');
        return { ok: true };
      });
      app.get('/__test/boom', async () => {
        throw new Error('SELECT secret FROM users exploded at /srv/internal/file.ts');
      });
    },
  });
}

describe('API conventions', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app.close();
  });

  it('returns an A1 404 for an unknown route', async () => {
    app = testApp();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('NOT_FOUND');
  });

  it('accepts a valid body', async () => {
    app = testApp();
    const res = await app.inject({ method: 'POST', url: '/__test/echo', payload: { name: 'Ana' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: 'Ana' });
  });

  it('returns 400 VALIDATION_ERROR with details for an invalid body', async () => {
    app = testApp();
    const res = await app.inject({ method: 'POST', url: '/__test/echo', payload: { name: 'A' } });
    expect(res.statusCode).toBe(400);
    const body = apiErrorSchema.parse(res.json());
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details?.some((d) => d.path === 'name')).toBe(true);
  });

  it('rejects unknown fields (strict schemas)', async () => {
    app = testApp();
    const res = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      payload: { name: 'Ana', extra: true },
    });
    expect(res.statusCode).toBe(400);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for malformed JSON', async () => {
    app = testApp();
    const res = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 500 INTERNAL_ERROR without a stack trace and logs the error with the request id', async () => {
    const lines: string[] = [];
    app = testApp({ write: (l) => lines.push(l) });
    const res = await app.inject({ method: 'GET', url: '/__test/boom' });
    expect(res.statusCode).toBe(500);
    expect(apiErrorSchema.parse(res.json())).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(res.body).not.toMatch(/SELECT|srv|stack|\.ts/);

    const requestId = res.headers['x-request-id'];
    expect(typeof requestId).toBe('string');
    const logged = lines
      .map((l) => JSON.parse(l) as { reqId?: string; msg?: string; err?: { message?: string } })
      .find((l) => l.msg === 'unhandled error');
    expect(logged?.reqId).toBe(requestId);
    expect(logged?.err?.message).toContain('exploded');
  });

  it('redacts cookies, authorization headers and passwords from logs', async () => {
    const lines: string[] = [];
    app = testApp({ write: (l) => lines.push(l) });
    app.log.info(
      {
        req: { headers: { cookie: 'sid=SECRETCOOKIE', authorization: 'Bearer SECRETTOKEN' } },
        res: { headers: { 'set-cookie': 'sid=SECRETSETCOOKIE' } },
        user: { password: 'SECRETPASSWORD' },
      },
      'sensitive',
    );
    await app.inject({
      method: 'GET',
      url: '/health',
      headers: { cookie: 'sid=SECRETCOOKIE', authorization: 'Bearer SECRETTOKEN' },
    });
    const all = lines.join('\n');
    expect(all).toContain('sensitive');
    expect(all).not.toMatch(/SECRET/);
    expect(all).toContain('[Redacted]');
  });

  it('redacts a password sent in a real request body', async () => {
    const lines: string[] = [];
    app = testApp({ write: (l) => lines.push(l) });
    const res = await app.inject({
      method: 'POST',
      url: '/__test/login',
      headers: { cookie: 'sid=SECRETCOOKIE' },
      payload: { email: 'a@b.c', password: 'SECRETPASSWORD' },
    });
    expect(res.statusCode).toBe(200);
    const all = lines.join('\n');
    expect(all).toContain('login attempt');
    expect(all).toContain('a@b.c');
    expect(all).not.toMatch(/SECRET/);
  });

  it('gives every request a distinct request id', async () => {
    app = testApp();
    const a = await app.inject({ method: 'GET', url: '/health' });
    const b = await app.inject({ method: 'GET', url: '/health' });
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });
});
