# 01 · Planning

The project's source of truth: every task lives here. Only the `planner` creates or changes specifications; the other agents only update the **Status** column of the table and the task **History**.

Statuses: `Proposed` → `Planned` → `In development` → `Ready for test` → `In test` → `Passed` → `Done` (detours: `Failed` → `In development`; `Proposed` → `Rejected`).

## Index table

| ID | Task | MVP phase | Priority | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| — | *(empty: the planner fills it in at kickoff)* | — | — | — | — |

## Technical decisions

*(The planner records João's answers to technical questions here.)*

## Common criteria

*(The planner defines the general, API, UI and real-time criteria here, cited by code in tasks.)*

## Applied decisions

Lines from `approvals.md` already handled by the planner (prevents applying the same decision twice).

| Decision date | Decision | IDs | Applied on |
| --- | --- | --- | --- |

## Specifications

<!--
Task template (copy for each new task):

### KB-000 · Short title

- **MVP phase:** Foundations | Authentication and workspaces | Board | Real time | Sprints | Reports and history | Design system | Quality and delivery
- **Priority:** High | Medium | Low
- **Depends on:** KB-00X, KB-00Y (or —)
- **Estimate:** S (≤ 2h) | M (≤ 1 day) | L (≤ 3 days); bigger tasks are split

**Goal:** one or two sentences on what gets done and why.

**Acceptance criteria:**
- [ ] verifiable criterion 1
- [ ] verifiable criterion 2
- [ ] common criteria: G1–Gn, A1–An (as applicable)

**Required tests:**
- Unit: what to test
- API: status codes, validation and authorization to test
- E2E: user flows (and two browsers if it touches real time)
- Accessibility: keyboard (which keys, which result), aria-live announcements where applicable

**Out of scope:** what is not part of this task.

**History:**
- YYYY-MM-DD · planner · created as Proposed
-->
