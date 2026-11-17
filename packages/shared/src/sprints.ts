import { z } from 'zod';

export const SPRINT_NAME_MIN_LENGTH = 1;
export const SPRINT_NAME_MAX_LENGTH = 80;
export const SPRINT_GOAL_MAX_LENGTH = 500;
export const SPRINT_LIST_DEFAULT_LIMIT = 50;
export const SPRINT_LIST_MAX_LIMIT = 100;

export const SPRINT_STATUSES = ['planned', 'active', 'closed'] as const;
export const sprintStatusSchema = z.enum(SPRINT_STATUSES);
export type SprintStatus = z.infer<typeof sprintStatusSchema>;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Milliseconds (UTC midnight) of a `YYYY-MM-DD` calendar date, or null when it is not a real date. */
function dateToMs(value: string): number | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  // Date.UTC rolls 2026-02-31 over to March: a real date round-trips unchanged.
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

/** True for a real calendar date written as `YYYY-MM-DD` (no time, no zone). */
export const isCalendarDate = (value: string): boolean => dateToMs(value) !== null;

/** A calendar date such as `2026-11-16` (sprints start and end on days, not instants). */
export const calendarDateSchema = z
  .string()
  .refine(isCalendarDate, { message: 'Use a real date written as YYYY-MM-DD' });

/** The calendar date of a `Date` in UTC. */
export const toCalendarDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Whole days from `today` to `endDate` (both calendar dates): positive before the end date, 0 on the
 * last day, negative after it.
 */
export function daysRemaining(endDate: string, today: string): number {
  const end = dateToMs(endDate);
  const now = dateToMs(today);
  if (end === null || now === null) throw new RangeError('Not a calendar date');
  return Math.round((end - now) / DAY_MS);
}

/** "4 days left", "Last day", "Ended 2 days ago", or "Starts in 3 days" before the start. */
export function daysRemainingLabel(startDate: string, endDate: string, today: string): string {
  const untilStart = daysRemaining(startDate, today);
  if (untilStart > 0) return `Starts in ${untilStart} ${untilStart === 1 ? 'day' : 'days'}`;
  const left = daysRemaining(endDate, today);
  if (left > 1) return `${left} days left`;
  if (left === 1) return '1 day left';
  if (left === 0) return 'Last day';
  const ago = -left;
  return `Ended ${ago} ${ago === 1 ? 'day' : 'days'} ago`;
}

/** Sum of the story points of `cards`; cards without an estimate count as 0. */
export const sumPoints = (cards: readonly { estimate: number | null }[]): number =>
  cards.reduce((total, card) => total + (card.estimate ?? 0), 0);

export const sprintNameSchema = z
  .string()
  .trim()
  .min(SPRINT_NAME_MIN_LENGTH, 'Name is required')
  .max(SPRINT_NAME_MAX_LENGTH, `Name must be at most ${SPRINT_NAME_MAX_LENGTH} characters`);

export const sprintGoalSchema = z
  .string()
  .trim()
  .max(SPRINT_GOAL_MAX_LENGTH, `Goal must be at most ${SPRINT_GOAL_MAX_LENGTH} characters`);

/** True when `end` is on or after `start`; false when either is not a real date. */
export const isDateRangeValid = (start: string, end: string): boolean => {
  const s = dateToMs(start);
  const e = dateToMs(end);
  return s !== null && e !== null && e >= s;
};

const END_BEFORE_START = {
  message: 'End date must be on or after the start date',
  path: ['endDate'],
};

export const sprintParamsSchema = z.strictObject({ id: z.uuid() });
export const projectSprintsParamsSchema = z.strictObject({ pid: z.uuid() });

export const sprintSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  goal: z.string(),
  startDate: calendarDateSchema,
  endDate: calendarDateSchema,
  status: sprintStatusSchema,
  /** Points of the cards in the sprint when it started; null until then. */
  committedPoints: z.number().int().nullable(),
  /** Points of the cards in Done when it was closed; null until then. */
  completedPoints: z.number().int().nullable(),
  closedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Sprint = z.infer<typeof sprintSchema>;

export const sprintResponseSchema = z.object({ sprint: sprintSchema });
export type SprintResponse = z.infer<typeof sprintResponseSchema>;

export const createSprintRequestSchema = z
  .strictObject({
    /** Client-generated id (A6): repeating the create returns the existing sprint. */
    id: z.uuid().optional(),
    name: sprintNameSchema,
    goal: sprintGoalSchema.optional(),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
  })
  .refine((body) => isDateRangeValid(body.startDate, body.endDate), END_BEFORE_START);
export type CreateSprintRequest = z.infer<typeof createSprintRequestSchema>;

export const updateSprintRequestSchema = z
  .strictObject({
    name: sprintNameSchema.optional(),
    goal: sprintGoalSchema.optional(),
    startDate: calendarDateSchema.optional(),
    endDate: calendarDateSchema.optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'Send at least one field to change',
  })
  .refine(
    (body) =>
      body.startDate === undefined ||
      body.endDate === undefined ||
      isDateRangeValid(body.startDate, body.endDate),
    END_BEFORE_START,
  );
export type UpdateSprintRequest = z.infer<typeof updateSprintRequestSchema>;

/** `GET /api/projects/:pid/sprints`: cursor pagination (A8), ordered by start date then id. */
export const sprintListQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(100).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SPRINT_LIST_MAX_LIMIT)
    .default(SPRINT_LIST_DEFAULT_LIMIT),
  /** Comma-separated statuses to keep, e.g. `planned,active`; all when missing. */
  status: z
    .string()
    .transform((value) => value.split(','))
    .pipe(z.array(sprintStatusSchema).min(1))
    .optional(),
});
export type SprintListQuery = z.infer<typeof sprintListQuerySchema>;

export const sprintListResponseSchema = z.object({
  sprints: z.array(sprintSchema),
  /** Pass it as `cursor` to get the next page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type SprintListResponse = z.infer<typeof sprintListResponseSchema>;

/**
 * Append-only sprint history (`sprint_events`). `sprint_started` snapshots what the sprint began
 * with, which the burndown (KB-025) needs because cards move in and out later.
 */
export const sprintEventDataSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sprint_started'),
    data: z.object({
      committedPoints: z.number().int().nonnegative(),
      cards: z.array(
        z.object({
          cardId: z.uuid(),
          columnId: z.uuid(),
          estimate: z.number().int().nullable(),
        }),
      ),
    }),
  }),
  z.object({
    type: z.literal('sprint_closed'),
    data: z.object({
      completedCards: z.number().int().nonnegative(),
      completedPoints: z.number().int().nonnegative(),
      returnedCards: z.number().int().nonnegative(),
      /** The cards that went back to the backlog. */
      returnedCardIds: z.array(z.uuid()),
    }),
  }),
]);
export type SprintEventData = z.infer<typeof sprintEventDataSchema>;

/** `PUT /api/cards/:id/sprint`: a planned or active sprint of the same project, or null for the backlog. */
export const setCardSprintRequestSchema = z.strictObject({ sprintId: z.uuid().nullable() });
export type SetCardSprintRequest = z.infer<typeof setCardSprintRequestSchema>;

/** What closing a sprint does, in cards and points (the dialog and the API agree on it). */
export const closeSprintSummarySchema = z.object({
  completedCards: z.number().int().nonnegative(),
  completedPoints: z.number().int().nonnegative(),
  returnedCards: z.number().int().nonnegative(),
});
export type CloseSprintSummary = z.infer<typeof closeSprintSummarySchema>;

/** `POST /api/sprints/:id/close` response. */
export const closeSprintResponseSchema = closeSprintSummarySchema;
export type CloseSprintResponse = CloseSprintSummary;

/**
 * Splits the cards of a sprint at the moment it closes: those in a Done column stay (and count for
 * the velocity), the rest return to the backlog. Cards without an estimate add 0 points.
 */
export function summarizeClose<T extends { columnId: string; estimate: number | null }>(
  cards: readonly T[],
  doneColumnIds: ReadonlySet<string>,
): CloseSprintSummary & { completed: T[]; returned: T[] } {
  const completed = cards.filter((c) => doneColumnIds.has(c.columnId));
  const returned = cards.filter((c) => !doneColumnIds.has(c.columnId));
  return {
    completedCards: completed.length,
    completedPoints: sumPoints(completed),
    returnedCards: returned.length,
    completed,
    returned,
  };
}
