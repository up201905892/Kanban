# Kanban — instructions for Claude Code

An agile project management tool (kanban board, sprints, burndown) with real-time collaborative editing. It is the second project in João's portfolio and uses the `@up201905892/ui` component library (the Design System project). All work follows the four-phase workflow described below, recorded in `docs/workflow/`.

## Language

- **Everything written to the repository is in English:** code, UI text, error messages, tests, docs, workflow records in `docs/workflow/`, and commit messages.
- **Conversation with João** (interactive sessions) is in European Portuguese.

## Stack

- pnpm workspaces (monorepo); the root `package.json` pins pnpm with `"packageManager": "pnpm@10.x.x"`:
  - `apps/web` — React + TypeScript (`strict`) + Vite
  - `apps/api` — Node.js + Fastify + WebSockets
  - `packages/shared` — types, Zod schemas and utilities shared by web and api
- Server state: TanStack Query (caching, optimistic updates, invalidation)
- Drag and drop: dnd-kit (keyboard accessible)
- Real time: Yjs (CRDT) + y-websocket served by `apps/api`
- Database: PostgreSQL + Prisma (versioned migrations in `apps/api/prisma/migrations`)
- Charts: Recharts (burndown and velocity)
- UI: `@up201905892/ui` once it is published on npm (see "Design system" below)
- Tests: Vitest + Testing Library (unit), Vitest + Fastify `app.inject` (API), Playwright (E2E, including two browsers at once)
- ESLint + Prettier; Conventional Commits

## The four-phase workflow

| Phase | File | Written by | Enters when |
| --- | --- | --- | --- |
| Planning | `docs/workflow/01-planning.md` | `planner` | João approves a proposed task |
| Development | `docs/workflow/02-development.md` | `developer` | The task is `Planned` and its dependencies are `Done` |
| Testing | `docs/workflow/03-testing.md` | `tester` | The task is `Ready for test` |
| Done | `docs/workflow/04-done.md` | `finisher` | The task's latest test report is `Passed` |

Planning is the source of truth: every task lives there with an ID (`KB-001`, `KB-002`, …) and the index table at the top shows the current status of every task.

### Task statuses (in this order)

`Proposed` → `Planned` → `In development` → `Ready for test` → `In test` → `Passed` → `Done`

Allowed detours: `In test` → `Failed` → `In development` (back to the developer with the failures); `Proposed` → `Rejected`.

### Transition rules (mandatory)

1. **Nothing is developed unless it is in Planning.** The developer only takes tasks with status `Planned`, whose ID exists in `01-planning.md` and whose dependencies are `Done`. Work outside the plan → stop and propose a new task first.
2. **Nothing is tested unless it was developed.** The tester only takes `Ready for test` tasks that have an entry in `02-development.md` with the changed files and the commit.
3. **Nothing is done unless it passed every test.** The finisher only closes tasks whose latest report in `03-testing.md` says `Passed`, with every acceptance criterion verified and zero failures.
4. **Only João approves the plan.** The `planner` creates tasks as `Proposed`; they only become `Planned` after João approves them, in the conversation or in a line of `docs/workflow/approvals.md`.
5. **Work-in-progress limit:** at most 2 tasks `In development` at the same time.
6. **Every status change** updates the Planning index table and appends a line to the task history: `- YYYY-MM-DD · <agent> · <old status> → <new status> · <short note>`.
7. **Never delete records.** Record files only grow; corrections are made with a new history line.

## Project commands

```
pnpm install
pnpm db:up            # local PostgreSQL (docker compose) — local development only
pnpm db:migrate       # apply Prisma migrations
pnpm build            # build every package (run before typecheck: web and api use packages/shared builds)
pnpm lint             # ESLint + Prettier
pnpm typecheck        # tsc --noEmit in every package
pnpm test             # Vitest (unit and API; needs DATABASE_URL)
pnpm test:e2e:setup   # install the Playwright Chromium browser
pnpm test:e2e         # Playwright (starts api + web)
pnpm dev              # api + web in development mode
```

If a command does not exist yet, creating it is part of the matching setup task. In GitHub Actions, PostgreSQL already runs as a service and `DATABASE_URL` and `SESSION_SECRET` are set; do not use `docker` there.

## Code conventions

- **Shared contracts:** every API request/response and every real-time message has a Zod schema in `packages/shared`, used for API validation and for front-end types.
- **API:** routes by domain in `apps/api/src/modules/<domain>/` (routes, service, schema, tests); authorization checked on the server in every route; one error format `{ error: { code, message } }`.
- **Database:** schema changes only through Prisma migrations, never by hand; every migration has a descriptive name.
- **Front end:** features in `apps/web/src/features/<feature>/`; server data only through TanStack Query; no loose `fetch` calls in components.
- **Real time:** the Yjs document is the authority; the server updates the database from it. Conflict handling and ordering (fractional indexing) are documented in an ADR.
- **Accessibility:** everything usable with the keyboard alone, including moving cards; drag-and-drop announcements in `aria-live`.
- **Security:** never store secrets in the repository; `.env.example` lists the required variables with fake values.
- **Commits:** Conventional Commits with the task ID: `feat(web): KB-012 add card drag and drop between columns`.

## Design system

- While `@up201905892/ui` is not published on npm, the `planner` orders the work so that the back end, data model and real time come first, and the UI uses minimal local components in `apps/web/src/components/` (no investment in styling).
- Once it is published, a dedicated task installs the package and replaces the local components.
- If a component is missing from the library, do not fully reimplement it here: add the request to "Decisions for João" in the daily log (it is work for the Design System project).

## Files that belong to João only

Agents never change these files (the permissions in `.claude/settings.json` also prevent it):

- `CLAUDE.md`, `.claude/` (rules, agents, permissions)
- `.github/` (workflows; CI already exists in `.github/workflows/ci.yml` and is not a task to plan)
- `docs/workflow/approvals.md` (João's decisions)

If a task needs to change one of these files (for example, a deploy workflow), the task prepares the content in a file under `docs/` and adds the request to "Decisions for João" in the daily log.

## Daily routine

`/daily` runs the full cycle: applies João's decisions, checks the rules, closes what passed, tests what is ready, develops what is planned and records everything in `docs/workflow/daily-log.md`.

- **Interactive:** João types `/daily` in Claude Code.
- **Autonomous:** `.github/workflows/daily.yml` runs `/daily autonomous` every weekday on the `develop` branch, pushes the commits and posts the summary on the `develop → main` pull request. João only steps in to approve tasks (in `approvals.md`) and to merge into `main`.
- No agent pushes, switches branches, deploys or publishes packages.
