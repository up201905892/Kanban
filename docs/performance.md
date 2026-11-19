# Performance with 500+ cards (KB-028)

How the board stays fast with large projects, and the numbers measured for a 600-card board.

## Seed data

`pnpm db:seed:large` creates a workspace and a project (`BIG`) whose board has 5 columns and 600 cards
(120 per column) with assignee, priority, estimate and description filled. It prints the log-in
(`large-board@example.com`) and the project address. It refuses to run when `NODE_ENV=production`
and is meant for local and CI databases only.

## Server: `GET /api/projects/:pid/board`

The whole request, session included, uses at most 5 SQL statements however many cards there are:

| # | Statement |
| --- | --- |
| 1 | Session and its user (one joined statement) |
| 2 | Project, to find its workspace |
| 3 | Membership of the caller in that workspace |
| 4 | Board with its columns and live cards (one joined statement) |
| 5 | Planned and active sprints |

Both joined statements use Prisma's `relationLoadStrategy: 'join'` (the `relationJoins` preview
feature is enabled in `schema.prisma`). `apps/api/src/modules/boards/board-performance.test.ts` seeds
600 cards and fails if the request needs more than 5 statements.

Timing in the API test (Fastify `inject`, local PostgreSQL, includes JSON serialisation and Zod
validation of the response): **about 31 to 32 ms** for the 600-card board (two runs, 2026-11-19; the
absolute number depends on the machine, the statement count does not).

## Client

- Each column's list is virtualized with TanStack Virtual: only the visible tiles plus 4 on each side
  are in the DOM (at most about 16 to 24 per column at common window heights, so well under the 150
  limit for 600 cards). The column scrolls on its own (`max-height: min(70vh, 48rem)`).
- The list keeps the held card and the focused card rendered while they are off screen, so a drag or
  the keyboard focus is not lost when the list scrolls.
- Keyboard: on a card link, ArrowDown, ArrowUp, Home and End move focus through the whole column
  (scrolling the target into view). Tab still reaches the tiles that are rendered, the move handle
  and the "Add card" button. Dragging with the keyboard or pointer auto-scrolls the column; announced
  positions use the full list ("position 60 of 120"); every list item carries `aria-posinset` and
  `aria-setsize`.
- Tiles are split into a thin sortable shell (dnd-kit re-renders it through its context) and a
  memoized body. Applying one board event re-renders only the body of the card that changed
  (`board-virtualized.test.tsx` counts body renders).
