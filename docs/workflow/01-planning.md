# 01 · Planning

The project's source of truth: every task lives here. Only the `planner` creates or changes specifications; the other agents only update the **Status** column of the table and the task **History**.

Statuses: `Proposed` → `Planned` → `In development` → `Ready for test` → `In test` → `Passed` → `Done` (detours: `Failed` → `In development`; `Proposed` → `Rejected`).

## Index table

| ID | Task | MVP phase | Priority | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| KB-001 | Monorepo scaffold and tooling | Foundations | High | — | Ready for test |
| KB-002 | Local PostgreSQL, Prisma and validated configuration | Foundations | High | KB-001 | Planned |
| KB-003 | API conventions and E2E harness | Foundations | High | KB-001 | Planned |
| KB-004 | Web app shell, data layer and minimal local components | Foundations | High | KB-003 | Planned |
| KB-005 | Authentication core: accounts and cookie sessions | Authentication and workspaces | High | KB-002, KB-003 | Proposed |
| KB-006 | Sign-up, log-in and log-out UI with protected routes | Authentication and workspaces | High | KB-004, KB-005 | Proposed |
| KB-007 | Workspaces, memberships and the authorization policy | Authentication and workspaces | High | KB-005, KB-006 | Proposed |
| KB-008 | Projects within a workspace | Authentication and workspaces | High | KB-007 | Proposed |
| KB-009 | Invite links, members and roles | Authentication and workspaces | Medium | KB-007 | Proposed |
| KB-010 | Fractional indexing utility and ordering/conflict ADR | Board | High | KB-001 | Planned |
| KB-011 | Board and configurable columns | Board | High | KB-008, KB-010 | Proposed |
| KB-012 | Cards: create, view, edit and delete | Board | High | KB-011 | Proposed |
| KB-013 | Card fields: assignee, priority and estimate | Board | Medium | KB-009, KB-012 | Proposed |
| KB-014 | Labels | Board | Low | KB-012, KB-018 | Proposed |
| KB-015 | Drag and drop and keyboard moving of cards | Board | High | KB-012 | Proposed |
| KB-016 | WebSocket server with the y-websocket protocol and room authorization | Real time | High | KB-007 | Proposed |
| KB-017 | Yjs document persistence in PostgreSQL | Real time | Medium | KB-016 | Proposed |
| KB-018 | Live board updates | Real time | High | KB-013, KB-015, KB-016 | Proposed |
| KB-019 | Collaborative card description with Yjs | Real time | Medium | KB-012, KB-017 | Proposed |
| KB-020 | Presence: who is on the board and who is editing a card | Real time | Medium | KB-019 | Proposed |
| KB-021 | Reconnection, offline edits and connection status | Real time | Medium | KB-018, KB-019 | Proposed |
| KB-022 | Backlog and sprint planning | Sprints | Medium | KB-013, KB-018 | Proposed |
| KB-023 | Close a sprint | Sprints | Medium | KB-022 | Proposed |
| KB-024 | Card activity history | Reports and history | Medium | KB-013, KB-015 | Proposed |
| KB-025 | Sprint burndown | Reports and history | Medium | KB-022 | Proposed |
| KB-026 | Velocity of recent sprints | Reports and history | Low | KB-023 | Proposed |
| KB-027 | Adopt `@up201905892/ui` and replace local components | Design system | Medium | KB-004, external: `@up201905892/ui` published on npm | Proposed |
| KB-028 | Performance with 500+ cards | Quality and delivery | Medium | KB-018 | Proposed |
| KB-029 | End-to-end collaboration suite (two browsers) | Quality and delivery | Medium | KB-009, KB-021, KB-023 | Proposed |
| KB-030 | Accessibility audit and fixes | Quality and delivery | Medium | KB-020, KB-021, KB-024, KB-025 | Proposed |
| KB-031 | Deploy preparation for Railway | Quality and delivery | Medium | KB-017 | Proposed |
| KB-032 | README with demo | Quality and delivery | Medium | KB-028, KB-031 | Proposed |

**Priority rule used:** High = blocks at least one other High/Medium task on the path to the v1.0 release; Medium = MVP scope that blocks nothing (or only Medium tasks at the end of the plan); Low = MVP scope that is the first candidate to move to v1.1 if the schedule slips.

**Estimate convention:** S = 0.25 day, M = 1 day, L = 2.5 days (ideal days). Total: 1 S + 21 M + 10 L = **46.25 ideal days** (51.25 if every L takes the full 3 days).

**ADRs required** (files in `docs/adr/NNNN-<slug>.md`, next free number): auth and sessions (KB-005), authorization model (KB-007), ordering and conflict handling (KB-010), real-time architecture and Yjs↔DB authority (KB-016, extended by KB-017 and KB-019), deployment topology (KB-031).

## Technical decisions

### D1 · Real-time engine — **Decided** (João, 2026-10-21)

Self-hosted Yjs using the y-websocket protocol, served by `apps/api` and persisted in PostgreSQL (not Liveblocks).
Rationale: no vendor cost or usage limits for a tool used every day; all data (including collaborative documents) lives in our own PostgreSQL, so one backup covers everything; authorization stays in our server with the same policy as the REST API; stronger portfolio signal (the real-time layer is ours). Affects KB-016–KB-021, KB-031.

### D2 · Back-end framework — **Decided** (João, 2026-10-21)

Fastify (not NestJS).
Rationale: lightweight and fast, first-class WebSocket support (`@fastify/websocket`) in the same process, `app.inject` for fast API tests without a network, and Zod type providers that fit the shared-contract rule; NestJS's DI/decorator layer adds ceremony without benefit at this size.

### D3 · Authentication — **Decided** (João, 2026-10-21)

Own email + password authentication: argon2id password hash, session table in PostgreSQL, opaque session token in an httpOnly cookie, following the Lucia guide / Copenhagen Book approach (not Auth.js, Lucia as a library, or Supabase Auth).
Rationale: no external dependency or vendor for a core security path; sessions are revocable server-side (needed when a member is removed); the same session cookie authenticates the WebSocket upgrade; well-documented, auditable approach. Details recorded in the auth ADR (KB-005).

### D4 · Deploy target — **Decided** (João, 2026-10-21)

Railway: one long-running Docker container that serves the API, the WebSocket endpoint and the built web app (same origin), plus Railway managed PostgreSQL.
Rationale: supports long-lived WebSocket connections in an always-on container (serverless platforms do not); one service and one database in the same project with private networking; Dockerfile-based builds keep the app portable. Constraint carried into the plan: **exactly one instance** (Yjs rooms live in memory) and app sleeping disabled. Agents prepare the files (KB-031); João connects the deploy. Affects KB-031, KB-032.

### D5 · Scope of Yjs authority (structured data vs collaborative text) — **Pending — awaiting João**

`CLAUDE.md` says "the Yjs document is the authority; the server updates the database from it", without saying which data lives in Yjs.

- **Working assumption (recommended):** hybrid. Collaborative text (card descriptions) and presence live in Yjs; the Yjs document is the authority for them and the server projects the text into PostgreSQL. Structured data (columns, cards, fields, positions, sprints) is written through the REST API with server-side validation and authorization, PostgreSQL is the authority, and changes are broadcast to other clients as board events over the same WebSocket. Why: field-level validation and authorization (e.g. an assignee must be a member, a viewer cannot edit, a sprint must belong to the project) are enforceable per request; reports and history query relational data directly; Yjs is used where a CRDT clearly wins (concurrent text editing).
- **Alternative:** the whole board state in one Yjs document per board, projected into PostgreSQL by the server. Simpler offline story for moves, but server-side validation of CRDT updates is hard, invalid updates can only be repaired after the fact, and reports depend on a projection.
- **If the alternative is chosen, these tasks change substantially:** KB-010, KB-012, KB-013, KB-014, KB-015, KB-016, KB-018, KB-021, KB-022, KB-024.
- **Must be answered before KB-010 and KB-012 are approved.**

### D6 · Email delivery and account recovery in v1.0 — **Pending — awaiting João**

- **Working assumption (recommended):** no email in v1.0. Invites are links copied and shared by the owner (KB-009); forgotten passwords are handled by an operator CLI that sets a temporary password and revokes the user's sessions (KB-005). Why: avoids an email provider, domain setup (SPF/DKIM) and extra failure modes in a 7–8 week plan; the user base is João and his groups.
- **Alternative:** an email provider (e.g. Resend or Postmark over SMTP) for password reset and emailed invites: about one extra M task, plus a provider account and a sending domain.
- **If the alternative is chosen:** KB-005 (CLI replaced or complemented by a reset flow), KB-009 (optional email invite), KB-031 (new variables); a new task is added.

## Common criteria

Tasks cite these codes in their acceptance criteria instead of repeating them. Each one must be verifiable with the code and a terminal.

### General

- **G1 · Green checks.** `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and (if the task has E2E tests) `pnpm test:e2e` pass locally from a clean install; lint has zero warnings; no `.only`/`.skip` committed; no `any` or `@ts-ignore` without a comment explaining why.
- **G2 · Shared contracts.** Every API request/response body, query string and real-time message has a Zod schema in `packages/shared`; web and api use the inferred types; no hand-written duplicate types.
- **G3 · Migrations.** Schema changes only through a new Prisma migration with a descriptive name in `apps/api/prisma/migrations`; `pnpm db:migrate` succeeds on an empty database and on the previous schema; merged migrations are never edited.
- **G4 · Data integrity.** Writes that touch more than one row run in one database transaction; invariants are enforced by the database where possible (foreign keys, unique and partial unique indexes, `CHECK`), not only in code; deletions cascade or are rejected exactly as the task specifies.
- **G5 · Activity log.** From KB-012 on, every mutation of a card writes an `ActivityEvent` (actor, card, type, changed fields with `from`/`to`, timestamp) in the same transaction as the change; event types are a discriminated union in `packages/shared`.
- **G6 · Configuration and secrets.** No secrets in the repository; every new environment variable is added to `.env.example` with a fake value and to the api's Zod config schema; a missing or invalid variable makes the api exit with a non-zero code and a message naming the variable (never its value).
- **G7 · ADR.** When a task says "ADR required", `docs/adr/NNNN-<slug>.md` exists with Status, Context, Decision, Alternatives considered and Consequences, and references the matching entry in "Technical decisions".
- **G8 · Unit tests for logic.** Every pure function or domain rule introduced (shared utilities, service rules) has unit tests covering normal, boundary and invalid inputs.
- **G9 · Dependencies.** No runtime dependency outside the `CLAUDE.md` stack unless the task names it; any new dependency is pinned in the lockfile and listed in the development entry.

### API

- **A1 · Error format.** Every error response is `{ error: { code, message } }` (validation errors may add `details: [{ path, message }]`); `code` is an UPPER_SNAKE_CASE value of the shared `ErrorCode` enum; no stack traces, SQL or internal identifiers in responses.
- **A2 · Validation.** Params, query and body are validated against the shared Zod schema before the handler runs; schemas are strict (unknown fields rejected); invalid input → `400 VALIDATION_ERROR`.
- **A3 · Authentication.** Every route except those the task lists as public requires a valid session → otherwise `401 UNAUTHENTICATED`. State-changing requests (POST/PUT/PATCH/DELETE) also require an `Origin` matching the configured web origin → otherwise `403 CSRF_REJECTED`.
- **A4 · Authorization without leaks.** Every route calls the shared policy (KB-007) on the server. A user who is not a member of the resource's workspace gets `404 NOT_FOUND` with exactly the same body as a non-existent ID; a member whose role lacks the permission gets `403 FORBIDDEN`. IDs in the body that point to another workspace or project (column, assignee, label, sprint) are rejected and never linked.
- **A5 · Status codes.** `201` create (returns the resource), `200` read/update, `204` delete, `400` invalid input, `409 CONFLICT`-family codes (e.g. `LAST_OWNER`, `SPRINT_ALREADY_ACTIVE`) for conflicts with the current state, `429 RATE_LIMITED` where rate limiting applies.
- **A6 · Idempotent creates.** Entities created from the board (columns, cards, labels) accept a client-generated UUID; repeating the same create returns `200` with the existing resource and never creates a duplicate (safe retries for optimistic updates and offline replay).
- **A7 · API test matrix.** Each new route has `app.inject` tests against a real PostgreSQL covering: success, `400`, `401`, `404` for a non-member, `403` for each role without permission, and the task's specific conflicts; the database is reset between tests.
- **A8 · Bounded lists.** Lists that can grow without bound (activity, members, invites, sprints) use cursor pagination with `limit` ≤ 100 and a stable order.

### UI

- **U1 · Data layer.** Server data only through TanStack Query hooks in `apps/web/src/features/<feature>/api`; no `fetch` outside the API client; mutation errors show the API `message`.
- **U2 · States.** Every data view has a loading state (with an accessible label), an empty state (explanatory text plus the primary action when the role allows it) and an error state (message plus "Retry").
- **U3 · Keyboard.** Everything is operable with the keyboard alone: Tab/Shift+Tab reach every control in a logical order, Enter/Space activate, Escape closes dialogs and menus and returns focus to the trigger; visible focus indicator; no keyboard traps.
- **U4 · Semantics.** Form fields have visible labels; validation errors are linked with `aria-describedby` and focus moves to the first invalid field on submit; icon-only buttons have an accessible name; one `h1` per page and a logical heading order; information is never conveyed by colour alone.
- **U5 · Announcements.** Async results (saved, moved, deleted, failed, remote changes to the focused item) are announced through the shared announcer: `aria-live="polite"` for success, `assertive` for errors; no announcements for background noise.
- **U6 · Optimistic updates.** Optimistic mutations roll back on error, announce the failure and invalidate the affected queries so the UI matches the server afterwards.
- **U7 · Role-aware UI.** Actions the user's role cannot perform are hidden or disabled with an explanation; the server still enforces them (A4).
- **U8 · Local components.** Until KB-027, UI uses only the minimal components in `apps/web/src/components/`; styling limited to layout and a visible focus ring; no UI libraries added.
- **U9 · Automated accessibility check.** The task's E2E tests run axe (`@axe-core/playwright`) on each new or changed screen with zero serious or critical violations.
- **U10 · Narrow screens.** Each screen is usable at 360 px width without horizontal page scroll (the board scrolls horizontally inside its own container).

### Real time

- **R1 · Validated messages.** Every custom real-time message (board events, awareness state) has a Zod schema in `packages/shared` and is validated on receipt on both server and client; invalid messages are dropped and logged without closing other users' connections or crashing the process.
- **R2 · Authenticated connections.** A WebSocket upgrade requires a valid session cookie and an allowed `Origin`; room access uses the same policy as A4; failures close the socket with `4401` (unauthenticated) or `4403` (forbidden or not found, indistinguishable) before any document data is sent.
- **R3 · Read-only viewers.** Viewers receive updates, but the server discards their document updates; the UI is read-only for them.
- **R4 · Convergence.** Concurrent edits from two clients converge to the same state in both clients and in the database after sync, verified with two browser contexts.
- **R5 · No edit loss on reconnect.** Edits made while disconnected (same page session) are synced and persisted after reconnect; verified with Playwright `context.setOffline()`.
- **R6 · Live structured changes.** Every committed mutation that changes what a board shows publishes a board event after the transaction commits (never on rollback); other clients on that board reflect it within 2 s without reloading.
- **R7 · Restart safety.** Yjs updates received by the server are persisted to PostgreSQL within 1 s; after an api restart, clients resync and no acknowledged edit is lost.

## Applied decisions

Lines from `approvals.md` already handled by the planner (prevents applying the same decision twice).

| Decision date | Decision | IDs | Applied on |
| --- | --- | --- | --- |

## Specifications

<!--
Task template (copy for each new task):

### KB-000 · Short title

- **MVP phase:** Foundations | Authentication and workspaces | Board | Real time | Sprints | Reports and history | Design system | Quality and delivery
- **Priority:** High | Medium | Low
- **Depends on:** KB-00X, KB-00Y (or —)
- **Estimate:** S (≤ 2h) | M (≤ 1 day) | L (≤ 3 days); bigger tasks are split

**Goal:** one or two sentences on what gets done and why.

**Acceptance criteria:**
- [ ] verifiable criterion 1
- [ ] verifiable criterion 2
- [ ] common criteria: G1–Gn, A1–An (as applicable)

**Required tests:**
- Unit: what to test
- API: status codes, validation and authorization to test
- E2E: user flows (and two browsers if it touches real time)
- Accessibility: keyboard (which keys, which result), aria-live announcements where applicable

**Out of scope:** what is not part of this task.

**History:**
- YYYY-MM-DD · planner · created as Proposed
-->

### KB-001 · Monorepo scaffold and tooling

- **MVP phase:** Foundations
- **Priority:** High
- **Depends on:** —
- **Estimate:** M

**Goal:** Create the pnpm monorepo so every later task builds, lints, typechecks and tests with exactly the commands CI already runs (`build`, `lint`, `typecheck`, `test`).

**Acceptance criteria:**
- [ ] Root `package.json` pins `"packageManager": "pnpm@10.x.y"` (exact version) and `"engines": { "node": ">=22" }`; `.nvmrc` contains `22`; `pnpm-workspace.yaml` lists `apps/*` and `packages/*`; `pnpm-lock.yaml` is committed and `pnpm install --frozen-lockfile` succeeds.
- [ ] `apps/web` (React + TypeScript + Vite), `apps/api` (Fastify + TypeScript) and `packages/shared` (TypeScript library built to `dist` with declarations, consumed by both through `workspace:*`).
- [ ] A base `tsconfig` with `strict: true` and `noUncheckedIndexedAccess: true`, extended by every package.
- [ ] Root scripts: `build` (topological, `packages/shared` first), `lint` (ESLint flat config + `prettier --check`), `format`, `typecheck` (`tsc --noEmit` in every package), `test` (Vitest in every package), `dev` (api + web in parallel).
- [ ] `GET /health` on the api returns `200 { "status": "ok" }`; the web placeholder page renders a constant imported from `packages/shared` (proves cross-package wiring).
- [ ] `.gitignore` covers `node_modules`, `dist`, `.env`, coverage and Playwright reports.
- [ ] Common criteria: G1, G9.

**Required tests:**
- Unit: one test per package (a shared utility; the web placeholder rendered with Testing Library).
- API: `GET /health` → 200 via `app.inject`.
- E2E: n/a (harness in KB-003).
- Accessibility: n/a.

**Out of scope:** database and Prisma (KB-002), Playwright and error conventions (KB-003), CI (already exists).

**History:**
- 2026-10-21 · planner · created as Proposed
- 2026-10-24 · planner · Proposed → Planned · approved by João (conversation, 2026-10-24)
- 2026-10-26 · developer · Planned → In development · started
- 2026-10-26 · developer · In development → Ready for test · commit 34bb1ee

### KB-002 · Local PostgreSQL, Prisma and validated configuration

- **MVP phase:** Foundations
- **Priority:** High
- **Depends on:** KB-001
- **Estimate:** M

**Goal:** Provide the database, migrations, test-database helpers and validated configuration so that local runs and CI (PostgreSQL service + `DATABASE_URL` + `SESSION_SECRET`) behave the same way.

**Acceptance criteria:**
- [ ] `docker-compose.yml` with `postgres:17` (same major as CI), a named volume and a healthcheck; creates the `kanban` and `kanban_test` databases; `pnpm db:up` starts it and `pnpm db:down` stops it.
- [ ] Prisma in `apps/api` (`apps/api/prisma/schema.prisma`); `pnpm db:migrate` runs `prisma migrate deploy` (non-interactive, as CI calls it); `pnpm db:migrate:dev` creates new migrations locally; an initial migration named `init` exists.
- [ ] The Prisma client is generated during `pnpm build` (or `postinstall`), so CI's build → typecheck order works before any database exists.
- [ ] Api config module: Zod-validated `DATABASE_URL`, `SESSION_SECRET` (≥ 32 characters), `PORT`, `WEB_ORIGIN`, `NODE_ENV`; invalid configuration exits per G6.
- [ ] `GET /health/ready` returns `200 { "db": "ok" }` when the database answers and `503` otherwise (used later by Railway's healthcheck).
- [ ] Root `.env.example` lists every variable with fake values and a one-line comment each.
- [ ] Vitest global setup applies migrations; a `resetDatabase()` helper truncates all tables between tests and **refuses to run** unless the database name ends in `_test`.
- [ ] Common criteria: G1, G3, G6, G8.

**Required tests:**
- Unit: config schema accepts a valid environment and rejects missing `DATABASE_URL` and a short `SESSION_SECRET` (message names the variable, not its value); `resetDatabase()` throws for a database not ending in `_test`.
- API: `/health/ready` → 200 with the database up; → 503 with an unreachable database URL.
- E2E: n/a.
- Accessibility: n/a.

**Out of scope:** domain tables (each feature adds its own), seed data (KB-028, KB-032).

**History:**
- 2026-10-21 · planner · created as Proposed
- 2026-10-24 · planner · Proposed → Planned · approved by João (conversation, 2026-10-24)

### KB-003 · API conventions and E2E harness

- **MVP phase:** Foundations
- **Priority:** High
- **Depends on:** KB-001
- **Estimate:** M

**Goal:** Fix the API conventions (error format, Zod validation, module layout, logging) and a working Playwright harness, including two isolated browser contexts, before any feature is written.

**Acceptance criteria:**
- [ ] Fastify registers a Zod type provider using schemas from `packages/shared`; `ErrorCode` enum and `ApiError` schema live in `packages/shared`.
- [ ] Global error handler and not-found handler return the A1 format; unexpected errors → `500 INTERNAL_ERROR` with a generic message, while the full error is logged with the request id.
- [ ] Structured logging (pino) with a request id per request; passwords and cookies are redacted from logs.
- [ ] `buildApp()` factory used by the server entry point and by tests; module layout `apps/api/src/modules/<domain>/` (routes, service, tests), with `health` as the reference module.
- [ ] `pnpm test:e2e:setup` runs `playwright install --with-deps chromium`; `pnpm test:e2e` starts api and web through Playwright `webServer` (`reuseExistingServer` only when `CI` is not set), runs Chromium only and keeps traces on failure.
- [ ] A Playwright fixture provides two independent browser contexts (`userA`, `userB`) with separate cookies, for the real-time and multi-user tests that follow.
- [ ] Common criteria: G1, G2, A1, A2.

**Required tests:**
- Unit: error serializer maps `ApiError`, Zod errors and unknown errors to A1.
- API: unknown route → 404 in A1 format; invalid body on a test-only route → 400 `VALIDATION_ERROR` with `details`; thrown error → 500 without stack trace.
- E2E: smoke test loads the web app; fixture self-test shows the two contexts do not share cookies.
- Accessibility: n/a.

**Out of scope:** authentication (KB-005), web data layer (KB-004).

**History:**
- 2026-10-21 · planner · created as Proposed
- 2026-10-24 · planner · Proposed → Planned · approved by João (conversation, 2026-10-24)

### KB-004 · Web app shell, data layer and minimal local components

- **MVP phase:** Foundations
- **Priority:** High
- **Depends on:** KB-003
- **Estimate:** M

**Goal:** Give every UI slice a router, a TanStack Query client, a typed API client and a minimal set of accessible local components, without investing in styling before `@up201905892/ui` exists.

**Acceptance criteria:**
- [ ] React Router with a root layout, a 404 page and an error boundary with a "Reload" action.
- [ ] `QueryClient` provider with defaults (no retry on 4xx); a typed `apiClient` in `apps/web/src/lib/api` that sends cookies, validates responses with shared schemas and throws a typed `ApiError` parsed from A1.
- [ ] An ESLint rule forbids `fetch` outside `apps/web/src/lib/api`.
- [ ] Local components in `apps/web/src/components/`: Button, IconButton, TextField, TextArea, Select, Dialog (focus trap, Escape, focus return), Spinner, EmptyState, ErrorState and an Announcer (polite + assertive live regions) with a `useAnnounce()` hook.
- [ ] Vite dev proxy forwards `/api` and `/ws` to the api so cookies are same-origin in development (same as production, KB-031).
- [ ] Common criteria: G1, U1, U3, U4, U5, U8, U9, U10.

**Required tests:**
- Unit: Dialog traps focus, Escape closes it and focus returns to the trigger; TextField links its error with `aria-describedby`; `useAnnounce()` writes to the right live region; `apiClient` turns an A1 body into `ApiError`.
- API: n/a.
- E2E: unknown route renders the 404 page; axe has zero serious/critical violations on it.
- Accessibility: Tab order through the 404 page; Escape behaviour covered by the Dialog unit test.

**Out of scope:** auth pages (KB-006), theme and visual design (KB-027).

**History:**
- 2026-10-21 · planner · created as Proposed
- 2026-10-24 · planner · Proposed → Planned · approved by João (conversation, 2026-10-24)

### KB-005 · Authentication core: accounts and cookie sessions

- **MVP phase:** Authentication and workspaces
- **Priority:** High
- **Depends on:** KB-002, KB-003
- **Estimate:** L
- **ADR required:** auth and sessions (D3)

**Goal:** Implement email + password authentication with server-side sessions (D3), the security baseline (CSRF, rate limiting) and the helpers that every later route and the WebSocket server use.

**Acceptance criteria:**
- [ ] ADR (G7): hashing algorithm and parameters, token format and storage, cookie attributes, expiry and renewal, CSRF strategy, rate limits, account-enumeration trade-off, and why D3 was chosen.
- [ ] Migration: `User` (id, email unique and stored lowercased, name, passwordHash, createdAt) and `Session` (id, userId FK with cascade, tokenHash unique, expiresAt, lastUsedAt, createdAt).
- [ ] `POST /api/auth/signup` {email, name, password 10–128 chars} → 201 with the user and a session cookie; duplicate email → `409 EMAIL_TAKEN`.
- [ ] `POST /api/auth/login` → 200 with cookie; unknown email or wrong password → `401 INVALID_CREDENTIALS` with an identical body (a dummy hash is verified for unknown emails to equalise timing).
- [ ] `POST /api/auth/logout` → 204, session row deleted and cookie cleared; `GET /api/auth/me` → 200 current user or 401.
- [ ] Passwords hashed with argon2id; `passwordHash` is never returned or logged.
- [ ] Session token: 32 random bytes; only its SHA-256 hash is stored; cookie `httpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when `NODE_ENV=production`; 30-day sliding expiry renewed at most once a day; expired sessions are rejected and deleted.
- [ ] Origin check for state-changing requests and rate limit on login/signup (10 per minute per IP + email) per A3/A5.
- [ ] `requireAuth` hook exposing `request.user`; public routes listed explicitly (signup, login, health); `getSessionFromCookieHeader()` helper exported for the WebSocket upgrade (KB-016).
- [ ] Test helpers: `createUserAndLogin()` for API tests and a Playwright helper that logs in through the API and stores the cookie.
- [ ] Operator CLI `pnpm --filter api admin:reset-password <email>` sets a random temporary password, prints it once and deletes all of that user's sessions (D6 working assumption).
- [ ] Common criteria: G1–G4, G6–G8, A1–A3, A5, A7.

**Required tests:**
- Unit: hash/verify round trip; token hashing; cookie options per `NODE_ENV`; Origin check; sliding-expiry rule.
- API: signup 201 / 400 (invalid email, short password, unknown field) / 409; login 200 / 401 for unknown email and wrong password with identical bodies / 429 after the limit; logout 204 then `me` 401; `me` 401 with no cookie, a tampered cookie and an expired session; POST without or with a wrong `Origin` → 403; no response contains `passwordHash`; CLI resets the password and invalidates existing sessions.
- E2E: n/a (UI in KB-006).
- Accessibility: n/a.

**Out of scope:** auth UI (KB-006), email verification and email-based reset (D6), OAuth, 2FA, "log out of all devices".

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-006 · Sign-up, log-in and log-out UI with protected routes

- **MVP phase:** Authentication and workspaces
- **Priority:** High
- **Depends on:** KB-004, KB-005
- **Estimate:** M

**Goal:** Let users create an account, log in and log out in the browser, and keep every private route behind a session.

**Acceptance criteria:**
- [ ] `/signup` and `/login` pages with field-level errors (from `details`) and API messages for 401/409/429.
- [ ] `useCurrentUser()` query on `/api/auth/me`; a protected-route wrapper redirects to `/login?next=<path>` and returns there after login; `next` accepts only same-origin relative paths (no open redirect).
- [ ] Any 401 from the API clears the query cache and redirects to login, keeping the current path in `next`.
- [ ] "Log out" in the header clears the cache and goes to `/login`.
- [ ] Password field with a show/hide toggle (`aria-pressed`).
- [ ] Common criteria: G1, U1–U5, U8–U10.

**Required tests:**
- Unit: `next` sanitizer rejects absolute, protocol-relative and `javascript:` URLs.
- API: n/a (covered in KB-005).
- E2E: sign up → lands on the home page; log out → visiting a protected URL redirects to login; log in → returns to that URL; wrong password and duplicate email show the error; axe on both pages.
- Accessibility: complete sign-up and log-in with the keyboard only (Tab, Enter); errors announced assertively and focus on the first invalid field.

**Out of scope:** profile editing, password change, password reset (D6).

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-007 · Workspaces, memberships and the authorization policy

- **MVP phase:** Authentication and workspaces
- **Priority:** High
- **Depends on:** KB-005, KB-006
- **Estimate:** L
- **ADR required:** authorization model

**Goal:** Introduce the tenant boundary (workspace), the three roles and a single server-side policy used by every later route and by the WebSocket server.

**Acceptance criteria:**
- [ ] ADR (G7): role matrix (owner, member, viewer) × actions (read; edit cards; manage columns, labels and sprints; manage projects; manage members and invites; rename/delete workspace), the 404-vs-403 rule (A4), and how project-level resources resolve to their workspace.
- [ ] Migration: `Workspace` (id, name, createdAt) and `Membership` (workspaceId, userId, role enum; unique (workspaceId, userId); cascades on workspace delete).
- [ ] Policy module `apps/api/src/modules/authz`: `authorize(user, resource, action)` resolves the resource's workspace, loads the membership and throws 404/403 per A4; resolvers for workspace and project IDs, extended by later tasks.
- [ ] `POST /api/workspaces` (creator becomes owner, one transaction) → 201; `GET /api/workspaces` (only mine, with my role); `GET /api/workspaces/:id`; `PATCH /api/workspaces/:id` (owner); `DELETE /api/workspaces/:id` (owner; body must repeat the workspace name) → 204, cascading.
- [ ] UI: home page lists my workspaces (empty state with "Create workspace"); create dialog; workspace switcher in the header; settings page with rename and delete (typed-name confirmation), owner-only per U7.
- [ ] Common criteria: G1–G4, G7, G8, A1–A8, U1–U10.

**Required tests:**
- Unit: table-driven test of the full role × action matrix from the ADR.
- API: create 201 / 400 / 401; list never includes other users' workspaces; get/patch/delete by a non-member → 404 identical to a random ID; patch/delete by member and viewer → 403; owner → 200/204; delete cascades memberships; delete with the wrong confirmation name → 400.
- E2E: create a workspace → visible in the list and switcher; rename; delete with confirmation; axe on home and settings.
- Accessibility: create dialog opened with Enter, cancelled with Escape (focus back on the button); switcher operable with Tab/Enter.

**Out of scope:** invites and member management (KB-009), projects (KB-008).

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-008 · Projects within a workspace

- **MVP phase:** Authentication and workspaces
- **Priority:** High
- **Depends on:** KB-007
- **Estimate:** M

**Goal:** Workspaces hold projects; each project will own a board, a backlog and sprints.

**Acceptance criteria:**
- [ ] Migration: `Project` (id, workspaceId FK cascade, name 1–80, key 2–5 uppercase letters unique per workspace, nextCardNumber default 1, createdAt).
- [ ] `POST /api/workspaces/:wid/projects` (owner, member) → 201; `GET` list and `GET /api/projects/:pid` (any role); `PATCH` (owner, member); `DELETE` (owner) → 204 with cascade. Duplicate key → `409 PROJECT_KEY_TAKEN`.
- [ ] The authz project resolver is added (project → workspace).
- [ ] UI: workspace page lists projects (loading/empty/error); create dialog with the key suggested from the name; project settings with rename and owner-only delete (typed-name confirmation).
- [ ] Common criteria: G1–G4, A1–A7, U1–U10.

**Required tests:**
- Unit: key suggestion from a name ("Kanban Board" → "KB").
- API: create 201 / 400 (invalid key) / 409 / 401 / 404 non-member / 403 viewer; list isolation between workspaces; delete 403 for member, 204 for owner.
- E2E: create a project → open it (board placeholder); rename; delete; axe on the workspace page.
- Accessibility: create dialog fully by keyboard; project list is a list of links.

**Out of scope:** board and columns (KB-011), archiving projects.

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-009 · Invite links, members and roles

- **MVP phase:** Authentication and workspaces
- **Priority:** Medium
- **Depends on:** KB-007
- **Estimate:** L

**Goal:** Owners invite people with a shareable link and a role and manage members, which makes group work possible.

**Acceptance criteria:**
- [ ] Migration: `Invite` (id, workspaceId, tokenHash unique, role member|viewer, createdById, expiresAt, maxUses nullable, uses, revokedAt).
- [ ] `POST /api/workspaces/:wid/invites` (owner) {role, expiresInDays 1–30, maxUses?} → 201 with the link, shown only once; `GET` active invites (owner); `DELETE /api/invites/:id` (owner) → 204 revokes.
- [ ] Public `GET /api/invites/:token` → 200 {workspaceName, role, expiresAt}; unknown, expired, revoked and exhausted tokens all → the same `404 INVITE_INVALID`.
- [ ] `POST /api/invites/:token/accept` (authenticated) creates the membership and increments `uses` with a conditional update in one transaction (never exceeds `maxUses` under concurrency) → 200 {workspaceId}; an existing member gets 200 with no role change.
- [ ] `GET /api/workspaces/:wid/members` (any role); `PATCH /members/:userId` {role} (owner); `DELETE /members/:userId` (owner, or the user themselves to leave). Demoting, removing or leaving as the last owner → `409 LAST_OWNER`.
- [ ] Removing a member deletes nothing they created; their sessions stay valid but they lose access (404) immediately.
- [ ] UI: `/invite/:token` page (workspace and role; logged-out users go through login/sign-up and come back via `next`; "Accept" button); Members page with role select, remove (confirmation), invite dialog with "Copy link" and the list of active invites with "Revoke".
- [ ] Common criteria: G1–G4, G8, A1–A8, U1–U10.

**Required tests:**
- Unit: invite validity (expired, revoked, exhausted, valid).
- API: create 201 / 400 / 401 / 404 non-member / 403 member and viewer; preview 200 and identical 404s for each invalid case; accept 200 / 401 / 404; two parallel accepts on `maxUses=1` → exactly one membership; members list 404 for a non-member; role change 403 for non-owners and 409 for the last owner; member leaves → 204 and then gets 404 on the workspace.
- E2E (two contexts): A creates a viewer invite; B signs up through the link and sees the workspace read-only; A promotes B to member and B can create a project after reload; axe on the invite and members pages.
- Accessibility: "Copy link" by keyboard announces "Link copied" (polite); role select has a label including the member's name.

**Out of scope:** email invites (D6), ownership-transfer wizard (role change covers it), per-project permissions, closing live connections on removal (KB-016).

**History:**
- 2026-10-21 · planner · created as Proposed
- 2026-10-24 · planner · priority High → Medium · re-check under João's rule: not on the critical path and blocks only Medium tasks (KB-013, KB-029)

### KB-010 · Fractional indexing utility and ordering/conflict ADR

- **MVP phase:** Board
- **Priority:** High
- **Depends on:** KB-001
- **Estimate:** M
- **ADR required:** ordering and conflict handling

**Goal:** Decide and implement how columns and cards are ordered and how concurrent structured edits are resolved, before any board code exists.

**Acceptance criteria:**
- [ ] ADR (G7): fractional-index string keys (base-62), deterministic order by (key, id), the server computes final keys from neighbours (client keys are only hints), rebalancing when a key exceeds 50 characters, concurrent-edit rules (field-level last write wins on PATCH, last move wins for the same card, delete wins and later edits get 404, per-card `version` used to order events), idempotent creates (A6), and the Yjs/PostgreSQL authority split from D5.
- [ ] `packages/shared/src/ordering`: `keyBetween(a, b)`, `keysBetween(a, b, n)`, `isValidKey(k)`, `compareByPosition(x, y)`; pure functions (a vetted library may be wrapped behind this API, per G9).
- [ ] Measured key length after 10,000 inserts at the end and 10,000 inserts at the same position recorded in the ADR.
- [ ] Common criteria: G1, G7, G8, G9.

**Required tests:**
- Unit: property-based (fast-check) — for random insert sequences between random neighbours, sorting by key reproduces the expected list order and keys are strictly increasing; `keysBetween(n = 100)` strictly increasing; invalid keys and `a ≥ b` throw.
- API: n/a.
- E2E: n/a.
- Accessibility: n/a.

**Out of scope:** endpoints using it (KB-011, KB-015), real-time transport (KB-016, KB-018).

**History:**
- 2026-10-21 · planner · created as Proposed
- 2026-10-24 · planner · Proposed → Planned · approved by João (conversation, 2026-10-24)

### KB-011 · Board and configurable columns

- **MVP phase:** Board
- **Priority:** High
- **Depends on:** KB-008, KB-010
- **Estimate:** M

**Goal:** Each project has a board whose columns users can add, rename, reorder, delete and mark as the "Done" column (needed by sprints and burndown).

**Acceptance criteria:**
- [ ] Migration: `Board` (1:1 with Project) and `Column` (id, boardId, name 1–50, position key, isDone; index (boardId, position)); a data migration creates boards for existing projects.
- [ ] New projects get "To do", "In progress" and "Done" (Done flagged) in the same transaction as the project.
- [ ] Exactly one Done column per board: setting `isDone` on one column clears it on the other in one transaction; removing the flag without setting another → `409 DONE_COLUMN_REQUIRED`.
- [ ] `GET /api/projects/:pid/board` (board + ordered columns); `POST /api/boards/:bid/columns` (A6); `PATCH /api/columns/:id` (name, position via neighbours, isDone); `DELETE /api/columns/:id` → 204 (the Done column → 409 `DONE_COLUMN_REQUIRED`). Owner and member manage; viewer reads.
- [ ] UI: board page with horizontal columns; "Add column" inline form; rename inline (Enter saves, Escape cancels); column menu with "Move left", "Move right", "Mark as Done column", "Delete" (confirmation); optimistic updates.
- [ ] Common criteria: G1–G4, A1–A7, U1–U10.

**Required tests:**
- Unit: neighbour selection for move left/right at the edges.
- API: get board 200 / 401 / 404 non-member; create 201, same id again → 200 with no duplicate; invalid name 400; viewer 403; Done flag exclusivity; deleting the Done column → 409; a column id from another board → 404.
- E2E: add, rename, reorder by keyboard and delete a column; state persists after reload; axe on the board.
- Accessibility: column menu reachable by Tab and opened with Enter; moves announced ("Column In progress moved to position 2 of 3").

**Out of scope:** cards (KB-012), WIP limits, swimlanes, several boards per project, live updates (KB-018).

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-012 · Cards: create, view, edit and delete

- **MVP phase:** Board
- **Priority:** High
- **Depends on:** KB-011
- **Estimate:** L

**Goal:** Deliver the core card lifecycle (with a markdown description) and the activity-log foundation that history and burndown rely on.

**Acceptance criteria:**
- [ ] Migration: `Card` (id, boardId, columnId, number unique per project, title 1–200, description markdown ≤ 20,000 chars, position key, version, createdById, createdAt, updatedAt, deletedAt) and `ActivityEvent` (id, cardId, actorId, type, data JSONB, createdAt; index (cardId, createdAt)).
- [ ] Card number taken from `Project.nextCardNumber` with an atomic increment in the creation transaction (no duplicates under concurrency).
- [ ] `POST /api/columns/:cid/cards` (A6; appended at the end unless neighbours are given) → 201; `GET /api/cards/:id`; `PATCH /api/cards/:id` {title?, description?} increments `version`; `DELETE /api/cards/:id` → 204 soft delete (`deletedAt`); deleted cards are excluded from every read and later mutations → 404.
- [ ] `GET /api/projects/:pid/board` includes non-deleted cards per column ordered by (position, id).
- [ ] `DELETE /api/columns/:id` with cards → `409 COLUMN_NOT_EMPTY` unless `moveCardsTo` (a column on the same board) is given; cards are appended there in one transaction.
- [ ] Activity per G5: `created`, `title_changed`, `description_changed` (stores lengths, not the text), `deleted`, `column_deleted_moved`.
- [ ] Markdown rendered without raw HTML (no `rehype-raw`); `javascript:` links removed.
- [ ] UI: "Add card" at the bottom of each column (Enter creates and keeps the field open for the next card); tiles show `KEY-number` and title; card detail dialog at `/projects/:pid/cards/:number` (deep link); inline title edit; description textarea with Edit/Preview and an explicit "Save" (replaced by KB-019); delete with confirmation; read-only for viewers.
- [ ] Common criteria: G1–G5, G8, A1–A7, U1–U10.

**Required tests:**
- Unit: markdown renderer strips `<script>`, inline event handlers and `javascript:` links.
- API: create 201 / 400 (empty or 201-char title) / 401 / 404 non-member / 403 viewer; repeated create id → 200, no duplicate; 20 parallel creates → 20 distinct numbers; PATCH increments `version` and writes `title_changed` in the same transaction (an injected failure leaves neither); delete 204 then GET and PATCH 404; column delete 409 without and 204 with `moveCardsTo`; `columnId` from another workspace → 404.
- E2E: create several cards using only the keyboard; open one by deep link; edit title and description; delete; axe on board and card dialog.
- Accessibility: tiles focusable; Enter opens the dialog; Escape closes it and returns focus to the tile; creation and deletion announced.

**Out of scope:** card fields (KB-013), labels (KB-014), moving cards (KB-015), live updates (KB-018), activity UI (KB-024), restoring deleted cards.

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-013 · Card fields: assignee, priority and estimate

- **MVP phase:** Board
- **Priority:** Medium
- **Depends on:** KB-009, KB-012
- **Estimate:** M

**Goal:** Cards carry who does them, how urgent they are and how big they are; estimates feed sprints, burndown and velocity.

**Acceptance criteria:**
- [ ] Migration: `Card.assigneeId` (nullable FK User), `priority` enum (none, low, medium, high, urgent; default none), `estimate` (nullable integer 0–100 story points, `CHECK` constraint).
- [ ] `PATCH /api/cards/:id` accepts the three fields; the assignee must be an owner or member of the card's workspace → otherwise `400 INVALID_ASSIGNEE`; each change writes an activity event with `from`/`to` (G5).
- [ ] Removing a member (KB-009 flow) unassigns their cards in that workspace in the same transaction, with activity events.
- [ ] Tiles show the assignee's initials (with the full name as accessible name), priority as icon + text and the estimate.
- [ ] Card detail: assignee select (current members), priority select, estimate number input with validation.
- [ ] Common criteria: G1–G5, A1–A7, U1–U10.

**Required tests:**
- Unit: priority display mapping (icon + label).
- API: valid updates 200; non-member or viewer assignee → 400; estimate −1, 101 and 1.5 → 400; viewer PATCH 403; non-member 404; removing a member clears their assignments and records events.
- E2E: set all three fields, reload, values persist and appear on the tile; axe on the card dialog.
- Accessibility: selects labelled; priority not conveyed by colour alone; changes announced.

**Out of scope:** multiple assignees, due dates, custom fields, filtering and search.

**History:**
- 2026-10-21 · planner · created as Proposed
- 2026-10-24 · planner · priority High → Medium · João's decision (2026-10-24): card fields are not on the MVP critical path

### KB-014 · Labels

- **MVP phase:** Board
- **Priority:** Low
- **Depends on:** KB-012, KB-018
- **Estimate:** M

**Goal:** Project-level labels to categorise cards. Scheduled after live updates so it publishes its own board events from the start.

**Acceptance criteria:**
- [ ] Migration: `Label` (id, projectId, name 1–30 unique per project case-insensitively, color from a fixed palette of 8 tokens) and `CardLabel` (cardId, labelId; composite PK; cascades).
- [ ] `POST/GET/PATCH/DELETE /api/projects/:pid/labels…` (owner and member manage, A6 on create); `PUT /api/cards/:id/labels` {labelIds} (max 10; a label from another project → 400); duplicate name → `409 LABEL_NAME_TAKEN`.
- [ ] Activity `labels_changed` {added, removed} (G5); board events for label and card-label changes (R6); the activity renderer handles the new type if KB-024 is already done (exhaustive switch).
- [ ] UI: labels on tiles (text, colour as a secondary cue); label picker in the card dialog (checkbox list); label management in project settings.
- [ ] Common criteria: G1–G5, A1–A7, U1–U10, R1, R6.

**Required tests:**
- Unit: palette validation.
- API: create 201 / 400 invalid colour / 409 duplicate / 403 viewer / 404 non-member; cross-project label → 400; setting the same labels twice is idempotent.
- E2E (two contexts): A creates a label and assigns it; B sees it on the tile within 2 s without reload; axe on settings and picker.
- Accessibility: picker options toggled with Space; changes announced.

**Out of scope:** filtering by label, custom colours outside the palette.

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-015 · Drag and drop and keyboard moving of cards

- **MVP phase:** Board
- **Priority:** High
- **Depends on:** KB-012
- **Estimate:** L

**Goal:** Move cards between columns and reorder them with the mouse or the keyboard alone (dnd-kit), with optimistic updates and deterministic results under concurrent moves.

**Acceptance criteria:**
- [ ] `POST /api/cards/:id/move` {columnId, afterCardId | null, beforeCardId | null}: the server computes the key from current neighbours inside a transaction (per the KB-010 ADR; stale neighbours resolved by the documented rule), increments `version` and returns the final position; activity `moved` {fromColumnId, toColumnId} only when the column changes.
- [ ] When a computed key exceeds the ADR threshold, the server rebalances that column's keys in the same transaction without changing the order.
- [ ] dnd-kit pointer and keyboard sensors: Space/Enter picks up, arrow keys move within and between columns, Space/Enter drops, Escape cancels and returns the card to its origin.
- [ ] Screen-reader announcements for pick-up, move, drop and cancel, with card, column and position ("Card KB-12 'Fix login' moved to In progress, position 3 of 5").
- [ ] Non-drag alternative: "Move to…" in the card menu (column select + top/bottom).
- [ ] Optimistic move with rollback and announcement on error; viewers cannot pick up cards (handles disabled) and the API returns 403.
- [ ] Common criteria: G1–G5, G8, A1–A5, A7, U1–U10.

**Required tests:**
- Unit: neighbour-to-key resolution, stale-neighbour rule, rebalance trigger.
- API: move within and between columns 200; to a column on another board 404; viewer 403; non-member 404; deleted card 404; two parallel moves into the same gap → both cards present once, in deterministic order; two parallel moves of the same card → it exists exactly once; rebalance keeps the order.
- E2E: mouse drag between columns persists after reload; keyboard move (Tab to the card, Space, ArrowRight, ArrowDown, Space) persists; Escape cancels; "Move to…" works; axe on the board.
- Accessibility: the key sequence above; live-region text asserted for pick-up, move, drop and cancel.

**Out of scope:** multi-select drag, dragging columns (menu in KB-011), live propagation (KB-018), virtualization (KB-028).

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-016 · WebSocket server with the y-websocket protocol and room authorization

- **MVP phase:** Real time
- **Priority:** High
- **Depends on:** KB-007
- **Estimate:** L
- **ADR required:** real-time architecture and Yjs↔DB authority (D1, D5)

**Goal:** Build the real-time layer in `apps/api`: an authenticated, authorized WebSocket endpoint speaking the y-websocket protocol, on which descriptions, presence and board events are built.

**Acceptance criteria:**
- [ ] ADR (G7): room naming (`board:<id>` for awareness and board events, `card:<id>:description` for text), y-protocols sync + awareness messages and the custom board-event message type, authority split per D5, persistence strategy (completed in KB-017), single-instance constraint and the scaling path (e.g. Redis pub/sub later), reconnection semantics.
- [ ] `@fastify/websocket` endpoint `/ws/:room` on the same port and origin as the API; the upgrade authenticates with the session cookie (`getSessionFromCookieHeader()`) and the Origin, and authorizes the room through the authz resolvers (R2).
- [ ] Server side of the y-websocket protocol with `y-protocols`: one in-memory `Y.Doc` per room, loaded on first connection and unloaded after the last client leaves (through a persistence hook implemented in KB-017).
- [ ] Viewer connections: document updates discarded, awareness allowed (R3).
- [ ] Heartbeat ping every 30 s; dead connections terminated; messages over 1 MB close the socket with 1009.
- [ ] Removing a member or changing their role (KB-009) closes or re-authorizes that user's open sockets in the workspace within 1 s (in-process event bus).
- [ ] Room-name schema and custom message schemas in `packages/shared` (R1).
- [ ] Common criteria: G1, G2, G7, G8, R1–R4.

**Required tests:**
- Unit: room-name parser and validation.
- API (integration with a real WebSocket client in Vitest): no cookie → 4401; wrong Origin → rejected; non-member → 4403 and no document bytes received; two members sync the same doc and converge (R4); a viewer's update is not applied on the server nor seen by the other client; removing a member closes their socket; oversized message → 1009.
- E2E: n/a (UI in KB-019 and KB-020).
- Accessibility: n/a.

**Out of scope:** persistence (KB-017), UI bindings (KB-019, KB-020), board events content (KB-018), several instances.

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-017 · Yjs document persistence in PostgreSQL

- **MVP phase:** Real time
- **Priority:** Medium
- **Depends on:** KB-016
- **Estimate:** M

**Goal:** Collaborative documents survive restarts and deploys, and live in PostgreSQL so a single database backup covers everything.

**Acceptance criteria:**
- [ ] Migration: `YDocument` (name PK, snapshot bytea, updatedAt) and `YDocumentUpdate` (id, docName FK, update bytea, createdAt).
- [ ] Incoming updates are appended in batches at most 500 ms apart (R7); on load, snapshot + updates are merged; compaction into the snapshot happens on unload or after 100 updates, in a transaction that never drops an update arriving during compaction.
- [ ] Graceful shutdown on SIGTERM/SIGINT: stop accepting connections, flush pending batches, close sockets with 1012 (service restart), then exit with code 0.
- [ ] Documents larger than 5 MB are logged as a warning.
- [ ] The ADR from KB-016 is updated with the persistence design and the backup implication (pg_dump captures documents).
- [ ] Common criteria: G1, G3, G4, G7, R7.

**Required tests:**
- Unit: batching timer and compaction trigger.
- API (integration): client edits → app closed and rebuilt on the same database → a new client receives the edits; compaction keeps the document identical (`Y.Text#toString()` and state vector); updates sent during compaction are not lost; SIGTERM handler flushes the pending batch before exit.
- E2E: n/a.
- Accessibility: n/a.

**Out of scope:** version history UI, purging documents of deleted cards.

**History:**
- 2026-10-21 · planner · created as Proposed
- 2026-10-24 · planner · priority High → Medium · re-check under João's rule: not on the critical path and blocks only Medium tasks (KB-019, KB-031)

### KB-018 · Live board updates

- **MVP phase:** Real time
- **Priority:** High
- **Depends on:** KB-013, KB-015, KB-016
- **Estimate:** L

**Goal:** Everyone looking at a board sees structured changes made by others (columns, cards, fields, moves) without reloading.

**Acceptance criteria:**
- [ ] After each committed mutation of columns, cards, card fields and moves, the service publishes a `BoardEvent` {type, boardId, entity, version, actorId, clientMutationId?, at} (Zod discriminated union in `packages/shared`) to the `board:<id>` room (R6); no event on rollback.
- [ ] Client hook `useBoardEvents(boardId)` applies events to the TanStack Query cache, ignores events with `version` ≤ the cached one (idempotent, out-of-order safe) and ignores the echo of its own mutations.
- [ ] On connect and reconnect the client refetches the board to cover missed events.
- [ ] Open card dialog: remote changes to fields the user is not editing update in place; a field being edited locally is not overwritten; if the card is deleted remotely, the dialog says "This card was deleted by <name>" and closes on confirm.
- [ ] Remote moves of the focused card keep focus on it and announce "Card KB-12 was moved to Done by Ana" (U5); no announcements for unfocused cards.
- [ ] Viewers receive events.
- [ ] Common criteria: G1, G2, G8, U5, U6, R1, R2, R6.

**Required tests:**
- Unit: cache reducer for every event type, stale/duplicate event handling, own-echo suppression.
- API (integration): a mutation through `app.inject` → event received by a WebSocket client in the board room; a forced rollback → no event; a non-member socket never receives events.
- E2E (two browsers): A creates, edits, moves and deletes a card → B sees each change within 2 s; a viewer B also sees them; axe unaffected.
- Accessibility: announcement for a remote move of the focused card asserted in the live region; focus stays on the card.

**Out of scope:** presence (KB-020), offline queue (KB-021), label events (KB-014), sprint events (KB-022, KB-023).

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-019 · Collaborative card description with Yjs

- **MVP phase:** Real time
- **Priority:** Medium
- **Depends on:** KB-012, KB-017
- **Estimate:** L

**Goal:** Several people edit a card description at the same time without conflicts; the Yjs document is the authority and the server keeps `Card.description` in sync.

**Acceptance criteria:**
- [ ] The description editor is bound to a `Y.Text` in the room `card:<id>:description` (CodeMirror 6 + `y-codemirror.next` in markdown mode, or an equivalent binding recorded in the real-time ADR); autosave replaces the "Save" button; status shows "Saved" / "Syncing…"; Edit/Preview toggle kept.
- [ ] Seeding: when no Yjs state exists, the server initializes the `Y.Text` from `Card.description` exactly once, even when two clients open the card at the same moment.
- [ ] Projection: the server writes the `Y.Text` content into `Card.description` within 2 s of the last change and on unload, so REST reads are current; `description_changed` events coalesced per actor per 10 minutes (G5).
- [ ] REST `PATCH /api/cards/:id` no longer accepts `description` (400 `VALIDATION_ERROR`): one write path.
- [ ] Editor limits input to 20,000 characters; viewers get a read-only editor (`aria-readonly`) that still updates live (R3).
- [ ] Tab does not trap focus (indent with Tab not enabled); the editor has the accessible name "Description".
- [ ] Common criteria: G1, G2, G5, G7, U3–U5, U9, R1–R4, R7.

**Required tests:**
- Unit: coalescing rule for `description_changed`.
- API (integration): single seeding under two simultaneous connections (no duplicated text); projection updates `Card.description`; PATCH with `description` → 400.
- E2E (two browsers): A and B type at the same time in different places of the same description → both show identical text, and after reload the text equals `GET /api/cards/:id` (R4); viewer B cannot type; axe on the dialog.
- Accessibility: Tab moves out of the editor; sync errors announced assertively; no announcements while typing.

**Out of scope:** remote cursors and presence (KB-020), offline indicator (KB-021), WYSIWYG rich text, comments.

**History:**
- 2026-10-21 · planner · created as Proposed
- 2026-10-24 · planner · priority High → Medium · re-check under João's rule: not on the critical path and blocks only Medium tasks (KB-020, KB-021)

### KB-020 · Presence: who is on the board and who is editing a card

- **MVP phase:** Real time
- **Priority:** Medium
- **Depends on:** KB-019
- **Estimate:** M

**Goal:** Show who is looking at the board and who is editing which card, so collaborators avoid stepping on each other.

**Acceptance criteria:**
- [ ] Awareness state {userId, name, color, activeCardId, editing} with a Zod schema (R1); the server overwrites `userId` and `name` from the session (no identity spoofing).
- [ ] Board header shows up to 5 avatars (initials) plus "+N", with an accessible list "3 people on this board: …".
- [ ] Tiles show "Ana is editing" when someone is editing that card; the card dialog shows who else has it open; the description editor shows remote cursors and selections labelled with names.
- [ ] Presence disappears immediately on a clean close and within 30 s after a lost connection.
- [ ] Common criteria: G1, G2, U3, U4, U9, R1, R2.

**Required tests:**
- Unit: awareness → presence view model (dedupe by user across tabs).
- API (integration): a spoofed `userId` in awareness is replaced by the session user.
- E2E (two browsers): A opens the board → B sees A's avatar; A opens a card and types → B sees "A is editing" on the tile and A's cursor; A closes the page → removed for B within 30 s.
- Accessibility: presence readable as a list by screen readers; indicators not colour-only; no live announcements for people joining/leaving.

**Out of scope:** follow mode, typing indicators outside the description, presence across boards.

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-021 · Reconnection, offline edits and connection status

- **MVP phase:** Real time
- **Priority:** Medium
- **Depends on:** KB-018, KB-019
- **Estimate:** L

**Goal:** Losing the connection (Wi-Fi drop, laptop sleep, server restart) never loses work: users see the connection state, keep working, and everything syncs when the connection returns.

**Acceptance criteria:**
- [ ] Connection status in the board header: "Connected", "Reconnecting…", "Offline", announced politely on change; WebSocket reconnect with exponential backoff (1 s up to 30 s, with jitter); the browser `online` event triggers an immediate retry; a 1012 close (KB-017) is treated as a reconnect.
- [ ] Description edits made offline keep working locally and sync on reconnect (R5).
- [ ] Structured mutations made offline are paused (TanStack Query network mode) and replayed in order on reconnect; creates are safe to retry (A6); a target deleted meanwhile → rollback plus "Card KB-12 was deleted while you were offline"; the header shows "N changes pending".
- [ ] After reconnect the board is refetched (KB-018) and Yjs resyncs; the final state equals the server state.
- [ ] `beforeunload` warning while there are unsynced Yjs updates or paused mutations.
- [ ] Session expired while offline (4401 on reconnect) → explicit message "Your session expired; N pending changes were not saved" and redirect to login; never a silent loss.
- [ ] Common criteria: G1, G8, U5, U6, R4, R5, R7.

**Required tests:**
- Unit: backoff schedule; replay order and conflict-to-message mapping.
- API (integration): a Node y-websocket client reconnects after the app is restarted on the same database and keeps its edits.
- E2E (two browsers): A goes offline (`context.setOffline(true)`), edits the description, moves one card and creates one; meanwhile B edits the same description; A comes back online → both converge, B sees A's move and exactly one new card, nothing lost (R4, R5).
- Accessibility: status changes announced politely; pending count is visible text.

**Out of scope:** keeping offline edits across page reloads or browser restarts (IndexedDB), service worker / PWA.

**History:**
- 2026-10-21 · planner · created as Proposed
- 2026-10-24 · planner · priority High → Medium · João's decision (2026-10-24): robustness layer that only blocks the Medium KB-029

### KB-022 · Backlog and sprint planning

- **MVP phase:** Sprints
- **Priority:** Medium
- **Depends on:** KB-013, KB-018
- **Estimate:** L

**Goal:** Plan work in sprints: a backlog of cards outside sprints, sprints with dates, moving cards into them and starting a sprint.

**Acceptance criteria:**
- [ ] Migration: `Sprint` (id, projectId, name 1–80, goal ≤ 500, startDate and endDate as calendar dates, status planned|active|closed, committedPoints, completedPoints, closedAt, createdAt; `CHECK endDate >= startDate`; partial unique index allowing at most one active sprint per project) and nullable `Card.sprintId`.
- [ ] `POST/GET/PATCH /api/projects/:pid/sprints…` (owner and member manage; list paginated per A8); `POST /api/sprints/:id/start` → 200 for a planned sprint, stores `committedPoints` and writes a `sprint_started` snapshot event; another active sprint → `409 SPRINT_ALREADY_ACTIVE` (also under concurrency, guaranteed by the index).
- [ ] `PUT /api/cards/:id/sprint` {sprintId | null}: only a planned or active sprint of the same project (closed → `409 SPRINT_CLOSED`, other project → 400); activity `sprint_added` / `sprint_removed` (G5); board events (R6).
- [ ] UI: Backlog page per project with the cards in no sprint and one section per planned/active sprint showing total points; "Add to sprint" / "Remove from sprint" actions per card; create/edit sprint dialog with date fields; start-sprint confirmation.
- [ ] Board: "Active sprint only" filter (on by default when a sprint is active) with the sprint name, dates and days remaining.
- [ ] Common criteria: G1–G5, G8, A1–A8, U1–U10, R1, R6.

**Required tests:**
- Unit: date validation; days remaining (start, middle, last day, after end); points totals ignoring unestimated cards.
- API: create 201 / 400 (end before start) / 403 viewer / 404 non-member; start 200 and 409 for a second active sprint, including two parallel starts; assign to a closed sprint 409; another project's sprint 400; events recorded.
- E2E: create a sprint, add three cards with the keyboard, start it → the board filter shows only them; two browsers: B sees the card join the sprint on the board within 2 s; axe on the backlog page.
- Accessibility: date fields labelled; each sprint section is a labelled region with a heading; add/remove actions announced.

**Out of scope:** drag and drop on the backlog (buttons only), reordering the backlog, several active sprints, sprint templates.

**History:**
- 2026-10-21 · planner · created as Proposed
- 2026-10-24 · planner · priority High → Medium · re-check under João's rule: not on the critical path and blocks only Medium tasks (KB-023, KB-025)

### KB-023 · Close a sprint

- **MVP phase:** Sprints
- **Priority:** Medium
- **Depends on:** KB-022
- **Estimate:** M

**Goal:** Close the active sprint safely: finished work stays in the sprint, unfinished cards return to the backlog, and the numbers needed for velocity are recorded.

**Acceptance criteria:**
- [ ] `POST /api/sprints/:id/close` (owner, member) → 200 {completedCards, completedPoints, returnedCards}; in one transaction: cards not in the Done column get `sprintId = null` with `sprint_removed {reason: "sprint_closed"}`, cards in Done keep the sprint, the sprint becomes `closed` with `closedAt` and `completedPoints`; board events (R6).
- [ ] Closing a sprint that is not active → `409 SPRINT_NOT_ACTIVE`; two parallel closes → exactly one 200.
- [ ] UI: "Complete sprint" with a confirmation dialog stating what will happen ("4 done, 2 will return to the backlog"), then a summary; backlog and board update.
- [ ] Common criteria: G1–G5, A1–A5, A7, U1–U10, R6.

**Required tests:**
- Unit: close summary computation.
- API: 200 with correct moves and snapshot; 409; 403 viewer; 404 non-member; parallel double close; an injected failure leaves the sprint and cards untouched.
- E2E: close a sprint with 2 done cards and 1 unfinished → the unfinished one is in the backlog and the board filter turns off; axe on the dialog.
- Accessibility: dialog focus management; result announced politely.

**Out of scope:** moving unfinished cards to the next sprint, reopening a sprint.

**History:**
- 2026-10-21 · planner · created as Proposed
- 2026-10-24 · planner · priority High → Medium · João's decision (2026-10-24): end of the sprint flow, blocks only Medium/Low tasks (KB-026, KB-029)

### KB-024 · Card activity history

- **MVP phase:** Reports and history
- **Priority:** Medium
- **Depends on:** KB-013, KB-015
- **Estimate:** M

**Goal:** Show what happened to a card, by whom and when, using the events recorded since KB-012.

**Acceptance criteria:**
- [ ] `GET /api/cards/:id/activity?cursor&limit` → newest first, cursor on (createdAt, id), `limit` ≤ 100 (A8), each event with actor {id, name}.
- [ ] "Activity" section in the card dialog with readable lines ("Ana moved this card from To do to In progress · 2 h ago"), a `<time>` element with the absolute date, and "Load more".
- [ ] Rendering uses an exhaustive switch over the shared event union, so any future event type fails the typecheck until it has a renderer.
- [ ] New events for the open card appear live (board event → activity query invalidated).
- [ ] Common criteria: G1, G2, G8, A1–A4, A7, A8, U1–U10.

**Required tests:**
- Unit: renderer text for every event type existing at that time; relative-time formatting.
- API: stable pagination with no duplicates or gaps across pages; 401; 404 non-member; deleted card 404.
- E2E: change the title, move the card and set an estimate → three entries in the right order; axe on the dialog.
- Accessibility: activity is a list; "Load more" moves focus to the first newly loaded item.

**Out of scope:** workspace-wide activity feed, comments, notifications.

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-025 · Sprint burndown

- **MVP phase:** Reports and history
- **Priority:** Medium
- **Depends on:** KB-022
- **Estimate:** M

**Goal:** Show how much work remains in the current sprint, day by day, against the ideal line.

**Acceptance criteria:**
- [ ] Pure function `computeBurndown(sprint, events)` derives per-day `remainingPoints` and `scopePoints` from activity events (estimate changes, moves into/out of the Done column, sprint add/remove, card deletion) from `startDate` to min(today, `endDate`); day boundaries in UTC (documented); unestimated cards count as 0 and are reported as `unestimatedCount`.
- [ ] `GET /api/sprints/:id/burndown` → {days, ideal, unestimatedCount} (any role).
- [ ] Reports page per project: Recharts line chart (remaining vs ideal), a text summary ("12 of 30 points remaining, 4 days left") and a "Show as table" toggle rendering a real `<table>` with caption and headers.
- [ ] Empty states: no active sprint; no estimated cards.
- [ ] Common criteria: G1, G2, G8, A1–A4, A7, U1–U10.

**Required tests:**
- Unit: fixtures — scope added mid-sprint raises the scope line; a card moved out of Done increases remaining; a deleted card leaves the scope; estimate change on a done card; empty sprint.
- API: 200 for each role; 404 non-member; 401.
- E2E: start a sprint with estimated cards, move one to Done → today's remaining value drops in the table; axe on the reports page.
- Accessibility: table toggle reachable by keyboard; the chart is never the only source of the information.

**Out of scope:** burnup, cumulative flow, hour-based burndown, burndown of past sprints, per-project time zones.

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-026 · Velocity of recent sprints

- **MVP phase:** Reports and history
- **Priority:** Low
- **Depends on:** KB-023
- **Estimate:** S

**Goal:** Show committed vs completed points for recent sprints to support planning.

**Acceptance criteria:**
- [ ] `GET /api/projects/:pid/velocity` → last 6 closed sprints {name, committedPoints, completedPoints} in chronological order, plus the average completed.
- [ ] Reports page: Recharts bar chart plus a table alternative and a text summary; empty state "Close a sprint to see velocity".
- [ ] Common criteria: G1, G2, A1–A4, A7, U1–U10.

**Required tests:**
- Unit: average with 0, 1 and 6 sprints.
- API: order and limit; 404 non-member; 401.
- E2E: after closing a sprint, the velocity table shows it; axe.
- Accessibility: as KB-025 (table toggle by keyboard).

**Out of scope:** forecasting, per-member velocity.

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-027 · Adopt `@up201905892/ui` and replace local components

- **MVP phase:** Design system
- **Priority:** Medium
- **Depends on:** KB-004; **external dependency:** `@up201905892/ui` published on npm (Design System project). This task stays `Proposed` until the package is published.
- **Estimate:** M

**Goal:** Replace the minimal local components with the published design-system library so the app gets a consistent, accessible visual identity.

**Acceptance criteria:**
- [ ] `@up201905892/ui` installed at an exact published version, with its tokens/theme applied.
- [ ] Every local component in `apps/web/src/components/` that has a library equivalent is removed and its usages migrated; no duplicate implementations remain.
- [ ] Components missing from the library are not fully reimplemented; each one is listed in "Decisions for João" in the daily log as a request to the Design System project.
- [ ] All existing unit, E2E and axe tests pass (only selectors may change); web bundle size before/after recorded in the development entry.
- [ ] Common criteria: G1, G9, U3, U4, U9, U10.

**Required tests:**
- Unit: existing suites pass.
- API: n/a.
- E2E: full suite plus axe on every main page.
- Accessibility: keyboard regression of dialogs, menus, selects and keyboard drag and drop.

**Out of scope:** new features, changes to the library itself.

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-028 · Performance with 500+ cards

- **MVP phase:** Quality and delivery
- **Priority:** Medium
- **Depends on:** KB-018
- **Estimate:** M

**Goal:** Keep the board fast and fully keyboard-operable with 500+ cards.

**Acceptance criteria:**
- [ ] `pnpm db:seed:large` (refuses to run when `NODE_ENV=production`) creates a project with 600 cards over 5 columns, with fields filled.
- [ ] Column card lists virtualized with TanStack Virtual: with 600 cards at most 150 tile elements are in the DOM.
- [ ] Keyboard navigation and keyboard/pointer drag still work for cards outside the viewport (target scrolled into view, auto-scroll while dragging); announced positions use the full count ("position 300 of 320").
- [ ] `GET /api/projects/:pid/board` uses at most 5 database queries regardless of card count (no N+1); timings for 600 cards recorded in `docs/performance.md`.
- [ ] Applying one board event re-renders only the affected tiles (memoized tiles).
- [ ] Common criteria: G1, G9, U3, U5.

**Required tests:**
- Unit: virtualized column renders a bounded number of tiles; a render counter shows unrelated tiles do not re-render on an event.
- API: query count ≤ 5 on the seeded 600-card board (Prisma query event counter).
- E2E: seeded board loads; keyboard move of the 300th card to another column persists after reload.
- Accessibility: Tab/arrow navigation through a virtualized column reaches the last card.

**Out of scope:** server-side pagination of the board, web workers, load testing of the WebSocket server.

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-029 · End-to-end collaboration suite (two browsers)

- **MVP phase:** Quality and delivery
- **Priority:** Medium
- **Depends on:** KB-009, KB-021, KB-023
- **Estimate:** M

**Goal:** One reliable journey test that proves the product works for a real group, run in CI on every push.

**Acceptance criteria:**
- [ ] Playwright spec(s) in `e2e/journeys/` with two users: A signs up, creates a workspace and project, creates an invite; B signs up through the link; both open the board; A moves a card while B edits its fields; both edit the same description; B goes offline, makes changes and reconnects; A starts and closes a sprint; A demotes B to viewer and B can no longer edit (read-only UI and API 403).
- [ ] No fixed sleeps (only auto-waiting assertions); the suite runs in under 5 minutes in CI.
- [ ] `pnpm test:e2e -- --repeat-each=10` on the journey passes with zero failures (flakiness check, result recorded in the development entry).
- [ ] Common criteria: G1, R4, R5, R6.

**Required tests:**
- Unit: n/a.
- API: n/a.
- E2E: the journey above (two browsers).
- Accessibility: the journey's card move is done with the keyboard.

**Out of scope:** Firefox/WebKit, load testing.

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-030 · Accessibility audit and fixes

- **MVP phase:** Quality and delivery
- **Priority:** Medium
- **Depends on:** KB-020, KB-021, KB-024, KB-025
- **Estimate:** M

**Goal:** Verify the whole app against WCAG 2.2 AA and fix what blocks it, beyond the per-task automated checks.

**Acceptance criteria:**
- [ ] `docs/accessibility-audit.md`: WCAG 2.2 AA checklist per screen (log-in, sign-up, workspaces, members, invite, board, card dialog, backlog, reports), keyboard-only walkthrough with results, screen-reader spot check (NVDA + Chrome) of drag-and-drop and live announcements, text contrast ≥ 4.5:1.
- [ ] An axe sweep spec visits every route with zero serious/critical violations.
- [ ] Every A/AA failure found is fixed in this task; anything else is listed in the audit with severity and added to "Decisions for João" in the daily log for planning.
- [ ] Common criteria: G1, U3–U5, U9, U10.

**Required tests:**
- Unit: n/a.
- API: n/a.
- E2E: axe sweep of all routes; keyboard-only critical path (create card → move → open → edit → close dialog) with no mouse.
- Accessibility: as above.

**Out of scope:** AAA criteria, fixes inside `@up201905892/ui` (reported to the Design System project).

**History:**
- 2026-10-21 · planner · created as Proposed

### KB-031 · Deploy preparation for Railway

- **MVP phase:** Quality and delivery
- **Priority:** Medium
- **Depends on:** KB-017
- **Estimate:** M
- **ADR required:** deployment topology (D4)

**Goal:** Prepare everything João needs to deploy to Railway (D4) — container, configuration, documentation and a proposed GitHub Actions workflow — without any agent deploying or editing `.github/`.

**Acceptance criteria:**
- [ ] Multi-stage `Dockerfile` at the root: pnpm via corepack (version from `packageManager`), Node 22, production dependencies only, non-root user; the api serves the built web app (static files + SPA fallback) on the same origin as `/api` and `/ws`; listens on Railway's `PORT`; `.dockerignore` present; image size recorded.
- [ ] The process runs as `node …` (no shell wrapper), so SIGTERM reaches it and the KB-017 graceful shutdown runs on redeploy.
- [ ] `railway.json` (config as code): Dockerfile builder, healthcheck path `/health/ready`, pre-deploy command running `prisma migrate deploy`, restart policy on failure, 1 replica.
- [ ] Production hardening: `trustProxy` for Railway's proxy, `Secure` cookies, `WEB_ORIGIN` set to the public Railway/custom domain, security headers (`@fastify/helmet`, CSP compatible with the app and its WebSocket), request body limit.
- [ ] `docs/deployment.md`: variables table (name, required, example, where it comes from — e.g. `DATABASE_URL` as a reference to the Railway PostgreSQL service), Railway setup steps (service from Dockerfile, PostgreSQL plugin, private networking, app sleeping disabled, exactly one replica because Yjs rooms are in memory), backups (Railway database backups where the plan allows plus a tested `pg_dump`/`pg_restore` runbook), rollback steps.
- [ ] `docs/deploy/railway-deploy.yml` (proposed workflow for João to copy into `.github/workflows/`): manual dispatch and/or tag push, runs after CI succeeds, deploys with the Railway CLI using a `RAILWAY_TOKEN` repository secret and the service name as a variable; no secrets in the file. A request to copy it is added to "Decisions for João" in the daily log.
- [ ] Local verification documented: `docker build` and `docker run` against the compose database serve the app at `http://localhost:8080`, and `pnpm test:e2e --grep @smoke` with `BASE_URL` pointing at the container passes (if agents lack permission for `docker build`, the step is handed to João in the daily log).
- [ ] Common criteria: G1, G6, G7.

**Required tests:**
- Unit: config rejects a production environment without `Secure`-compatible settings (e.g. `WEB_ORIGIN` not https).
- API: static web files and SPA fallback served by the api; `/api/*` unknown routes still return A1 404 (not the SPA); security headers present.
- E2E: `@smoke` tag on the sign-up → create workspace flow, runnable against `BASE_URL`.
- Accessibility: n/a.

**Out of scope:** running any deploy, editing `.github/`, custom domain and DNS, multiple instances, monitoring/alerting service.

**History:**
- 2026-10-21 · planner · created as Proposed
- 2026-10-24 · planner · priority High → Medium · João's decision (2026-10-24): release preparation at the end of the plan, blocks only the Medium KB-032

### KB-032 · README with demo

- **MVP phase:** Quality and delivery
- **Priority:** Medium
- **Depends on:** KB-028, KB-031
- **Estimate:** M

**Goal:** A README that lets a recruiter understand the product and the process in two minutes and a developer run it in ten.

**Acceptance criteria:**
- [ ] `pnpm db:seed:demo` (refuses `NODE_ENV=production`) creates a demo workspace with two users, a project, a closed sprint and an active sprint with history, so burndown and velocity show real data.
- [ ] README: what it is, feature list, a GIF of two browsers collaborating, screenshots (board, card, backlog, reports), architecture diagram (web / api / WebSocket / PostgreSQL, Yjs authority split), local setup with the `CLAUDE.md` commands, test strategy, links to the ADRs, `docs/deployment.md` and the workflow records in `docs/workflow/`, and a "Live demo" line for João to fill after deploying.
- [ ] Every command in the README is verified on a clean clone.
- [ ] Common criteria: G1.

**Required tests:**
- Unit: n/a.
- API: demo seed runs twice without errors (idempotent) and refuses production.
- E2E: n/a.
- Accessibility: images have alt text; the GIF has a text description.

**Out of scope:** marketing site, video, documentation site.

**History:**
- 2026-10-21 · planner · created as Proposed
