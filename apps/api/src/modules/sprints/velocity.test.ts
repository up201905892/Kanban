import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  projectResponseSchema,
  velocityResponseSchema,
  workspaceResponseSchema,
} from '@kanban/shared';
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

async function setup() {
  const [owner, viewer, outsider] = await Promise.all([
    createUserAndLogin(app, { name: 'Olivia' }),
    createUserAndLogin(app, { name: 'Vera' }),
    createUserAndLogin(app, { name: 'Eve' }),
  ]);
  const ws = workspaceResponseSchema.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/workspaces',
        headers: owner.headers,
        payload: { name: 'Acme' },
      })
    ).json(),
  ).workspace;
  await prisma.membership.create({
    data: { workspaceId: ws.id, userId: viewer.user.id, role: 'viewer' },
  });
  const project = projectResponseSchema.parse(
    (
      await app.inject({
        method: 'POST',
        url: `/api/workspaces/${ws.id}/projects`,
        headers: owner.headers,
        payload: { name: 'P', key: 'KB' },
      })
    ).json(),
  ).project;
  return { owner, viewer, outsider, project };
}

const get = (url: string, who?: { headers: Record<string, string> }) =>
  app.inject({ method: 'GET', url, ...(who ? { headers: who.headers } : {}) });

const dates = { startDate: new Date('2026-01-01'), endDate: new Date('2026-01-14') };

describe('GET /api/projects/:pid/velocity', () => {
  it('is empty with no closed sprints (active and planned ones are ignored)', async () => {
    const { owner, project } = await setup();
    await prisma.sprint.createMany({
      data: [
        { projectId: project.id, name: 'Planned', ...dates },
        { projectId: project.id, name: 'Active', status: 'active', committedPoints: 5, ...dates },
      ],
    });
    const res = await get(`/api/projects/${project.id}/velocity`, owner);
    expect(res.statusCode).toBe(200);
    expect(velocityResponseSchema.parse(res.json())).toEqual({
      sprints: [],
      averageCompleted: 0,
    });
  });

  it('returns the last 6 closed sprints in chronological order with the average', async () => {
    const { viewer, project } = await setup();
    for (let i = 1; i <= 8; i += 1) {
      await prisma.sprint.create({
        data: {
          projectId: project.id,
          name: `Sprint ${i}`,
          status: 'closed',
          ...dates,
          committedPoints: 10,
          completedPoints: i,
          closedAt: new Date(Date.UTC(2026, 0, i + 1)),
        },
      });
    }
    const res = await get(`/api/projects/${project.id}/velocity`, viewer);
    expect(res.statusCode).toBe(200);
    const body = velocityResponseSchema.parse(res.json());
    expect(body.sprints.map((s) => s.name)).toEqual([
      'Sprint 3',
      'Sprint 4',
      'Sprint 5',
      'Sprint 6',
      'Sprint 7',
      'Sprint 8',
    ]);
    expect(body.sprints[0]).toMatchObject({ committedPoints: 10, completedPoints: 3 });
    expect(body.averageCompleted).toBe(5.5);
  });

  it('is 404 for a non-member (same as a missing project) and 401 without a session', async () => {
    const { outsider, project } = await setup();
    const denied = await get(`/api/projects/${project.id}/velocity`, outsider);
    const missing = await get(
      '/api/projects/0194a3c2-0000-7000-8000-000000000000/velocity',
      outsider,
    );
    expect(denied.statusCode).toBe(404);
    expect(apiErrorSchema.parse(denied.json())).toEqual(apiErrorSchema.parse(missing.json()));
    expect((await get(`/api/projects/${project.id}/velocity`)).statusCode).toBe(401);
  });
});
