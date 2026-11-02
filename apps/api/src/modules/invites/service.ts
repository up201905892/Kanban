import {
  ErrorCode,
  inviteLink,
  type AcceptInviteResponse,
  type CreateInviteRequest,
  type CreateInviteResponse,
  type Invite,
  type InvitePreview,
  type InviteRole,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError } from '../../lib/app-error.js';
import { generateToken, hashToken } from '../auth/tokens.js';
import { authorize } from '../authz/index.js';
import { isInviteValid } from './validity.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** One error for unknown, expired, revoked and exhausted tokens, so nothing leaks. */
export const inviteInvalid = (): AppError =>
  new AppError(404, ErrorCode.INVITE_INVALID, 'This invite link is invalid or has expired');

interface InviteRow {
  id: string;
  role: string;
  createdAt: Date;
  expiresAt: Date;
  maxUses: number | null;
  uses: number;
}

const toInvite = (row: InviteRow): Invite => ({
  id: row.id,
  role: row.role as InviteRole,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  maxUses: row.maxUses,
  uses: row.uses,
});

export async function createInvite(
  prisma: PrismaClient,
  user: { id: string },
  workspaceId: string,
  input: CreateInviteRequest,
  webOrigin: string,
  now = new Date(),
): Promise<CreateInviteResponse> {
  await authorize(prisma, user, { type: 'workspace', id: workspaceId }, 'members:manage');
  const token = generateToken();
  const row = await prisma.invite.create({
    data: {
      workspaceId,
      tokenHash: hashToken(token),
      role: input.role,
      createdById: user.id,
      expiresAt: new Date(now.getTime() + input.expiresInDays * DAY_MS),
      maxUses: input.maxUses ?? null,
    },
  });
  return { invite: toInvite(row), link: inviteLink(webOrigin, token) };
}

/** Active invites only: not revoked, not expired, not exhausted. */
export async function listActiveInvites(
  prisma: PrismaClient,
  user: { id: string },
  workspaceId: string,
  now = new Date(),
): Promise<Invite[]> {
  await authorize(prisma, user, { type: 'workspace', id: workspaceId }, 'members:manage');
  const rows = await prisma.invite.findMany({
    where: { workspaceId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return rows.filter((row) => isInviteValid(row, now)).map(toInvite);
}

export async function revokeInvite(
  prisma: PrismaClient,
  user: { id: string },
  inviteId: string,
  now = new Date(),
): Promise<void> {
  await authorize(prisma, user, { type: 'invite', id: inviteId }, 'members:manage');
  // Keeps the first revocation time if it is revoked twice; a vanished invite is simply gone.
  await prisma.invite.updateMany({
    where: { id: inviteId, revokedAt: null },
    data: { revokedAt: now },
  });
}

/** Public: what the link offers. Every invalid case gives the same error. */
export async function previewInvite(
  prisma: PrismaClient,
  token: string,
  now = new Date(),
): Promise<InvitePreview> {
  const row = await prisma.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { workspace: { select: { name: true } } },
  });
  if (!row || !isInviteValid(row, now)) throw inviteInvalid();
  return {
    workspaceName: row.workspace.name,
    role: row.role as InviteRole,
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** Thrown inside the transaction to undo the use counter when the user was already a member. */
class AlreadyMember extends Error {}

/**
 * Accepts an invite. The use counter is incremented with a conditional update (the WHERE clause
 * re-checks revocation, expiry and `maxUses` on the locked row), in the same transaction as the
 * membership insert, so concurrent accepts can never exceed `maxUses`.
 * An existing member gets the workspace ID back and nothing changes (no role change, no use).
 */
export async function acceptInvite(
  prisma: PrismaClient,
  user: { id: string },
  token: string,
  now = new Date(),
): Promise<AcceptInviteResponse> {
  const tokenHash = hashToken(token);
  const invite = await prisma.invite.findUnique({ where: { tokenHash } });
  if (!invite || !isInviteValid(invite, now)) throw inviteInvalid();

  const existing = await prisma.membership.findUnique({
    where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id } },
    select: { id: true },
  });
  if (existing) return { workspaceId: invite.workspaceId };

  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({
        where: {
          id: invite.id,
          revokedAt: null,
          expiresAt: { gt: now },
          OR: [{ maxUses: null }, { uses: { lt: tx.invite.fields.maxUses } }],
        },
        data: { uses: { increment: 1 } },
      });
      if (claimed.count !== 1) throw inviteInvalid();
      const created = await tx.membership.createMany({
        data: [{ workspaceId: invite.workspaceId, userId: user.id, role: invite.role }],
        skipDuplicates: true,
      });
      // A parallel accept by the same user won the race: undo this use.
      if (created.count !== 1) throw new AlreadyMember();
    });
  } catch (error) {
    if (error instanceof AlreadyMember) return { workspaceId: invite.workspaceId };
    // The workspace was deleted between the check and the insert: same as an invalid link.
    if ((error as { code?: unknown }).code === 'P2003') throw inviteInvalid();
    throw error;
  }
  return { workspaceId: invite.workspaceId };
}
