import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workspaceListResponseSchema, workspaceResponseSchema } from '@kanban/shared';
import { buildApp } from '../../app.js';
import { createPrismaClient } from '../../db.js';
import { TEST_ORIGIN, createUserAndLogin } from '../../test-utils/auth.js';
import { resetDatabase } from '../../test-utils/reset-database.js';

const prisma = createPrismaClient(process.env['DATABASE_URL'] ?? '');
let app: FastifyInstance;

beforeEach(async () => {
  await resetDatabase(prisma);
  app = buildApp({ prisma, webOrigin: TEST_ORIGIN });
  await app.ready();
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

async function create(who: Awaited<ReturnType<typeof createUserAndLogin>>, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/workspaces',
    headers: who.headers,
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  return workspaceResponseSchema.parse(res.json()).workspace;
}

describe('workspaces edge cases (tester)', () => {
  it('a non-member deleting with a wrong name gets the same 404 as a random id', async () => {
    const owner = await createUserAndLogin(app, { name: 'Olivia' });
    const eve = await createUserAndLogin(app, { name: 'Eve' });
    const ws = await create(owner, 'Acme');
    const real = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${ws.id}`,
      headers: eve.headers,
      payload: { confirmName: 'wrong' },
    });
    const random = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${randomUUID()}`,
      headers: eve.headers,
      payload: { confirmName: 'wrong' },
    });
    expect(real.statusCode).toBe(404);
    expect(real.body).toBe(random.body);
    expect(await prisma.workspace.count()).toBe(1);
  });

  it('confirmation is exact: case and surrounding whitespace do not match', async () => {
    const owner = await createUserAndLogin(app);
    const ws = await create(owner, '  Acme  ');
    expect(ws.name).toBe('Acme');
    for (const confirmName of ['acme', 'Acme ', '']) {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/workspaces/${ws.id}`,
        headers: owner.headers,
        payload: { confirmName },
      });
      expect(res.statusCode).toBe(400);
    }
    expect(await prisma.workspace.count()).toBe(1);
  });

  it('rejects a whitespace-only rename and keeps the name', async () => {
    const owner = await createUserAndLogin(app);
    const ws = await create(owner, 'Acme');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${ws.id}`,
      headers: owner.headers,
      payload: { name: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } })).name).toBe('Acme');
  });

  it('rejects mutations from a foreign Origin and a malformed id (400)', async () => {
    const owner = await createUserAndLogin(app);
    const ws = await create(owner, 'Acme');
    const foreign = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${ws.id}`,
      headers: { ...owner.headers, origin: 'https://evil.example' },
      payload: { name: 'Hacked' },
    });
    expect(foreign.statusCode).toBe(403);
    const bad = await app.inject({
      method: 'GET',
      url: '/api/workspaces/not-a-uuid',
      headers: owner.headers,
    });
    expect(bad.statusCode).toBe(400);
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } })).name).toBe('Acme');
  });

  it('a user with no memberships gets an empty list, and deleting one workspace leaves others', async () => {
    const a = await createUserAndLogin(app, { name: 'A' });
    const b = await createUserAndLogin(app, { name: 'B' });
    const empty = await app.inject({ method: 'GET', url: '/api/workspaces', headers: b.headers });
    expect(workspaceListResponseSchema.parse(empty.json()).workspaces).toEqual([]);
    const w1 = await create(a, 'One');
    await create(b, 'Two');
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${w1.id}`,
      headers: a.headers,
      payload: { confirmName: 'One' },
    });
    expect(del.statusCode).toBe(204);
    expect(await prisma.workspace.count()).toBe(1);
    expect(await prisma.membership.count()).toBe(1);
  });
});
