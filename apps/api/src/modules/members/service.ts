import { ErrorCode, type BoardEvent, type Member, type Role } from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError, notFound } from '../../lib/app-error.js';
import { cardEvent, publishBoardEvents } from '../../lib/board-events.js';
import { publishMembershipChange } from '../../lib/membership-events.js';
import { authorize } from '../authz/index.js';
import { lockBoard } from '../boards/lock.js';
import { recordActivity } from '../cards/activity.js';
import { toCardSummary } from '../cards/service.js';

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
  const member = await changeMemberRoleTx(prisma, user, workspaceId, targetUserId, role);
  publishMembershipChange({ workspaceId, userId: targetUserId, role: member.role });
  return member;
}

async function changeMemberRoleTx(
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

/**
 * Clears the person's assignments on live cards of the workspace, with one `assignee_changed`
 * event per card, in the caller's transaction (G4, G5). Boards are locked in id order first, like
 * every other card writer, so a concurrent move or edit cannot interleave.
 */
async function unassignCards(
  tx: Tx,
  workspaceId: string,
  userId: string,
  actorId: string,
): Promise<BoardEvent[]> {
  const events: BoardEvent[] = [];
  const cards = await tx.card.findMany({
    where: { assigneeId: userId, deletedAt: null, board: { project: { workspaceId } } },
    select: { id: true, boardId: true },
    orderBy: { id: 'asc' },
  });
  if (cards.length === 0) return events;
  for (const boardId of [...new Set(cards.map((c) => c.boardId))].sort()) {
    await lockBoard(tx, boardId);
  }
  // Re-read under the locks: an edit may have changed the assignee while we waited.
  const current = await tx.card.findMany({
    where: { id: { in: cards.map((c) => c.id) }, assigneeId: userId, deletedAt: null },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  for (const { id } of current) {
    const row = await tx.card.update({
      where: { id },
      data: { assigneeId: null, version: { increment: 1 } },
    });
    await recordActivity(tx, id, actorId, {
      type: 'assignee_changed',
      data: { from: userId, to: null },
    });
    events.push(cardEvent('card_updated', row.boardId, toCardSummary(row), actorId, {}));
  }
  return events;
}

/** Owners remove anyone; any member may remove themselves (leave). */
export async function removeMember(
  prisma: PrismaClient,
  user: { id: string },
  workspaceId: string,
  targetUserId: string,
): Promise<void> {
  const leaving = targetUserId === user.id;
  const events: BoardEvent[] = [];
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
    // Only the membership goes: everything the person created stays, but their assignments end.
    await tx.membership.delete({ where: { id: target.id } });
    events.push(...(await unassignCards(tx, workspaceId, targetUserId, user.id)));
  });
  // After commit, so a socket is never closed for a change that rolled back.
  publishMembershipChange({ workspaceId, userId: targetUserId, role: null });
  publishBoardEvents(events);
}
