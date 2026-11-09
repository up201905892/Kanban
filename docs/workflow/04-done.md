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

## Milestones

<!-- The finisher records here when an MVP phase is fully Done (e.g. "Foundations done — 2026-11-04"). -->

- Foundations done — 2026-10-27 (KB-001, KB-002, KB-003, KB-004)
- Authentication and workspaces done — 2026-11-02 (KB-005, KB-006, KB-007, KB-008, KB-009)
