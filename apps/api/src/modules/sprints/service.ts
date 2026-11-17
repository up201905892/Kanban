import {
  ErrorCode,
  isDateRangeValid,
  sprintEventDataSchema,
  sumPoints,
  summarizeClose,
  type BoardEvent,
  type CloseSprintResponse,
  type CreateSprintRequest,
  type Sprint,
  type SprintEventData,
  type SprintListQuery,
  type SprintListResponse,
  type UpdateSprintRequest,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError, notFound } from '../../lib/app-error.js';
import {
  cardEvent,
  publishBoardEvents,
  sprintEvent,
  type MutationMeta,
} from '../../lib/board-events.js';
import { authorize } from '../authz/index.js';
import { lockBoard, type Tx } from '../boards/lock.js';
import { recordActivity } from '../cards/activity.js';
import { toCardSummary } from '../cards/service.js';
import { dateToString, stringToDate, toSprint } from './mapper.js';

const alreadyActive = (): AppError =>
  new AppError(
    409,
    ErrorCode.SPRINT_ALREADY_ACTIVE,
    'Another sprint is already active. Close it before starting this one.',
  );

const closedSprint = (): AppError =>
  new AppError(409, ErrorCode.SPRINT_CLOSED, 'A closed sprint cannot be changed');

/** The board of a project (1:1); every structural change of the project runs under its lock. */
async function boardOfProject(tx: Tx, projectId: string): Promise<string> {
  const board = await tx.board.findUnique({ where: { projectId }, select: { id: true } });
  if (!board || !(await lockBoard(tx, board.id))) throw notFound();
  return board.id;
}

async function recordSprintEvent(
  tx: Pick<Tx, 'sprintEvent'>,
  sprintId: string,
  actorId: string,
  event: SprintEventData,
): Promise<void> {
  const parsed = sprintEventDataSchema.parse(event);
  await tx.sprintEvent.create({
    data: { sprintId, actorId, type: parsed.type, data: parsed.data },
  });
}

/** `startDate|id`, the position after which the next page starts. */
const encodeCursor = (sprint: Sprint): string =>
  Buffer.from(`${sprint.startDate}|${sprint.id}`).toString('base64url');

function decodeCursor(cursor: string): { startDate: Date; id: string } {
  const [date, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const valid =
    date !== undefined &&
    id !== undefined &&
    isDateRangeValid(date, date) &&
    /^[0-9a-f-]{36}$/i.test(id);
  if (!valid) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'The cursor is not valid');
  return { startDate: stringToDate(date), id };
}

export async function listSprints(
  prisma: PrismaClient,
  user: { id: string },
  projectId: string,
  query: SprintListQuery,
): Promise<SprintListResponse> {
  await authorize(prisma, user, { type: 'project', id: projectId }, 'workspace:read');
  const after = query.cursor ? decodeCursor(query.cursor) : null;
  const rows = await prisma.sprint.findMany({
    where: {
      projectId,
      ...(query.status && { status: { in: query.status } }),
      ...(after && {
        OR: [
          { startDate: { gt: after.startDate } },
          { startDate: after.startDate, id: { gt: after.id } },
        ],
      }),
    },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    take: query.limit + 1,
  });
  const page = rows.slice(0, query.limit).map(toSprint);
  const last = page.at(-1);
  return {
    sprints: page,
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
  };
}

export async function createSprint(
  prisma: PrismaClient,
  user: { id: string },
  projectId: string,
  input: CreateSprintRequest,
  meta: MutationMeta = {},
): Promise<{ sprint: Sprint; created: boolean }> {
  await authorize(prisma, user, { type: 'project', id: projectId }, 'board:manage');
  const events: BoardEvent[] = [];
  const result = await prisma.$transaction(async (tx) => {
    const boardId = await boardOfProject(tx, projectId);
    if (input.id) {
      // A6: repeating a create returns the existing sprint; another project's id is a conflict.
      const existing = await tx.sprint.findUnique({ where: { id: input.id } });
      if (existing) {
        if (existing.projectId !== projectId) {
          throw new AppError(409, ErrorCode.CONFLICT, 'This id is already in use');
        }
        return { sprint: toSprint(existing), created: false };
      }
    }
    const row = await tx.sprint.create({
      data: {
        ...(input.id && { id: input.id }),
        projectId,
        name: input.name,
        goal: input.goal ?? '',
        startDate: stringToDate(input.startDate),
        endDate: stringToDate(input.endDate),
      },
    });
    const sprint = toSprint(row);
    events.push(sprintEvent(boardId, sprint, user.id, meta));
    return { sprint, created: true };
  });
  publishBoardEvents(events);
  return result;
}

export async function updateSprint(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
  input: UpdateSprintRequest,
  meta: MutationMeta = {},
): Promise<Sprint> {
  await authorize(prisma, user, { type: 'sprint', id }, 'board:manage');
  const events: BoardEvent[] = [];
  const result = await prisma.$transaction(async (tx) => {
    const first = await tx.sprint.findUnique({ where: { id }, select: { projectId: true } });
    if (!first) throw notFound();
    const boardId = await boardOfProject(tx, first.projectId);
    // Re-read under the lock: the sprint may have been started or closed while we waited.
    const sprint = await tx.sprint.findUnique({ where: { id } });
    if (!sprint) throw notFound();
    if (sprint.status === 'closed') throw closedSprint();

    const startDate = input.startDate ?? dateToString(sprint.startDate);
    const endDate = input.endDate ?? dateToString(sprint.endDate);
    if (!isDateRangeValid(startDate, endDate)) {
      throw new AppError(
        400,
        ErrorCode.VALIDATION_ERROR,
        'End date must be on or after the start date',
        [{ path: 'endDate', message: 'End date must be on or after the start date' }],
      );
    }
    const row = await tx.sprint.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.goal !== undefined && { goal: input.goal }),
        ...(input.startDate !== undefined && { startDate: stringToDate(input.startDate) }),
        ...(input.endDate !== undefined && { endDate: stringToDate(input.endDate) }),
      },
    });
    const updated = toSprint(row);
    events.push(sprintEvent(boardId, updated, user.id, meta));
    return updated;
  });
  publishBoardEvents(events);
  return result;
}

/** True for the unique violation of the one-active-sprint index (the database's own guarantee). */
const isActiveIndexViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; message?: unknown; meta?: unknown };
  return (
    e.code === 'P2002' ||
    (typeof e.message === 'string' && e.message.includes('sprints_one_active_per_project_idx'))
  );
};

/**
 * Starts a planned sprint: stores the points it commits to and a `sprint_started` snapshot of its
 * cards. Serialised with every other board change by the board lock, and backed by the partial
 * unique index, so two parallel starts can never both succeed.
 */
export async function startSprint(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
  meta: MutationMeta = {},
): Promise<Sprint> {
  await authorize(prisma, user, { type: 'sprint', id }, 'board:manage');
  const events: BoardEvent[] = [];
  try {
    const result = await prisma.$transaction(async (tx) => {
      const first = await tx.sprint.findUnique({ where: { id }, select: { projectId: true } });
      if (!first) throw notFound();
      const boardId = await boardOfProject(tx, first.projectId);
      const sprint = await tx.sprint.findUnique({ where: { id } });
      if (!sprint) throw notFound();
      if (sprint.status !== 'planned') {
        throw new AppError(
          409,
          ErrorCode.SPRINT_NOT_PLANNED,
          sprint.status === 'active'
            ? 'This sprint has already started'
            : 'A closed sprint cannot be started',
        );
      }
      const other = await tx.sprint.findFirst({
        where: { projectId: sprint.projectId, status: 'active' },
        select: { id: true },
      });
      if (other) throw alreadyActive();

      const cards = await tx.card.findMany({
        where: { sprintId: id, deletedAt: null },
        select: { id: true, columnId: true, estimate: true },
        orderBy: [{ number: 'asc' }],
      });
      const committedPoints = sumPoints(cards);
      const row = await tx.sprint.update({
        where: { id },
        data: { status: 'active', committedPoints },
      });
      await recordSprintEvent(tx, id, user.id, {
        type: 'sprint_started',
        data: {
          committedPoints,
          cards: cards.map((c) => ({ cardId: c.id, columnId: c.columnId, estimate: c.estimate })),
        },
      });
      const started = toSprint(row);
      events.push(sprintEvent(boardId, started, user.id, meta));
      return started;
    });
    publishBoardEvents(events);
    return result;
  } catch (error) {
    if (isActiveIndexViolation(error)) throw alreadyActive();
    throw error;
  }
}

/**
 * Closes the active sprint in one transaction under the board lock: cards in a Done column keep the
 * sprint, the others go back to the backlog (`sprintId = null`, `sprint_removed` with reason
 * `sprint_closed`), and the sprint stores `closedAt` and `completedPoints` (the velocity of KB-026
 * reads them). A `sprint_closed` row is added to `sprint_events`. The lock makes two parallel
 * closes serial: the second one finds a closed sprint and gets `409 SPRINT_NOT_ACTIVE`.
 */
export async function closeSprint(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
  meta: MutationMeta = {},
): Promise<CloseSprintResponse> {
  await authorize(prisma, user, { type: 'sprint', id }, 'board:manage');
  const events: BoardEvent[] = [];
  const result = await prisma.$transaction(async (tx) => {
    const first = await tx.sprint.findUnique({ where: { id }, select: { projectId: true } });
    if (!first) throw notFound();
    const boardId = await boardOfProject(tx, first.projectId);
    // Re-read under the lock: another close may have won while we waited.
    const sprint = await tx.sprint.findUnique({ where: { id } });
    if (!sprint) throw notFound();
    if (sprint.status !== 'active') {
      throw new AppError(409, ErrorCode.SPRINT_NOT_ACTIVE, 'Only an active sprint can be closed');
    }

    const [cards, doneColumns] = await Promise.all([
      tx.card.findMany({
        where: { sprintId: id, deletedAt: null },
        select: { id: true, columnId: true, estimate: true },
        orderBy: [{ number: 'asc' }],
      }),
      tx.column.findMany({ where: { boardId, isDone: true }, select: { id: true } }),
    ]);
    const summary = summarizeClose(cards, new Set(doneColumns.map((c) => c.id)));

    const returnedIds = summary.returned.map((c) => c.id);
    const returnedRows = [];
    for (const cardId of returnedIds) {
      returnedRows.push(
        await tx.card.update({
          where: { id: cardId },
          data: { sprintId: null, version: { increment: 1 } },
        }),
      );
      await recordActivity(tx, cardId, user.id, {
        type: 'sprint_removed',
        data: { sprintId: sprint.id, sprintName: sprint.name, reason: 'sprint_closed' },
      });
    }

    const row = await tx.sprint.update({
      where: { id },
      data: { status: 'closed', closedAt: new Date(), completedPoints: summary.completedPoints },
    });
    await recordSprintEvent(tx, id, user.id, {
      type: 'sprint_closed',
      data: {
        completedCards: summary.completedCards,
        completedPoints: summary.completedPoints,
        returnedCards: summary.returnedCards,
        returnedCardIds: returnedIds,
      },
    });
    for (const card of returnedRows) {
      events.push(cardEvent('card_updated', boardId, toCardSummary(card), user.id, meta));
    }
    events.push(sprintEvent(boardId, toSprint(row), user.id, meta));
    return {
      completedCards: summary.completedCards,
      completedPoints: summary.completedPoints,
      returnedCards: summary.returnedCards,
    };
  });
  publishBoardEvents(events);
  return result;
}
