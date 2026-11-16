import { sumPoints, type CardSummary, type Sprint } from '@kanban/shared';

/** Sprints in display order: start date, then id (the order the server lists them in). */
export const sortSprints = (sprints: readonly Sprint[]): Sprint[] =>
  [...sprints].sort((a, b) =>
    a.startDate === b.startDate ? a.id.localeCompare(b.id) : a.startDate.localeCompare(b.startDate),
  );

const byNumber = (a: CardSummary, b: CardSummary) => a.number - b.number;

/** Cards that are in no sprint, oldest number first. */
export const backlogCards = (cards: readonly CardSummary[]): CardSummary[] =>
  cards.filter((c) => c.sprintId === null).sort(byNumber);

/** Cards of one sprint, oldest number first. */
export const sprintCards = (cards: readonly CardSummary[], sprintId: string): CardSummary[] =>
  cards.filter((c) => c.sprintId === sprintId).sort(byNumber);

export interface PointsTotal {
  points: number;
  /** Cards without an estimate: they add nothing to the total. */
  unestimated: number;
}

export const pointsOf = (cards: readonly CardSummary[]): PointsTotal => ({
  points: sumPoints(cards),
  unestimated: cards.filter((c) => c.estimate === null).length,
});

/** "12 points" / "1 point" / "12 points, 2 not estimated". */
export function pointsLabel({ points, unestimated }: PointsTotal): string {
  const base = `${points} ${points === 1 ? 'point' : 'points'}`;
  return unestimated > 0 ? `${base}, ${unestimated} not estimated` : base;
}

/** The sprint cards may be added to by default: the active one, else the first planned. */
export const defaultTargetSprint = (sprints: readonly Sprint[]): Sprint | undefined =>
  sprints.find((s) => s.status === 'active') ?? sprints.find((s) => s.status === 'planned');

/** Today as a calendar date in the browser's time zone (what a person calls "today"). */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** "16 Nov 2026 to 27 Nov 2026" from two calendar dates (no time-zone shift). */
export function dateRangeLabel(startDate: string, endDate: string): string {
  return `${formatDate(startDate)} to ${formatDate(endDate)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ''} ${year}`;
}
