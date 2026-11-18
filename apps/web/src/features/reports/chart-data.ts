import type { BurndownResponse } from '@kanban/shared';

export interface BurndownRow {
  date: string;
  /** Missing for days that have not happened yet. */
  remaining: number | null;
  scope: number | null;
  ideal: number;
}

/** One row per day of the sprint: the ideal line covers all of them, the real values only up to today. */
export function burndownRows(data: BurndownResponse): BurndownRow[] {
  const byDate = new Map(data.days.map((d) => [d.date, d]));
  return data.ideal.map((point) => {
    const day = byDate.get(point.date);
    return {
      date: point.date,
      remaining: day?.remainingPoints ?? null,
      scope: day?.scopePoints ?? null,
      ideal: point.points,
    };
  });
}

/** True when no card in the sprint has points (the chart would be a flat line at 0). */
export const hasNoEstimates = (data: BurndownResponse): boolean =>
  data.days.every((d) => d.scopePoints === 0);
