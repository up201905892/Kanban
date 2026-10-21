# Workflow kit — Kanban with Claude Code

The same workflow as the Design System (four phases, four agents, an autonomous daily cycle), adapted to a full-stack app with a database and real time. Everything in this kit is in English.

```
Planning ──► Development ──► Testing ──► Done
(planner)    (developer)     (tester)    (finisher)
    ▲              ▲             │
    │              └── Failed ◄──┘
approvals.md
  (João)
```

## Contents

| Path | Purpose |
| --- | --- |
| `CLAUDE.md` | Project and workflow rules; Claude Code reads it in every session |
| `INITIAL-PROMPT.md` | The prompt for the first session (create the backlog with you) |
| `.claude/agents/` | The four agents: `planner`, `developer`, `tester`, `finisher` |
| `.claude/skills/daily/SKILL.md` | The daily cycle (`/daily` by hand, `/daily autonomous` on the schedule) |
| `.claude/settings.json` | Permissions: what the agents can and cannot do |
| `.github/workflows/daily.yml` | The daily schedule (weekdays, 09:23 UTC) |
| `.github/workflows/ci.yml` | Independent checks: build, lint, types, migrations, tests, E2E |
| `.github/workflows/claude.yml` | Answers `@claude` mentions in issues and pull requests |
| `.github/workflows/claude-code-review.yml` | Reviews pull requests with inline comments |
| `docs/workflow/01-planning.md` … `04-done.md` | The four records |
| `docs/workflow/approvals.md` | Your decisions (only you edit it) |
| `docs/workflow/daily-log.md` | Summary of each day |

## Differences from the Design System

| | Design System | Kanban |
| --- | --- | --- |
| IDs | `DS-XXX` | `KB-XXX` |
| Daily command | `/diario` | `/daily` |
| Records | Portuguese names | English names (`01-planning.md`, `approvals.md`, `daily-log.md`) |
| Structure | library (`packages/ui`, tokens, icons) | `apps/web`, `apps/api`, `packages/shared` |
| Tests | unit, axe, Storybook | unit, API, authorization, E2E, real time with two browsers |
| Database | — | PostgreSQL as a service in GitHub Actions |
| Closing a task | changeset, stories | CHANGELOG, `.env.example`, `docs/api.md`, ADR |
| Blocked for agents | push, npm publish | push, publish, deploy, reading or editing `.env` |
| Daily run | 06:47 UTC | 09:23 UTC |

The workflows already include what you fixed in the Design System: `pnpm/action-setup` reads the version from `packageManager`, the build runs before typecheck, Chromium is installed through a script (`test:e2e:setup`), background tasks are disabled in the daily run, and the review accepts the bot-opened pull request.

## Installation

1. **Repository:** create a new GitHub repository (e.g. `kanban`), outside OneDrive. Extract the zip and copy **the contents** of the `kanban-workflow` folder to the repository root. Check with `dir -Force` in PowerShell that `CLAUDE.md`, `.claude` and `.github` are at the root, and with `dir .github\workflows` that the four `.yml` files are there. Commit and push to `main`.
2. **Claude GitHub App:** at [github.com/apps/claude](https://github.com/apps/claude) → **Configure** → add the new repository and save.
3. **Secret:** in the new repository, *Settings → Secrets and variables → Actions → New repository secret*, name `CLAUDE_CODE_OAUTH_TOKEN`. Generate a token with `claude setup-token`.
4. **Docker Desktop (local work only):** `winget install Docker.DockerDesktop`. GitHub Actions does not need it.
5. **First session:** open Claude Code at the repository root, paste the text from `INITIAL-PROMPT.md`, answer the technical decisions and approve the tasks. Then `git push`.
6. **First cycle:** *Actions → Daily cycle → Run workflow*.
7. **Protect `main`:** *Settings → Branches* → require a pull request for `main`.

## Day to day

Read the summary on the `develop → main` pull request, approve tasks in `docs/workflow/approvals.md` **on the `develop` branch**, and merge into `main` when a phase closes.

## Subscription usage with two projects

Both cycles, plus the automatic pull request reviews, draw from the same Claude subscription limit. If it stops being enough for your other work:

- lower "At most 2 tasks developed per run" to 1 in the `SKILL.md` of one project;
- or run the Kanban cycle on alternate days: `cron: "23 9 * * 2,4"` (Tuesdays and Thursdays);
- or limit the review to opened pull requests only (remove `synchronize` in `claude-code-review.yml`).

## Deploy

Agents never deploy. The last MVP phase prepares a Dockerfile and a file in `docs/` with the proposed deploy workflow. You pick the service, create the secrets and copy the workflow into `.github/`.

## Security

Defined in `.claude/settings.json`:

- no push, branch switching, `reset` or `rebase`;
- no package publishing or deploys (Fly, Vercel, Railway and Render CLIs blocked);
- no reading or editing `.env` files;
- no editing `CLAUDE.md`, `.claude/`, `.github/` or `approvals.md`.

The database credentials in the workflows are test-only and exist only during each run.
