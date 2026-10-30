# 0003 · Authorization model

- **Status:** Accepted
- **Date:** 2026-10-30
- **Task:** KB-007
- **Technical decisions:** D1 (authorization stays in our server with the same policy for REST and WebSocket) and D3 (own authentication) in `docs/workflow/01-planning.md`.

## Context

Data belongs to a workspace (the tenant). Users join workspaces with a role. Every route, and later the WebSocket server (KB-016), must answer "may this user do this to that resource?" the same way, and must never reveal whether a resource in someone else's workspace exists (criterion A4).

## Decision

1. **Tenant boundary.** `Workspace` is the tenant. `Membership(workspaceId, userId, role)` is unique per pair and cascades when the workspace or the user is deleted. Every later resource belongs, directly or through a project, to exactly one workspace.
2. **Roles.** `owner`, `member`, `viewer`. A user has at most one role per workspace. The creator of a workspace becomes its owner in the same transaction.
3. **Role x action matrix.** The matrix lives in `packages/shared/src/authz.ts` (`ROLE_PERMISSIONS`, `can(role, action)`) so the API enforces it and the web app uses the same table to hide or disable controls (U7). It is covered by a table-driven unit test that spells every cell out.

   | Action | owner | member | viewer |
   | --- | --- | --- | --- |
   | `workspace:read` (read everything in the workspace) | yes | yes | yes |
   | `card:edit` (create, edit, move, delete cards and their fields) | yes | yes | no |
   | `board:manage` (columns, labels, sprints) | yes | yes | no |
   | `project:manage` (create and rename projects) | yes | yes | no |
   | `project:delete` | yes | no | no |
   | `members:manage` (invites, roles, removing members) | yes | no | no |
   | `workspace:update` (rename) | yes | no | no |
   | `workspace:delete` | yes | no | no |

   Rationale: members are the working team and shape the board and the sprints; destructive or administrative actions (deleting a project, managing people, deleting the workspace) are owner-only; viewers are read-only. Adding an action means adding a row to the matrix and to its test.
4. **404 versus 403.** `authorize(db, user, resource, action)` in `apps/api/src/modules/authz` resolves the resource to a workspace and loads the caller's membership:
   - resource missing, or caller not a member: `404 NOT_FOUND` with the same status, code and message in both cases, so existence never leaks;
   - caller is a member but the role lacks the action: `403 FORBIDDEN`.

   The existence check therefore always comes before the permission check. Validation of the request shape (400) does not depend on the resource and may run first; checks that depend on the resource's data (for example the confirmation name when deleting a workspace) run only after `authorize`.
5. **Resolving resources to workspaces.** A `ResourceRef` is a tagged union (`{ type, id }`). Each type has a resolver that returns the workspace ID or `null`: a workspace resolves to itself; KB-008 added `project` (project to workspace, one lookup on `projects.workspace_id`); later tasks add board, column, card, label and sprint by walking up to the project. A resolver is a single indexed lookup. A new route must pick the resource it acts on, call `authorize` with the matching action, and use the returned `workspaceId` for every further query, so IDs in a request body that point into another workspace are rejected rather than linked.
6. **Lists.** List endpoints filter by membership in the query itself (`GET /api/workspaces` joins on the caller's memberships) instead of fetching and filtering.
7. **Reuse by the WebSocket server.** KB-016 calls the same `authorize` with the user from `getSessionFromCookieHeader`; viewers get `workspace:read` only, which maps to receive-only rooms.
8. **Deleting a workspace.** Owner only, and the body must repeat the exact workspace name (`400 VALIDATION_ERROR` otherwise). The database cascades to memberships and to everything added below the workspace later.

## Alternatives considered

- **Per-route role checks written inline:** easy to forget and impossible to test as one table.
- **A policy library (CASL and similar):** an extra dependency for eight actions and three roles.
- **Returning 403 to non-members:** reveals that a workspace or resource exists. Rejected by A4.
- **Several roles per user or custom roles:** not needed in v1.0.
- **Row-level security in PostgreSQL:** strong, but ties every query to a session variable and complicates Prisma and tests; server-side checks suffice for a single API.

## Consequences

- One function guards every route, and the matrix has one place to change; the web app cannot drift from the server.
- A forgotten `authorize` call is the main risk. Each task's API test matrix (A7) must include the 404 and 403 cases; a reviewer should check that every new route calls `authorize`.
- Every `authorize` call costs one extra membership query (and one resolver query for nested resources). Acceptable at this scale; a per-request cache can be added if profiling asks for it.
- Removing a member or changing a role takes effect on the next request, because nothing about roles is stored in the session.
