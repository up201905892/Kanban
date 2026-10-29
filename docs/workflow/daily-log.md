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

## 2026-10-29

- **Decisions for João:**
  - Approve more tasks so work is not starved. Only KB-007 can start tomorrow (KB-008 and KB-009 wait behind it). Suggested line: `2026-10-29 | Approve | KB-011 to KB-013, KB-015 to KB-017`.
  - Raise KB-009 from Medium to High? It now blocks KB-016 (High, critical path). The planner added KB-009 as a dependency of KB-016 and did not change the priority of an already `Planned` task. Answer with `Change`.
  - Optional: a small S task for a `packages/shared` watch mode in `pnpm dev` and the placeholder `app_meta` table; `/health` is still not proxied by Vite.
- **Done:** KB-005, KB-006
- **Tested:** KB-005 (Passed; 9 edge-case tests added), KB-006 (Passed; 9 open-redirect edge-case tests added)
- **Developed:** KB-005 (account and cookie-session auth, ADR 0002, `@node-rs/argon2`), KB-006 (sign-up, log-in, log-out UI and protected routes)
- **Proposals awaiting approval:** KB-011 to KB-032 (KB-027 also waits for `@up201905892/ui` on npm)
- **Applied decisions:** KB-005 to KB-009 approved; D5 (hybrid Yjs/REST) and D6 (no email in v1.0) decided. KB-011 and KB-012 specs aligned with D5; ADR 0001 section 7 is still marked provisional, and KB-011 includes updating it.
- **Rule violations found:** none. The KB-007/KB-008 index rows were joined on one line; the planner fixed them. KB-031 gained the `trustProxy` and argon2 warm-up follow-ups.
- **Next step:** develop KB-007 (workspaces and the authorization policy), then KB-008 and KB-009.

## 2026-10-28

- **Decisions for João:**
  - Approve the next tasks in `approvals.md` (e.g. `Approve | KB-005 to KB-009`). No task is `Planned` now, so tomorrow's run has nothing to develop until you approve.
  - Answer D5 (scope of Yjs authority). KB-010 was approved before D5 was answered, so ADR `0001` section 7 is provisional (assumes text and presence in Yjs, structured data through REST with PostgreSQL as authority). If you choose the alternative, ADR sections 3, 5 and 6 and tasks KB-012 to KB-016, KB-018, KB-021, KB-022 and KB-024 need revising. Also answer D6 (email in v1.0).
  - Still open: optional local `prisma migrate reset` / `pnpm db:up`/`db:down` check, the placeholder `app_meta` table, and whether `/health` should move under `/api`.
  - Planner suggestions for KB-011/KB-012: use `COLLATE "C"` on position columns; KB-015 must implement the stale-neighbour rule from the ADR.
- **Done:** KB-010
- **Tested:** KB-010 (Passed; the tester added 3 edge-case tests)
- **Developed:** KB-010 (Ready for test)
- **Proposals awaiting approval:** KB-005 to KB-009, KB-011 to KB-032 (no new proposals; the backlog is already fully proposed, so the planner was not called)
- **Rule violations found:** none. The finisher could not run its secret-pattern scan (sandbox denied it); the commit only added ordering code, tests, the ADR and the `fast-check` dev dependency.
- **Next step:** develop KB-005 and KB-006 once approved.

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
