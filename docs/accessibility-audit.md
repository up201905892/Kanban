# Accessibility audit (KB-030)

Target: WCAG 2.2 level AA. Audit date: 2026-11-23. Scope: every route of `apps/web` as of KB-025.

## How this audit was done

| Method | What it covers | Result |
| --- | --- | --- |
| Automated axe sweep (`e2e/accessibility.spec.ts`) | Every route, rules tagged `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` (includes colour contrast); only `serious` and `critical` fail the test | Zero violations after the fixes below |
| 360 px width check (same spec) | No horizontal page scroll on every route (WCAG 1.4.10 Reflow, U10) | Passes after fix F2 |
| Keyboard-only critical path (same spec) | Create card, move it, open it, edit the title, close the dialog, with key presses only | Passes |
| Code and E2E review of the keyboard patterns | Dialog focus trap and focus return, menus, drag and drop keyboard pattern, live regions | See per-screen tables |
| Screen-reader spot check (NVDA + Chrome) | Drag-and-drop and live announcements | **Not performed.** No screen reader or Windows host is available to the autonomous agents. Open item for João (see "Open items") |

Axe finds roughly a third of WCAG problems, so the tables below record what was checked by hand in the code and in the existing E2E tests, not only what axe reports.

## Contrast (SC 1.4.3 and 1.4.11)

The stylesheet uses a small palette. Ratios computed against the white background (`#fff`):

| Use | Colour | Ratio | Needs | OK |
| --- | --- | --- | --- | --- |
| Body text, headings, borders of controls | `#111`, `#333` | 18.9, 12.6 | 4.5 (text), 3 (UI borders) | yes |
| Error text | `#b00020` | 7.9 | 4.5 | yes |
| Secondary text | `#595959` | 7.0 | 4.5 | yes |
| Focus ring | `#1a56db` | 6.3 | 3 | yes |
| Chart lines (burndown) | `#1d4ed8`, `#4b5563` | 6.7, 7.6 | 3 | yes |
| Row separator | `#ccc` | 1.6 | decorative only (rows are also separated by spacing) | yes |

Axe's colour-contrast rule also ran on every screen with no findings. Information is not conveyed by colour alone: priority has an icon and a label, errors have text, the burndown has a table alternative.

## Per-screen checklist

Legend: ok = meets the criterion, fixed = failed and was fixed in this task, see F-numbers below.

### Log-in and sign-up

| Criterion | Result |
| --- | --- |
| 1.3.1, 3.3.2 Labels visible and associated | ok |
| 3.3.1 Errors linked with `aria-describedby`, focus moves to the first invalid field | ok (E2E in KB-006) |
| 2.4.2 Page title | fixed (F3) |
| 2.4.1 Bypass blocks | ok (skip link in the layout) |
| 1.3.1 One `h1` | ok |
| 3.3.8 Accessible authentication (no cognitive test; paste and password managers allowed, password can be shown) | ok |
| Keyboard walkthrough: Tab through the fields and the submit button, Enter submits | ok |

### Workspaces (home, workspace, workspace settings)

| Criterion | Result |
| --- | --- |
| One `h1`, logical heading order | ok |
| Loading, empty and error states announced (`role="alert"` on errors) | ok |
| Error state that replaces the page still has the `h1` | fixed (F1) |
| Destructive actions confirmed in a dialog with focus return | ok |
| 360 px reflow | ok |

### Members and invite

| Criterion | Result |
| --- | --- |
| Table has column and row headers (`scope`) and a name | ok |
| Role `select` has an accessible name per person | ok |
| Demotion to viewer and removal ask for confirmation; Escape and Cancel keep the state and return focus | ok (KB-038, KB-009) |
| 1.4.10 Reflow at 360 px: the table is wider than the screen | fixed (F2) |
| Invite page for an invalid link has an `h1` | fixed (F1) |
| Invite link is a normal link, Accept is a button | ok |

### Board

| Criterion | Result |
| --- | --- |
| Columns are named regions; each card tile is one link and one move handle | ok |
| Connection status and presence list readable as text | ok (KB-020, KB-021) |
| Dragging (SC 2.5.7): a single-pointer alternative exists | ok, see "Card pattern (D9)" |
| Moves announced politely, failures assertively, in the shared live regions | ok (`move-cards.spec.ts`) |
| Focus returns to the move handle after a drop | ok (`move-cards.spec.ts`) |
| Remote changes do not steal focus and are not announced as noise | ok |
| Target size (SC 2.5.8, 24 by 24 px minimum) of tile link and move handle | not measured in a browser; the stylesheet sets minimum widths of 1.5 rem and above on the small controls. Listed as O2 |
| 360 px: the board scrolls inside its own container, the page does not | ok |

#### Card pattern (D9, option A) and SC 2.5.7

Result of the audit of the pattern chosen in D9:

- Enter on a tile (a link) opens the card dialog. Verified by `e2e/accessibility.spec.ts` (keyboard path) and `e2e/cards.spec.ts`.
- Space on the tile, or Space or Enter on the move handle ("Move card KB-n"), picks the card up; arrow keys move it between positions and columns with a polite announcement for every step; Space drops it; Escape cancels and announces where the card returned. Verified by `e2e/move-cards.spec.ts` and the keyboard path in `e2e/accessibility.spec.ts`.
- "Move to..." in the card dialog (column and position selects plus a "Move card" button) is the single-pointer alternative to dragging, so SC 2.5.7 Dragging Movements is met without any drag. Verified by `e2e/move-cards.spec.ts`.
- Two Tab stops per tile (link and move handle) are intentional (decision D9). Not a failure: each stop has a distinct name and purpose. Tab order across a large board is long; this is recorded as an open item (O3), not an A/AA failure, because the skip link and the "Move to..." route exist.

### Card dialog

| Criterion | Result |
| --- | --- |
| `role="dialog"`, labelled by title, focus trapped, Escape closes, focus returns to the tile | ok (E2E and keyboard path) |
| Title edit by keyboard (Edit title, Enter saves, Escape cancels) | ok |
| Description editor has a label; preview is a labelled group | ok |
| Save state ("Saved") readable as text and announced politely | ok |
| Activity history is a list with text, not colour | ok |
| Presence "editing" indicator has a text alternative | ok |

### Backlog and sprints

| Criterion | Result |
| --- | --- |
| Sprint sections are named regions, controls name the sprint and card they act on ("Add to sprint: PL-1") | ok |
| Create, start and close sprint dialogs: focus and Escape | ok |
| Dates are text, not only colour | ok |

### Reports (burndown)

| Criterion | Result |
| --- | --- |
| Chart has a text summary and a "Show as table" alternative that works with the keyboard | ok (`burndown.spec.ts`) |
| Colours are not the only difference between the two lines (legend text) | ok |

### Not found and route error

| Criterion | Result |
| --- | --- |
| One `h1`, link back home | ok |

## Failures found and fixed (A/AA)

| ID | Criterion | Finding | Fix |
| --- | --- | --- | --- |
| F1 | 1.3.1 Info and relationships, 2.4.6 Headings (best practice, reported by axe `page-has-heading-one`) | Every page-level error state ("Invite not valid", "Project unavailable", "Workspace unavailable", "Could not check your session") rendered an `h2` and the page had no `h1` | `ErrorState` takes `headingLevel`; pages where the error replaces the whole page pass `1`. Unit test in `components.test.tsx`; the sweep visits an unavailable project and workspace and an invalid invite |
| F2 | 1.4.10 Reflow | The members table made the page scroll horizontally at 360 px | The table sits in a focusable, labelled scroll region (`.table-scroll`), so the page does not scroll and keyboard users can still scroll the table |

| F3 | 2.4.2 Page titled | The document title was "Kanban" on every route | `useHeadingTitle` in `RootLayout` keeps `document.title` as "<h1 text> - Kanban", also when the heading appears after data loads. Unit test `useHeadingTitle.test.tsx`; the sweep asserts the title on every logged-in route |

No other serious or critical axe violation was found on any route, logged in or out, or in the card dialog.

## Open items (not fixed here)

| ID | Severity | Item | Suggested handling |
| --- | --- | --- | --- |
| O1 | High for the release sign-off, none for the code | NVDA + Chrome spot check of drag-and-drop and live announcements was not performed (no screen reader available to the agents) | João runs the 10-minute script below and records the result in this file |
| O2 | Low | Target sizes (SC 2.5.8) were reviewed in the stylesheet but not measured in a browser; contrast was computed and axe-checked, not checked on real devices | Fold into the O1 session; a Playwright bounding-box check is a candidate for the planner |
| O3 | Low | Large boards have two Tab stops per tile; a user with only a keyboard must Tab through every tile to reach later columns | Candidate for a "skip to column" shortcut after v1.0; ties to KB-028 |
| O4 | Low | Anything inside `@up201905892/ui` once KB-027 lands must be re-audited | Re-run `e2e/accessibility.spec.ts` as part of KB-027 |

### NVDA spot-check script (for O1)

1. Open a board with three cards, start NVDA, Chrome.
2. Tab to "Move card KB-1": NVDA reads the name. Press Space: NVDA says "Picked up Card KB-1 ... position 1 of 3".
3. ArrowDown and ArrowRight: each step is read ("moved to ... position n of m"). Escape: "Move cancelled ...".
4. Repeat and drop with Space: "dropped in ...". Focus is on the handle.
5. Open a card (Enter on its link): the dialog title is read; Tab stays inside; Escape returns to the tile.
6. With a second browser, change a card title: nothing is announced for a card that is not focused.
7. Record pass or fail per step here.
