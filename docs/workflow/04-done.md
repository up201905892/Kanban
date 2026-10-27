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

## Milestones

<!-- The finisher records here when an MVP phase is fully Done (e.g. "Foundations done — 2026-11-04"). -->
