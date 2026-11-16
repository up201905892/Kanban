import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectResponseSchema, workspaceResponseSchema } from '@kanban/shared';
import { buildApp } from '../../app.js';
import { createPrismaClient } from '../../db.js';
import { TEST_ORIGIN, createUserAndLogin } from '../../test-utils/auth.js';
import { resetDatabase } from '../../test-utils/reset-database.js';

// Verifies the hand-written constraints of the add_sprints migration by name.
const prisma = createPrismaClient(process.env['DATABASE_URL'] ?? '');
let app: FastifyInstance;

beforeEach(async () => {
  await resetDatabase(prisma);
  app = buildApp({ prisma, webOrigin: TEST_ORIGIN });
  await app.ready();
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

async function projectId() {
  const owner = await createUserAndLogin(app, { name: 'Olivia' });
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
  return projectResponseSchema.parse(
    (
      await app.inject({
        method: 'POST',
        url: `/api/workspaces/${ws.id}/projects`,
        headers: owner.headers,
        payload: { name: 'P', key: 'KB' },
      })
    ).json(),
  ).project.id;
}

const day = (d: string) => new Date(`${d}T00:00:00Z`);

describe('add_sprints migration constraints', () => {
  it('has the named CHECKs and the partial unique index in the catalog', async () => {
    const checks = await prisma.$queryRaw<{ conname: string }[]>`
      select conname from pg_constraint where conrelid = 'sprints'::regclass and contype = 'c'`;
    expect(checks.map((c) => c.conname).sort()).toEqual([
      'sprints_closed_check',
      'sprints_dates_check',
    ]);
    const idx = await prisma.$queryRaw<{ indexdef: string }[]>`
      select indexdef from pg_indexes where indexname = 'sprints_one_active_per_project_idx'`;
    expect(idx[0]?.indexdef).toMatch(/UNIQUE/);
    expect(idx[0]?.indexdef).toMatch(/WHERE .*status.*active/);
  });

  it('accepts a one-day sprint (end equals start) and refuses end before start by the CHECK', async () => {
    const pid = await projectId();
    await expect(
      prisma.sprint.create({
        data: {
          projectId: pid,
          name: 'One day',
          startDate: day('2026-11-20'),
          endDate: day('2026-11-20'),
        },
      }),
    ).resolves.toBeTruthy();
    await expect(
      prisma.sprint.create({
        data: {
          projectId: pid,
          name: 'Bad',
          startDate: day('2026-11-20'),
          endDate: day('2026-11-19'),
        },
      }),
    ).rejects.toThrow(/sprints_dates_check/);
  });

  it('refuses a closed sprint without closedAt and a closedAt on a non-closed sprint', async () => {
    const pid = await projectId();
    const base = { projectId: pid, startDate: day('2026-11-16'), endDate: day('2026-11-27') };
    await expect(
      prisma.sprint.create({ data: { ...base, name: 'A', status: 'closed' } }),
    ).rejects.toThrow(/sprints_closed_check/);
    await expect(
      prisma.sprint.create({
        data: { ...base, name: 'B', status: 'planned', closedAt: new Date() },
      }),
    ).rejects.toThrow(/sprints_closed_check/);
    await expect(
      prisma.sprint.create({
        data: { ...base, name: 'C', status: 'closed', closedAt: new Date() },
      }),
    ).resolves.toBeTruthy();
  });

  it('allows many closed sprints but only one active per project', async () => {
    const pid = await projectId();
    const base = { projectId: pid, startDate: day('2026-11-16'), endDate: day('2026-11-27') };
    await prisma.sprint.create({
      data: { ...base, name: 'C1', status: 'closed', closedAt: new Date() },
    });
    await prisma.sprint.create({
      data: { ...base, name: 'C2', status: 'closed', closedAt: new Date() },
    });
    await prisma.sprint.create({ data: { ...base, name: 'A1', status: 'active' } });
    await expect(
      prisma.sprint.create({ data: { ...base, name: 'A2', status: 'active' } }),
    ).rejects.toThrow(/sprints_one_active_per_project_idx|Unique constraint/);
  });

  it('declares ON DELETE SET NULL on the card sprint foreign key', async () => {
    const fk = await prisma.$queryRaw<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'cards_sprint_id_fkey'`;
    expect(fk[0]?.def).toMatch(/ON DELETE SET NULL/);
  });
});
