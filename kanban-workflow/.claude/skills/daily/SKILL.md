---
name: daily
description: Runs the Kanban daily cycle — applies João's decisions, checks the rules, closes, tests, develops, plans and records. Use when João types /daily or when the scheduled daily run starts.
argument-hint: "[autonomous]"
---

Run the Kanban daily cycle following the four-phase workflow in `CLAUDE.md`. You are the orchestrator: you do not write code or reports yourself; you delegate each task to the right agent, **one task at a time**, and wait for the result before moving on. Everything you write to the repository is in English.

Arguments received: `$ARGUMENTS`

## Run mode

- **Interactive** (no arguments): João is present. You may ask him questions when a decision is needed, in European Portuguese.
- **Autonomous** (argument `autonomous`, used by the GitHub Actions schedule): nobody is watching.
  - Never wait for an answer. A decision that needs João goes to the "Decisions for João" section of the day's log, and the affected task stays paused.
  - Never switch branches, push, deploy or publish packages. Only commit on the current branch; the workflow handles the push.
  - Never edit `CLAUDE.md`, `.claude/`, `.github/` or `docs/workflow/approvals.md` (they belong to João; the permissions also block it).
  - If a command fails for lack of permission, do not work around it: record the command and the reason under "Decisions for João".

## 0. João's decisions

If `docs/workflow/approvals.md` has lines not yet listed under "Applied decisions" in `01-planning.md` → delegate to the `planner` agent to apply them. Tasks approved last night can then be developed today.

## 1. Current state

1. Read `CLAUDE.md` and the files in `docs/workflow/`.
2. Run `git status` and `git log --oneline -20`.
3. If there are uncommitted changes that belong to no task: in interactive mode, ask João; in autonomous mode, leave them untouched and record them under "Decisions for João".

## 2. Rules audit

Check and list any violation:
- a task outside `Proposed`/`Planned` with no history justifying its status;
- a task `Ready for test` or later with no entry in `02-development.md`;
- a task `Passed`/`Done` whose latest report in `03-testing.md` is not `Passed`;
- a task `Done` with no entry in `04-done.md`;
- commits mentioning `KB-XXX` for a task that was never `Planned`;
- more than 2 tasks `In development`;
- a task stuck `In development` or `In test` for more than 3 days.

Violations are **never fixed silently**: the affected tasks stay paused and the violation goes into the day's log. Other tasks continue normally.

## 3. Done (first, to free up the flow)

For each `Passed` task → delegate to the `finisher` agent with the ID.

## 4. Testing

For each `Ready for test` task → delegate to the `tester` agent with the ID.

## 5. Development

1. First, `Failed` tasks (oldest first) → `developer` agent.
2. Then, while fewer than 2 tasks are `In development`, pick the next `Planned` task whose dependencies are `Done` (priority High → Medium → Low, then lowest ID) → `developer` agent.
3. At most 2 tasks developed per run.
4. When the `developer` finishes a task as `Ready for test`, delegate straight to the `tester` and, if `Passed`, to the `finisher`. A task can go through the whole cycle in one day.
5. If a task fails 3 times in a row, stop developing it and record it under "Decisions for João" (the specification probably needs revision).

## 6. Planning

If there are fewer than 3 `Planned` tasks with satisfied dependencies → delegate to the `planner` agent to propose the next ones. Proposals stay `Proposed` until João approves them.

## 7. Daily log

1. Add the day's summary to `docs/workflow/daily-log.md`, right after the introduction, titled `## YYYY-MM-DD` (template in the file). In autonomous mode the workflow posts this section as a comment on the pull request, so write it for João to read on his phone: short, with pending decisions first.
2. Commit: `chore(workflow): daily log YYYY-MM-DD`.
3. In interactive mode, reply to João with the same summary, in European Portuguese.
