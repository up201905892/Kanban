import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  workspaceListResponseSchema,
  workspaceResponseSchema,
  type Role,
} from '@kanban/shared';
import { buildApp } from '../../app.js';
import { createPrismaClient } from '../../db.js';
import { TEST_ORIGIN, createUserAndLogin, type TestUser } from '../../test-utils/auth.js';
import { resetDatabase } from '../../test-utils/reset-database.js';
import { authorize } from '../authz/index.js';

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

function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  who?: TestUser,
  body?: object,
) {
  return app.inject({
    method,
    url,
    headers: who ? who.headers : origin,
    ...(body ? { payload: body } : {}),
  });
}

async function createWorkspace(owner: TestUser, name = 'Acme') {
  const res = await call('POST', '/api/workspaces', owner, { name });
  expect(res.statusCode).toBe(201);
  return workspaceResponseSchema.parse(res.json()).workspace;
}

/** A workspace owned by `owner` with a member and a viewer added straight in the database. */
async function setup() {
  const [owner, member, viewer, outsider] = await Promise.all([
    createUserAndLogin(app, { name: 'Olivia' }),
    createUserAndLogin(app, { name: 'Mark' }),
    createUserAndLogin(app, { name: 'Vera' }),
    createUserAndLogin(app, { name: 'Eve' }),
  ]);
  const workspace = await createWorkspace(owner);
  await prisma.membership.createMany({
    data: [
      { workspaceId: workspace.id, userId: member.user.id, role: 'member' },
      { workspaceId: workspace.id, userId: viewer.user.id, role: 'viewer' },
    ],
  });
  return { owner, member, viewer, outsider, workspace };
}

describe('POST /api/workspaces', () => {
  it('creates the workspace and makes the creator its owner (201)', async () => {
    const owner = await createUserAndLogin(app);
    const res = await call('POST', '/api/workspaces', owner, { name: '  Acme  ' });
    expect(res.statusCode).toBe(201);
    const { workspace } = workspaceResponseSchema.parse(res.json());
    expect(workspace).toMatchObject({ name: 'Acme', role: 'owner' });
    const memberships = await prisma.membership.findMany();
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      workspaceId: workspace.id,
      userId: owner.user.id,
      role: 'owner',
    });
  });

  it.each([
    ['empty name', { name: '' }],
    ['missing name', {}],
    ['name too long', { name: 'a'.repeat(81) }],
    ['unknown field', { name: 'A', role: 'owner' }],
  ])('rejects %s (400)', async (_label, body) => {
    const owner = await createUserAndLogin(app);
    const res = await call('POST', '/api/workspaces', owner, body);
    expect(res.statusCode).toBe(400);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.workspace.count()).toBe(0);
  });

  it('requires a session (401) and the web origin (403)', async () => {
    const anonymous = await call('POST', '/api/workspaces', undefined, { name: 'A' });
    expect(anonymous.statusCode).toBe(401);
    const owner = await createUserAndLogin(app);
    const wrongOrigin = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: { cookie: owner.cookie, origin: 'http://evil.example' },
      payload: { name: 'A' },
    });
    expect(wrongOrigin.statusCode).toBe(403);
    expect(apiErrorSchema.parse(wrongOrigin.json()).error.code).toBe('CSRF_REJECTED');
  });
});

describe('GET /api/workspaces', () => {
  it('lists only my workspaces with my role', async () => {
    const { owner, member, viewer, outsider, workspace } = await setup();
    const other = await createWorkspace(outsider, 'Secret');

    const asRole = async (who: TestUser) =>
      workspaceListResponseSchema.parse((await call('GET', '/api/workspaces', who)).json())
        .workspaces;

    expect(await asRole(owner)).toEqual([workspace]);
    expect((await asRole(member))[0]?.role).toBe('member');
    expect((await asRole(viewer))[0]?.role).toBe('viewer');
    expect(await asRole(outsider)).toEqual([other]);
  });

  it('returns an empty list for a new user and 401 without a session', async () => {
    const user = await createUserAndLogin(app);
    const res = await call('GET', '/api/workspaces', user);
    expect(workspaceListResponseSchema.parse(res.json()).workspaces).toEqual([]);
    expect((await call('GET', '/api/workspaces')).statusCode).toBe(401);
  });
});

describe('GET /api/workspaces/:id', () => {
  it('returns the workspace to every role', async () => {
    const { owner, member, viewer, workspace } = await setup();
    const roles: [TestUser, Role][] = [
      [owner, 'owner'],
      [member, 'member'],
      [viewer, 'viewer'],
    ];
    for (const [who, role] of roles) {
      const res = await call('GET', `/api/workspaces/${workspace.id}`, who);
      expect(res.statusCode).toBe(200);
      expect(workspaceResponseSchema.parse(res.json()).workspace).toEqual({ ...workspace, role });
    }
  });

  it('answers a non-member exactly like a random id (404)', async () => {
    const { outsider, workspace } = await setup();
    const real = await call('GET', `/api/workspaces/${workspace.id}`, outsider);
    const random = await call('GET', `/api/workspaces/${randomUUID()}`, outsider);
    expect(real.statusCode).toBe(404);
    expect(random.statusCode).toBe(404);
    expect(real.json()).toEqual(random.json());
    expect(apiErrorSchema.parse(real.json()).error.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed id (400) and anonymous callers (401)', async () => {
    const user = await createUserAndLogin(app);
    expect((await call('GET', '/api/workspaces/not-a-uuid', user)).statusCode).toBe(400);
    expect((await call('GET', `/api/workspaces/${randomUUID()}`)).statusCode).toBe(401);
  });
});

describe('PATCH /api/workspaces/:id', () => {
  it('lets the owner rename (200)', async () => {
    const { owner, workspace } = await setup();
    const res = await call('PATCH', `/api/workspaces/${workspace.id}`, owner, { name: 'Renamed' });
    expect(res.statusCode).toBe(200);
    expect(workspaceResponseSchema.parse(res.json()).workspace).toMatchObject({
      id: workspace.id,
      name: 'Renamed',
      role: 'owner',
    });
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: workspace.id } })).name).toBe(
      'Renamed',
    );
  });

  it('forbids a member and a viewer (403) without changing anything', async () => {
    const { member, viewer, workspace } = await setup();
    for (const who of [member, viewer]) {
      const res = await call('PATCH', `/api/workspaces/${workspace.id}`, who, { name: 'Hacked' });
      expect(res.statusCode).toBe(403);
      expect(apiErrorSchema.parse(res.json()).error.code).toBe('FORBIDDEN');
    }
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: workspace.id } })).name).toBe(
      'Acme',
    );
  });

  it('answers a non-member like a random id (404), and rejects bad input (400)', async () => {
    const { owner, outsider, workspace } = await setup();
    const real = await call('PATCH', `/api/workspaces/${workspace.id}`, outsider, { name: 'X' });
    const random = await call('PATCH', `/api/workspaces/${randomUUID()}`, outsider, { name: 'X' });
    expect(real.statusCode).toBe(404);
    expect(real.json()).toEqual(random.json());
    const bad = await call('PATCH', `/api/workspaces/${workspace.id}`, owner, { name: '' });
    expect(bad.statusCode).toBe(400);
    expect(
      (await call('PATCH', `/api/workspaces/${workspace.id}`, undefined, { name: 'X' })).statusCode,
    ).toBe(401);
  });
});

describe('DELETE /api/workspaces/:id', () => {
  it('lets the owner delete with the name, cascading memberships (204)', async () => {
    const { owner, workspace } = await setup();
    const other = await createWorkspace(owner, 'Keep me');
    expect(await prisma.membership.count({ where: { workspaceId: workspace.id } })).toBe(3);
    const res = await call('DELETE', `/api/workspaces/${workspace.id}`, owner, {
      confirmName: 'Acme',
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(await prisma.workspace.count({ where: { id: workspace.id } })).toBe(0);
    expect(await prisma.membership.count({ where: { workspaceId: workspace.id } })).toBe(0);
    // Other workspaces and the users are untouched.
    expect(await prisma.workspace.count({ where: { id: other.id } })).toBe(1);
    expect(await prisma.user.count()).toBe(4);
    expect((await call('GET', `/api/workspaces/${workspace.id}`, owner)).statusCode).toBe(404);
  });

  it('rejects a wrong or missing confirmation name (400) and deletes nothing', async () => {
    const { owner, workspace } = await setup();
    for (const body of [{ confirmName: 'acme' }, { confirmName: '' }, {}]) {
      const res = await call('DELETE', `/api/workspaces/${workspace.id}`, owner, body);
      expect(res.statusCode).toBe(400);
      expect(apiErrorSchema.parse(res.json()).error.code).toBe('VALIDATION_ERROR');
    }
    expect(await prisma.workspace.count({ where: { id: workspace.id } })).toBe(1);
  });

  it('forbids a member and a viewer (403), even with the right name', async () => {
    const { member, viewer, workspace } = await setup();
    for (const who of [member, viewer]) {
      const res = await call('DELETE', `/api/workspaces/${workspace.id}`, who, {
        confirmName: 'Acme',
      });
      expect(res.statusCode).toBe(403);
    }
    expect(await prisma.workspace.count({ where: { id: workspace.id } })).toBe(1);
  });

  it('answers a non-member like a random id (404) and anonymous callers 401', async () => {
    const { outsider, workspace } = await setup();
    const body = { confirmName: 'Acme' };
    const real = await call('DELETE', `/api/workspaces/${workspace.id}`, outsider, body);
    const random = await call('DELETE', `/api/workspaces/${randomUUID()}`, outsider, body);
    expect(real.statusCode).toBe(404);
    expect(real.json()).toEqual(random.json());
    expect(
      (await call('DELETE', `/api/workspaces/${workspace.id}`, undefined, body)).statusCode,
    ).toBe(401);
    expect(await prisma.workspace.count({ where: { id: workspace.id } })).toBe(1);
  });
});

describe('authorize()', () => {
  it('returns workspace and role, 404 for non-members and unknown ids, 403 for a weak role', async () => {
    const { member, outsider, workspace } = await setup();
    const ref = { type: 'workspace', id: workspace.id } as const;
    await expect(authorize(prisma, member.user, ref, 'card:edit')).resolves.toEqual({
      workspaceId: workspace.id,
      role: 'member',
    });
    await expect(authorize(prisma, member.user, ref, 'workspace:delete')).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
    await expect(authorize(prisma, outsider.user, ref, 'workspace:read')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    await expect(
      authorize(prisma, member.user, { type: 'workspace', id: randomUUID() }, 'workspace:read'),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });
});
