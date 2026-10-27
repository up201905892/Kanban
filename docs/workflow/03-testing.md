# 03 · Testing

Test reports. Only the `tester` writes here. Each test run of a task produces a new report (an old report is never rewritten).

Entry rule: the task must be `Ready for test` and have an entry in `02-development.md` with changed files and a commit.

## Reports

<!--
Report template:

### KB-000 · Title — Report N — YYYY-MM-DD

- **Commit tested:** short hash
- **Result:** Passed | Failed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm build` | ✔ / ✘ |
| Lint | `pnpm lint` | ✔ / ✘ |
| Types | `pnpm typecheck` | ✔ / ✘ |
| Unit and API | `pnpm test` (N tests) | ✔ / ✘ |
| E2E | `pnpm test:e2e` (N tests) | ✔ / ✘ |
| Authorization | requests without access return 403/404 | ✔ / ✘ / n.a. |
| Real time | two clients at once | ✔ / ✘ / n.a. |
| Accessibility | keyboard + aria-live | ✔ / ✘ |

**Acceptance criteria:**
- [x] criterion 1 — how it was verified
- [ ] criterion 2 — FAIL: description

**Tests added by the tester:** files (if any)

**Failures found (if Failed):**
1. What fails, steps to reproduce, expected vs actual, likely file
-->

### KB-001 · Monorepo scaffold and tooling — Report 1 — 2026-10-26

- **Commit tested:** 34bb1ee (in `develop` history; working tree clean apart from the status change)
- **Result:** Passed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm install --frozen-lockfile`, `pnpm build` | ✔ |
| Lint | `pnpm lint` (ESLint + Prettier, zero warnings) | ✔ |
| Types | `pnpm typecheck` | ✔ |
| Unit and API | `pnpm test` (4 tests: shared 2, api 1, web 1) | ✔ |
| E2E | `pnpm test:e2e` not defined; the task states E2E is n/a (harness in KB-003) | n.a. |
| Authorization | no protected routes yet | n.a. |
| Real time | not touched | n.a. |
| Accessibility | n/a for this task (placeholder page with `main` and `h1`) | n.a. |

**Acceptance criteria:**
- [x] Root `package.json` pins `packageManager` `pnpm@10.34.9` and `engines.node >=22`; `.nvmrc` is `22`; `pnpm-workspace.yaml` lists `apps/*` and `packages/*`; lockfile committed, `pnpm install --frozen-lockfile` succeeds — read the files and ran the install.
- [x] `apps/web` (React + Vite), `apps/api` (Fastify), `packages/shared` (built to `dist` with `.d.ts`; both apps depend on `workspace:*`) — read the package.json files and ran the build.
- [x] Base tsconfig with `strict` and `noUncheckedIndexedAccess`, extended by every package — read all tsconfig files.
- [x] Root scripts `build` (shared first), `lint` (eslint + prettier --check), `format`, `typecheck`, `test`, `dev` exist — read `package.json`; build, lint, typecheck and test run. `pnpm dev` was not run (background processes are not permitted in this sandbox); its parts were checked instead (see next item).
- [x] `GET /health` returns `200 {"status":"ok"}` — `app.inject` test, plus the built server (`dist/server.js`) started on a real port and queried with `fetch`: 200 `{"status":"ok"}`, unknown route 404. The web placeholder renders `APP_NAME` from `@kanban/shared` — Testing Library test; the web production build succeeds.
- [x] `.gitignore` covers `node_modules`, `dist`, `.env`, coverage, Playwright reports — read the file.
- [x] G1 — build, lint, typecheck and test green; no `.only`/`.skip`/`@ts-ignore` found. G9 — dependencies listed in the development entry and pinned in the lockfile; runtime dependencies are within the stack (fastify, react, react-dom).

**Required tests:** one unit test per package (shared `slugify` x2, web `App`), API `/health` via `app.inject`. They exist, assert real behaviour and are not trivial.

**Tests added by the tester:** none

**Observations (not failures):**
- `typescript` is declared as `^6.0.3` (the development note says `~6.0`); the lockfile pins the resolved version, so this is harmless.
- `pnpm dev` (vite and `tsx watch`) was not exercised live.

### KB-002 · Local PostgreSQL, Prisma and validated configuration — Report 1 — 2026-10-26

- **Commit tested:** 23baaa8 (in `develop` history; working tree clean apart from the status change)
- **Result:** Passed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm install --frozen-lockfile`, `pnpm build` (runs `prisma generate`) | ✔ |
| Lint | `pnpm lint` | ✔ |
| Types | `pnpm typecheck` | ✔ |
| Unit and API | `pnpm test` (24 tests incl. 2 added by the tester: shared 2, web 1, api 21) | ✔ |
| E2E | `pnpm test:e2e` not defined; the task states E2E is n/a (harness in KB-003) | n.a. |
| Authorization | no protected routes yet | n.a. |
| Real time | not touched | n.a. |
| Accessibility | n/a for this task | n.a. |

**Acceptance criteria:**
- [x] `docker-compose.yml` with `postgres:17`, named volume `kanban_pgdata`, healthcheck, init script creating `kanban_test`; `db:up` (`docker compose up -d --wait`) and `db:down` exist — verified by reading the files only; docker is not available in this run, so the stack was not started.
- [x] Prisma in `apps/api/prisma/schema.prisma`; `db:migrate` = `prisma migrate deploy`, `db:migrate:dev` = `prisma migrate dev`; migration `20261026180933_init` exists — read files; `prisma migrate deploy` ran through the Vitest global setup; `prisma migrate diff` from the database to the schema reports no difference.
- [x] Client generated in `pnpm build` (api `build` = `prisma generate && tsc`) — `pnpm build` ran from the install with no extra database step and typecheck passed afterwards.
- [x] Config module validates `DATABASE_URL`, `SESSION_SECRET` (>= 32), `PORT`, `WEB_ORIGIN`, `NODE_ENV`; invalid configuration exits — read `config.ts`; unit tests; added `config-exit.test.ts` proving `loadConfigOrExit` prints variable names only (no values) and calls `process.exit(1)`.
- [x] `GET /health/ready` returns 200 `{db:"ok"}` / 503 `{db:"unavailable"}` — `health.test.ts` against the real test database and an unreachable URL; response parsed with the shared Zod schema.
- [x] `.env.example` lists every variable with fake values and a comment each — read the file (`PORT`, `HOST`, `NODE_ENV`, `WEB_ORIGIN`, `DATABASE_URL`, `TEST_DATABASE_URL`, `SESSION_SECRET`).
- [x] Global setup applies migrations; `resetDatabase()` truncates all tables (keeps `_prisma_migrations`) and refuses non-`_test` databases, including lookalikes (`kanban_test_backup`), empty names and invalid URLs, without leaking credentials — read the code and tests; they ran green.
- [x] G1 (all checks green, no `.only`/`.skip`), G3, G6, G8 — checked; G9 dependencies listed in the development entry.

**Required tests:** config accepts valid / rejects missing `DATABASE_URL` and short `SESSION_SECRET` with name-only messages; `resetDatabase()` throws for a non-`_test` database; `/health/ready` 200 and 503. All exist, assert real behaviour and are not trivial.

**Tests added by the tester:** `apps/api/src/config-exit.test.ts` (exit code 1 and no value leakage on invalid configuration).

**Observations (not failures):**
- `prisma migrate reset --force` was not run: Prisma blocks it when invoked by an AI agent without explicit user consent. Instead, the single `init` migration was checked by reading it, by the `migrate deploy` in global setup and by `migrate diff` showing no drift. The database was not recreated from empty in this run; worth a manual `prisma migrate reset` by João.
- `pnpm db:up` / `db:down` and the real server start were not run (no docker, no compound commands in this sandbox).
- The `app_meta` table is a technical placeholder so that `init` exists, as the developer noted; the planner may confirm it.

### KB-003 · API conventions and E2E harness — Report 1 — 2026-10-27

- **Commit tested:** f93922c (in `develop` history, HEAD c0a45eb; working tree clean apart from the status change)
- **Result:** Failed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm build` | ✔ |
| Lint | `pnpm lint` | ✔ |
| Types | `pnpm typecheck` | ✔ |
| Unit and API | `pnpm test` (shared 6, web 1, api 36) | ✔ |
| E2E | `pnpm test:e2e` and `CI=1 pnpm test:e2e` (2 passed each) | ✔ |
| Authorization | no protected routes yet | n.a. |
| Real time | not touched | n.a. |
| Accessibility | n/a for this task | n.a. |

**Acceptance criteria:**
- [x] Zod type provider with shared schemas; `ErrorCode` and `ApiError` in `packages/shared` — read `app.ts`, `errors.ts`; validator/serializer compilers set; strict-schema test passes.
- [x] Global error and not-found handlers return A1; unexpected errors give `500 INTERNAL_ERROR` with a generic message and the full error is logged with the request id — read `app.ts`, `app-error.ts`; `app.test.ts` asserts the body has no SQL/path/stack text and the log line `reqId` equals `x-request-id`.
- [x] pino logging with a request id per request; cookies, authorization, set-cookie and passwords redacted — `app.test.ts` (distinct ids; no `SECRET` string in log output). The redaction test logs a hand-built `req` object, not a real request carrying a body password (see observations).
- [x] `buildApp()` factory used by server and tests; `modules/health/{routes,service,health.test}` as the reference module — read files.
- [x] `test:e2e:setup` = `playwright install --with-deps chromium`; `test:e2e` = `playwright test`; config starts api and web via `webServer`, `reuseExistingServer: !isCI`, Chromium only, `trace: 'retain-on-failure'` — read `playwright.config.ts` and `package.json`; ran E2E with and without `CI=1`. `test:e2e:setup` itself was not run (needs system packages).
- [x] Fixture with independent `userA` and `userB` contexts — `fixtures.spec.ts` checks cookies, localStorage and distinct contexts; passed.
- [ ] Common criteria G1, G2, A1, A2 — G1, A1, A2 verified. **G2 not met**, see failure 1.

**Required tests:** error serializer unit tests, API tests (404 A1, 400 with details, 500 without stack), smoke and fixture E2E all exist and assert real behaviour. Not trivial.

**Tests added by the tester:** none

**Failures:**
1. G2 violated in the reference module. The `GET /health` response schema `healthResponseSchema = z.object({ status: z.literal('ok') })` is defined locally in `apps/api/src/modules/health/routes.ts` instead of in `packages/shared`. G2 requires every response body to have a Zod schema in `packages/shared`, with web and api using the inferred types. Reproduce: `grep -rn "status" packages/shared/src` finds no health schema. Expected: a shared schema (next to `readyResponseSchema`) imported by the route. Actual: local duplicate. Likely files: `apps/api/src/modules/health/routes.ts`, `packages/shared/src`.

**Observations (not failures):**
- The redaction test would be stronger if it sent a real request body containing `password` through a test route and asserted on the real log lines.
- `pnpm test:e2e:setup` was not run; Chromium was already available.
- Sandbox denials: compound commands (`cd ... && ...`, `;` chains, heredoc appends) and `git -C <path>`; plain `git status` and `git log` worked.

### KB-003 · API conventions and E2E harness — Report 2 — 2026-10-27

- **Commit tested:** e514dee (in `develop` history, HEAD a61c79b; working tree clean apart from the status change)
- **Result:** Passed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm build` | ✔ |
| Lint | `pnpm lint` | ✔ |
| Types | `pnpm typecheck` | ✔ |
| Unit and API | `pnpm test` (shared 6, web 1, api 37) | ✔ |
| E2E | `pnpm test:e2e` (2 passed) | ✔ |
| Authorization | no protected routes yet | n.a. |
| Real time | not touched | n.a. |
| Accessibility | n/a for this task | n.a. |

**Acceptance criteria:**
- [x] Zod type provider with shared schemas; `ErrorCode` and `ApiError` in `packages/shared` — unchanged since report 1; tests green.
- [x] Global error and not-found handlers return A1; 500 generic with full error logged with the request id — `app.test.ts` green (unchanged).
- [x] pino logging, request id per request, redaction — new test sends a real `POST /__test/login` with a cookie header and a body password; asserts the log contains the request and email but no `SECRET` text.
- [x] `buildApp()` factory and `modules/health` reference module — unchanged.
- [x] `test:e2e:setup` / `test:e2e` scripts and Playwright config — E2E ran green; `test:e2e:setup` not run (needs system packages).
- [x] Two-context fixture `userA`/`userB` — `fixtures.spec.ts` passed.
- [x] G1, G2, A1, A2 — G2 now met: `healthResponseSchema` and `readyResponseSchema` live in `packages/shared/src/health.ts` and the health routes import both from `@kanban/shared` (grep shows no local schema definition left in `apps/api`).

**Required tests:** all exist, assert real behaviour, not trivial.

**Tests added by the tester:** none

**Failures:** none

**Observations (not failures):**
- `CI=1 pnpm test:e2e` was not re-run (no E2E or web changes since report 1, where it passed).
- Sandbox denials: compound commands (`&&`, `;` chains, `git merge-base` combined with echo) and `sed -i` chains; I used the Edit tool, `pnpm --dir` and heredoc append.

### KB-004 · Web app shell, data layer and minimal local components — Report 1 — 2026-10-27

- **Commit tested:** 488703d (in `develop` history, HEAD f334744; working tree clean apart from the status change)
- **Result:** Passed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm build` | ✔ |
| Lint | `pnpm lint` | ✔ |
| Types | `pnpm typecheck` | ✔ |
| Unit and API | `pnpm test` (shared 6, web 18, api 37) | ✔ |
| E2E | `pnpm test:e2e` (6 passed) | ✔ |
| Authorization | no protected routes touched | n.a. |
| Real time | not touched (proxy config only) | n.a. |
| Accessibility | axe E2E on 404, tab order E2E, Dialog keyboard unit test | ✔ |

**Acceptance criteria:**
- [x] Router, root layout, 404, error boundary with Reload: `router.tsx` and `routes/` read; `App.test.tsx`, `RouteError.test.tsx` and the E2E 404 test pass.
- [x] QueryClient defaults (no retry on 4xx) and typed `apiClient`: `query-client.ts` `shouldRetry` and `api-client.ts` read (`credentials: 'include'`, schema validation, A1 parsed into `ApiError`, NETWORK_ERROR and INVALID_RESPONSE fallbacks); `api-client.test.ts` green.
- [x] ESLint forbids `fetch` outside `lib/api`: confirmed by linting `api-client.ts` content as `apps/web/src/x.ts` through stdin, which raised `no-restricted-globals` for `fetch`.
- [x] Local components (Button, IconButton, TextField, TextArea, Select, Dialog, Spinner, EmptyState, ErrorState, Announcer and `useAnnounce`): all files exist; Dialog trap, Escape and focus return, `aria-describedby` and live regions covered by `components.test.tsx`.
- [x] Vite dev proxy for `/api` and `/ws` (ws enabled): verified by reading `vite.config.ts` only.
- [x] Common criteria G1, U1, U3, U4, U5, U8, U9, U10: axe has zero serious or critical violations, a 360 px no-overflow check passes, tab order is skip link, brand link, back link.

**Required tests:** all exist, assert real behaviour, not trivial.

**Tests added by the tester:** none

**Failures:** none

**Observations (not failures):**
- The Vite proxy was not exercised at runtime (no test; config reviewed only).
- `/health` is not under `/api`, so it is not proxied (developer already flagged it for the planner).
- Sandbox denials: heredoc append with `tee`, and plain `git status --short` (plain `git status` worked).
