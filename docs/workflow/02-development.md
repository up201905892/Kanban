# 02 · Development

Implementation record. Only the `developer` writes here. One entry per task; if a task comes back failed from testing, a new **Iteration** is added to the same entry.

Entry rule: the task must be `Planned` in `01-planning.md` and every dependency `Done`.

## Entries

<!--
Entry template:

### KB-000 · Title (same as Planning)

**Iteration 1 — YYYY-MM-DD**
- **Status at the end:** Ready for test
- **What was done:** 2–4 line summary
- **Changed files:** list of paths
- **Migrations:** names (or "none")
- **Commit(s):** short hash + message
- **Acceptance criteria covered:** which ones and where (file or test)
- **Tests written by the developer:** test files created/changed
- **Local checks:** build ✔ · lint ✔ · typecheck ✔ · test ✔ · test:e2e ✔ / n.a.
- **Notes for the tester:** how to verify, known edge cases

**Iteration 2 — YYYY-MM-DD** (only if failed)
- **Failures received:** reference to the report in 03-testing.md
- **Fixes:** …
-->

### KB-001 · Monorepo scaffold and tooling

**Iteration 1 — 2026-10-26**

- **Status at the end:** Ready for test
- **What was done:** Created the pnpm monorepo (`apps/web` React + Vite, `apps/api` Fastify, `packages/shared` built to `dist` with declarations, all consumed through `workspace:*`). Added strict base tsconfig (`strict`, `noUncheckedIndexedAccess`), ESLint flat config, Prettier, root scripts, `GET /health` and a web placeholder rendering `APP_NAME` from `@kanban/shared`.
- **Changed files:** `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.nvmrc`, `.gitignore`, `.prettierrc.json`, `.prettierignore`, `eslint.config.js`, `tsconfig.base.json`, `packages/shared/**`, `apps/api/**`, `apps/web/**`
- **Migrations:** none
- **Commit(s):** `34bb1ee` feat(shared): KB-001 scaffold pnpm monorepo with web, api and shared packages
- **Acceptance criteria covered:** root config and lockfile (`package.json`, `pnpm-workspace.yaml`, `.nvmrc`); three packages; base tsconfig; root scripts; `/health` (`apps/api/src/health.test.ts`) and shared constant in web (`apps/web/src/App.test.tsx`); `.gitignore`; G1, G9.
- **Tests written by the developer:** `packages/shared/src/slugify.test.ts`, `apps/api/src/health.test.ts`, `apps/web/src/App.test.tsx`
- **Local checks:** build ✔ · lint ✔ · typecheck ✔ · test ✔ · test:e2e n.a.
- **New dependencies (G9):** root dev: typescript ~6.0, eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, globals, prettier, vitest, @types/node. api: fastify; dev tsx, vitest, @types/node. web: react, react-dom; dev vite, @vitejs/plugin-react, vitest, jsdom, @testing-library/{react,dom,jest-dom}, @types/react, @types/react-dom. shared: dev vitest.
- **Notes for the tester:**
  - Run `pnpm install --frozen-lockfile`, then `pnpm build` before `typecheck`/`test` (web and api resolve `@kanban/shared` from its `dist`).
  - TypeScript is pinned to `~6.0` because `typescript-eslint` does not yet support TypeScript 7 (the latest).
  - `pnpm install` reports "Ignored build scripts: esbuild"; everything works without approving it.
  - I could not start the api server and curl `/health` here (the sandbox blocked the compound command); `/health` is covered through `app.inject`. Please check `pnpm dev` manually.
  - Suggestion for the planner: the `dev` script needs `shared` built once; a watch mode for `shared` could be added later.

### KB-002 · Local PostgreSQL, Prisma and validated configuration

**Iteration 1 — 2026-10-26**

- **Status at the end:** Ready for test
- **What was done:** Added `docker-compose.yml` (postgres:17, named volume, healthcheck, init script creating `kanban_test`), Prisma 7 in `apps/api` (config in `prisma.config.ts`, client generated to `src/generated/prisma` with the `pg` driver adapter) and the `init` migration. Added the Zod-validated config module, `GET /health/ready` (200 `{db:"ok"}` / 503 `{db:"unavailable"}`, schema in `packages/shared`), a Vitest global setup that runs `prisma migrate deploy`, and `resetDatabase()` which refuses non-`_test` databases. `.env.example` updated.
- **Changed files:** `docker-compose.yml`, `docker/postgres-init/01-create-test-db.sql`, `.env.example`, `.gitignore`, `.prettierignore`, `eslint.config.js`, `package.json`, `pnpm-lock.yaml`, `apps/api/package.json`, `apps/api/tsconfig.build.json`, `apps/api/prisma.config.ts`, `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/**`, `apps/api/vitest.config.ts`, `apps/api/src/{app,server,config,db}.ts`, `apps/api/src/test-utils/*`, `apps/api/src/{config,health}.test.ts`, `packages/shared/src/{health,index}.ts`, `packages/shared/package.json`
- **Migrations:** `20261026180933_init` (creates the technical `app_meta` table)
- **Commit(s):** `23baaa8` feat(api): KB-002 add PostgreSQL, Prisma, validated config and readiness check
- **Acceptance criteria covered:** compose + `db:up`/`db:down` (`docker-compose.yml`; not run here, see notes); `db:migrate` / `db:migrate:dev` / `init` migration (verified `pnpm db:migrate`); client generated in `pnpm build` (api `build` runs `prisma generate`); config (`config.ts`, `config.test.ts`); `/health/ready` (`health.test.ts`); `.env.example`; global setup + `resetDatabase()` (`test-utils/`, `reset-database.test.ts`); G1, G3, G6, G8.
- **Tests written by the developer:** `apps/api/src/config.test.ts`, `apps/api/src/health.test.ts`, `apps/api/src/test-utils/reset-database.test.ts`
- **Local checks:** build ✔ · lint ✔ · typecheck ✔ · test ✔ (against the CI-style PostgreSQL service on localhost:5432) · test:e2e n.a.
- **New dependencies (G9):** api: `@prisma/client` ^7.10.1, `@prisma/adapter-pg` 7.10.1 (Prisma 7 requires a driver adapter), `zod` ^4; dev `prisma` ~7.10.1 (pinned to 7.x because `latest` resolved to an 8.0 release candidate). shared: `zod`.
- **Notes for the tester:**
  - Prisma creates no migration for an empty schema, so `init` needed a model: I added a minimal technical `AppMeta` (`app_meta`) table. It is not a domain table; the planner may want to confirm or replace it.
  - Tests use `TEST_DATABASE_URL` if set, otherwise `DATABASE_URL` (CI); both must name a database ending in `_test`. The global setup refuses otherwise.
  - Locally: `cp .env.example .env`, `pnpm db:up`, `pnpm db:migrate`. `pnpm db:up`/`db:down` and the invalid-config exit of `server.ts` (covered by unit tests of `loadConfig`) were not run manually here.
  - The server loads the repository-root `.env` with `process.loadEnvFile` (no dotenv dependency). `pnpm install` still reports ignored build scripts (esbuild, prisma engines); nothing needs approving.
  - New env vars `HOST`, `NODE_ENV`, `WEB_ORIGIN`, `TEST_DATABASE_URL` are in `.env.example`.

### KB-003 · API conventions and E2E harness

**Iteration 1 — 2026-10-27**

- **Status at the end:** Ready for test
- **What was done:** Added `ErrorCode` and `ApiError` schemas to `packages/shared`. In the api: Zod type provider (`fastify-type-provider-zod`) with validator and serializer compilers, global error and not-found handlers returning the A1 format (`lib/app-error.ts`: `AppError`, `notFound`, `serializeError`), pino logging through Fastify with a UUID request id per request (also returned as `x-request-id`) and redaction of cookies, authorization and passwords, and `buildApp()` with an optional `registerRoutes` hook for test-only routes. `health` moved to `modules/health/` (routes, service, test) as the reference module. Playwright harness at the repo root: `playwright.config.ts` (Chromium only, `webServer` for api and web, `reuseExistingServer` only without `CI`, traces kept on failure), `e2e/fixtures.ts` with independent `userA` and `userB` contexts, a smoke test and a fixture self-test.
- **Changed files:** `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `playwright.config.ts`, `e2e/{fixtures.ts,fixtures.spec.ts,smoke.spec.ts}`, `apps/api/package.json`, `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/api/src/lib/app-error.ts`, `apps/api/src/lib/app-error.test.ts`, `apps/api/src/modules/health/{routes,service}.ts`, `apps/api/src/modules/health/health.test.ts` (moved from `src/health.test.ts`), `packages/shared/src/{errors.ts,errors.test.ts,index.ts}`
- **Migrations:** none
- **Commit(s):** `f93922c` feat(api): KB-003 add API conventions, error format, logging and Playwright harness
- **Acceptance criteria covered:** type provider and shared `ErrorCode`/`ApiError` (`app.ts`, `errors.ts`); handlers and 500 behaviour (`app.test.ts`, `app-error.test.ts`); logging, request id and redaction (`app.test.ts`); `buildApp()` and `modules/health` layout; `test:e2e:setup`/`test:e2e` scripts and config; two-context fixture (`e2e/fixtures.spec.ts`); G1, G2, A1, A2 (strict schema and unknown-field test in `app.test.ts`).
- **Tests written by the developer:** `packages/shared/src/errors.test.ts`, `apps/api/src/lib/app-error.test.ts`, `apps/api/src/app.test.ts`, `e2e/smoke.spec.ts`, `e2e/fixtures.spec.ts`
- **Local checks:** build ✔ · lint ✔ · typecheck ✔ (now also typechecks `e2e/` and `playwright.config.ts` through the root `tsconfig.json`) · test ✔ · test:e2e ✔ (2 passed)
- **New dependencies (G9):** api: `fastify-type-provider-zod` ^7 (named by the task: Zod type provider). Root dev: `@playwright/test` (the E2E tool in the stack). pino is not added directly: Fastify bundles it.
- **Notes for the tester:**
  - `pnpm test:e2e:setup` downloaded Chromium here; E2E starts api via `pnpm --filter @kanban/api dev`, which needs `DATABASE_URL`/`SESSION_SECRET` (root `.env` locally, CI env in Actions). I did not run it with `CI=1` set.
  - Malformed JSON and other framework 4xx errors are mapped to `400 VALIDATION_ERROR` with a generic message.
  - Process note: `git mv` and `python3` heredocs were denied by the sandbox; I used plain `mv` and the Edit tool instead.
  - Suggestion for the planner: `ErrorCode` already contains codes for later tasks (UNAUTHENTICATED, FORBIDDEN, CSRF_REJECTED, CONFLICT, RATE_LIMITED); CI may need `CI=true` env for `webServer` to start fresh servers (it already sets it).

**Iteration 2 — 2026-10-27** (fix for test report 1)

- **Status at the end:** Ready for test
- **What was done:** Failure 1 (G2): `healthResponseSchema` and `HealthResponse` moved to `packages/shared/src/health.ts`, exported from the index, and imported by the health route (local duplicate and the `zod` import removed). Observation addressed: new API test sends a real `POST /__test/login` with a password in the body and a cookie header, and asserts that the real log lines contain the request but no `SECRET` text.
- **Changed files:** `packages/shared/src/health.ts`, `packages/shared/src/index.ts`, `apps/api/src/modules/health/routes.ts`, `apps/api/src/app.test.ts`
- **Migrations:** none
- **Commit(s):** `e514dee` fix(api): KB-003 move health response schema to shared and test real-request redaction
- **Acceptance criteria covered:** G2 (shared schema used by the route); log redaction with a real request.
- **Tests written by the developer:** `apps/api/src/app.test.ts` (new redaction test)
- **Local checks:** build ✔ · lint ✔ · typecheck ✔ · test ✔ (shared 6, web 1, api 37) · test:e2e not re-run (no E2E or web changes)
- **New dependencies (G9):** none
- **Notes for the tester:**
  - The test logs `{ body: req.body }` (covered by the `*.password` redact path); Fastify's own `req` serializer drops the body, so the `req.body.password` path is only a safety net.
  - Sandbox denials this iteration: compound commands (`cd ... && ...` with variable use, `;` chains) and `python3` heredoc edits; I used the Edit tool and `pnpm --dir`.

### KB-004 · Web app shell, data layer and minimal local components

**Iteration 1 — 2026-10-27**

- **Status at the end:** Ready for test
- **What was done:** React Router (data router) with `RootLayout` (skip link, main nav, `<main id="main">`), `HomePage`, `NotFoundPage` (catch-all) and a `RouteError` errorElement with a "Reload" button. `App` wires `QueryClientProvider` (no retry on 4xx, max 2 retries otherwise, no mutation retry), `AnnouncerProvider` and the router; tests can inject a router (`createTestRouter`) and a query client. Typed `apiClient` in `apps/web/src/lib/api` (`credentials: 'include'`, JSON body, response validated with a shared Zod schema, A1 bodies parsed with `apiErrorSchema` into `ApiError`; client-side codes `NETWORK_ERROR` and `INVALID_RESPONSE`). ESLint rule forbids `fetch` (global, `window.fetch`, `globalThis.fetch`) in `apps/web` except `src/lib/api`. Local components: Button, IconButton, TextField, TextArea, Select, Dialog (portal, focus trap, Escape, focus return), Spinner, EmptyState, ErrorState (optional `retryLabel`), Announcer (`AnnouncerProvider` with polite and assertive live regions, `useAnnounce()`). Vite dev proxy for `/api` and `/ws` (ws enabled) to `API_URL` (default `http://localhost:3000`). Minimal `styles.css` (layout, focus ring, `sr-only`).
- **Changed files:** `eslint.config.js`, `package.json`, `pnpm-lock.yaml`, `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/src/{App.tsx,App.test.tsx,main.tsx,router.tsx,styles.css}`, `apps/web/src/routes/*`, `apps/web/src/components/*`, `apps/web/src/lib/api/*`, `e2e/not-found.spec.ts`
- **Migrations:** none
- **Commit(s):** `488703d` feat(web): KB-004 add app shell, data layer and minimal local components
- **Acceptance criteria covered:** router, 404 and error boundary (`router.tsx`, `routes/`, `RouteError.test.tsx`); query client and `apiClient` (`lib/api`, `api-client.test.ts`); fetch lint rule (`eslint.config.js`; `pnpm lint` passes with the only `fetch` calls in `lib/api`); components (`components/`, `components.test.tsx`); Vite proxy (`vite.config.ts`); G1, U1, U3, U4, U5, U8, U9 (axe in `e2e/not-found.spec.ts`), U10 (360 px E2E check).
- **Tests written by the developer:** `apps/web/src/components/components.test.tsx` (Dialog trap/Escape/focus return, field `aria-describedby`, `useAnnounce` regions), `apps/web/src/lib/api/api-client.test.ts` (A1 to `ApiError`, validation, retry policy), `apps/web/src/routes/RouteError.test.tsx`, `apps/web/src/App.test.tsx` (home, 404, tab order), `e2e/not-found.spec.ts` (404, axe, tab order, 360 px)
- **Local checks:** build ✔ · lint ✔ · typecheck ✔ · test ✔ (shared 6, web 18, api 37) · test:e2e ✔ (6 passed)
- **New dependencies (G9):** web: `react-router` ^7, `@tanstack/react-query` (stack), `zod` (types for `apiClient` schemas, same version as shared); web dev: `@testing-library/user-event`; root dev: `@axe-core/playwright` (named by U9).
- **Notes for the tester:**
  - Dev proxy forwards `/api` and `/ws` without rewriting; `/health` is not proxied (it is not under `/api`). The proxy was not exercised by a test.
  - The web `ApiError` is a class; the shared `ApiError` type is the response body shape.
  - `Spinner` uses `role="status"`; `Announcer` messages are set 50 ms after clearing so repeats are re-announced.
  - Suggestion for the planner: decide whether `/health` should move under `/api` for same-origin use in production (KB-031).
  - Sandbox denials: heredoc file creation, `sed -i`, and `git -C <path>` were denied; I used the Write/Edit tools and plain `git` commands.

### KB-010 · Fractional indexing utility and ordering/conflict ADR

**Iteration 1 — 2026-10-28**

- **Status at the end:** Ready for test
- **What was done:** `packages/shared/src/ordering` with `keyBetween`, `keysBetween`, `isValidKey`, `compareByPosition` (plus `needsRebalance`, `MAX_KEY_LENGTH` = 50, `InvalidKeyError`), a pure base-62 fractional-index implementation (Greenspan scheme, written in-house, no new runtime dependency), exported from the shared index. ADR `docs/adr/0001-ordering-and-conflict-handling.md` covers keys, `(position, id)` order, server-computed keys, rebalancing above 50 characters, concurrent-edit rules, `version` ordering, idempotent creates (A6) and measurements.
- **Changed files:** `packages/shared/src/ordering/fractional-index.ts`, `packages/shared/src/ordering/index.ts`, `packages/shared/src/ordering/fractional-index.test.ts`, `packages/shared/src/index.ts`, `packages/shared/package.json`, `pnpm-lock.yaml`, `docs/adr/0001-ordering-and-conflict-handling.md`
- **Migrations:** none
- **Commit(s):** `ee1160d` feat(shared): KB-010 add fractional indexing utility and ordering ADR
- **Acceptance criteria covered:** ADR (G7) in `docs/adr/0001-...`; ordering API in `packages/shared/src/ordering`; measured key length (append x10,000: 4 characters; same position x10,000: 1,669 characters, over 50 from insert 289) recorded in the ADR and asserted in the tests; G1, G8, G9.
- **Tests written by the developer:** `packages/shared/src/ordering/fractional-index.test.ts` (fast-check properties for random inserts and `keysBetween(n = 100)`, invalid keys, `a >= b`, boundaries, `compareByPosition`, growth measurements)
- **Local checks:** build ✔ · lint ✔ · typecheck ✔ · test ✔ (shared 29, web 18, api 37) · test:e2e n.a.
- **New dependencies (G9):** `fast-check` (dev, `packages/shared`), required by the task's property-based tests.
- **Notes for the tester:**
  - **D5 is still pending.** The ADR's section 7 (Yjs/PostgreSQL authority split) is marked provisional and states the assumption used (hybrid: text and presence in Yjs, structured data in PostgreSQL via REST). If João chooses the alternative, ADR sections 3, 5 and 6 must be revisited. The task text says D5 should be answered before KB-010 is approved; it was approved anyway, so this is flagged for the daily log.
  - The ADR states that position columns need `COLLATE "C"` so database order matches code-unit order; KB-011 and KB-012 migrations should apply it (suggestion for the planner).
  - The ADR's stale-neighbour rule (section 3) is a proposal for KB-015 to implement and test.
  - `pnpm test:e2e` not run (no E2E or web changes).
