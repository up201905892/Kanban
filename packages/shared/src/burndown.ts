import { z } from 'zod';
import { calendarDateSchema, daysRemainingLabel, toCalendarDate } from './sprints.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** One day of the burndown; the day is the UTC calendar day and the values are at its end. */
export const burndownDaySchema = z.object({
  date: calendarDateSchema,
  /** Points of the sprint's cards that are not in a Done column. */
  remainingPoints: z.number().int().nonnegative(),
  /** Points of every card in the sprint (Done or not). */
  scopePoints: z.number().int().nonnegative(),
});
export type BurndownDay = z.infer<typeof burndownDaySchema>;

export const idealPointSchema = z.object({
  date: calendarDateSchema,
  points: z.number().nonnegative(),
});
export type IdealPoint = z.infer<typeof idealPointSchema>;

/** `GET /api/sprints/:id/burndown`. */
export const burndownResponseSchema = z.object({
  /** From the start date to the earlier of today (UTC), the end date and the close date. */
  days: z.array(burndownDaySchema),
  /** Straight line from the scope of the first day to 0 on the end date; covers the whole sprint. */
  ideal: z.array(idealPointSchema),
  /** Cards in the sprint without an estimate (they count as 0 points). */
  unestimatedCount: z.number().int().nonnegative(),
});
export type BurndownResponse = z.infer<typeof burndownResponseSchema>;

/** The history the burndown replays: the card activity events of the sprint's cards. */
export interface BurndownEvent {
  id: string;
  cardId: string;
  /** ISO instant. */
  createdAt: string;
  type: string;
  data: unknown;
}

export interface BurndownSprint {
  startDate: string;
  endDate: string;
  /** ISO instant when a closed sprint was closed; the chart stops on that day. */
  closedAt?: string | null;
}

export interface BurndownCard {
  id: string;
  columnId: string;
  estimate: number | null;
}

export interface BurndownContext {
  /** The sprint's id: `sprint_added` / `sprint_removed` events of other sprints are ignored. */
  sprintId: string;
  doneColumnIds: ReadonlySet<string>;
  /** Present state of every card that is or was in the sprint (soft-deleted ones included). */
  cards: readonly BurndownCard[];
  /** The calendar day of "now" in UTC. */
  today: string;
}

interface CardState {
  inSprint: boolean;
  deleted: boolean;
  columnId: string;
  estimate: number | null;
}

const obj = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const idOf = (value: unknown): string | undefined => {
  const id = obj(value)['columnId'];
  return typeof id === 'string' ? id : undefined;
};

const estimateOf = (value: unknown): number | null => (typeof value === 'number' ? value : null);

const dayMs = (date: string): number => Date.parse(`${date}T00:00:00.000Z`);
const addDays = (date: string, n: number): string =>
  toCalendarDate(new Date(dayMs(date) + n * DAY_MS));

/** The column or estimate a card had before its first change, working back from its present state. */
function initialState(card: BurndownCard, events: readonly BurndownEvent[]): CardState {
  let columnId = card.columnId;
  let estimate = card.estimate;
  let columnSeen = false;
  let estimateSeen = false;
  for (const event of events) {
    const data = obj(event.data);
    if (!columnSeen && event.type === 'moved' && typeof data['fromColumnId'] === 'string') {
      columnId = data['fromColumnId'];
      columnSeen = true;
    } else if (!columnSeen && event.type === 'column_deleted_moved') {
      const from = idOf(data['from']);
      if (from !== undefined) {
        columnId = from;
        columnSeen = true;
      }
    }
    if (!estimateSeen && event.type === 'estimate_changed') {
      estimate = estimateOf(data['from']);
      estimateSeen = true;
    }
  }
  return { inSprint: false, deleted: false, columnId, estimate };
}

function apply(state: CardState, event: BurndownEvent, sprintId: string): void {
  const data = obj(event.data);
  switch (event.type) {
    case 'sprint_added':
      if (data['sprintId'] === sprintId) state.inSprint = true;
      break;
    case 'sprint_removed':
      if (data['sprintId'] === sprintId) state.inSprint = false;
      break;
    case 'deleted':
      state.deleted = true;
      break;
    case 'moved':
      if (typeof data['toColumnId'] === 'string') state.columnId = data['toColumnId'];
      break;
    case 'column_deleted_moved': {
      const to = idOf(data['to']);
      if (to !== undefined) state.columnId = to;
      break;
    }
    case 'estimate_changed':
      state.estimate = estimateOf(data['to']);
      break;
    default:
      break;
  }
}

/**
 * Replays the card activity of a sprint to get, for every day, the points still to do and the
 * points in scope. A day is a UTC calendar day (the API stores instants in UTC and sprint dates have
 * no zone) and its values are the state at the end of that day. A card counts while it is in the
 * sprint and not deleted; it is remaining while it is outside a Done column. Cards without an
 * estimate count as 0 and are reported in `unestimatedCount` (as of the last day).
 *
 * Cards that were hard-deleted (a column delete removes the cards soft-deleted in it) are not in the
 * input, so they drop out of the scope of past days (D11, option A, documented in `docs/api.md`).
 */
export function computeBurndown(
  sprint: BurndownSprint,
  events: readonly BurndownEvent[],
  context: BurndownContext,
): BurndownResponse {
  const sorted = [...events].sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
  );
  const byCard = new Map<string, BurndownEvent[]>();
  for (const event of sorted) {
    const list = byCard.get(event.cardId) ?? [];
    list.push(event);
    byCard.set(event.cardId, list);
  }
  const states = new Map<string, CardState>();
  for (const card of context.cards) {
    states.set(card.id, initialState(card, byCard.get(card.id) ?? []));
  }

  const lengthDays = Math.round((dayMs(sprint.endDate) - dayMs(sprint.startDate)) / DAY_MS) + 1;
  const closedDay = sprint.closedAt ? toCalendarDate(new Date(sprint.closedAt)) : null;
  let lastDate = sprint.endDate;
  if (context.today < lastDate) lastDate = context.today;
  if (closedDay !== null && closedDay < lastDate) lastDate = closedDay;

  const totals = (): { remaining: number; scope: number } => {
    let remaining = 0;
    let scope = 0;
    for (const state of states.values()) {
      if (!state.inSprint || state.deleted) continue;
      const points = state.estimate ?? 0;
      scope += points;
      if (!context.doneColumnIds.has(state.columnId)) remaining += points;
    }
    return { remaining, scope };
  };

  const days: BurndownDay[] = [];
  let next = 0;
  for (let date = sprint.startDate; date <= lastDate; date = addDays(date, 1)) {
    const limit = dayMs(addDays(date, 1));
    while (next < sorted.length) {
      const event = sorted[next];
      if (!event || Date.parse(event.createdAt) >= limit) break;
      const state = states.get(event.cardId);
      if (state) apply(state, event, context.sprintId);
      next += 1;
    }
    const { remaining, scope } = totals();
    days.push({ date, remainingPoints: remaining, scopePoints: scope });
  }

  const first = days[0]?.scopePoints ?? 0;
  const ideal: IdealPoint[] = [];
  for (let i = 0; i < lengthDays; i += 1) {
    const points = lengthDays === 1 ? first : first * (1 - i / (lengthDays - 1));
    ideal.push({ date: addDays(sprint.startDate, i), points: Math.round(points * 100) / 100 });
  }

  // `next` stopped at the end of the last day: later events are not applied, so the states are the
  // ones of the last day.
  let unestimatedCount = 0;
  for (const state of states.values()) {
    if (state.inSprint && !state.deleted && state.estimate === null) unestimatedCount += 1;
  }
  return { days, ideal, unestimatedCount };
}

/** "12 of 30 points remaining, 4 days left" (used by the reports page; the chart is never alone). */
export function burndownSummary(
  sprint: BurndownSprint,
  last: BurndownDay | undefined,
  today: string,
): string {
  if (!last) return 'The sprint has not started yet';
  const label = daysRemainingLabel(sprint.startDate, sprint.endDate, today);
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  return `${last.remainingPoints} of ${last.scopePoints} points remaining, ${lower}`;
}
