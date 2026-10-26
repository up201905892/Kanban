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
