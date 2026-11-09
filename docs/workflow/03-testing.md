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

### KB-010 · Fractional indexing utility and ordering/conflict ADR — Report 1 — 2026-10-28

- **Commit tested:** ee1160d (in `develop` history, HEAD 718ec9c; working tree clean before the tester's test file)
- **Result:** Passed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm build` | ✔ |
| Lint | `pnpm lint` | ✔ |
| Types | `pnpm typecheck` | ✔ |
| Unit and API | `pnpm test` (shared 29 + 3 added, web 18, api 37) | ✔ |
| E2E | `CI=1 pnpm test:e2e` (6 passed) | ✔ |
| Authorization | no routes touched | n.a. |
| Database | no migrations | n.a. |
| Real time / accessibility | not touched | n.a. |

**Acceptance criteria:**
- [x] ADR (G7): `docs/adr/0001-ordering-and-conflict-handling.md` read; covers base-62 keys, (position, id) order, server-computed keys with client keys as hints, rebalancing above 50 characters, field-level LWW PATCH, last move wins, delete wins with 404, per-card `version`, idempotent creates (A6) and the Yjs/PostgreSQL split (section 7, explicitly provisional pending D5).
- [x] `packages/shared/src/ordering`: `keyBetween`, `keysBetween`, `isValidKey`, `compareByPosition` exist, are pure and are exported; implementation read in full.
- [x] Measured lengths in the ADR (4 characters after 10,000 appends; 1,669 after 10,000 same-position inserts, over 50 at insert 289) match the assertions in the unit test, which passes.
- [x] Common criteria G1, G7, G8, G9: all checks green; only dev dependency `fast-check` added, justified by the required property tests; no new runtime dependency.

**Required tests:** fast-check properties for random inserts and `keysBetween(n = 100)`, invalid keys and `a >= b` throwing all exist and assert real behaviour.

**Tests added by the tester:** `packages/shared/src/ordering/fractional-index.edge.test.ts` (10,000 repeated prepends, random insert/delete sequences, `keysBetween` between fractional bounds); all pass.

**Failures:** none

**Observations (not failures):**
- D5 is still pending, so ADR section 7 and the dependent sections 3, 5 and 6 may need revision; the ADR states this openly.
- `COLLATE "C"` for position columns and the stale-neighbour rule are for KB-011, KB-012 and KB-015 to implement and test.

### KB-005 · Authentication core: accounts and cookie sessions — Report 1 — 2026-10-29

- **Commit tested:** 2b198b3 (in `develop` history, HEAD 22bbc86; working tree clean before the tester's test file)
- **Result:** Passed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm build` | ✔ |
| Lint | `pnpm lint` | ✔ |
| Types | `pnpm typecheck` | ✔ |
| Unit and API | `pnpm test` (shared 38, web 18, api 91, plus 9 added by the tester) | ✔ |
| E2E | `CI=1 pnpm test:e2e` (8 passed) | ✔ |
| Authorization | see criteria; protected by default, explicit public list | ✔ |
| Database | `prisma migrate status` up to date; `migrate diff` DB vs schema: no difference; migration SQL read | ✔ (see observations) |
| Real time / accessibility | not touched (n.a. per spec) | n.a. |

**Acceptance criteria:**
- [x] ADR: `docs/adr/0002-authentication-and-sessions.md` read; covers hashing, token, cookie, expiry, CSRF, rate limits, enumeration trade-off and why D3.
- [x] Migration: `users` and `sessions` columns, unique email and token hash, FK with `ON DELETE CASCADE`, lowercase `CHECK`; checked in the SQL and by a no-drift diff against the schema.
- [x] Signup: 201 plus cookie; 400 for invalid email, short (9) and long (129) password, unknown field, malformed JSON, empty body, array body; 10 and 128 characters accepted; 409 `EMAIL_TAKEN` also for a different email case. Verified with the developer tests and `auth.edge.test.ts`.
- [x] Login: 200 plus cookie; unknown email and wrong password give byte-identical 401 bodies; dummy hash verified (code read); email is trimmed and case-insensitive.
- [x] Logout: 204, empty body, session row deleted, cleared cookie (`Max-Age=0`), other sessions of the same user untouched; `me` then 401; `me` 401 with no, empty, junk, oversized and tampered cookies.
- [x] argon2id (`$argon2id$` prefix checked), `passwordHash` not in any response; test logs checked: no password, cookie or `passwordHash` in captured log lines, and a 400 body does not echo the password.
- [x] Token and cookie: 32 random bytes, only SHA-256 stored, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` only in production, 30-day sliding expiry renewed at most daily, expired sessions rejected and deleted (code read and developer unit/API tests).
- [x] Origin check: missing, `null`, look-alike and trailing-slash origins give 403 `CSRF_REJECTED` in the error format; rate limit 429 with `Retry-After` after 10 attempts per IP and email (limiter keyed on the normalised email).
- [x] `requireAuth` on everything outside the explicit `PUBLIC_ROUTES`; `/health` public; unknown paths 404 without leaking; `getSessionFromCookieHeader()` exported.
- [x] Test helpers `createUserAndLogin()` and Playwright `signUpViaApi`/`logInViaApi` exist and are used by passing tests.
- [x] CLI `admin:reset-password`: unknown email exits 1 with a message, no argument exits 2 with usage, invalid email exits 1 without a stack trace; the function resetting the password and deleting all sessions is covered by the developer tests.
- [x] Common criteria G1 to G4, G6 to G8, A1 to A3, A5, A7: checks green, errors in the project format, no secrets in the repository, new dependency `@node-rs/argon2` justified.

**Required tests:** all listed unit and API tests exist and assert real behaviour (hash round trip, token hashing, cookie options per `NODE_ENV`, Origin check, sliding expiry, signup/login/logout/me matrix, 429, no `passwordHash`, CLI). E2E and accessibility n.a.

**Tests added by the tester:** `apps/api/src/modules/auth/auth.edge.test.ts` (9 tests: hostile Origin values, malformed bodies, password length boundaries, email case, log and body leakage, junk cookies, logout without Origin or session and per-session deletion, byte-identical 401 bodies, public and unknown routes); all pass.

**Failures:** none

**Observations (not failures):**
- `prisma migrate reset --force` was refused by Prisma's AI-safety guard (no user consent in this unattended run) and was not bypassed. Applying the migrations to an empty database was therefore checked indirectly: the test database was built from these two migrations, status is up to date and the schema diff is empty. CI runs the migrations on an empty service database.
- The dummy hash is computed lazily, so the first unknown-email login after a process start is slower (about 67 ms against 14 ms measured, including connection warm-up). It is slower, not faster, and affects one request; the developer may warm it at start-up.
- Rate-limit buckets are per IP and email, so one IP can try many different emails (as specified); `trustProxy` is for KB-031.

### KB-006 · Sign-up, log-in and log-out UI with protected routes — Report 1 — 2026-10-29

- **Commit tested:** f26ab7e (in `develop` history, HEAD aeb4224; working tree clean before the tester's test file)
- **Result:** Passed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm build` | ✔ |
| Lint | `pnpm lint` | ✔ |
| Types | `pnpm typecheck` | ✔ |
| Unit and API | `pnpm test` (shared 38, web 54, api 100; plus 9 web tests added by the tester) | ✔ |
| E2E | `CI=1 pnpm test:e2e` (20 passed) | ✔ |
| Authorization | protected routes: private routes sit under `RequireAuth`; 401 handling code and tests read | ✔ |
| Database | no migrations in this task | n.a. |
| Real time | not touched | n.a. |
| Accessibility | E2E: keyboard-only sign-up and log-in, focus on first invalid field, axe on both pages (with and without errors), 360 px; code read for `aria-pressed`, assertive announcer, `:focus-visible` style | ✔ |

**Acceptance criteria:**
- [x] `/signup` and `/login` with field-level errors from `details` and API messages for 401/409/429: `form-errors.ts` read; unit tests (`auth-flow.test.tsx`) and E2E (wrong password, duplicate email) pass.
- [x] `useCurrentUser()` on `/api/auth/me`; `RequireAuth` redirects to `/login?next=<path>` and login returns there; `next` sanitized (E2E: login returns to the page; external `next` ignored). Code read of `safe-next.ts`.
- [x] Any 401 `UNAUTHENTICATED` clears the cache and redirects keeping the path (`unauthorized.test.tsx`, E2E expired session). A wrong password (`INVALID_CREDENTIALS`) does not trigger it.
- [x] "Log out" in the header clears the cache and goes to `/login` (unit and E2E; protected URL then redirects).
- [x] Password show/hide toggle with `aria-pressed` (unit test; code read; reachable by Tab).
- [x] Common criteria G1, U1 to U5, U8 to U10: checks green, loading (spinner), error (retry) and submit-disabled states present, errors announced assertively, 360 px layout, axe clean.

**Required tests:** sanitizer unit tests (absolute, protocol-relative, backslash, `javascript:`, control chars) exist and assert real behaviour; E2E covers every listed flow, axe on both pages and keyboard-only completion; API n/a.

**Tests added by the tester:** `apps/web/src/features/auth/safe-next.edge.test.ts` (9 tests: NUL, CRLF, DEL, triple slash, `/\/`, `https:/`, `mailto:`, `vbscript:`, encoded slashes, `loginPathFor` with unsafe input); all pass.

**Failures:** none

**Observations (not failures):**
- On logout, `RequireAuth` and the logout handler both navigate; the last navigation (`/login`, no `next`) wins and E2E confirms the result.
- No Retry-After countdown for 429, as the developer noted and the spec allows.
- The Planning index rows for KB-007 and KB-008 are joined on one line (pre-existing; for the planner).

### KB-007 · Workspaces, memberships and the authorization policy — Report 1 — 2026-10-30

- **Commit tested:** 3175dc4 (in `develop` history; working tree clean before the tester's test file)
- **Result:** Passed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm build` | ✔ |
| Lint | `pnpm lint` | ✔ |
| Types | `pnpm typecheck` | ✔ |
| Unit and API | `pnpm test` (shared 69, web 73, api 119; plus 5 api tests added by the tester) | ✔ |
| E2E | `CI=1 pnpm test:e2e` (24 passed) | ✔ |
| Authorization | `authorize.ts`, `service.ts`, `routes.ts` read; API tests and tester edge tests | ✔ |
| Database | migration SQL read (enum, unique index, cascades); test database is up to date with 3 migrations | ✔ (see observations) |
| Real time | not touched | n.a. |
| Accessibility | E2E: axe on home, settings and not-found, keyboard dialog (Enter/Escape, focus return), keyboard switcher | ✔ |

**Acceptance criteria:**
- [x] ADR 0003 exists with Context, Decision, Alternatives considered, Consequences (headings checked); the role matrix is covered by the table-driven `authz.test.ts`.
- [x] Migration: `Workspace` and `Membership` with role enum, unique `(workspace_id, user_id)`, cascade on workspace delete (SQL read; cascade verified by API test and tester test).
- [x] Policy module `authz`: `authorize()` resolves the workspace, loads the membership, 404 for missing or non-member (identical body, tested with a real versus random id), 403 for a weak role. The project resolver is not present because the `Project` table arrives in KB-008, which lists the resolver as its own criterion (see observations).
- [x] Endpoints: create 201 (owner membership in one nested write), list only mine with role, get, patch (owner), delete (owner, `confirmName`) 204 with cascade; 400/401/403/404 verified by developer tests and tester edge tests.
- [x] UI: home list with empty state, create dialog, header switcher, settings with rename and typed-name delete, read-only for non-owners; covered by web flow tests and E2E.
- [x] Common criteria G1 to G4, G7, G8, A1 to A5, A7, U1 to U10: checks green, schemas strict and in `packages/shared`, errors in the project format, 360 px and axe covered by E2E. A6 and A8 do not apply.

**Required tests:** role x action matrix unit test, API matrix (201/400/401, isolation, identical 404, 403 for member and viewer, 204 with cascade, wrong name 400), E2E (create, list, switcher, rename, delete, axe) and keyboard tests all exist and assert real behaviour.

**Tests added by the tester:** `apps/api/src/modules/workspaces/workspaces.edge.test.ts` (5 tests: non-member delete with a wrong name gives the same 404 as a random id; exact, case-sensitive confirmation; whitespace-only rename rejected; foreign Origin 403 and malformed id 400 with no change; empty list and delete isolation between workspaces); all pass.

**Failures:** none

**Observations (not failures):**
- `prisma migrate reset --force` was not run (Prisma's AI-safety guard refused it in earlier unattended runs); the test database is built from the three migrations with none pending. CI applies them to an empty database.
- The planning criterion mentions a project resolver; it is deferred to KB-008 (its criterion list includes it) because no `Project` table exists yet.
- A non-member sending a malformed or empty body to a real workspace ID gets 400 before authorization, identical to a random ID, so nothing leaks.

### KB-008 · Projects within a workspace — Report 1 — 2026-10-30

- **Commit tested:** 1ce8f22 (in `develop` history; working tree clean before testing)
- **Result:** Passed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm build` | ✔ |
| Lint | `pnpm lint` | ✔ |
| Types | `pnpm typecheck` | ✔ |
| Unit and API | `pnpm test` (shared 89, web 85, api 154) | ✔ |
| E2E | `CI=1 pnpm test:e2e` (27 passed) | ✔ |
| Authorization | `service.ts`, `routes.ts`, `authorize.ts` read; every route calls `authorize()` with the right action; API tests for 401, identical 404 (non-member vs unknown), 403 viewer and member | ✔ |
| Database | migration SQL read (table, unique `(workspace_id, key)`, `next_card_number` default 1, cascade FK); applied in the test database; cascade tested | ✔ (see observations) |
| Real time | not touched | n.a. |
| Accessibility | E2E: axe on workspace page, settings and not-found; keyboard-only create dialog with Escape focus return; project list is a `ul` (aria-label Projects) of links | ✔ |

**Acceptance criteria:**
- [x] Migration `Project` (id, workspaceId FK cascade, name, key, nextCardNumber default 1, createdAt): SQL read; name 1-80 and key `^[A-Z]{2,5}$` enforced by the shared Zod schemas (shared and API tests).
- [x] Endpoints POST (owner, member) 201, GET list and GET one (any role), PATCH (owner, member), DELETE (owner) 204 with cascade; duplicate key gives `409 PROJECT_KEY_TAKEN`: routes read and API tests (create, 400 matrix, 409, concurrent creates, roles, cascade from workspace delete).
- [x] Authz project resolver added (project to workspace): `authorize.ts` read; exercised by the project routes and a direct `authorize()` test.
- [x] UI: workspace page lists projects with loading, empty and error (Retry) states; create dialog suggests the key from the name; settings with rename and owner-only delete with typed-name confirmation: web flow tests and E2E.
- [x] Common criteria G1-G4, A1-A5, A7, U1-U10: checks green, contracts in `packages/shared`, errors in the project format, axe in E2E.

**Required tests:** key suggestion unit ("Kanban Board" to "KB"); API (201, 400 invalid key, 409, 401, 404 non-member, 403 viewer, list isolation, delete 403 member and 204 owner); E2E (create, open, rename, delete, axe); keyboard dialog test. All exist and assert real behaviour.

**Tests added by the tester:** none (existing coverage judged sufficient).

**Failures:** none

**Observations (not failures):**
- `prisma migrate reset --force` was not run (Prisma's AI-safety guard refuses it in unattended runs); the test database is built from the migrations. CI applies them to an empty database.
- PATCH accepts only `name` (key immutable, since card IDs will use it) and the API delete has no typed-name confirmation (UI only); both match the task text, which does not require otherwise.

### KB-009 · Invite links, members and roles — Report 1 — 2026-11-02

- **Commit tested:** dbdd2e9 (with b5df221; both in `develop` history; working tree clean before testing)
- **Result:** Passed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm build` | ✔ |
| Lint | `pnpm lint` | ✔ |
| Types | `pnpm typecheck` | ✔ |
| Unit and API | `pnpm test` (shared 104, web 94, api 185) | ✔ |
| E2E | `CI=1 pnpm test:e2e` (29 passed) | ✔ |
| Authorization | invites and members `service.ts`/`routes.ts` read; every route calls `authorize()` (`members:manage` for create, list, revoke, role change, remove others; `workspace:read` for list and leave); API tests for 401, identical 404 (non-member vs unknown), 403 member and viewer | ✔ |
| Database | migration SQL read (unique `token_hash`, role enum, cascade FKs, `uses` default 0, workspace index); applied in the test database | ✔ (see observations) |
| Real time | not touched (socket closing is KB-016) | n.a. |
| Accessibility | E2E: axe on invite and members pages, keyboard-only invite creation and copy; "Link copied" announced via `announce`; role select `aria-label` "Role for <name>"; Revoke buttons labelled; loading, empty and error (Retry) states present; `role="alert"` on errors | ✔ |

**Acceptance criteria:**
- [x] Migration `Invite`: SQL read, matches the field list.
- [x] Create 201 with link once (`no-store`, only the SHA-256 stored), list active (owner), revoke 204 (idempotent): routes read and API tests (400 matrix, 401, 403, 404).
- [x] Public preview 200; unknown, expired, revoked and exhausted give the same `404 INVITE_INVALID`: API test compares them.
- [x] Accept: conditional `updateMany` plus membership insert in one transaction; parallel accepts on `maxUses=1` give exactly one membership (test); existing member 200, no role change, no use consumed.
- [x] Members list (any role), PATCH role (owner), DELETE (owner or self); `409 LAST_OWNER` on demote, remove and leave; workspace row locked `FOR UPDATE` against concurrent demotion (test).
- [x] Removed member keeps their created data, session stays valid, workspace access gives 404 at once (API and E2E).
- [x] UI: invite page with `next` round trip, members page (role select, confirm removal, invite dialog with Copy link, active list with Revoke): web flow tests and E2E.
- [x] Common criteria G1-G4, G8, A1-A8, U1-U10: checks green, contracts in `packages/shared`, project error format, axe in E2E.

**Required tests:** unit validity (valid, expired boundary, revoked, exhausted); API matrix as listed; E2E two contexts (viewer invite, read-only, promote, create project after reload, axe); accessibility (keyboard copy announcement, labelled role select). All exist and assert real behaviour.

**Tests added by the tester:** none (existing coverage judged sufficient).

**Failures:** none

**Observations (not failures):**
- `prisma migrate reset --force` was not run (Prisma's AI-safety guard refuses it in unattended runs); the test database is built from the migrations. CI applies them to an empty database.
- The loser of a concurrent mutual demotion gets 403 rather than 409 (documented by the developer); the invariant of one owner holds.
- Members can read each other's email on the members list, as the criteria require.

### KB-011 · Board and configurable columns — Report 1 — 2026-11-05

- **Commit tested:** 60565ef (in the history of `develop`; working tree clean before testing)
- **Result:** Passed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm build` | ✔ |
| Lint | `pnpm lint` (zero warnings, Prettier clean) | ✔ |
| Types | `pnpm typecheck` | ✔ |
| Unit and API | `pnpm test` (shared 112, web 111, api 230 = 453 tests) | ✔ |
| E2E | `pnpm test:e2e` (31 tests, including `e2e/board.spec.ts`) | ✔ |
| Authorization | 401 without session, 404 for non-members (same body as a missing id), 403 for viewers on writes, 404 for another board's neighbour id; checked in code and `boards.test.ts` | ✔ |
| Real time | live updates are out of scope (KB-018) | n.a. |
| Accessibility | keyboard menu, Enter/Escape in inline forms, aria-live announcements, axe in E2E | ✔ |

**Acceptance criteria:**
- [x] Migration `20261105173341_add_boards_and_columns`: read the SQL; `Board` 1:1 with `Project` (unique project_id, cascade), `Column.position` is `TEXT COLLATE "C"`, index `(board_id, position, id)`, `CHECK` on name length 1 to 50, partial unique index for one Done column per board, and a data migration that creates boards and the three default columns for existing projects. Migrations apply on the test database (`prisma migrate status`: up to date, 6 migrations).
- [x] ADR 0001 amended: diff read; Status and the section 7 heading no longer say provisional, the decision, date and D5 are stated, the original text is kept.
- [x] New projects get "To do", "In progress", "Done" (Done flagged) in the same transaction (nested create in the project service; covered by `boards.test.ts` default-board test).
- [x] Exactly one Done column: service swaps the flag in one transaction under a board row lock, clearing the old one first; clearing directly and deleting the Done column return `409 DONE_COLUMN_REQUIRED`; the partial unique index backs it. Covered by the API tests, including a race test.
- [x] Endpoints: `GET /api/projects/:pid/board`, `POST /api/boards/:bid/columns` (201 / repeated id 200 with no duplicate / other board's id 409), `PATCH /api/columns/:id` (name, move via neighbours, isDone), `DELETE /api/columns/:id` 204. Owner and member manage, viewer reads. Routes and tests read; strict Zod schemas give `400 VALIDATION_ERROR`.
- [x] UI: add column inline form, inline rename (Enter saves, Escape cancels), column menu (Move left/right, Mark as Done, Delete with confirmation), optimistic updates with rollback; verified through `board-flow.test.tsx` and the passing E2E (add, rename, keyboard reorder, mark Done, delete, reload persistence).
- [x] Common criteria: G1 (all checks green, no `.only`/`.skip` found in the new tests), G2 (schemas in `packages/shared/src/board.ts`), G3, G4 (transactions, FK, CHECK, partial unique index), A1 to A7 (error format, validation, CSRF/401 tests, no-leak 404, idempotent create, test matrix), U1 to U10 (axe in E2E, scroll container, announcements, role-aware UI).

**Required tests:**
- [x] Unit: neighbour selection for move left/right at the edges (`board.test.ts`, `ordering.test.ts`); non-trivial, assert both edges.
- [x] API: get board 200/401/404; create 201 and same id again 200 with no duplicate; invalid name 400; viewer 403; Done exclusivity; deleting Done 409; another board's column id 404/409; `a0` vs `Z0` returned in code-unit order (binary collation).
- [x] E2E: add, rename, reorder by keyboard, delete, reload persistence, axe on the board.
- [x] Accessibility: menu reachable by Tab and opened with Enter; move announcement "Column In progress moved to position 2 of 3".

**Failures:** none.

**Observations (not failures):**
- `prisma migrate reset --force` and creating a fresh database were not run (the sandbox did not allow them); the test database is built from the migrations and CI applies them to an empty database.
- No tests were added by the tester.
- The delete dialog says there are no cards yet; KB-012 must revise the deletion rules and wording.

### KB-012 · Cards: create, view, edit and delete — Report 1 — 2026-11-05

- **Commit tested:** 512a5e9 (in the history of `develop`; working tree clean before testing)
- **Result:** Passed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm build` | ✔ |
| Lint | `pnpm lint` (ESLint and Prettier clean) | ✔ |
| Types | `pnpm typecheck` | ✔ |
| Unit and API | `pnpm test` (shared 127, web 145, api 266 = 538 tests) | ✔ |
| E2E | `pnpm test:e2e` (34 tests, including `e2e/cards.spec.ts`; no retries needed this run) | ✔ |
| Authorization | 401 without session, 404 for non-members (same body as unknown id), 403 for viewers on writes, soft-deleted card resolves to 404 for every role, column or neighbour from another board 404; read in `authorize.ts`, `cards/service.ts` and `cards.test.ts` | ✔ |
| Real time | live updates are out of scope (KB-018); concurrency covered by the board row lock and the 20-parallel-create test | n.a. |
| Accessibility | tiles are links (Tab and Enter), dialog Escape returns focus to the tile, creation and deletion announced in aria-live, axe on board, dialog and confirmation in E2E | ✔ |

**Acceptance criteria:**
- [x] Migration `20261105174849_add_cards_and_activity_events`: read the SQL. `cards.position` is `TEXT COLLATE "C"`, index `(column_id, position, id)`, unique `(board_id, number)` (board is 1:1 with project), CHECKs on title 1 to 200, description at most 20,000, number and version positive, `deleted_at`; `activity_events` with JSONB `data` and index `(card_id, created_at)`. Migrations apply on the test database (7 found, none pending).
- [x] Card number from `Project.nextCardNumber` with an atomic `increment` inside the creation transaction under the board lock; the "20 parallel creates give 20 distinct numbers" API test passes.
- [x] Routes: `POST /api/columns/:cid/cards` returns 201 (200 on repeated id without duplicate), appended at the end unless `afterCardId`/`beforeCardId` are given; `GET`, `PATCH` (increments `version`) and `DELETE` (204, soft delete); GET, PATCH and DELETE afterwards give 404. Read the service and routes, and the passing tests.
- [x] Board includes non-deleted cards ordered by (position, id) with `COLLATE "C"` (`Z0` before `a0` test). The response carries a flat `cards` list with `columnId` rather than nesting per column; the criterion's content and ordering are met (see observations).
- [x] `DELETE /api/columns/:id`: `409 COLUMN_NOT_EMPTY` without `moveCardsTo`; with it cards are appended to the destination in one transaction; foreign destination 404, self 400; covered by API tests and the E2E column-delete test.
- [x] Activity (G5): `created`, `title_changed`, `description_changed` (lengths only), `deleted`, `column_deleted_moved`, written in the same transaction; the injected-failure test (database trigger) leaves neither change nor event.
- [x] Markdown: `react-markdown` without `rehype-raw`; unit tests strip `<script>`, inline handlers and `javascript:` links; the E2E XSS test stays inert.
- [x] UI: Add card at the bottom of each column (Enter creates and keeps the field open), tiles show `KEY-number` and title, deep link `/projects/:pid/cards/:number`, inline title edit, description Edit/Preview with explicit Save, delete with confirmation, read-only for viewers; verified in `cards-flow.test.tsx` and `e2e/cards.spec.ts`.
- [x] Authority per D5: description written only through REST `PATCH`; the web has no description logic beyond the textarea (read in `CardDialog.tsx`).
- [x] Common criteria: G1 (all checks green), G2 (Zod schemas in `packages/shared/src/cards.ts`), G3, G4 (transactions, FK, CHECKs, unique index), G5, G8, A1 to A7 (error format, strict validation, CSRF/401 tests, no-leak 404, idempotent create), U1 to U10.

**Required tests:**
- [x] Unit: Markdown renderer strips script, handlers and `javascript:` links (`Markdown.test.tsx`).
- [x] API: create 201 / 400 (empty and 201-char title) / 401 / 404 non-member / 403 viewer; repeated id 200 without duplicate; 20 parallel creates; PATCH version and `title_changed` with injected failure; delete 204 then GET/PATCH 404; column delete 409 and 204 with `moveCardsTo`; column from another workspace 404.
- [x] E2E: keyboard-only creation, deep link, edit title and description, delete, axe on board and dialog.
- [x] Accessibility: tiles focusable, Enter opens, Escape closes with focus return, creation and deletion announced.

**Tests added by the tester:** none.

**Failures:** none.

**Observations (not failures):**
- The board response uses a flat `cards` list, not cards nested per column (documented by the developer; ordering and content satisfy the criterion).
- `prisma migrate reset --force` was not run (sandbox restrictions); the test database is built from the migrations and CI applies them to an empty database.
- The pre-existing `members.spec.ts` locator flake noted by the developer did not occur in this run; worth scoping the locator in a future task.
- Deleting a column cascades to its earlier soft-deleted cards and their events (history lost); flagged for KB-024.
- Web bundle is about 620 kB; code splitting is a candidate for KB-028.

### KB-015 · Drag and drop and keyboard moving of cards — Report 1 — 2026-11-06

- **Commit tested:** 4cf8b44 (with 9c36e41 on top; both in the history of `develop`; working tree clean before testing)
- **Result:** Passed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm build` | ✔ |
| Lint | `pnpm lint` (ESLint and Prettier clean) | ✔ |
| Types | `pnpm typecheck` | ✔ |
| Unit and API | `pnpm test` (web 155, api 278, shared all passing) | ✔ |
| E2E | `pnpm test:e2e` (40 passed, including `e2e/move-cards.spec.ts`) | ✔ |
| Authorization | `moveCard` authorizes the card and the destination column with `card:edit` (viewer 403, non-member 404 identical to unknown, other board or workspace 404, foreign neighbour 404, deleted card 404); read in `service.ts` and `move.test.ts` | ✔ |
| Database | no migration in this task (activity `type` is plain text); existing 7 migrations apply on the test database | ✔ |
| Real time | live propagation is out of scope (KB-018); concurrency is covered by the board row lock and the parallel-move API tests | n.a. |
| Accessibility | keyboard pick-up, arrows, drop, Escape asserted in E2E with live-region text; axe on the board; focus returns to the handle | ✔ |

**Acceptance criteria:**
- [x] `POST /api/cards/:id/move`: validated by `moveCardRequestSchema`; key computed from current siblings under the board lock in one transaction; `version` incremented; the final card with position returned; `moved` {fromColumnId, toColumnId} recorded only when the column changes (tests: reorder without event, between columns with one event).
- [x] Rebalance: `placeWithRebalance` respaces in the same transaction; the 320-repeated-inserts test keeps the order and key length at most 50.
- [x] Pointer and keyboard sensors: Space or Enter picks up on the handle (Space on the card link), arrows move, Space drops, Escape cancels and returns the card; verified in E2E.
- [x] Announcements for pick-up, move, drop and cancel with card, column and position, asserted in E2E (e.g. "Card MV-1 'Fix login' moved to In progress, position 1 of 1").
- [x] Non-drag alternative: "Move to..." (column select and Top or Bottom), unit-tested and in E2E. It lives in the card dialog, not a per-card menu (see observations).
- [x] Optimistic move with rollback and assertive announcement on error (unit test and E2E with a failed move); viewers get a disabled handle and the API returns 403.
- [x] Common criteria G1 to G5, G8, A1 to A5, A7, U1 to U10: checks green, Zod schemas in shared, transaction and activity, error format and no-leak 404 verified.

**Required tests:**
- [x] Unit: `ordering.test.ts` (`placeCard`, `neighboursAt`, `layoutOf`), stale-neighbour and rebalance cases in `move.test.ts`.
- [x] API: within and between columns 200; other board 404; viewer 403; non-member 404; deleted card 404; two parallel moves into one gap; two parallel moves of one card; rebalance keeps the order; 400 matrix and 401.
- [x] E2E: mouse drag persists after reload; keyboard move persists; Escape cancels; Move to...; axe on the board.
- [x] Accessibility: key sequence and live-region text for pick-up, move, drop and cancel.

**Tests added by the tester:** none.

**Failures:** none.

**Observations (not failures):**
- "Move to..." is in the card dialog because the board has no card menu; Enter on the card link still opens the card (KB-012), so keyboard pick-up uses Space on the link or the move handle. The planner may want to confirm both choices.
- Rapid arrow presses overwrite each other in the live region (last wins).
- Touch behaviour was not tested on real devices.
- `prisma migrate reset --force` was not run (sandbox restrictions); no migration changed.

### KB-016 · WebSocket server with the y-websocket protocol and room authorization — Report 1 — 2026-11-06

- **Commit tested:** cc55adb (with a964cdc on top; both in the history of `develop`; working tree clean before testing)
- **Result:** Passed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm build` | ✔ |
| Lint | `pnpm lint` (ESLint and Prettier clean) | ✔ |
| Types | `pnpm typecheck` | ✔ |
| Unit and API | `pnpm test` run after the last developer change (shared 144, web 155, api 303 passing); `realtime.test.ts` (25 tests) also run 3 more times alone, all green (flakiness check) | ✔ |
| E2E | `pnpm test:e2e` (39 passed, 1 flaky passed on retry: `move-cards.spec.ts:105` KB-015, a web test; this task changes no web code) | ✔ |
| Authorization | read `routes.ts`: cookie via `getSessionFromCookieHeader` (4401), room parsed (4400), `authorize(..., 'workspace:read')` on board or card resolver; 404 and 403 both close 4403 so existence does not leak; nothing is sent before authorization (messages queued); tests assert zero bytes to non-members | ✔ |
| Database | no migration in this task; existing 7 migrations apply on the test database | ✔ |
| Real time | two members converge (concurrent edits, state vectors), late joiner gets state, viewer updates discarded and not seen by others, removal closes socket in under 1 s, demotion and promotion take effect; verified in the API tests with real `ws` clients | ✔ |
| Accessibility | n.a. (no UI) | n.a. |

**Acceptance criteria:**
- [x] ADR: `docs/adr/0004-real-time-architecture.md` exists with rooms, protocol, authority split, persistence seam, single instance and Redis path, reconnection (read).
- [x] `/ws/:room` on the API port: Origin checked before upgrade (403), session cookie after (4401), room authorized via authz resolvers (tests: no cookie, bad token, wrong and missing Origin, non-member).
- [x] y-protocols server with one `Y.Doc` per room, loaded on first connection and unloaded after the last leaves through the `RoomPersistence` hook (tests: late joiner, unload, load/store order, failing load gives 1011).
- [x] Viewer: updates discarded, awareness allowed (tests).
- [x] Heartbeat: silent client terminated, responsive client kept (tests with a shortened interval; default is `WS_HEARTBEAT_MS` 30 s); over 1 MiB closes with 1009, message at the limit accepted.
- [x] Member removal closes sockets with 4403 in under 1 s, role change re-authorizes; events published after commit in `members/service.ts`; refused removal keeps the socket.
- [x] Room-name and message schemas in `packages/shared/src/realtime.ts` with unit tests.
- [x] Common criteria G1, G2, G7, G8, R1 to R4: checks green, shared Zod schemas, ADR written, convergence verified.

**Required tests:**
- [x] Unit: room-name parser valid and invalid matrix.
- [x] API with a real WebSocket client: all listed cases exist and assert the requested behaviour (4401, wrong Origin, 4403 with no bytes, convergence, viewer, removal, 1009).
- [x] E2E and accessibility: n/a per the specification.

**Tests added by the tester:** none.

**Failures:** none.

**Observations (not failures):**
- The E2E test `move-cards.spec.ts:105` (KB-015) was flaky once and passed on retry; unrelated to this task, worth a look by the planner.
- Known gaps already listed by the developer and the ADR: sockets are not closed on session expiry, logout or deletion of a workspace, project, board or card; a removal between authorization and room join is missed. Both are outside this task's criteria; a follow-up task is suggested.
- `GET /ws/:room` is in `PUBLIC_ROUTES` by design; it authenticates itself after the handshake.
- `prisma migrate reset --force` not run (no migration changed).

### KB-013 · Card fields: assignee, priority and estimate — Report 1 — 2026-11-09

- **Commit tested:** 13fd332 (in `develop` history; working tree clean before testing)
- **Result:** Passed

| Check | Command or method | Result |
| --- | --- | --- |
| Build | `pnpm build` | ✔ |
| Lint | `pnpm lint` | ✔ |
| Types | `pnpm typecheck` | ✔ |
| Unit and API | `pnpm test` (shared 146, web 166, api 316) | ✔ |
| E2E | `pnpm test:e2e` (41 tests) | ✔ |
| Authorization | viewer PATCH 403, non-member 404 identical to unknown card, unauthenticated 401 (api `cards/fields.test.ts`) | ✔ |
| Real time | n.a. (no collaboration change; live updates are KB-018) | n.a. |
| Accessibility | selects labelled, priority icon + text, `aria-describedby` on estimate errors, announcements via `useAnnounce`, axe in E2E | ✔ |

**Acceptance criteria:**
- [x] Migration: read `20261109195755_add_card_assignee_priority_estimate/migration.sql` (nullable FK to users, enum `card_priority` default `none`, `estimate` with `CHECK` 0-100 or NULL); `pnpm db:migrate` reports no pending migrations; the DB CHECK is exercised by an API test.
- [x] PATCH accepts the three fields; non-member, viewer or unknown assignee gives 400 `INVALID_ASSIGNEE`; one activity event per changed field with `from`/`to`. Reviewed `service.ts`; `fields.test.ts` passes (boundaries 0 and 100; -1, 101, 1.5 give 400; no-op writes nothing).
- [x] Member removal and leaving unassign that workspace's cards in the same transaction with events; other workspaces untouched; refused last-owner removal keeps the assignment (API tests).
- [x] Tiles: initials with full name as accessible name, priority icon + text, estimate (web `cards-flow.test.tsx` and E2E).
- [x] Card dialog: assignee select (assignable members), priority select, validated estimate input (web tests and E2E: set, reload, persist).
- [x] Common criteria G1-G5, A1-A7, U1-U10: automated checks green; rollback and error announcements covered by tests.

**Required tests:** unit priority mapping, API cases, E2E with axe and the accessibility cases exist and assert the specified behaviour (not trivial).

**Observations (not failures):**
- `prisma migrate reset --force` was blocked by the environment safety guard (explicit user consent needed, unavailable in autonomous mode). Instead `pnpm db:migrate` confirmed the migration is applied with no drift, and CI applies migrations to an empty database.
- The developer's suggestion stands: decide whether demoting a member to viewer should unassign their cards.
