# API reference

REST endpoints and real-time messages. Error format for every error response: `{ error: { code, message } }`, plus `details` for validation errors. The schemas (`ErrorCode`, `ApiError`) are in `packages/shared`.

## Conventions

- Every response carries an `x-request-id` header; the same id appears in the server logs.
- Unknown routes return `404 NOT_FOUND`; invalid or malformed requests return `400 VALIDATION_ERROR` (with `details` for schema errors); unexpected errors return `500 INTERNAL_ERROR` with a generic message and no stack trace.
- Cookies, authorization headers and passwords are redacted from logs.

- Every route except `GET /health`, `GET /health/ready`, `POST /api/auth/signup` and `POST /api/auth/login` requires the session cookie, otherwise `401 UNAUTHENTICATED`.
- Every POST, PUT, PATCH and DELETE must carry an `Origin` header equal to the web origin, otherwise `403 CSRF_REJECTED`.
- Design details: `docs/adr/0002-authentication-and-sessions.md`.

## REST

### POST /api/auth/signup

Public. Body `{ email, name, password }` (password 10 to 128 characters; unknown fields rejected; schema `signupRequestSchema`). Response `201 { user: { id, email, name, createdAt } }` and a `kanban_session` cookie. Errors: `400 VALIDATION_ERROR`, `409 EMAIL_TAKEN`, `429 RATE_LIMITED` (10 per minute per IP and email, with `Retry-After`).

### POST /api/auth/login

Public. Body `{ email, password }`. Response `200` as signup, with a new session cookie. Unknown email and wrong password both return `401 INVALID_CREDENTIALS` with the same body. Errors: `400`, `429`.

### POST /api/auth/logout

Authenticated. Response `204`; the session is deleted and the cookie cleared.

### GET /api/auth/me

Authenticated. Response `200 { user }`, or `401 UNAUTHENTICATED`.

### POST /api/workspaces

Authenticated. Body `{ name }` (1 to 80 characters, trimmed). Creates the workspace and makes the caller its owner in one transaction. Response `201 { workspace }` where `workspace` is `{ id, name, createdAt, role }`. Errors: `400`, `401`.

### GET /api/workspaces

Authenticated. Response `200 { workspaces }`: only the workspaces the caller belongs to, oldest first, each with the caller's `role`.

### GET /api/workspaces/:id

Any role. Response `200 { workspace }`. A workspace the caller does not belong to answers exactly like an unknown ID: `404 NOT_FOUND`.

### PATCH /api/workspaces/:id

Owner only. Body `{ name }`. Response `200 { workspace }`. Errors: `400`, `401`, `403 FORBIDDEN` (member, viewer), `404`.

### DELETE /api/workspaces/:id

Owner only. Body `{ confirmName }` must equal the workspace name exactly, otherwise `400 VALIDATION_ERROR`. Response `204`; memberships (and later everything below the workspace) are removed by cascade. Errors: `400`, `401`, `403`, `404`.

### POST /api/workspaces/:wid/projects

Owner or member. Body `{ name, key }`: `name` 1 to 80 characters (trimmed), `key` 2 to 5 uppercase letters `A-Z`, unique per workspace (the key is fixed after creation). Response `201 { project }` with `{ id, workspaceId, name, key, createdAt }`. Errors: `400`, `401`, `403 FORBIDDEN` (viewer), `404` (unknown workspace or not a member, identical bodies), `409 PROJECT_KEY_TAKEN` (with a `details` entry for `key`).

### GET /api/workspaces/:wid/projects

Any role. Response `200 { projects }`, oldest first, only the projects of that workspace. Errors: `400`, `401`, `404`.

### GET /api/projects/:pid

Any role. Response `200 { project }`. A project of a workspace the caller does not belong to answers exactly like an unknown ID: `404 NOT_FOUND`.

### PATCH /api/projects/:pid

Owner or member. Body `{ name }` (the key cannot be changed; unknown fields are rejected). Response `200 { project }`. Errors: `400`, `401`, `403` (viewer), `404`.

### DELETE /api/projects/:pid

Owner only. No body. Response `204`; everything below the project is removed by cascade and the key becomes free again. Errors: `400`, `401`, `403` (member, viewer), `404`.

### GET /api/projects/:pid/board

Any role. Response `200 { board: { id, projectId }, columns, cards }`, columns ordered by `(position, id)` (code-unit order; the `position` column uses the `"C"` collation); `cards` is a flat list of the non-deleted cards as summaries `{ id, columnId, number, title, position, version }`, ordered by column and then `(position, id)` (no description: fetch `GET /api/cards/:id`). Every project has exactly one board, created with the project together with the columns "To do", "In progress" and "Done" (flagged). Errors: `400`, `401`, `404`.

### POST /api/boards/:bid/columns

Owner or member. Body `{ id?, name, afterColumnId?, beforeColumnId? }`: `id` is a client-generated UUID (repeating the same create answers `200` with the existing column and never duplicates it; an id used on another board is `409 CONFLICT`), `name` 1 to 50 characters (trimmed), the neighbours choose the place (the server computes the key; without neighbours the column goes last). A neighbour on another board is `404`. Response `201 { column: { id, boardId, name, position, isDone } }`. Errors: `400`, `401`, `403` (viewer), `404`, `409`.

### PATCH /api/columns/:id

Owner or member. Body with at least one of `name`, `isDone`, `afterColumnId` / `beforeColumnId` (moving: give the neighbours the column should end up between; `null` means the edge). `isDone: true` moves the Done flag here and clears it on the other column in one transaction; `isDone: false` on the Done column answers `409 DONE_COLUMN_REQUIRED` (mark another column instead). Response `200 { column }`. Errors: `400`, `401`, `403`, `404`, `409`.

### DELETE /api/columns/:id

Owner or member. Optional query `moveCardsTo=<column id>`: a column of the same board that receives the live cards of the deleted column, appended at its end in their current order in one transaction (each moved card gets a `column_deleted_moved` event and a new `version`). Without it, a column that still has cards answers `409 COLUMN_NOT_EMPTY`; soft-deleted cards do not count and go away with the column. `moveCardsTo` on another board is `404`, equal to the column itself is `400`. The Done column cannot be deleted: `409 DONE_COLUMN_REQUIRED` (checked first). Response `204`. Errors: `400`, `401`, `403`, `404`, `409`.

### POST /api/columns/:cid/cards

Owner or member. Body `{ id?, title, description?, afterCardId?, beforeCardId? }`: `id` is a client-generated UUID (repeating the same create answers `200` with the existing card and never duplicates it; an id used on another board or by a deleted card is `409 CONFLICT`), `title` 1 to 200 characters (trimmed), `description` Markdown up to 20,000 characters, the neighbours (live cards of this column; another column is `404`) choose the place, without them the card goes last. The card number comes from `Project.nextCardNumber` with an atomic increment in the same transaction and is never reused. Writes a `created` activity event. Response `201 { card: { id, columnId, boardId, number, title, description, position, version, createdById, createdAt, updatedAt } }`. Errors: `400`, `401`, `403` (viewer), `404`, `409`.

### GET /api/cards/:id

Any role. Response `200 { card }`. A soft-deleted card is `404` for everyone. Errors: `400`, `401`, `404`.

### PATCH /api/cards/:id

Owner or member. Body with at least one of `title`, `description` (the description path is interim until KB-019). A change increments `version` and writes `title_changed` (`{ from, to }`) and/or `description_changed` (`{ from, to }` as lengths, never the text) in the same transaction; a request that changes nothing returns the card untouched. Response `200 { card }`. Errors: `400`, `401`, `403`, `404`.

### DELETE /api/cards/:id

Owner or member. Soft delete (`deletedAt`); writes a `deleted` event. Response `204`; afterwards `GET`, `PATCH` and `DELETE` answer `404` and the card disappears from the board. Errors: `400`, `401`, `403`, `404`.

### POST /api/workspaces/:wid/invites

Owner only. Body `{ role: "member" | "viewer", expiresInDays: 1-30, maxUses?: 1-1000 }` (an owner invite does not exist; promote a member instead). Response `201 { invite: { id, role, createdAt, expiresAt, maxUses, uses }, link }` with `Cache-Control: no-store`. The link (`<WEB_ORIGIN>/invite/<token>`) is shown only in this response; only the SHA-256 of the token is stored. Errors: `400`, `401`, `403` (member, viewer), `404`.

### GET /api/workspaces/:wid/invites

Owner only. Response `200 { invites }`: active invites only (not revoked, not expired, not exhausted), newest first. The list never contains links. Errors: `401`, `403`, `404`.

### DELETE /api/invites/:id

Owner only. Revokes the invite. Response `204` (repeating it is also `204`). Errors: `401`, `403`, `404` (non-member and unknown ID are identical).

### GET /api/invites/:token

Public (the token is the credential). Response `200 { workspaceName, role, expiresAt }`. Unknown, expired, revoked and exhausted tokens all answer the same `404 INVITE_INVALID`.

### POST /api/invites/:token/accept

Any logged-in user. Creates the membership with the invite's role and increments `uses` in one transaction, using a conditional update, so parallel accepts never exceed `maxUses`. Response `200 { workspaceId }`. Someone who is already a member also gets `200`, with no role change and no use consumed. Errors: `401`, `404 INVITE_INVALID`.

### GET /api/workspaces/:wid/members

Any member. Response `200 { members: [{ userId, name, email, role, joinedAt }] }`, oldest first. Errors: `401`, `404`.

### PATCH /api/workspaces/:wid/members/:userId

Owner only. Body `{ role: "owner" | "member" | "viewer" }`. Response `200 { member }`. Errors: `400`, `401`, `403`, `404`, `409 LAST_OWNER` (demoting the only owner).

### DELETE /api/workspaces/:wid/members/:userId

An owner removes anyone; any member may remove themselves (leave). Response `204`. The person keeps their session but gets `404` for the workspace at once; nothing they created is deleted. Errors: `401`, `403` (non-owner removing someone else), `404`, `409 LAST_OWNER` (removing or leaving as the only owner). Membership changes of one workspace are serialised with a row lock, so two owners cannot demote each other at the same time and leave none.

### Operator command

`pnpm --filter api admin:reset-password <email>` sets a random temporary password, prints it once and deletes all sessions of that user (no email in v1.0).

### GET /health

Reports that the API process is running. No authentication.

- Response `200`: `{ "status": "ok" }` (schema `healthResponseSchema` in `packages/shared`)

### GET /health/ready

Reports whether the API can reach its database (used by the hosting healthcheck). No authentication. The response schema is `readyResponseSchema` in `packages/shared`.

- Response `200`: `{ "db": "ok" }` when the database answers
- Response `503`: `{ "db": "unavailable" }` when it does not

## Real-time messages

None yet (see KB-016).
