import { ErrorCode, type Role, type Workspace } from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError, notFound } from '../../lib/app-error.js';
import { authorize } from '../authz/index.js';

interface WorkspaceRow {
  id: string;
  name: string;
  createdAt: Date;
}

const toWorkspace = (row: WorkspaceRow, role: Role): Workspace => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt.toISOString(),
  role,
});

const isRecordMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2025';

/** Creates the workspace and the creator's owner membership in one transaction. */
export async function createWorkspace(
  prisma: PrismaClient,
  user: { id: string },
  name: string,
): Promise<Workspace> {
  const row = await prisma.workspace.create({
    data: { name, memberships: { create: { userId: user.id, role: 'owner' } } },
  });
  return toWorkspace(row, 'owner');
}

/** Only the caller's workspaces, oldest first. */
export async function listWorkspaces(
  prisma: PrismaClient,
  user: { id: string },
): Promise<Workspace[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: [{ workspace: { createdAt: 'asc' } }, { workspaceId: 'asc' }],
  });
  return memberships.map((m) => toWorkspace(m.workspace, m.role));
}

export async function getWorkspace(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
): Promise<Workspace> {
  const { role } = await authorize(prisma, user, { type: 'workspace', id }, 'workspace:read');
  const row = await prisma.workspace.findUnique({ where: { id } });
  if (!row) throw notFound();
  return toWorkspace(row, role);
}

export async function renameWorkspace(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
  name: string,
): Promise<Workspace> {
  const { role } = await authorize(prisma, user, { type: 'workspace', id }, 'workspace:update');
  try {
    const row = await prisma.workspace.update({ where: { id }, data: { name } });
    return toWorkspace(row, role);
  } catch (error) {
    // Deleted between the check and the update.
    if (isRecordMissing(error)) throw notFound();
    throw error;
  }
}

/** Deletes the workspace; the database cascades to memberships (and, later, everything below). */
export async function deleteWorkspace(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
  confirmName: string,
): Promise<void> {
  await authorize(prisma, user, { type: 'workspace', id }, 'workspace:delete');
  const row = await prisma.workspace.findUnique({ where: { id }, select: { name: true } });
  if (!row) throw notFound();
  if (confirmName !== row.name) {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Invalid request', [
      { path: 'confirmName', message: 'Type the workspace name exactly to confirm' },
    ]);
  }
  await prisma.workspace.deleteMany({ where: { id } });
}
