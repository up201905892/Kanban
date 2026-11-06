import { ErrorCode, can, type Action, type Role } from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError, notFound } from '../../lib/app-error.js';

/**
 * A resource reference. Later tasks add variants (project, board, column, card, ...) together with
 * a resolver in `RESOLVERS` that maps the resource to the ID of its workspace.
 */
export type ResourceRef =
  | { type: 'workspace'; id: string }
  | { type: 'project'; id: string }
  | { type: 'invite'; id: string }
  | { type: 'board'; id: string }
  | { type: 'column'; id: string }
  | { type: 'card'; id: string };

type Db = Pick<PrismaClient, 'membership' | 'project' | 'invite' | 'board' | 'column' | 'card'>;
type Resolver<T extends ResourceRef['type']> = (
  db: Db,
  id: Extract<ResourceRef, { type: T }>['id'],
) => Promise<string | null>;

const RESOLVERS: { [T in ResourceRef['type']]: Resolver<T> } = {
  // A workspace resolves to itself; a missing workspace has no membership and is a 404 below.
  workspace: async (_db, id) => id,
  // A project resolves to its workspace with one indexed lookup.
  project: async (db, id) =>
    (await db.project.findUnique({ where: { id }, select: { workspaceId: true } }))?.workspaceId ??
    null,
  // An invite resolves to its workspace with one indexed lookup.
  invite: async (db, id) =>
    (await db.invite.findUnique({ where: { id }, select: { workspaceId: true } }))?.workspaceId ??
    null,
  // A board resolves through its project.
  board: async (db, id) =>
    (
      await db.board.findUnique({
        where: { id },
        select: { project: { select: { workspaceId: true } } },
      })
    )?.project.workspaceId ?? null,
  // A column resolves through its board and project.
  column: async (db, id) =>
    (
      await db.column.findUnique({
        where: { id },
        select: { board: { select: { project: { select: { workspaceId: true } } } } },
      })
    )?.board.project.workspaceId ?? null,
  // A card resolves through its board and project. A soft-deleted card does not resolve at all, so
  // every later request about it is a plain 404 for every role.
  card: async (db, id) =>
    (
      await db.card.findFirst({
        where: { id, deletedAt: null },
        select: { board: { select: { project: { select: { workspaceId: true } } } } },
      })
    )?.board.project.workspaceId ?? null,
};

export interface AuthzContext {
  workspaceId: string;
  role: Role;
}

export const forbidden = (): AppError =>
  new AppError(403, ErrorCode.FORBIDDEN, 'You do not have permission to do this');

/**
 * The single server-side authorization check (ADR 0003). Resolves the resource's workspace, loads
 * the caller's membership and throws:
 *  - 404 NOT_FOUND when the resource does not exist or the caller is not a member (identical body,
 *    so existence never leaks);
 *  - 403 FORBIDDEN when the caller is a member whose role lacks the permission.
 */
export async function authorize(
  db: Db,
  user: { id: string },
  resource: ResourceRef,
  action: Action,
): Promise<AuthzContext> {
  const resolver = RESOLVERS[resource.type] as Resolver<ResourceRef['type']>;
  const workspaceId = await resolver(db, resource.id);
  if (!workspaceId) throw notFound();
  const membership = await db.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    select: { role: true },
  });
  if (!membership) throw notFound();
  if (!can(membership.role, action)) throw forbidden();
  return { workspaceId, role: membership.role };
}
