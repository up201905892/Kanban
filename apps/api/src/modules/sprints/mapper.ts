import type { Sprint, SprintStatus } from '@kanban/shared';

interface SprintRow {
  id: string;
  projectId: string;
  name: string;
  goal: string;
  startDate: Date;
  endDate: Date;
  status: SprintStatus;
  committedPoints: number | null;
  completedPoints: number | null;
  closedAt: Date | null;
  createdAt: Date;
}

/** Calendar dates (`DATE` columns) come back as UTC midnight; the API uses `YYYY-MM-DD`. */
export const dateToString = (date: Date): string => date.toISOString().slice(0, 10);
export const stringToDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

export const toSprint = (row: SprintRow): Sprint => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  goal: row.goal,
  startDate: dateToString(row.startDate),
  endDate: dateToString(row.endDate),
  status: row.status,
  committedPoints: row.committedPoints,
  completedPoints: row.completedPoints,
  closedAt: row.closedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});
