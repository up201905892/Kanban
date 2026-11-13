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


Possible decisions:

- **Approve** — the tasks move from `Proposed` to `Planned`.
- **Change** — the planner revises the specification according to the note; the task stays `Proposed`.
- **Reject** — the task leaves the plan (recorded as rejected, not deleted).
- **Answer** — an answer to a question left under "Decisions for João" in the daily log; the note holds the answer.
- **Unblock** — lets the cycle resume a task paused by a rule violation or by 3 failures, with the instruction in the note.
