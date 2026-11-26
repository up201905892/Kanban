# Approvals and decisions (João)

**Only João edits this file.** This is how the plan moves forward when the cycle runs on its own: the `planner` reads this file at the start of every `/daily` run and applies new decisions. Agents are not allowed to change it.

How to use it: add one line per decision (on GitHub, on the `develop` branch, even from a phone). Never delete old lines.

| Date | Decision | IDs | Note |
| --- | --- | --- | --- |
| *YYYY-MM-DD* | *Approve* | *KB-001 to KB-008* | |
| 2026-10-28 | Approve | KB-005 to KB-009 | |
| 2026-10-28 | Answer | D6 | Accept the working assumption: no email in v1.0; invites are shared links and password reset uses the operator CLI |
| 2026-10-28 | Answer | D5 | Accept the working assumption: hybrid; Yjs is the authority for card descriptions and presence, PostgreSQL (via REST) for structured data |
| 2026-11-04 | Approve | KB-011 to KB-013, KB-015 to KB-019 | |
| 2026-11-04 | Answer | KB-008 | Confirmed: the project key is fixed after creation (PATCH accepts only name) |
| 2026-11-04 | Answer | KB-007 | Confirmed: role matrix in ADR 0003 as implemented |
| 2026-11-13 | Approve | KB-034, KB-035, KB-037, KB-039, KB-040, KB-033 | Quality debt first: fixes to tasks already Done |
| 2026-11-13 | Approve | KB-022, KB-021, KB-024 | Next features: backlog and sprints, reconnection, activity history |
| 2026-11-13 | Answer | D9 | A: keep KB-015 as built |
| 2026-11-13 | Reject | KB-036 | Not needed with D9 = A |
| 2026-11-13 | Answer | D10 | A: demoting a member to viewer unassigns their cards |
| 2026-11-13 | Approve | KB-038 | Implements D10 = A |
| 2026-11-13 | Answer | D11 | A: accept and document that deleting a column hard-deletes its soft-deleted cards and their history in v1.0 |
| 2026-11-13 | Approve | KB-014, KB-020, KB-023, KB-025, KB-026, KB-028, KB-029, KB-030, KB-031, KB-032 | Approve the rest of the MVP; develop as dependencies close |
| 2026-11-20 | Answer | 2026-11-19 follow-ups | Plan (1) pnpm test:e2e forwards arguments and (3) unit test for validateSessionToken |
| 2026-11-20 | Answer | ADR 0004 §7 | Plan a follow-up: re-check the project still exists on room join |
| 2026-11-26 | Change | KB-030 | Remove the NVDA + Chrome spot check from the acceptance criteria and plan it as a separate follow-up task done by João (script in docs/accessibility-audit.md, item O1); retest KB-030 on the automated criteria |
| 2026-11-26 | Change | KB-031 | Move the Docker image build (size check) and the pg_dump/pg_restore backup drill to a separate follow-up task done by João (steps in docs/deployment.md, "Verify the image locally"); retest KB-031 on the remaining criteria |
| 2026-11-26 | Answer | 2026-11-24 follow-up | Plan the fix: after a 404 on a card move, do not announce "It is back in To do." |
| 2026-11-26 | Answer | 2026-11-19 follow-ups | Plan (2) "jump to card" / "Move to top/bottom" keyboard shortcut |
| 2026-11-26 | Answer | KB-030 follow-ups | Plan O2 (24 px target size) and O3 (skip to column); O4 after KB-027 |
| 2026-11-26 | Change | KB-031 | Deploy to Render instead of Railway (Railway is not an option), free plan: replace railway.json with render.yaml (web service from the Dockerfile + Render PostgreSQL), run prisma migrate deploy at container start while keeping node as the process that receives SIGTERM, use Render auto-deploy after CI passes instead of a GitHub workflow, document sleeping after inactivity and the free database expiry, update ADR 0005 and docs/deployment.md. Move the Docker image build and the pg_dump/pg_restore drill to a separate follow-up task done by João. Rename the task accordingly |

Possible decisions:

- **Approve** — the tasks move from `Proposed` to `Planned`.
- **Change** — the planner revises the specification according to the note; the task stays `Proposed`.
- **Reject** — the task leaves the plan (recorded as rejected, not deleted).
- **Answer** — an answer to a question left under "Decisions for João" in the daily log; the note holds the answer.
- **Unblock** — lets the cycle resume a task paused by a rule violation or by 3 failures, with the instruction in the note.
