import { z } from 'zod';

/** Role of a user inside one workspace (see ADR 0003). */
export const ROLES = ['owner', 'member', 'viewer'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/** Everything a route or the WebSocket server may ask the policy about. */
export const ACTIONS = [
  'workspace:read',
  'card:edit',
  'board:manage',
  'project:manage',
  'project:delete',
  'members:manage',
  'workspace:update',
  'workspace:delete',
] as const;
export const actionSchema = z.enum(ACTIONS);
export type Action = z.infer<typeof actionSchema>;

/** The role x action matrix of ADR 0003. The single source of truth for api and web. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Action>>> = {
  owner: new Set<Action>(ACTIONS),
  member: new Set<Action>(['workspace:read', 'card:edit', 'board:manage', 'project:manage']),
  viewer: new Set<Action>(['workspace:read']),
};

/** True when `role` may perform `action`. */
export function can(role: Role, action: Action): boolean {
  return ROLE_PERMISSIONS[role].has(action);
}
