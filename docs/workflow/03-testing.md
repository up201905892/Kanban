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
