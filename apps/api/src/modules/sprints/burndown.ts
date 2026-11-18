import {
  computeBurndown,
  toCalendarDate,
  type BurndownEvent,
  type BurndownResponse,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { notFound } from '../../lib/app-error.js';
import { authorize } from '../authz/index.js';
import { toSprint } from './mapper.js';

/**
 * Burndown of a sprint (any role). It replays the activity of every card that is, or ever was, in
 * the sprint (`sprint_added` for this sprint) through the pure `computeBurndown`; days are UTC days.
 * A planned sprint has no days yet. Known limitation (D11, option A): cards hard-deleted by a column
 * delete no longer exist, so they are missing from the scope of past days.
 */
export async function getBurndown(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
  now: Date = new Date(),
): Promise<BurndownResponse> {
  await authorize(prisma, user, { type: 'sprint', id }, 'workspace:read');
  const row = await prisma.sprint.findUnique({
    where: { id },
    include: { project: { select: { board: { select: { id: true } } } } },
  });
  const boardId = row?.project.board?.id;
  if (!row || !boardId) throw notFound();
  const sprint = toSprint(row);
  if (sprint.status === 'planned') return { days: [], ideal: [], unestimatedCount: 0 };

  const added = await prisma.activityEvent.findMany({
    where: { type: 'sprint_added', data: { path: ['sprintId'], equals: id } },
    select: { cardId: true },
    distinct: ['cardId'],
  });
  const cardIds = added.map((a) => a.cardId);
  const [cards, events, doneColumns] = await Promise.all([
    prisma.card.findMany({
      where: { id: { in: cardIds } },
      select: { id: true, columnId: true, estimate: true },
    }),
    prisma.activityEvent.findMany({
      where: { cardId: { in: cardIds } },
      select: { id: true, cardId: true, type: true, data: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.column.findMany({ where: { boardId, isDone: true }, select: { id: true } }),
  ]);
  const burndownEvents: BurndownEvent[] = events.map((e) => ({
    id: e.id,
    cardId: e.cardId,
    type: e.type,
    data: e.data,
    createdAt: e.createdAt.toISOString(),
  }));
  return computeBurndown(sprint, burndownEvents, {
    sprintId: id,
    doneColumnIds: new Set(doneColumns.map((c) => c.id)),
    cards,
    today: toCalendarDate(now),
  });
}
