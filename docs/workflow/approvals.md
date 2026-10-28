# Approvals and decisions (João)

**Only João edits this file.** This is how the plan moves forward when the cycle runs on its own: the `planner` reads this file at the start of every `/daily` run and applies new decisions. Agents are not allowed to change it.

How to use it: add one line per decision (on GitHub, on the `develop` branch, even from a phone). Never delete old lines.

| Date | Decision | IDs | Note |
| --- | --- | --- | --- |
| *YYYY-MM-DD* | *Approve* | *KB-001 to KB-008* | |
| 2026-10-28 | Approve | KB-005 to KB-009 | |
| 2026-10-28 | Answer | D6 | Accept the working assumption: no email in v1.0; invites are shared links and password reset uses the operator CLI |
| 2026-10-28 | Answer | D5 | Accept the working assumption: hybrid; Yjs is the authority for card descriptions and presence, PostgreSQL (via REST) for structured data |

Possible decisions:

- **Approve** — the tasks move from `Proposed` to `Planned`.
- **Change** — the planner revises the specification according to the note; the task stays `Proposed`.
- **Reject** — the task leaves the plan (recorded as rejected, not deleted).
- **Answer** — an answer to a question left under "Decisions for João" in the daily log; the note holds the answer.
- **Unblock** — lets the cycle resume a task paused by a rule violation or by 3 failures, with the instruction in the note.
