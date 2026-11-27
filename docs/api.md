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

Authenticated. Response `204`; the session is deleted and the cookie cleared, and the real-time sockets opened with that session are closed with `4401`.

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

Any role. Response `200 { board: { id, projectId }, columns, cards, sprints, labels }` (`labels` are the project's labels, see "GET /api/projects/:pid/labels"), columns ordered by `(position, id)` (code-unit order; the `position` column uses the `"C"` collation); `sprints` are the project's planned and active sprints ordered by `(startDate, id)` (closed ones only come from the sprints list); `cards` is a flat list of the non-deleted cards as summaries `{ id, columnId, number, title, position, version, assigneeId, priority, estimate, sprintId, labelIds }` (`sprintId` is `null` for the backlog; `labelIds` lists the card's labels), ordered by column and then `(position, id)` (no description: fetch `GET /api/cards/:id`). Every project has exactly one board, created with the project together with the columns "To do", "In progress" and "Done" (flagged). Errors: `400`, `401`, `404`.

### POST /api/boards/:bid/columns

Owner or member. Body `{ id?, name, afterColumnId?, beforeColumnId? }`: `id` is a client-generated UUID (repeating the same create answers `200` with the existing column and never duplicates it; an id used on another board is `409 CONFLICT`), `name` 1 to 50 characters (trimmed), the neighbours choose the place (the server computes the key; without neighbours the column goes last). A neighbour on another board is `404`. Response `201 { column: { id, boardId, name, position, isDone } }`. Errors: `400`, `401`, `403` (viewer), `404`, `409`.

### PATCH /api/columns/:id

Owner or member. Body with at least one of `name`, `isDone`, `afterColumnId` / `beforeColumnId` (moving: give the neighbours the column should end up between; `null` means the edge). `isDone: true` moves the Done flag here and clears it on the other column in one transaction; `isDone: false` on the Done column answers `409 DONE_COLUMN_REQUIRED` (mark another column instead). Response `200 { column }`. Errors: `400`, `401`, `403`, `404`, `409`.

### DELETE /api/columns/:id

Owner or member. Optional query `moveCardsTo=<column id>`: a column of the same board that receives the live cards of the deleted column, appended at its end in their current order in one transaction (each moved card gets a `column_deleted_moved` event and a new `version`). Without it, a column that still has cards answers `409 COLUMN_NOT_EMPTY`; soft-deleted cards do not count and go away with the column. In v1.0, deleting a column permanently removes the cards that were soft-deleted in it earlier, together with their activity (the `cards.column_id` foreign key cascades; decision D11, option A); they cannot be viewed or restored afterwards. `moveCardsTo` on another board is `404`, equal to the column itself is `400`. The Done column cannot be deleted: `409 DONE_COLUMN_REQUIRED` (checked first). Response `204`. Errors: `400`, `401`, `403`, `404`, `409`.

### POST /api/columns/:cid/cards

Owner or member. Body `{ id?, title, description?, afterCardId?, beforeCardId? }`: `id` is a client-generated UUID (repeating the same create answers `200` with the existing card and never duplicates it; an id used on another board or by a deleted card is `409 CONFLICT`), `title` 1 to 200 characters (trimmed), `description` Markdown up to 20,000 characters, the neighbours (live cards of this column; another column is `404`) choose the place, without them the card goes last. The card number comes from `Project.nextCardNumber` with an atomic increment in the same transaction and is never reused. Writes a `created` activity event. Response `201 { card: { id, columnId, boardId, number, title, description, position, version, createdById, createdAt, updatedAt } }`. Errors: `400`, `401`, `403` (viewer), `404`, `409`.

### GET /api/cards/:id

Any role. Response `200 { card }`. A soft-deleted card is `404` for everyone. Errors: `400`, `401`, `404`.

### GET /api/cards/:id/activity

Any role. Query `cursor` (opaque, from the previous page) and `limit` (1 to 100, default 30). Response `200 { events, nextCursor }`: events newest first, ordered by `(createdAt, id)` descending so pages never repeat or skip an event even when timestamps tie; `nextCursor` is `null` on the last page. Each event is `{ id, cardId, actorId, createdAt, type, data, actor: { id, name } }`, where `type` and `data` follow the shared `activityEventDataSchema` union. `description_changed` carries lengths only (`{ from, to }`), never the text, and is coalesced per person in 10-minute windows. Events are written in the same transaction as the change; the description projection writes `description_changed` without a board event, so those entries show up the next time the activity is fetched. A soft-deleted card cannot be viewed or restored in v1.0: this endpoint and `GET /api/cards/:id` answer `404` for it. Deleting a column permanently removes the cards that were soft-deleted in it earlier, together with their activity (D11, option A; see `DELETE /api/columns/:id`). Errors: `400` (bad cursor or limit), `401`, `404` (unknown card, deleted card or non-member).

### PATCH /api/cards/:id

Owner or member. Body with at least one of `title`, `assigneeId` (uuid or `null`), `priority` (`none`, `low`, `medium`, `high`, `urgent`) and `estimate` (integer 0-100 or `null`). The assignee must be an owner or member of the card's workspace, otherwise `400 INVALID_ASSIGNEE` (viewers, non-members and unknown users alike). `description` is not accepted (`400 VALIDATION_ERROR`): the description is written only through the `card:<id>:description` Yjs room (see "Real time"). A change increments `version` and writes, in the same transaction, `title_changed` (`{ from, to }`), `assignee_changed` (`{ from, to }` user ids or `null`), `priority_changed` and `estimate_changed` (`{ from, to }`); a request that changes nothing returns the card untouched. Cards (and board summaries) carry `assigneeId`, `priority` (default `none`) and `estimate` (default `null`). Removing a member (or a member leaving) sets `assigneeId` to `null` on their live cards in that workspace in the same transaction, bumping `version` and writing `assignee_changed` with the remover as actor. Response `200 { card }`. Errors: `400`, `401`, `403`, `404`.

### POST /api/cards/:id/move

Owner or member. Body `{ columnId, afterCardId?, beforeCardId? }` (`null` or missing means no neighbour on that side; with neither, the card goes to the end of the column). The destination column must belong to the same board and be visible to the caller (another board or workspace is `404`); a neighbour on another board is `404`. Inside one transaction under the board lock the server computes the key from the current neighbours (ADR 0001 section 3: a neighbour that vanished or moved elsewhere is stale and the remaining one is used), rebalances the column's keys when the key would outgrow 50 characters (siblings get a new `version`, the order is unchanged), increments the card's `version` and writes a `moved` event `{ fromColumnId, toColumnId }` only when the column changes. Response `200 { card }` with the final `position` and `version`. Errors: `400`, `401`, `403`, `404`.

### PUT /api/cards/:id/sprint

Owner or member. Body `{ sprintId }`: the id of a planned or active sprint of the card's project, or `null` to return the card to the backlog. In one transaction under the board lock the card's `version` is incremented and `sprint_removed` (`{ sprintId, sprintName }` of the old sprint) and/or `sprint_added` (`{ sprintId, sprintName }`) are written; moving between sprints writes both. Asking for the sprint the card already has changes nothing (no version, no event, no board event). A sprint of another project, of another workspace, or one that does not exist is `400 INVALID_SPRINT` (the same answer for all three, so nothing leaks); a closed sprint as the target, or a card that finished in a closed sprint (it stays there), is `409 SPRINT_CLOSED`. Publishes `card_updated`. Response `200 { card }`. Errors: `400`, `401`, `403`, `404`, `409`.

### POST /api/projects/:pid/labels

Owner or member. Body `{ id?, name, color }`: `id` is an optional client UUID (repeating the same create answers `200` with the existing label; an id used by another project is `409 CONFLICT`), `name` 1 to 30 characters (trimmed), unique within the project without regard to case, `color` one of the 8 palette tokens `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `gray`. Response `201 { label: { id, projectId, name, color } }`. Publishes `label_created`. Errors: `400` (including an invalid colour), `401`, `403` (viewer or CSRF), `404` (non-member or unknown project), `409` (`LABEL_NAME_TAKEN`, `CONFLICT`).

### GET /api/projects/:pid/labels

Any role. Response `200 { labels }`. Errors: `400`, `401`, `404`.

### PATCH /api/labels/:id

Owner or member. Body with at least one of `name` and `color` (same rules as create). Response `200 { label }`. Publishes `label_updated`. Errors: `400`, `401`, `403`, `404`, `409` (`LABEL_NAME_TAKEN`).

### DELETE /api/labels/:id

Owner or member. Response `204`. Removes the label from every card that carried it: each such live card gets a new `version` and a `labels_changed` activity event (`removed`), and a `card_updated` event is published for it, followed by `label_deleted`. Errors: `400`, `401`, `403`, `404`.

### PUT /api/cards/:id/labels

Owner or member. Body `{ labelIds }`: the complete set of labels of the card, at most 10, each listed once (otherwise `400 VALIDATION_ERROR`). A label that belongs to another project or does not exist is `400 INVALID_LABEL` and nothing is linked. A real change increments the card's `version`, writes `labels_changed` (`{ added, removed }`, each entry `{ id, name }` so the history survives a label deletion) in the same transaction and publishes `card_updated`; sending the set the card already has changes nothing (no version, no activity, no event). Response `200 { card }`. Errors: `400`, `401`, `403`, `404`.

### POST /api/projects/:pid/sprints

Owner or member. Body `{ id?, name, goal?, startDate, endDate }`: `name` 1-80 characters, `goal` up to 500, dates are calendar dates `YYYY-MM-DD` (real dates only) and `endDate` must not be before `startDate` (`400 VALIDATION_ERROR`, also enforced by a database `CHECK`). `id` is an optional client UUID: repeating the same create returns `200` with the existing sprint (an id used by another project is `409 CONFLICT`). The sprint starts as `planned`. Response `201 { sprint }` with `{ id, projectId, name, goal, startDate, endDate, status, committedPoints, completedPoints, closedAt, createdAt }`. Publishes `sprint_updated`. Errors: `400`, `401`, `403`, `404`, `409`.

### GET /api/projects/:pid/sprints

Any role. Query `limit` (1-100, default 50), `cursor` (the `nextCursor` of the previous page; an invalid one is `400`) and `status` (comma-separated `planned`, `active`, `closed`; all when missing). Ordered by `(startDate, id)`. Response `200 { sprints, nextCursor }` (`nextCursor` is `null` on the last page). Errors: `400`, `401`, `404`.

### PATCH /api/sprints/:id

Owner or member. Body with at least one of `name`, `goal`, `startDate`, `endDate` (the merged dates must keep `endDate >= startDate`, otherwise `400`). A closed sprint cannot be changed: `409 SPRINT_CLOSED`. Publishes `sprint_updated`. Response `200 { sprint }`. Errors: `400`, `401`, `403`, `404`, `409`.

### POST /api/sprints/:id/start

Owner or member. No body. Only a `planned` sprint can start (otherwise `409 SPRINT_NOT_PLANNED`) and only one sprint per project can be active (`409 SPRINT_ALREADY_ACTIVE`, guaranteed by a partial unique index, so two parallel starts give exactly one `200`). In one transaction the sprint becomes `active`, `committedPoints` is set to the sum of the estimates of its live cards (cards without an estimate count as 0) and a `sprint_started` row is added to `sprint_events` with a snapshot `{ committedPoints, cards: [{ cardId, columnId, estimate }] }` for the burndown (KB-025). Publishes `sprint_updated`. Response `200 { sprint }`. Errors: `401`, `403`, `404`, `409`.

### POST /api/sprints/:id/close

Owner or member. No body. Only an `active` sprint can be closed (otherwise `409 SPRINT_NOT_ACTIVE`); the board lock serialises closes, so two parallel calls give exactly one `200`. In one transaction: live cards of the sprint that are not in a Done column get `sprintId = null`, their `version` is incremented and `sprint_removed` `{ sprintId, sprintName, reason: "sprint_closed" }` is written for each; cards in a Done column keep the sprint; the sprint becomes `closed` with `closedAt` and `completedPoints` (sum of the estimates of the cards that stayed, unestimated count as 0; `committedPoints` is untouched); a `sprint_closed` row `{ completedCards, completedPoints, returnedCards, returnedCardIds }` is added to `sprint_events`. Any failure leaves the sprint and the cards untouched. After the commit it publishes `card_updated` for each returned card and then `sprint_updated`. Response `200 { completedCards, completedPoints, returnedCards }`. Errors: `400`, `401`, `403`, `404`, `409`.

### GET /api/sprints/:id/burndown

Any role. Response `200 { days, ideal, unestimatedCount }`. `days` has one entry `{ date, remainingPoints, scopePoints }` per UTC calendar day from the sprint's `startDate` to the earliest of today, `endDate` and (for a closed sprint) the close day; it is empty before the start date. `ideal` is a straight line `{ date, points }` for every day of the sprint, from the scope of the first day down to 0 on `endDate`. `unestimatedCount` is the number of cards in the sprint without an estimate; they count as 0 points. A planned sprint answers `{ days: [], ideal: [], unestimatedCount: 0 }`. Errors: `400`, `401`, `404` (a non-member gets the same answer as a missing id).

How it is computed (`computeBurndown` in `packages/shared`): the activity events of every card that was ever added to the sprint (`sprint_added` with this sprint id) are replayed in order. The values of a day are the state at the end of that day; **day boundaries are UTC** (sprint dates are plain dates and the server stores instants in UTC, there is no per-project time zone). A card counts in `scopePoints` while it is in the sprint and not deleted (`sprint_added` / `sprint_removed` / `deleted`) with the estimate it had that day (`estimate_changed`); it counts in `remainingPoints` while it is outside a Done column (`moved`, `column_deleted_moved`). Cards moved out of Done raise the remaining points again; cards added mid-sprint raise the scope line.

Known limitation (D11, option A): deleting a column hard-deletes the cards that were soft-deleted in it earlier, together with their activity. If that happens during the active sprint, those cards no longer exist, so they drop out of the scope line of past days. Today's remaining points are not affected.

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

Owner only. Body `{ role: "owner" | "member" | "viewer" }`. Response `200 { member }`. Errors: `400`, `401`, `403`, `404`, `409 LAST_OWNER` (demoting the only owner). Side effect: changing an owner or member to `viewer` unassigns every live card of that workspace assigned to them, in the same transaction (each card gets `version` + 1 and an `assignee_changed { from, to: null }` event with the caller as actor, and a `card_updated` board event after commit), the same as removing or leaving. Other role changes touch no cards.

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

Design and rationale: `docs/adr/0004-real-time-architecture.md`. Schemas: `packages/shared/src/realtime.ts`.

### GET /ws/:room (WebSocket upgrade)

Same port and origin as the REST API (Vite proxies `/ws` in development). Binary messages follow the y-websocket protocol.

- Rooms: `board:<boardId>` (awareness and server-pushed board events) and `card:<cardId>:description` (collaborative text). IDs are UUIDs.
- Upgrade: the `Origin` header must equal the web origin, otherwise `403 CSRF_REJECTED` before the upgrade. The session cookie authenticates after the upgrade.
- Close codes: `4401` no or invalid session, or the session ended while connected (logout closes that session's sockets within 1 s; expiry or a session deleted by another process is caught by the heartbeat check, at most about 30 s later; other sessions of the same user stay open); `4403` not a member of the room's workspace, or the room does not exist (indistinguishable), or the membership was removed while connected (also when removed between authorization and joining), or the workspace, project or card of the room was deleted (deleting a card closes only its description room; the board room stays open); `4400` invalid room name; `1003` text frame; `1007` malformed message; `1009` message over 1 MiB; `1011` the room could not be loaded; `1012` the server is restarting (graceful shutdown; reconnect with backoff). The text of a card description is the `Y.Text` named `description` of its room: a new document is seeded once from `Card.description`, and the server writes the text back to `Card.description` (so `GET /api/cards/:id` is current) within about 1 s of the last change and when the room unloads, recording a `description_changed` activity event (`{ from, to }` as lengths, never the text) coalesced per person over 10 minutes; the projection does not change the card `version`. Card description documents are persisted in PostgreSQL (updates batched at most 500 ms apart, compacted after 100 updates and when the last client leaves).
- Message types (first varint): `0` sync, `1` awareness, `3` query awareness (all as in y-websocket), `4` board event (server to client only: a varString with JSON `{ "type": string, "data": object }`).
- Awareness state (KB-020): JSON `{ userId, name, color, activeCardId: uuid | null, editing: boolean, caret?: relative position | null }`. The server overwrites `userId`, `name` and `color` from the session, drops invalid states and updates for client IDs owned by someone else, and removes a connection's states when it closes. A connection may own at most 4 states.
- Viewers receive documents and may send awareness, but their document updates are discarded. In board rooms clients never write the document.
- The server pings every 30 s and terminates connections that do not answer.

### Board events (KB-018)

Schema: `boardEventSchema` in `packages/shared/src/board-events.ts`. After the transaction of a mutation commits (never on rollback or on a no-op), the server pushes one message per event to every connection of `board:<boardId>`, viewers included. The wire message is type `4` with JSON `{ "type": <event type>, "data": <BoardEvent> }`.

`BoardEvent` is `{ type, boardId, entity, version, actorId, clientMutationId?, at }`:

| `type` | `entity` | `version` | Published after |
| --- | --- | --- | --- |
| `card_created` | card summary | card version | `POST /api/columns/:cid/cards` (not for a repeated create) |
| `card_updated` | card summary | card version | `PATCH /api/cards/:id` (title, assignee, priority, estimate), `PUT /api/cards/:id/sprint`, `PUT /api/cards/:id/labels`, label deletion (the cards that carried it), `POST /api/sprints/:id/close` (the cards returned to the backlog); removing or leaving a workspace unassigns cards (actor = the remover) |
| `card_moved` | card summary | card version | `POST /api/cards/:id/move`; siblings whose key was respaced; cards moved by deleting a column |
| `card_deleted` | `{ id, columnId, number, title }` | version after the delete | `DELETE /api/cards/:id` |
| `label_created`, `label_updated` | label | `null` (labels are not versioned) | label create and update (always applied) |
| `label_deleted` | `{ id, name }` | `null` | `DELETE /api/labels/:id` (after the `card_updated` events of the cards that carried it) |
| `sprint_updated` | sprint | `null` (sprints are not versioned) | sprint create, edit, start and close; clients keep planned and active sprints and drop a closed one |
| `column_created`, `column_updated` | column | `null` (columns are not versioned) | column create and update (also the siblings respaced and the old Done column) |
| `column_deleted` | `{ id, name }` | `null` | `DELETE /api/columns/:id` (after the `card_moved` events of its cards) |

- Clients apply a card event only when `version` is greater than the version they hold, so duplicates and out-of-order events are harmless. Column events are always applied and carry the full column.
- `clientMutationId` is the value of the optional request header `X-Client-Mutation-Id` (a UUID; anything else is ignored) of the request that caused the event, so a client can skip the echo of its own change.
- Events are not replayed: a client refetches `GET /api/projects/:pid/board` whenever it (re)connects.
