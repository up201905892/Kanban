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

## Milestones

<!-- The finisher records here when an MVP phase is fully Done (e.g. "Foundations done — 2026-11-04"). -->

- Foundations done — 2026-10-27 (KB-001, KB-002, KB-003, KB-004)
