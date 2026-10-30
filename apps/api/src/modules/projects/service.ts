import { ErrorCode, type Project } from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError, notFound } from '../../lib/app-error.js';
import { authorize } from '../authz/index.js';

interface ProjectRow {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  createdAt: Date;
}

const toProject = (row: ProjectRow): Project => ({
  id: row.id,
  workspaceId: row.workspaceId,
  name: row.name,
  key: row.key,
  createdAt: row.createdAt.toISOString(),
});

const errorCodeOf = (error: unknown): unknown =>
  typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;

const keyTaken = (): AppError =>
  new AppError(409, ErrorCode.PROJECT_KEY_TAKEN, 'This key is already used in the workspace', [
    { path: 'key', message: 'This key is already used in the workspace' },
  ]);

export async function createProject(
  prisma: PrismaClient,
  user: { id: string },
  workspaceId: string,
  input: { name: string; key: string },
): Promise<Project> {
  await authorize(prisma, user, { type: 'workspace', id: workspaceId }, 'project:manage');
  try {
    return toProject(await prisma.project.create({ data: { workspaceId, ...input } }));
  } catch (error) {
    // The unique (workspace, key) index decides, so two concurrent creates cannot both win.
    if (errorCodeOf(error) === 'P2002') throw keyTaken();
    // The workspace was deleted between the check and the insert (foreign key).
    if (errorCodeOf(error) === 'P2003') throw notFound();
    throw error;
  }
}

/** Projects of one workspace, oldest first; the membership check scopes it to the caller. */
export async function listProjects(
  prisma: PrismaClient,
  user: { id: string },
  workspaceId: string,
): Promise<Project[]> {
  await authorize(prisma, user, { type: 'workspace', id: workspaceId }, 'workspace:read');
  const rows = await prisma.project.findMany({
    where: { workspaceId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toProject);
}

export async function getProject(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
): Promise<Project> {
  await authorize(prisma, user, { type: 'project', id }, 'workspace:read');
  const row = await prisma.project.findUnique({ where: { id } });
  if (!row) throw notFound();
  return toProject(row);
}

export async function renameProject(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
  name: string,
): Promise<Project> {
  await authorize(prisma, user, { type: 'project', id }, 'project:manage');
  try {
    return toProject(await prisma.project.update({ where: { id }, data: { name } }));
  } catch (error) {
    if (errorCodeOf(error) === 'P2025') throw notFound();
    throw error;
  }
}

/** Owner only; the database cascades to everything below the project later. */
export async function deleteProject(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
): Promise<void> {
  await authorize(prisma, user, { type: 'project', id }, 'project:delete');
  await prisma.project.deleteMany({ where: { id } });
}
