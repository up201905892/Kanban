# 0001 · Ordering and conflict handling

- **Status:** Accepted for ordering, concurrent-edit rules and idempotent creates. **Provisional** for the Yjs/PostgreSQL authority split (section 7): it depends on decision D5, which is still pending from João.
- **Date:** 2026-10-28
- **Task:** KB-010
- **Technical decisions:** D1 (real time with Yjs), D2 (Fastify), D5 (scope of Yjs authority, pending) in `docs/workflow/01-planning.md`.

## Context

Columns and cards have a user-defined order, and several people edit a board at the same time. We need (a) an ordering scheme where moving or inserting one item rewrites only that item, (b) a deterministic order that every client and the server agree on, and (c) clear rules for concurrent edits, so that optimistic updates and live updates (KB-015, KB-018) behave predictably. `CLAUDE.md` says "the Yjs document is the authority; the server updates the database from it" without saying which data lives in Yjs (D5).

## Decision

### 1. Position keys

- Columns (within a board) and cards (within a column) have a `position` string: a fractional-index key. The implementation is `packages/shared/src/ordering` (pure functions, no dependencies): `keyBetween(a, b)`, `keysBetween(a, b, n)`, `isValidKey(k)`, `compareByPosition(x, y)`, plus `needsRebalance(k)` and `MAX_KEY_LENGTH`.
- Keys use base-62 digits `0-9A-Za-z`, whose ASCII order matches the numeric order, so the keys sort correctly with a plain code-unit string comparison. This is the same scheme as Greenspan's fractional indexing: a head letter encodes the length of the integer part, followed by an optional fractional part that never ends in `0`. Appending or prepending grows the key only logarithmically.
- In PostgreSQL the column must use a binary collation (`COLLATE "C"`) so that `ORDER BY position` matches the code-unit order. Migrations that add `position` columns (KB-011, KB-012) must do this.
- `null` means "no neighbour": `keyBetween(null, null)` is the first key, `keyBetween(a, null)` appends, `keyBetween(null, b)` prepends. Invalid keys, and `a >= b`, throw `InvalidKeyError`.

### 2. Deterministic order

Items are always ordered by `(position, id)`: the position key by code-unit order, ties broken by the id (`compareByPosition`). Ties can only happen after a race, and the tie-break guarantees every client shows the same order.

### 3. The server computes the final key

A client never decides a stored key. A move request names its neighbours (`afterCardId` / `beforeCardId`, see KB-015). Inside one transaction the server reads the current positions of those neighbours and computes the key with `keyBetween`. Client-computed keys, if sent, are only hints for optimistic rendering and are replaced by the server's response. If a neighbour is stale (deleted, moved elsewhere, or no longer adjacent), the server uses the neighbours' current keys: if both still exist and are ordered, the item goes between them; if one is gone, the item goes next to the remaining one; if both are gone, it goes to the end of the target column. The response carries the final position.

### 4. Rebalancing

If a computed key is longer than `MAX_KEY_LENGTH` (50 characters), the server rewrites the positions of all siblings with `keysBetween(null, null, n)` in the same transaction and bumps their `version`, then computes the new key on the rebalanced list. Rebalancing is rare: it needs hundreds of repeated inserts at exactly the same spot (see measurements).

### 5. Concurrent-edit rules (structured data)

- **PATCH is field-level last write wins.** A PATCH only changes the fields it contains; two people editing different fields both win; for the same field the later request (server order) wins. No `If-Match` is required.
- **Moves: last move wins** for the same card. Each move is applied in server order; the final position is whatever the last transaction computed.
- **Delete wins.** After a delete, any later edit or move of that entity returns `404 NOT_FOUND`; the client drops its optimistic state and refetches.
- **Per-card `version`.** Every mutation of a card increments `version` in the same transaction and the number travels in the response and in live events. A client ignores an event whose `version` is lower than or equal to the one it already holds for that card, so out-of-order delivery cannot roll state back.
- **Optimistic updates** roll back on error and are reconciled with the server response (final position, `version`).

### 6. Idempotent creates (A6)

Columns and cards accept a client-generated UUID as their id. Repeating a create with the same id returns `200` with the existing resource and never makes a duplicate, so retries after a network failure are safe. A create for an id that exists but belongs to another board or project is rejected (`409`/`403` as the route defines); the check is part of the route's authorization.

### 7. Yjs / PostgreSQL authority split — PROVISIONAL, pending D5

D5 has not been answered. **Assumption used here (the working assumption recommended in D5, not a decision):**

- Collaborative text (card descriptions) and presence live in Yjs. The Yjs document is the authority for them; the server projects the text into PostgreSQL.
- Structured data (columns, cards, fields, positions, sprints) is written through the REST API with server-side validation and authorization. PostgreSQL is the authority, and changes are broadcast to other clients as board events over the WebSocket.

Sections 1-6 of this ADR are written for that assumption: the server computes keys in a transaction and the `version` column orders events. **If João chooses the alternative (the whole board in one Yjs document per board), sections 3, 5 and 6 must be revisited** and this ADR superseded or amended: concurrent moves would then be resolved by the CRDT (for example with a Yjs-friendly fractional position per item) and the server would have to validate and project updates after the fact. Section 1, 2 and 4 (the key utility) would stay useful in either case. The same pending status carries to the real-time ADR (KB-016) and to KB-012, KB-013, KB-014, KB-015, KB-018, KB-021, KB-022, KB-024.

## Alternatives considered

- **Integer `position` with renumbering:** moving one card rewrites every sibling; concurrent moves collide and need locking; noisy activity log and events.
- **Float `position` (average of neighbours):** loses precision after about 50 repeated inserts and gives no clean way to detect it.
- **Linked list (`previousId`/`nextId`):** hard to keep consistent under concurrent writes; no database ordering; hard to constrain.
- **Wrapping the `fractional-indexing` npm package:** equivalent algorithm, but adds a runtime dependency (G9) for about 150 lines of code; a library may still replace the module behind the same API later.
- **Lexorank / bucketed ranks:** requires background rebalancing jobs; more moving parts than needed.
- **Optimistic concurrency with `If-Match` on every PATCH:** rejected for v1.0 because field-level last write wins is simpler and enough for a small team; can be added per entity later.
- **Whole board in Yjs (D5 alternative):** see section 7.

## Consequences

- Insert and move write a single row; the order is stable and agreed by everyone.
- Keys can grow when many items are repeatedly inserted at the same spot; the 50-character threshold and server-side rebalancing cap the cost. Rebalancing changes many rows at once and must be tested in KB-011/KB-015.
- Position columns need a binary collation and an index on `(parent, position, id)`.
- Last write wins can silently overwrite a concurrent edit of the same field; this is accepted and visible through live updates and the activity log.
- The authority split may change when D5 is answered (section 7).

## Measurements

Measured with the unit test `packages/shared/src/ordering/fractional-index.test.ts` (`key growth`), 2026-10-28:

| Scenario | Result |
| --- | --- |
| 10,000 inserts at the end (each after the previous key) | final key length 4, maximum 4 |
| 10,000 inserts at the same position (always between the same lower neighbour and the previously inserted key, the worst case) | final key length 1,669; the 50-character threshold is first exceeded at insert 289 |

Appending is effectively constant. Repeated insertion at one spot costs about 6 bits per insert (one base-62 digit per roughly 6 inserts), so rebalancing triggers after about 290 inserts in the same gap in that adversarial pattern. Typical use (inserting between different neighbours) stays far below that.
