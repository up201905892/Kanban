import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  projectListResponseSchema,
  projectResponseSchema,
  workspaceResponseSchema,
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

function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  who?: TestUser,
  body?: object,
) {
  return app.inject({
    method,
    url,
    headers: who ? who.headers : { origin: TEST_ORIGIN },
    ...(body ? { payload: body } : {}),
  });
}

async function createWorkspace(owner: TestUser, name = 'Acme') {
  const res = await call('POST', '/api/workspaces', owner, { name });
  return workspaceResponseSchema.parse(res.json()).workspace;
}

async function createProject(
  who: TestUser,
  workspaceId: string,
  name = 'Kanban Board',
  key = 'KB',
) {
  const res = await call('POST', `/api/workspaces/${workspaceId}/projects`, who, { name, key });
  expect(res.statusCode).toBe(201);
  return projectResponseSchema.parse(res.json()).project;
}

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

const notFoundBody = (res: { json: () => unknown }) => apiErrorSchema.parse(res.json());

describe('POST /api/workspaces/:wid/projects', () => {
  it('creates a project as owner and as member (201)', async () => {
    const { owner, member, workspace } = await setup();
    const a = await createProject(owner, workspace.id, 'Kanban Board', 'KB');
    const b = await createProject(member, workspace.id, 'Website', 'WEB');
    expect(a).toMatchObject({ workspaceId: workspace.id, name: 'Kanban Board', key: 'KB' });
    expect(b.key).toBe('WEB');
    const row = await prisma.project.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.nextCardNumber).toBe(1);
  });

  it.each([
    ['lowercase key', { name: 'A', key: 'kb' }],
    ['one-letter key', { name: 'A', key: 'K' }],
    ['six-letter key', { name: 'A', key: 'ABCDEF' }],
    ['key with a digit', { name: 'A', key: 'K1' }],
    ['empty name', { name: '', key: 'KB' }],
    ['name too long', { name: 'a'.repeat(81), key: 'KB' }],
    ['missing key', { name: 'A' }],
    ['unknown field', { name: 'A', key: 'KB', nextCardNumber: 99 }],
  ])('rejects %s (400)', async (_label, body) => {
    const { owner, workspace } = await setup();
    const res = await call('POST', `/api/workspaces/${workspace.id}/projects`, owner, body);
    expect(res.statusCode).toBe(400);
    expect(notFoundBody(res).error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.project.count()).toBe(0);
  });

  it('rejects a malformed workspace id (400)', async () => {
    const { owner } = await setup();
    const res = await call('POST', '/api/workspaces/nope/projects', owner, {
      name: 'A',
      key: 'KB',
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers 409 PROJECT_KEY_TAKEN for a duplicate key in the same workspace', async () => {
    const { owner, workspace } = await setup();
    await createProject(owner, workspace.id);
    const res = await call('POST', `/api/workspaces/${workspace.id}/projects`, owner, {
      name: 'Other',
      key: 'KB',
    });
    expect(res.statusCode).toBe(409);
    const { error } = notFoundBody(res);
    expect(error.code).toBe('PROJECT_KEY_TAKEN');
    expect(error.details?.[0]?.path).toBe('key');
    expect(await prisma.project.count()).toBe(1);
  });

  it('allows the same key in different workspaces', async () => {
    const { owner, workspace } = await setup();
    const other = await createWorkspace(owner, 'Second');
    await createProject(owner, workspace.id);
    await createProject(owner, other.id);
    expect(await prisma.project.count()).toBe(2);
  });

  it('lets only one of two concurrent creates with the same key win', async () => {
    const { owner, workspace } = await setup();
    const results = await Promise.all(
      ['One', 'Two', 'Three'].map((name) =>
        call('POST', `/api/workspaces/${workspace.id}/projects`, owner, { name, key: 'KB' }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
  });

  it('requires a session (401)', async () => {
    const { workspace } = await setup();
    const res = await call('POST', `/api/workspaces/${workspace.id}/projects`, undefined, {
      name: 'A',
      key: 'KB',
    });
    expect(res.statusCode).toBe(401);
  });

  it('answers 404 to a non-member exactly like for an unknown workspace', async () => {
    const { outsider, workspace } = await setup();
    const body = { name: 'A', key: 'KB' };
    const foreign = await call('POST', `/api/workspaces/${workspace.id}/projects`, outsider, body);
    const unknown = await call('POST', `/api/workspaces/${randomUUID()}/projects`, outsider, body);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual(unknown.json());
    expect(await prisma.project.count()).toBe(0);
  });

  it('answers 403 to a viewer', async () => {
    const { viewer, workspace } = await setup();
    const res = await call('POST', `/api/workspaces/${workspace.id}/projects`, viewer, {
      name: 'A',
      key: 'KB',
    });
    expect(res.statusCode).toBe(403);
    expect(notFoundBody(res).error.code).toBe('FORBIDDEN');
  });
});

describe('GET /api/workspaces/:wid/projects', () => {
  it('lists the workspace projects for every role and isolates workspaces', async () => {
    const { owner, member, viewer, workspace } = await setup();
    const other = await createWorkspace(owner, 'Second');
    const kb = await createProject(owner, workspace.id, 'Kanban Board', 'KB');
    await createProject(owner, other.id, 'Hidden', 'HID');
    for (const who of [owner, member, viewer]) {
      const res = await call('GET', `/api/workspaces/${workspace.id}/projects`, who);
      expect(res.statusCode).toBe(200);
      expect(projectListResponseSchema.parse(res.json()).projects).toEqual([kb]);
    }
  });

  it('returns an empty list for a workspace without projects', async () => {
    const { owner, workspace } = await setup();
    const res = await call('GET', `/api/workspaces/${workspace.id}/projects`, owner);
    expect(res.json()).toEqual({ projects: [] });
  });

  it('answers 401 and 404 for anonymous callers and non-members', async () => {
    const { outsider, workspace } = await setup();
    expect((await call('GET', `/api/workspaces/${workspace.id}/projects`)).statusCode).toBe(401);
    const res = await call('GET', `/api/workspaces/${workspace.id}/projects`, outsider);
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/projects/:pid', () => {
  it('returns the project to every role', async () => {
    const { owner, member, viewer, workspace } = await setup();
    const project = await createProject(owner, workspace.id);
    for (const who of [owner, member, viewer]) {
      const res = await call('GET', `/api/projects/${project.id}`, who);
      expect(res.statusCode).toBe(200);
      expect(projectResponseSchema.parse(res.json()).project).toEqual(project);
    }
  });

  it('answers an identical 404 for a non-member and for an unknown id', async () => {
    const { owner, outsider, workspace } = await setup();
    const project = await createProject(owner, workspace.id);
    const foreign = await call('GET', `/api/projects/${project.id}`, outsider);
    const unknown = await call('GET', `/api/projects/${randomUUID()}`, outsider);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual(unknown.json());
  });

  it('answers 401 and 400', async () => {
    const { owner, workspace } = await setup();
    const project = await createProject(owner, workspace.id);
    expect((await call('GET', `/api/projects/${project.id}`)).statusCode).toBe(401);
    expect((await call('GET', '/api/projects/nope', owner)).statusCode).toBe(400);
  });
});

describe('PATCH /api/projects/:pid', () => {
  it('renames as owner and as member, keeping the key', async () => {
    const { owner, member, workspace } = await setup();
    const project = await createProject(owner, workspace.id);
    const a = await call('PATCH', `/api/projects/${project.id}`, owner, { name: ' Renamed ' });
    expect(projectResponseSchema.parse(a.json()).project).toMatchObject({
      name: 'Renamed',
      key: 'KB',
    });
    const b = await call('PATCH', `/api/projects/${project.id}`, member, { name: 'Again' });
    expect(b.statusCode).toBe(200);
  });

  it('rejects a key change, empty names and unknown fields (400)', async () => {
    const { owner, workspace } = await setup();
    const project = await createProject(owner, workspace.id);
    for (const body of [{ name: 'X', key: 'ZZ' }, { name: '' }, {}]) {
      const res = await call('PATCH', `/api/projects/${project.id}`, owner, body);
      expect(res.statusCode).toBe(400);
    }
    const row = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(row).toMatchObject({ name: 'Kanban Board', key: 'KB' });
  });

  it('answers 403 to a viewer, 404 to a non-member, 401 to anonymous', async () => {
    const { owner, viewer, outsider, workspace } = await setup();
    const project = await createProject(owner, workspace.id);
    const body = { name: 'Nope' };
    expect((await call('PATCH', `/api/projects/${project.id}`, viewer, body)).statusCode).toBe(403);
    expect((await call('PATCH', `/api/projects/${project.id}`, outsider, body)).statusCode).toBe(
      404,
    );
    expect((await call('PATCH', `/api/projects/${project.id}`, undefined, body)).statusCode).toBe(
      401,
    );
    const row = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(row.name).toBe('Kanban Board');
  });
});

describe('DELETE /api/projects/:pid', () => {
  it('lets the owner delete (204)', async () => {
    const { owner, workspace } = await setup();
    const project = await createProject(owner, workspace.id);
    const res = await call('DELETE', `/api/projects/${project.id}`, owner);
    expect(res.statusCode).toBe(204);
    expect(await prisma.project.count()).toBe(0);
    expect((await call('GET', `/api/projects/${project.id}`, owner)).statusCode).toBe(404);
  });

  it('answers 403 to a member and a viewer, 404 to a non-member, 401 to anonymous', async () => {
    const { owner, member, viewer, outsider, workspace } = await setup();
    const project = await createProject(owner, workspace.id);
    for (const [who, status] of [
      [member, 403],
      [viewer, 403],
      [outsider, 404],
      [undefined, 401],
    ] as const) {
      const res = await call('DELETE', `/api/projects/${project.id}`, who);
      expect(res.statusCode).toBe(status);
    }
    expect(await prisma.project.count()).toBe(1);
  });

  it('frees the key for reuse', async () => {
    const { owner, workspace } = await setup();
    const project = await createProject(owner, workspace.id);
    await call('DELETE', `/api/projects/${project.id}`, owner);
    await createProject(owner, workspace.id);
  });

  it('is removed together with its workspace (cascade)', async () => {
    const { owner, workspace } = await setup();
    await createProject(owner, workspace.id);
    const res = await call('DELETE', `/api/workspaces/${workspace.id}`, owner, {
      confirmName: workspace.name,
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.project.count()).toBe(0);
  });
});

describe('authorize() with a project', () => {
  it('resolves the project to its workspace and applies the role matrix', async () => {
    const { owner, member, viewer, outsider, workspace } = await setup();
    const project = await createProject(owner, workspace.id);
    const ref = { type: 'project', id: project.id } as const;
    await expect(authorize(prisma, owner.user, ref, 'project:delete')).resolves.toEqual({
      workspaceId: workspace.id,
      role: 'owner',
    });
    await expect(authorize(prisma, member.user, ref, 'project:manage')).resolves.toMatchObject({
      role: 'member',
    });
    await expect(authorize(prisma, member.user, ref, 'project:delete')).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(authorize(prisma, viewer.user, ref, 'project:manage')).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(authorize(prisma, outsider.user, ref, 'workspace:read')).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      authorize(prisma, owner.user, { type: 'project', id: randomUUID() }, 'workspace:read'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
