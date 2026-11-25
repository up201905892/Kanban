# 04 · Done

Closed tasks. Only the `finisher` writes here, and only after confirming that the latest report in `03-testing.md` is `Passed`.

## Done tasks

<!--
Entry template:

### KB-000 · Title — done on YYYY-MM-DD

- **Approving test report:** Report N (YYYY-MM-DD), commit hash
- **Development iterations:** N
- **Delivered:** what the app user gains, in one sentence
- **CHANGELOG:** line added under "Unreleased" (or "not applicable")
- **Documentation:** docs/api.md, ADR, .env.example (whichever apply)
- **Lessons:** optional, one line
-->

### KB-001 · Monorepo scaffold and tooling — done on 2026-10-26

- **Approving test report:** Report 1 (2026-10-26), commit 34bb1ee
- **Development iterations:** 1
- **Delivered:** the project has a working base (web, api and shared packages) with a health check, so every later feature builds on the same tooling.
- **CHANGELOG:** "Added: The app now has a starting point: a web page and a server with a health check that reports when the service is running (KB-001)."
- **Documentation:** `docs/api.md` (GET /health), `.env.example` (PORT, HOST); no ADR required
- **Lessons:** `pnpm dev` needs `packages/shared` built once first; a watch mode for shared is a candidate task for the planner.

### KB-002 · Local PostgreSQL, Prisma and validated configuration — done on 2026-10-26

- **Approving test report:** Report 1 (2026-10-26), commit 23baaa8 (later commits are a test file and workflow records only)
- **Development iterations:** 1
- **Delivered:** the server now connects to a database, refuses to start with invalid configuration and exposes a readiness check, so later features can store data.
- **CHANGELOG:** "Added: The server now connects to a database and has a readiness check that tells whether the database is reachable (KB-002)."
- **Documentation:** `docs/api.md` (GET /health/ready), `.env.example` (DATABASE_URL, TEST_DATABASE_URL, SESSION_SECRET, WEB_ORIGIN, NODE_ENV); no ADR required
- **Lessons:** not run in the sandbox: `pnpm db:up`/`db:down` and `prisma migrate reset` (Prisma blocks it for AI agents). The compose file was reviewed by reading and the `init` migration checked by `migrate deploy` and `migrate diff` (no drift); not blocking. João may run `prisma migrate reset` once locally. The `app_meta` placeholder table is for the planner to confirm.

### KB-003 · API conventions and E2E harness — done on 2026-10-27

- **Approving test report:** Report 2 (2026-10-27), commit e514dee (later commits are workflow records only)
- **Development iterations:** 2
- **Delivered:** the server now answers every error in one consistent format with a request id, and the project has a browser test harness with two independent users for the collaboration features to come.
- **CHANGELOG:** "Added: Errors from the server now follow one consistent format and carry a request id, which makes problems easier to trace and report (KB-003)."
- **Documentation:** `docs/api.md` (error format and conventions, health schema); no new environment variables; no ADR required
- **Lessons:** iteration 1 failed G2 because a response schema was local to the api; check that every response schema lives in `packages/shared` before handing over. Not run: `pnpm test:e2e:setup` and `CI=1 pnpm test:e2e` after the fix (no relevant changes).

### KB-004 · Web app shell, data layer and minimal local components — done on 2026-10-27

- **Approving test report:** Report 1 (2026-10-27), commit 488703d (later commits are workflow records only)
- **Development iterations:** 1
- **Delivered:** the web app now has routing, a not-found page, an error screen with Reload, a typed API client and accessible basic components, so every UI feature can build on them.
- **CHANGELOG:** "Added: The web app now has page navigation, a "page not found" screen, a recovery screen with a Reload button when something goes wrong, and accessible basic building blocks such as buttons, form fields and dialogs (KB-004)."
- **Documentation:** `.env.example` (API_URL for the Vite dev proxy); no new endpoints, so no `docs/api.md` change; no ADR required
- **Lessons:** the Vite proxy was only reviewed, not exercised at runtime; `/health` is not under `/api` so it is not proxied (planner suggestion). The finisher could not run `git log`/`git diff`/`git show` with paths in the sandbox, so "no production commits after the tested commit" rests on the commit list in the session context (only two docs(workflow) commits follow 488703d).

### KB-010 · Fractional indexing utility and ordering/conflict ADR — done on 2026-10-28

- **Approving test report:** Report 1 (2026-10-28), commit ee1160d (later commits are workflow records and a tester test file only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** the shared package now has the ordering functions that boards will use to place columns and cards, and an ADR that fixes how concurrent edits and moves are resolved.
- **CHANGELOG:** "Added: Groundwork for ordering cards and columns on the board: a reliable way to place an item between two others, plus documented rules for what happens when several people edit or move the same card at once (KB-010)."
- **Documentation:** ADR `docs/adr/0001-ordering-and-conflict-handling.md`; no new endpoints (`docs/api.md` unchanged); no new environment variables
- **Lessons:** D5 (Yjs/PostgreSQL authority) is still pending, so ADR section 7 is provisional and sections 3, 5 and 6 may need revision. Planner suggestions: position columns need `COLLATE "C"` (KB-011, KB-012 migrations); the stale-neighbour rule is for KB-015 to implement. The finisher's secret-pattern search was denied by the sandbox; the check rests on the commit only adding ordering code, tests, an ADR and a dev dependency (`fast-check`).

### KB-005 · Authentication core: accounts and cookie sessions — done on 2026-10-29

- **Approving test report:** Report 1 (2026-10-29), commit 2b198b3 (later commits are workflow records and a tester test file only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** the API now supports sign-up, log-in, log-out and "current user" with secure cookie sessions, an Origin check, rate limits, a guard that protects every route by default, and an operator command to reset a password.
- **CHANGELOG:** "Added: People can now create an account with email and password, log in and log out; sessions last 30 days and sign-up and log-in attempts are rate limited to protect accounts (KB-005)."
- **Documentation:** ADR `docs/adr/0002-authentication-and-sessions.md`; `docs/api.md` (auth endpoints and CLI); no new environment variables (`SESSION_SECRET` already in `.env.example`)
- **Lessons:** tester observations for the planner: the dummy hash is computed lazily, so the first unknown-email login after start-up is slower (warm it at start-up); `trustProxy` is for KB-031; the empty-database migration run was checked indirectly (CI runs it). Secret search found only fake passwords in test files.

### KB-006 · Sign-up, log-in and log-out UI with protected routes — done on 2026-10-29

- **Approving test report:** Report 1 (2026-10-29), commit f26ab7e (later commits are workflow records and a tester test file only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** people can sign up, log in and log out in the browser, private pages are protected and return the user to where they were, and an expired session sends them to log in.
- **CHANGELOG:** "Added: People can now sign up, log in and log out in the browser; private pages send you to the log-in page and bring you back afterwards, and the password field has a show/hide button (KB-006)."
- **Documentation:** no new endpoints (UI over the KB-005 endpoints, already in `docs/api.md`); no new environment variables; no ADR required
- **Lessons:** no Retry-After countdown for 429 (allowed by the spec). Planner: the Planning index rows for KB-007 and KB-008 are still joined on one line. No TODO left; no secret patterns found in the task's files.

### KB-007 · Workspaces, memberships and the authorization policy — done on 2026-10-30

- **Approving test report:** Report 1 (2026-10-30), commit 3175dc4 (later commits are the development record, a tester test file and the test report only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** people can create, list, switch between, rename and delete workspaces, and every workspace has owners, members and viewers whose permissions are enforced on the server without revealing other people's workspaces.
- **CHANGELOG:** "Added: People can now create workspaces, switch between them, rename them and delete them (with a typed-name confirmation); every workspace has owners, members and viewers, and what each can do is enforced on the server without revealing other people's workspaces (KB-007)."
- **Documentation:** ADR `docs/adr/0003-authorization-model.md`; `docs/api.md` (the five `/api/workspaces` endpoints); no new environment variables
- **Lessons:** the `project` resolver of the policy module is deferred to KB-008 (the `Project` table does not exist yet; KB-008 lists it as a criterion). KB-009 must add the last-owner rule when members can leave. `prisma migrate reset` was not run (Prisma guard); CI applies the three migrations to an empty database. The finisher's secret-pattern search and `git log` with paths were denied by the sandbox; the check rests on the commit list (only `docs(workflow)` and `test(api)` commits follow 3175dc4) and a TODO search that found nothing. The Planning index rows are now separate.

### KB-008 · Projects within a workspace — done on 2026-10-30

- **Approving test report:** Report 1 (2026-10-30), commit 1ce8f22 (later commits are the development record and the test report only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** workspaces now hold projects; owners and members can create, rename and open them, only owners can delete them, and the authorization policy resolves a project to its workspace.
- **CHANGELOG:** "Added: Workspaces now hold projects: owners and members can create projects (with a short key suggested from the name), rename them and open them; only owners can delete a project, after typing its name to confirm (KB-008)."
- **Documentation:** `docs/api.md` (five project endpoints); ADR 0003 updated (project resolver); no new environment variables
- **Lessons:** the project key is immutable after creation (card IDs will use it in KB-012) and the typed-name delete confirmation is UI only; both match the task text. Planner: confirm key edits are not wanted. `prisma migrate reset` was not run (Prisma guard); CI applies the migrations to an empty database. No TODO left; no secret patterns found in the task's changes. Milestone "Authentication and workspaces" not yet reached (KB-009 is Planned).

### KB-009 · Invite links, members and roles — done on 2026-11-02

- **Approving test report:** Report 1 (2026-11-02), commit dbdd2e9 (later commits are the development record and the test report only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** owners can invite people with a shareable link (member or viewer, with expiry and optional use limit), revoke links, change roles and remove members; anyone can leave a workspace, but the last owner cannot.
- **CHANGELOG:** "Added: Owners can now invite people with a shareable link (as member or viewer, with an expiry date and an optional use limit), see and revoke active links, change people's roles and remove them; anyone can leave a workspace, but the last owner cannot (KB-009)."
- **Documentation:** `docs/api.md` (invite and member endpoints); ADR 0003 item 9; no new environment variables (`WEB_ORIGIN` already in `.env.example`)
- **Lessons:** the loser of a concurrent mutual demotion gets 403 instead of 409 (invariant holds). Closing live sockets on removal stays with KB-016. `prisma migrate reset` was not run (Prisma guard); CI applies migrations to an empty database. No TODO left; no secret found in the task's changes.

### KB-011 · Board and configurable columns — done on 2026-11-05

- **Approving test report:** Report 1 (2026-11-05), commit 60565ef (later commits are the development record and the test report only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** every project has a board with the columns "To do", "In progress" and "Done"; owners and members can add, rename, reorder (also by keyboard), delete columns and choose the Done column; viewers can only read.
- **CHANGELOG:** "Added: Every project now has a board with the columns "To do", "In progress" and "Done"; owners and members can add, rename, reorder (also from the keyboard), delete columns and choose which one counts as "Done", while viewers can only look (KB-011)."
- **Documentation:** `docs/api.md` (board and column endpoints); ADR 0001 amended for D5 (hybrid), section 7 now Accepted; no new environment variables
- **Lessons:** the PATCH move format (`afterColumnId`/`beforeColumnId`) is the one KB-015 will reuse. The delete dialog says there are no cards yet; KB-012 must revise deletion rules and wording. `prisma migrate reset` and a fresh database were not run (sandbox/Prisma guard); CI applies migrations to an empty database. No TODO found in source. The finisher's secret-pattern search was denied by the sandbox; the check rests on the developer and tester records (no new dependencies, no new environment variables).

### KB-012 · Cards: create, view, edit and delete — done on 2026-11-05

- **Approving test report:** Report 1 (2026-11-05), commit 512a5e9 (later commits are the development record and the test report only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** boards now hold cards: owners and members add, open (by deep link), edit (title and Markdown description) and delete cards, viewers read them; deleting a column with cards asks where to move them; every card change is recorded as an activity event.
- **CHANGELOG:** "Added: Boards now hold cards: owners and members can add cards at the bottom of a column (several in a row with just the keyboard), open a card at its own link, edit its title and its Markdown description (with a preview) and delete it after confirming; viewers can read cards. Every change to a card is recorded for the history to come (KB-012)." and "Changed: Deleting a column that still has cards now asks where the cards should go and moves them to the end of that column instead of losing them (KB-012)."
- **Documentation:** `docs/api.md` (card endpoints and `moveCardsTo` on column delete); no new environment variables; no ADR requested by the task
- **Lessons:** the board response has a flat `cards` list instead of nesting per column. Deleting a column cascades to its earlier soft-deleted cards and their events, so that history is lost (flag for KB-024). The `members.spec.ts` "at least one owner" locator is flaky and should be scoped. Web bundle is about 620 kB (candidate for KB-028). `prisma migrate reset` was not run (sandbox); CI applies migrations to an empty database. No TODO found in the task's code. The finisher's secret-pattern search was denied by the sandbox (`This command requires approval`); the check rests on the developer and tester records (one new dependency, `react-markdown`; no new environment variables). Milestone "Board" not yet reached (KB-013, KB-015 are Planned, KB-014 is Proposed).

### KB-015 · Drag and drop and keyboard moving of cards — done on 2026-11-06

- **Approving test report:** Report 1 (2026-11-06), commit 4cf8b44 (later commits are workflow records only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** cards can be moved between columns and reordered by mouse or entirely by keyboard (Space to pick up, arrows, Space to drop, Escape to cancel) with screen-reader announcements; the card dialog has a "Move to..." option; viewers cannot move cards; a refused move is rolled back.
- **CHANGELOG:** "Added: Cards can now be moved between columns and reordered by dragging with the mouse or entirely from the keyboard (Space to pick up, arrow keys to move, Space to drop, Escape to cancel), with spoken announcements for screen readers; the card dialog also has a "Move to..." option for choosing a column and the top or bottom. Viewers cannot move cards, and a move the server refuses is undone (KB-015)."
- **Documentation:** `docs/api.md` (`POST /api/cards/:id/move`); no new environment variables; no migration; no ADR requested (ADR 0001 section 3 implemented)
- **Lessons:** "Move to..." lives in the card dialog (no per-card menu) and Enter on the card link still opens the card, so keyboard pick-up uses Space or the move handle; the planner may confirm both choices. Rapid arrow presses overwrite each other in the live region. Touch not tested on real devices. The create-card rebalance does not bump sibling `version` (out of scope). Three dnd-kit dependencies added. No TODO found in the task's code; no secret found (no new environment variables). Milestone "Board" not yet reached (KB-013 is Planned, KB-014 is Proposed).

### KB-016 · WebSocket server with the y-websocket protocol and room authorization — done on 2026-11-06

- **Approving test report:** Report 1 (2026-11-06), commit cc55adb (later commits are workflow records only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** an authenticated WebSocket endpoint `/ws/:room` speaking the y-websocket protocol, with Origin and session-cookie checks, room authorization through the authz resolvers, one Yjs document per room, read-only viewers, heartbeat, a 1 MiB message limit and immediate socket closing when a member is removed or their role changes.
- **CHANGELOG:** "Added: The server now has a live-connection channel that only signed-in members of a workspace can join; it keeps people's edits in sync, lets read-only viewers watch without changing anything, and disconnects people at once when they are removed from the workspace (KB-016)."
- **Documentation:** `docs/api.md` (`GET /ws/:room`); ADR 0004 real-time architecture (Accepted); no new environment variables (the heartbeat interval is a code constant); no migration
- **Lessons:** sockets are not closed on session expiry, logout, or deletion of a workspace, project, board or card, and a removal between authorization and room join is missed; the planner should consider a follow-up task. `move-cards.spec.ts:105` (KB-015) was flaky once in E2E. New dependencies in apps/api: `@fastify/websocket`, `ws`, `yjs`, `y-protocols`, `lib0`. No TODO found in the task's code; no secret found (no new environment variables). Milestone "Real time" not yet reached (KB-017 and others not Done).

### KB-013 · Card fields: assignee, priority and estimate — done on 2026-11-09

- **Approving test report:** Report 1 (2026-11-09), commit 13fd332 (later commits are workflow records only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** cards carry an assignee (workspace owner or member), a priority (none to urgent) and an estimate (0 to 100 story points); tiles show initials, priority as icon plus text and the estimate; the card dialog edits them with validation; removing a member or leaving unassigns their cards in the same transaction, with activity events.
- **CHANGELOG:** "Added: Cards can now be assigned to a workspace owner or member, given a priority (none, low, medium, high or urgent) and an estimate in story points (0 to 100); these show on the card tile and are edited in the card dialog, and when someone is removed from a workspace or leaves it, their cards become unassigned (KB-013)."
- **Documentation:** `docs/api.md` (`PATCH /api/cards/:id` fields, `INVALID_ASSIGNEE`, new activity events); migration `20261109195755_add_card_assignee_priority_estimate`; no new environment variables; no ADR requested
- **Lessons:** the planner should decide whether demoting a member to viewer should unassign their cards (currently it does not). `prisma migrate reset` was blocked in the sandbox; CI applies migrations to an empty database. No new dependencies. No TODO found in the task's code; no secret found. Milestone "Board" not yet reached (KB-014 is Proposed).

### KB-017 · Yjs document persistence in PostgreSQL — done on 2026-11-09

- **Approving test report:** Report 1 (2026-11-09), commit ff62944 (later commits are workflow records only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** collaborative documents are stored in PostgreSQL (snapshot plus batched updates, compacted after 100 updates or on unload) and survive restarts; on SIGTERM/SIGINT the server flushes pending batches, closes sockets with 1012 and exits with code 0; documents above 5 MB log a warning.
- **CHANGELOG:** "Added: Collaborative documents are now saved in the database, so they are still there after the server restarts or is redeployed; when the server is told to stop it saves what is pending and asks connected clients to reconnect (KB-017)."
- **Documentation:** `docs/api.md` (`GET /ws/:room` persistence and 1012 close); ADR 0004 section 9 (persistence design and backup implication); migration `20261109201533_add_yjs_document_persistence`; no new environment variables
- **Lessons:** note for the planner (tester's follow-up): in `store()` in `apps/api/src/modules/realtime/persistence.ts`, if the final flush fails (database failure at unload), the awaited chain throws and the document is destroyed with the retry timer cleared, so edits of that last window could be lost; consider a follow-up task. Real SIGTERM delivery to a spawned `node dist/server.js` was not run (handler-level tests only). `prisma migrate reset` was not run (sandbox); CI applies migrations to an empty database. No TODO found in the task's code; no secret found. Milestone "Real time" not yet reached (KB-018, KB-019 are Planned; KB-020, KB-021 are Proposed).

### KB-018 · Live board updates — done on 2026-11-10

- **Approving test report:** Report 1 (2026-11-10), commit acab99f (later commits are workflow records only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** after each committed mutation of columns, cards, card fields and moves (and card unassignment on member removal) the server publishes a `BoardEvent` to the `board:<id>` room, viewers included; the web client applies events to the TanStack Query cache with a version filter, skips its own echoes, and refetches on connect and reconnect; the open card dialog updates in place without overwriting a field being edited and reports remote deletion; a remote move of the focused card is announced and keeps focus.
- **CHANGELOG:** "Added: Boards now update live: when someone else adds, edits, moves or deletes a card or changes a column, everyone looking at the board sees it without reloading, viewers included. An open card updates in place without overwriting a field you are typing in, says who deleted it if it disappears, and a card you are focused on that someone else moves is announced to screen readers while keeping your focus on it (KB-018)."
- **Documentation:** `docs/api.md` (board events section); ADR 0004 updated; no migrations; no new environment variables; no new dependencies
- **Lessons:** until KB-034 is done, respaced siblings on card creation and column deletion keep their `version`, so clients drop those `card_moved` events and may show a different order until the next refetch; the planner should consider KB-034 as a dependency. There is no tombstone, so a `card_updated` after `card_deleted` (reconnect race) would re-add the card until a refetch. `members.spec.ts:98` was flaky once in E2E. `prisma migrate reset` was not run (sandbox). No TODO found in the task's code; no secret found. Milestone "Real time" not yet reached (KB-019 is Planned; KB-020, KB-021 are Proposed).

### KB-019 · Collaborative card description with Yjs — done on 2026-11-10

- **Approving test report:** Report 1 (2026-11-10), commit 4edff2c (later commits are workflow records only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** the card description is edited live by several people through a Yjs `Y.Text` in `card:<id>:description` with automatic saving and a "Saved" / "Syncing…" status; the server seeds the text once from `Card.description`, projects it back within about 1 s and on unload, and coalesces `description_changed` activity per person over 10 minutes; `PATCH /api/cards/:id` refuses `description`; viewers see the live text read-only.
- **CHANGELOG:** "Added: Several people can now edit a card description at the same time without overwriting each other: changes appear live, saving is automatic (the status shows "Saved" or "Syncing…"), viewers see the text update but cannot type, and the description can no longer be changed through the card update request (KB-019)."
- **Documentation:** `docs/api.md` (PATCH fields, `GET /ws/:room` description room); ADR 0004 section 12; no migrations; no new environment variables; new web dependencies `yjs`, `y-protocols`, `lib0`
- **Lessons:** a textarea binding is used instead of CodeMirror (allowed equivalent, in the ADR); if the final flush fails at unload the last edit window could be lost; concurrent merges can exceed 20,000 characters in the live document (the projection is cut); real SIGTERM delivery is only covered by handler-level tests; `prisma migrate reset` was not run (sandbox). No TODO found in the task's code; no secret found. Milestone "Real time" not yet reached (KB-020, KB-021 are Proposed).

### KB-034 · Bump card versions when positions are respaced — done on 2026-11-13

- **Approving test report:** Report 1 (2026-11-13), commit cb54a72 (later commits are workflow records only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** every card whose position is rewritten by a create rebalance or by a column delete with `moveCardsTo` now gets `version` incremented in the same transaction, so the sibling `card_moved` events carry newer versions and clients apply them instead of dropping them; responses are unchanged.
- **CHANGELOG:** "Fixed: Cards that are pushed to a new position when someone adds a card or deletes a column now update live for everyone on the board, so all people see the same card order without reloading (KB-034)."
- **Documentation:** ADR 0004 ordering note updated (gap closed); `docs/api.md` did not mention the risk; no migrations; no new environment variables
- **Lessons:** the spec's "320-insert" loop does not force a rebalance on create; tests write keys directly into the database to trigger it. `prisma migrate reset` was not run (sandbox). No TODO found in the task's code; no secret found. No milestone reached (the Board phase still has other tasks that are not Done).

### KB-020 · Presence: who is on the board and who is editing a card — done on 2026-11-13

- **Approving test report:** Report 1 (2026-11-13), commit 1846f99 (later commits are workflow records only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** awareness over the existing board and card-description sockets, with the server overwriting `userId`, `name` and `color` from the session and ignoring updates for other clients' IDs; the board shows up to 5 avatars plus "+N" with an accessible list; tiles show "Ana is editing", the card dialog shows "Also here", and the description shows remote carets with visible names drawn from Yjs relative positions in an `aria-hidden` overlay; presence is removed at once on a clean close.
- **CHANGELOG:** "Added: The board now shows who is there: avatars with initials (up to five, then "+N") above the board, "Ana is editing" on a card while someone types in its description, a "Also here" line in the open card, and other people's cursors in the description with their names. People disappear as soon as they leave or lose their connection, and nobody can pretend to be someone else (KB-020)."
- **Documentation:** `docs/api.md` (awareness state); ADR 0004 section 13; no migrations; no new environment variables; no new dependencies
- **Lessons:** the 30 s removal after a lost connection relies on the heartbeat and library timeout and is not covered by a test; every tile re-renders on presence changes (relevant to KB-028); `prisma migrate reset` was not run (sandbox). No TODO found in the task's code; no secret found. Milestone "Real time" not yet reached (KB-021 and others are not Done).

### KB-021 · Reconnection, offline edits and connection status — done on 2026-11-16

- **Approving test report:** Report 1 (2026-11-16), commit 4752b5a (later commit 8699b85 is a workflow record only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** one connection-state module (`lib/realtime/connection.ts`) drives both the board socket and the card description client, with backoff from 1 s to 30 s with jitter, an immediate retry on the browser `online` event and 1012 treated as a reconnect; the board header shows Connected / Reconnecting… / Offline (polite announcement) and "N changes pending"; offline description edits sync on reconnect; offline mutations are paused and replayed in order, with a named message when the target was deleted meanwhile; the board is refetched after reconnect; the browser warns before closing with unsynced changes; an expired session shows "Your session expired; N pending changes were not saved" and redirects to log in.
- **CHANGELOG:** "Added: The board header now shows the connection ("Connected", "Reconnecting…" or "Offline") and how many changes are waiting. If the connection drops, you can keep working and your changes are sent in order when it returns, and the log-in page says how many changes were not saved if your session expired meanwhile (KB-021)."
- **Documentation:** ADR 0004 section 14; `docs/api.md` unchanged (no API change); no migrations; no new environment variables; no new dependencies
- **Lessons:** a card dialog opened while already offline is read-only until its first sync; offline edits other than move, delete and create use generic failure messages; offline work does not survive a page reload (IndexedDB out of scope); `prisma migrate reset` was not run (sandbox). No TODO found in the task's code; no secret found. No milestone reached (the Real time phase still has open tasks such as KB-033, KB-037, KB-039, KB-040).

### KB-022 · Backlog and sprint planning — done on 2026-11-16

- **Approving test report:** Report 1 (2026-11-16), commit 1e2a12e (later commits are a test file and workflow records only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** migration `add_sprints` (sprints, `sprint_events`, nullable `cards.sprint_id`, date CHECK, closed/closedAt CHECK and a partial unique index for one active sprint per project); sprint create, list, edit and start endpoints with `409 SPRINT_ALREADY_ACTIVE` also under parallel starts; `PUT /api/cards/:id/sprint` with activity and live board events; a Backlog page per project with a labelled section per sprint, point totals and keyboard add/remove; a sprint dialog with date fields and a start confirmation; a board banner and "Active sprint only" filter.
- **CHANGELOG:** "Added: Work can now be planned in sprints: each project has a Backlog page that lists the cards in no sprint and one section per planned or active sprint with its dates and total story points; owners and members create and edit sprints, add cards to a sprint or send them back to the backlog (all with the keyboard), and start a sprint after a confirmation (only one sprint can be active at a time). While a sprint is active the board shows its name, dates and days left and, by default, only its cards, with an "Active sprint only" switch; other people see these changes live (KB-022)."
- **Documentation:** `docs/api.md` (sprint endpoints, `PUT /api/cards/:id/sprint`, `sprint_updated` event, board `sprints`); no ADR required by the specification; no new environment variables; no new dependencies
- **Lessons:** `prisma migrate reset` was not run (sandbox), so the empty-database replay relies on CI; a card finished in a closed sprint keeps its `sprintId` and is in neither the backlog nor a section until KB-023; suggestions for the planner: KB-023 should set `Card.sprintId = null` with `sprint_removed {reason: "sprint_closed"}`, and KB-025 can read the start snapshot from `sprint_events`. No TODO found in the task's code; no secret found. No milestone reached (KB-023 and KB-025 in Sprints are not Done).

### KB-023 · Close a sprint — done on 2026-11-17

- **Approving test report:** Report 2 (2026-11-17), commit 02b0ff0 (later commits are workflow records only; no production code changed after it). Report 1 (commit 941e7a4) was invalidated by KB-024 production changes and the task was retested.
- **Development iterations:** 1
- **Delivered:** `POST /api/sprints/:id/close` in one transaction under the board lock: unfinished cards return to the backlog with `sprint_removed {reason: "sprint_closed"}`, Done cards keep the sprint, `closedAt` and `completedPoints` are stored, a `sprint_closed` row goes to `sprint_events`, board events are published after commit; `409 SPRINT_NOT_ACTIVE` also for parallel closes; "Complete sprint" button with a confirmation preview and a polite summary on the Backlog page, optimistic with rollback.
- **CHANGELOG:** "Added: Owners and members can now complete the active sprint from the Backlog page: a confirmation says what will happen ("4 done, 2 will return to the backlog"), cards in the Done column stay in the sprint, unfinished cards go back to the backlog, and a summary is shown afterwards; the points finished are recorded for the velocity report and everyone sees the change live (KB-023)."
- **Documentation:** `docs/api.md` (close endpoint, `card_updated` source); no ADR required by the specification; no migrations; no new environment variables; no new dependencies
- **Lessons:** a finished card keeps the closed sprint's `sprintId` and appears in neither the backlog nor a section (by design, KB-022 behaviour); `committedPoints` is left as at start. The only `TODO` found is a test constant name, not a leftover; no secret found.

### KB-024 · Card activity history — done on 2026-11-17

- **Approving test report:** Report 1 (2026-11-17), commit b637114 (later commits are workflow records only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** `GET /api/cards/:id/activity` (newest first, cursor on `(createdAt, id)`, limit up to 100, actor `{id, name}`, 404 for non-members and soft-deleted cards); an "Activity" section in the card dialog with readable lines, `<time>` elements and a "Load more" button that moves focus to the first new item; an exhaustive switch over the shared event union; live refresh through board events (not for `description_changed`, by design); `description_changed` shows lengths only.
- **CHANGELOG:** "Added: Every card now has an Activity section that shows what happened to it, newest first, in plain sentences such as "Ana moved this card from To do to In progress · 2 h ago", with the exact date on hover and a "Load more" button; new changes appear live while the card is open, and description edits show only how many characters changed, never the text. Deleting a column permanently removes cards that were deleted from it earlier, together with their history (KB-024)."
- **Documentation:** `docs/api.md` (activity endpoint; D11 option A in the column-delete and card-activity sections); no ADR required by the specification; no migrations; no new environment variables; no new dependencies
- **Lessons:** names for `moved` and `assignee_changed` events come from the current board and members, so deleted columns and former members show generic text; the developer's local test run predated the last two test files (the tester's full run passed). No TODO found in the task's code; no secret found. Milestone "Reports and history" not reached (KB-025 and KB-026 are Planned).

### KB-025 · Sprint burndown — done on 2026-11-18

- **Approving test report:** Report 1 (2026-11-18), commit 3128e34 (production code last changed in 0288fa4; later commits are workflow records only)
- **Development iterations:** 1
- **Delivered:** pure `computeBurndown` in `packages/shared` (UTC days, `unestimatedCount`); `GET /api/sprints/:id/burndown` (any role, 404 for non-members) reading `activity_events`; Reports page with a Recharts chart (remaining vs ideal), a text summary, a keyboard-operable "Show as table" toggle with a real table, empty states, and live refresh through board events.
- **CHANGELOG:** "Added: Each project now has a Reports page with the burndown of the active sprint: a chart of the points still to do against the ideal line, a text summary such as "12 of 30 points remaining, 4 days left", and a "Show as table" button for the same numbers in a table; days follow UTC, cards without an estimate count as 0 points, and the page updates as people move cards (KB-025)." (already added with the code commit)
- **Documentation:** `docs/api.md` (burndown endpoint, UTC rule and the D11 option A known limitation); no ADR required by the specification; no migrations; no new environment variables; new dependency `recharts` in `apps/web`
- **Lessons:** the burndown reads `activity_events` rather than the `sprint_started` snapshot in `sprint_events`, so the snapshot stays unused by reports. No TODO left by the task (the `TODO` matches are a test constant name for a "To do" column); no secret introduced. Milestone "Reports and history" not reached (KB-026 and others still open).

### KB-033 · Close real-time sockets on logout, session expiry and resource deletion — done on 2026-11-18

- **Approving test report:** Report 1 (2026-11-18), commit e639421 (later commits are workflow records only; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** in-process bus `apps/api/src/lib/access-events.ts` (session ended, resource deleted, `roomsClosedBy`); logout closes that session's sockets with 4401; heartbeat revalidation with one batched query (`findEndedSessions`) catches expiry and direct deletions; workspace, project and card deletion close the affected rooms with 4403 after commit (a card keeps the board room); membership re-check after join closes the join race; ADR 0004 section 7 amended.
- **CHANGELOG:** "Added: Live connections now end when access ends: logging out disconnects that session's live connections within a second, expired sessions are disconnected within about 30 seconds, and deleting a workspace, project or card disconnects everyone viewing it; removing someone while they are connecting can no longer leave them connected (KB-033)."
- **Documentation:** `docs/api.md` (logout and WebSocket close codes); ADR 0004 section 7 (done in the task); no migrations; no new environment variables; no new dependencies
- **Lessons:** a project deleted between room authorization and join is not re-checked (documented in the ADR; possible follow-up for the planner); the "injected failure" rollback has no dedicated test (the 400 path covers it); one unrelated flaky E2E in `members.spec.ts` (KB-035 covers it). No TODO found in the task's code; no secret found. Milestone "Real time" not reached (KB-037, KB-039 and KB-040 are Planned).

### KB-028 · Performance with 500+ cards — done on 2026-11-19

- **Approving test report:** Report 1 (2026-11-19), commit 7981063 (later commits, 7aae44a and 49eb7c9, only change workflow records; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** `pnpm db:seed:large` (600 cards over 5 columns, refuses to run with `NODE_ENV=production`); virtualized column lists with TanStack Virtual (at most 150 tiles with 600 cards, own scroll area per column, `aria-posinset`/`aria-setsize`); ArrowUp/ArrowDown/Home/End walk through a whole column and focus restores scroll off-screen cards into view; board request in 5 SQL statements for the whole request (joined relation loading, `relationJoins` preview feature, no migration); memoized tile bodies so one board event re-renders one tile body; timings in `docs/performance.md`.
- **CHANGELOG:** "Added: Boards with hundreds of cards now stay fast: each column shows only the cards in view and scrolls on its own, the board loads with a fixed number of database queries, and one live change redraws only the card it affects; arrow keys, Home and End walk through a long column, and moving a card by keyboard still announces its position out of the full count (KB-028)."
- **Documentation:** `docs/performance.md` (done in the task); no new endpoints or messages, so no `docs/api.md` change; no ADR required by the specification; no migrations; no new environment variables; new dependency `@tanstack/react-virtual` in `apps/web` (named by the task)
- **Lessons:** `validateSessionToken` (used by every authenticated request and the WebSocket upgrade) changed to a joined query and has no direct unit test, only route tests; the 5-query budget holds for a fresh session (a daily renewal adds one `UPDATE`); keyboard dragging inside a very long column relies on dnd-kit auto-scroll and is not covered by an E2E; suggestion for the planner: a jump-to-card or "Move to top/bottom" shortcut for long columns. No TODO found in the task's code. The only credential in the repository is the demo seed password in `apps/api/src/seed/large-board.ts`, documented in the code as local-only (the seed refuses to run in production) and not a real secret. Milestone "Quality and delivery" not reached (KB-029, KB-030, KB-031, KB-032 and KB-035 are Planned); the other phases still have open tasks.

### KB-035 · Stabilise the flaky members and move-cards E2E tests — done on 2026-11-19

- **Approving test report:** Report 1 (2026-11-19), commit a42520e (later commits, cc3f64e and 2dce46b, only change workflow records; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** root causes of the three flaky E2E tests fixed (role error matched twice by an unscoped `getByText`; reload or second browser opening before optimistic writes were answered); new `afterWrite` helper in `e2e/fixtures.ts`, applied to the `board`, `cards`, `large-board`, `members` and `move-cards` specs; one application bug fixed: `onDragOver` could announce a move right after pick-up (`isOwnSpot` in `ordering.ts`, with a unit test). Repeat runs 160/160 and 80/80 without retries.
- **CHANGELOG:** "Fixed: Picking up a card with the keyboard or mouse no longer sometimes announces a move to the same position, which could replace the "Picked up" announcement for screen reader users (KB-035)."
- **Documentation:** no new endpoints, messages or environment variables, so no `docs/api.md` or `.env.example` change; no ADR required; no migrations; no new dependencies
- **Lessons:** `pnpm test:e2e -- <files> --repeat-each` does not forward arguments (use `npx playwright test`); suggestion for the planner: fix the root `package.json` script to forward arguments. No TODO found in the task's code; no secret found (the e2e password is a fake test value). Milestone "Quality and delivery" not reached (KB-029, KB-030, KB-031 and KB-032 are still open).

### KB-037 · Keep unsaved collaborative edits when the final flush fails — done on 2026-11-20

- **Approving test report:** Report 1 (2026-11-20), commit 2e6fe52 (later commits, 34f4277 and c0de80a, only change workflow records; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** a failed final store (Yjs append or `Card.description` projection) no longer drops the room: it is retained in memory and retried with backoff (1 s doubling, cap 30 s); a client joining a retained room gets the in-memory document; a compaction-only failure does not retain the room; errors log document name and attempt (no content) and one warning after 5 minutes; graceful shutdown retries within a 10 s deadline and exits with code 1, naming each unsaved document, when edits could not be saved; timers are `unref()`ed and `retainedRooms()` is exposed for tests.
- **CHANGELOG:** "Added: A database failure while a card description is being saved no longer loses the last edits: the server keeps the unsaved text in memory and keeps retrying (after 1, 2, 4 seconds and so on, at most every 30 seconds), a person who opens the card meanwhile still sees the edits, and when the server is stopped it waits up to 10 seconds for the database and exits with an error, naming each document, if something could not be saved (KB-037)."
- **Documentation:** ADR 0004 section 9 amended (done in the task); no new endpoints or messages, so no `docs/api.md` change; no new environment variables (timings are options, not variables); no migrations; no new dependencies
- **Lessons:** `RealtimeService.shutdown()` now returns a result and is memoized; the "timers do not keep the process alive" unit test only inspects timers created after its spy (the rest verified by code reading). Retained rooms stay in memory until the database recovers. No TODO found in the task's code; no secret found. Milestone "Real time" not reached (KB-039, KB-040 and KB-043 are Planned).

### KB-038 · Unassign a member's cards when they are demoted to viewer (D10) — done on 2026-11-20

- **Approving test report:** Report 1 (2026-11-20), commit 00e7f7e (the later commit 0845ec6 only adds tests; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** changing an owner or member to viewer now unassigns their live cards in the workspace through the shared `unassignCards` helper, in the same transaction (boards locked in id order, `version` + 1, `assignee_changed` with the owner as actor, `card_updated` board events after commit only); the Members page asks for confirmation (Cancel and Escape keep the role and return focus), invalidates the board and card queries and announces the result politely.
- **CHANGELOG:** "Changed: Changing an owner or member to viewer on the Members page now asks for confirmation ("<name> will become a viewer and their cards in this workspace will be unassigned.") and unassigns that person's cards in the workspace, as removing them already does; boards update live and the result is announced (KB-038)."
- **Documentation:** `docs/api.md` documents the side effect on the members endpoint; no new endpoints, messages or environment variables; no ADR required; no migrations; no new dependencies
- **Lessons:** events are asserted on the in-process bus rather than a `ws` client (bus-to-socket path covered by `board-events.test.ts`); query invalidation uses the `['projects']` and `['cards']` prefixes because keys carry no workspace id. No TODO found in the task's code; no secret found. Milestone "Authentication and workspaces" not re-reached (KB-042 is Planned).

### KB-039 · Card and column tombstones in the live board cache — done on 2026-11-24

- **Approving test report:** Report 1 (2026-11-24), commit 8655423 (the later commits, c865300 and ea407e0, only change workflow records; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** per-session bounded tombstone sets (1,000 most recent ids) for cards and columns, filled by `card_deleted` and `column_deleted` events, own successful DELETE and a 404 from a card read or mutation; create, update and move events for tombstoned ids are ignored (same object returned); fetched boards and optimistic rollbacks are filtered so a stale refetch cannot restore a deleted card or column; the open card dialog keeps "deleted by"; reducers stay pure.
- **CHANGELOG:** "Fixed: A card or column that someone deleted no longer comes back on the board because of a late live update or a slow reload of the board; a card that no longer exists is removed from the board when an action on it fails (KB-039)."
- **Documentation:** client-only change, so no `docs/api.md`, `.env.example` or ADR change; no migrations; no new dependencies
- **Lessons:** after a 404 move the message still ends with "It is back in To do." although the tile is removed; suggestion for the planner: make the U6 message say the card no longer exists when the 404 tombstoned it. Tombstones are per `QueryClient` (session), equivalent to per page because ids are never reused. No TODO found in the task's code; no secret found. Milestone "Real time" not reached (KB-040 and KB-043 are still open).

### KB-040 · Enforce the description length limit in the shared document — done on 2026-11-24

- **Approving test report:** Report 1 (2026-11-24), commit 5647afd (the later commits, f1a10f5, e22556a and e01850a, only add tests or change workflow records; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** after every applied sync step 2 or update from a member in a card description room, the server deletes the excess over `CARD_DESCRIPTION_MAX_LENGTH` (20,000) from the end in one server-origin transaction, broadcast and persisted like any update; deterministic, idempotent, never splits a surrogate pair, writes no activity event; the projection cut stays as a backstop and logs a warning with document name and length only; the editor shows a counter from 19,000 characters linked by `aria-describedby` (not a live region) and announces once, politely, a trim of the person's own text.
- **CHANGELOG:** "Added: A card description can no longer go past 20,000 characters when several people paste or type at the same time: the server removes the excess from the end for everyone, the editor shows "N characters left" from 19,000 characters and "Description limit reached (20,000 characters)" at the limit, and a trim of your own text is announced politely (KB-040)."
- **Documentation:** ADR 0004 section 12 amended (done in the task); no new endpoints or messages, so no `docs/api.md` change; no new environment variables; no migrations; no new dependencies
- **Lessons:** the own-text trim announcement is a heuristic (an ordinary tail deletion by someone else that leaves 20,000 characters can be announced too); a large update reaches every client in full before the trim update follows. No TODO found in the task's code; no secret found. Milestone "Real time" not reached (KB-043 is still Planned).

### KB-041 · Forward arguments through `pnpm test:e2e` — done on 2026-11-25

- **Approving test report:** Report 1 (2026-11-25), commit 140c29a (the later commit, c708526, only changes workflow records; no production code changed after it)
- **Development iterations:** 1
- **Delivered:** the root `test:e2e` script now runs `scripts/e2e.mjs`, which drops one leading `--` (pnpm 10 passes it literally and Playwright would treat what follows as file filters) and runs `playwright test <args>` with the same exit code; `playwright.config.ts` unchanged; no arguments behaves as before (61 E2E passed); unit test `scripts/e2e-args.test.ts` (4 cases) runs in the root `pnpm test`.
- **CHANGELOG:** "Fixed: For people working on the project: `pnpm test:e2e` now passes options such as a test file, `--repeat-each` or `--retries` to Playwright, with or without a `--` before them, instead of running the whole suite and ignoring them (KB-041)."
- **Documentation:** tooling change, so no `docs/api.md`, `.env.example` or ADR change; README and `docs/` already show only working forms; no migrations; no new dependencies
- **Lessons:** only a leading `--` is dropped, a later one reaches Playwright unchanged (intended, tested). KB-029 can now use `pnpm test:e2e -- --repeat-each=10`. No TODO found in the task's code; no secret found. Milestone "Quality and delivery" not reached (KB-029, KB-030, KB-031, KB-032 and others are open).

## Milestones

<!-- The finisher records here when an MVP phase is fully Done (e.g. "Foundations done — 2026-11-04"). -->

- Foundations done — 2026-10-27 (KB-001, KB-002, KB-003, KB-004)
- Authentication and workspaces done — 2026-11-02 (KB-005, KB-006, KB-007, KB-008, KB-009)
- Sprints done — 2026-11-17 (KB-022, KB-023)
