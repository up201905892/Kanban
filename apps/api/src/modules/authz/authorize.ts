import { ErrorCode, can, type Action, type Role } from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError, notFound } from '../../lib/app-error.js';

/**
 * A resource reference. Later tasks add variants (project, board, column, card, ...) together with
 * a resolver in `RESOLVERS` that maps the resource to the ID of its workspace.
 */
export type ResourceRef = { type: 'workspace'; id: string };

type Db = Pick<PrismaClient, 'membership'>;
type Resolver<T extends ResourceRef['type']> = (
  db: Db,
  id: Extract<ResourceRef, { type: T }>['id'],
) => Promise<string | null>;

const RESOLVERS: { [T in ResourceRef['type']]: Resolver<T> } = {
  // A workspace resolves to itself; a missing workspace has no membership and is a 404 below.
  workspace: async (_db, id) => id,
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
