# Daily log

Summary of each `/daily` run, most recent first.

<!--
Template:

## YYYY-MM-DD

- **Decisions for João:** none | list (what needs deciding and how to answer in approvals.md)
- **Done:** KB-00X, …
- **Tested:** KB-00Y (Passed), KB-00Z (Failed: short reason)
- **Developed:** KB-00W (Ready for test)
- **Proposals awaiting approval:** KB-0AA, …
- **Rule violations found:** none | description
- **Next step:** …
-->

## 2026-10-27

- **Decisions for João:**
  - Approve the next tasks in `approvals.md` (e.g. `Approve | KB-005 to KB-009`). Only KB-010 is `Planned` now, so tomorrow's run will only have KB-010 to develop. KB-005 and KB-006 are the next on the critical path.
  - Answer D5 (scope of Yjs authority) and D6 (email in v1.0) in "Technical decisions" of `01-planning.md`. D5 must be answered before KB-010 and KB-012 are approved.
  - Open from yesterday: optional local `prisma migrate reset` / `pnpm db:up`/`db:down` check, and confirm the placeholder `app_meta` table from KB-002.
  - Planner suggestion: `/health` is not under `/api`, so the Vite dev proxy does not forward it. Decide whether it should move under `/api` (relevant for KB-031).
- **Done:** KB-003, KB-004 (Foundations milestone: KB-001 to KB-004 complete)
- **Tested:** KB-003 (report 1 Failed: `healthResponseSchema` was not in `packages/shared`; report 2 Passed), KB-004 (Passed)
- **Developed:** KB-003 (two iterations), KB-004
- **Proposals awaiting approval:** KB-005 to KB-032 (no new proposals; the whole backlog is already proposed, so the planner was not called)
- **Rule violations found:** none. The finisher could not run `git add`/`git commit` for KB-004; the orchestrator committed its docs as `1a11763`.
- **Next step:** develop KB-010 once approvals for KB-005 onwards arrive.

## 2026-10-26

- **Decisions for João:**
  - Approve the next tasks in `approvals.md` (e.g. `Approve | KB-005 to KB-009`). Only KB-003, KB-004 and KB-010 are `Planned`, so the backlog runs dry in about two days. KB-005 depends on KB-002 and KB-003.
  - Answer D5 (scope of Yjs authority) and D6 (email in v1.0) in "Technical decisions" of `01-planning.md`. D5 must be answered before KB-010 and KB-012 are approved.
  - Optional: run `prisma migrate reset` once locally and `pnpm db:up`/`db:down`. The tester could not run them in CI (no Docker, Prisma blocks reset for agents). KB-002 was closed without them.
  - KB-002 added a placeholder `app_meta` table so the `init` migration is not empty. Confirm it or ask the planner to replace it.
- **Done:** KB-001, KB-002
- **Tested:** KB-001 (Passed), KB-002 (Passed)
- **Developed:** KB-001, KB-002 (both went through the full cycle today)
- **Proposals awaiting approval:** KB-005 to KB-032 (no new proposals; the backlog is already fully proposed)
- **Rule violations found:** none. The finisher could not run `git commit` (denied); the orchestrator committed its docs as `dcc37b4`.
- **Next step:** develop KB-003, then KB-004 and KB-010, once the plan is topped up.
