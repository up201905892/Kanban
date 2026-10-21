# Approvals and decisions (João)

**Only João edits this file.** This is how the plan moves forward when the cycle runs on its own: the `planner` reads this file at the start of every `/daily` run and applies new decisions. Agents are not allowed to change it.

How to use it: add one line per decision (on GitHub, on the `develop` branch, even from a phone). Never delete old lines.

| Date | Decision | IDs | Note |
| --- | --- | --- | --- |
| *YYYY-MM-DD* | *Approve* | *KB-001 to KB-008* | |

Possible decisions:

- **Approve** — the tasks move from `Proposed` to `Planned`.
- **Change** — the planner revises the specification according to the note; the task stays `Proposed`.
- **Reject** — the task leaves the plan (recorded as rejected, not deleted).
- **Answer** — an answer to a question left under "Decisions for João" in the daily log; the note holds the answer.
- **Unblock** — lets the cycle resume a task paused by a rule violation or by 3 failures, with the instruction in the note.
