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
