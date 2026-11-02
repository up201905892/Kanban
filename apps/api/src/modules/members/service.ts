import { ErrorCode, type Member, type Role } from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError, notFound } from '../../lib/app-error.js';
import { authorize } from '../authz/index.js';

interface MemberRow {
  userId: string;
  role: Role;
  createdAt: Date;
  user: { name: string; email: string };
}

const toMember = (row: MemberRow): Member => ({
  userId: row.userId,
  name: row.user.name,
  email: row.user.email,
  role: row.role,
  joinedAt: row.createdAt.toISOString(),
});

export const lastOwner = (): AppError =>
  new AppError(
    409,
    ErrorCode.LAST_OWNER,
    'A workspace needs at least one owner. Make someone else an owner first.',
  );

export async function listMembers(
  prisma: PrismaClient,
  user: { id: string },
  workspaceId: string,
): Promise<Member[]> {
  await authorize(prisma, user, { type: 'workspace', id: workspaceId }, 'workspace:read');
  const rows = await prisma.membership.findMany({
    where: { workspaceId },
    include: { user: { select: { name: true, email: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toMember);
}

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Serialises membership changes of one workspace by locking its row, so two owners demoting each
 * other at the same time cannot leave the workspace without an owner.
 */
async function lockWorkspace(tx: Tx, workspaceId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
}

export async function changeMemberRole(
  prisma: PrismaClient,
  user: { id: string },
  workspaceId: string,
  targetUserId: string,
  role: Role,
): Promise<Member> {
  return prisma.$transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    await authorize(tx, user, { type: 'workspace', id: workspaceId }, 'members:manage');
    const target = await tx.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) throw notFound();
    if (target.role === 'owner' && role !== 'owner') {
      const owners = await tx.membership.count({ where: { workspaceId, role: 'owner' } });
      if (owners <= 1) throw lastOwner();
    }
    const row = await tx.membership.update({
      where: { id: target.id },
      data: { role },
      include: { user: { select: { name: true, email: true } } },
    });
    return toMember(row);
  });
}

/** Owners remove anyone; any member may remove themselves (leave). */
export async function removeMember(
  prisma: PrismaClient,
  user: { id: string },
  workspaceId: string,
  targetUserId: string,
): Promise<void> {
  const leaving = targetUserId === user.id;
  await prisma.$transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    await authorize(
      tx,
      user,
      { type: 'workspace', id: workspaceId },
      leaving ? 'workspace:read' : 'members:manage',
    );
    const target = await tx.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) throw notFound();
    if (target.role === 'owner') {
      const owners = await tx.membership.count({ where: { workspaceId, role: 'owner' } });
      if (owners <= 1) throw lastOwner();
    }
    // Only the membership goes: everything the person created stays.
    await tx.membership.delete({ where: { id: target.id } });
  });
}
