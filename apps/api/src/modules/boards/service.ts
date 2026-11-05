import {
  ErrorCode,
  keysBetween,
  needsRebalance,
  type BoardResponse,
  type Column,
  type CreateColumnRequest,
  type UpdateColumnRequest,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError, notFound } from '../../lib/app-error.js';
import { authorize } from '../authz/index.js';
import { recordActivity } from '../cards/activity.js';
import { toCardSummary } from '../cards/service.js';
import { lockBoard, type Tx } from './lock.js';
import { placeWithRebalance } from './position.js';

interface ColumnRow {
  id: string;
  boardId: string;
  name: string;
  position: string;
  isDone: boolean;
}

const toColumn = (row: ColumnRow): Column => ({
  id: row.id,
  boardId: row.boardId,
  name: row.name,
  position: row.position,
  isDone: row.isDone,
});

const doneRequired = (): AppError =>
  new AppError(
    409,
    ErrorCode.DONE_COLUMN_REQUIRED,
    'A board needs a Done column. Mark another column as Done first.',
  );

/** Columns of a board in the deterministic order (position under the "C" collation, then id). */
const orderedColumns = (tx: Pick<Tx, 'column'>, boardId: string) =>
  tx.column.findMany({ where: { boardId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });

/**
 * Neighbour IDs must belong to the same board (A4). An ID that exists on another board is rejected
 * as not found and never linked; an ID that no longer exists is treated as stale (ADR 0001 s.3).
 */
async function assertNeighboursUsable(
  tx: Tx,
  boardId: string,
  ids: (string | null | undefined)[],
): Promise<void> {
  const wanted = ids.filter((id): id is string => typeof id === 'string');
  if (wanted.length === 0) return;
  const elsewhere = await tx.column.count({
    where: { id: { in: wanted }, boardId: { not: boardId } },
  });
  if (elsewhere > 0) throw notFound();
}

export async function getBoard(
  prisma: PrismaClient,
  user: { id: string },
  projectId: string,
): Promise<BoardResponse> {
  await authorize(prisma, user, { type: 'project', id: projectId }, 'workspace:read');
  const board = await prisma.board.findUnique({
    where: { projectId },
    include: {
      columns: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
      // Soft-deleted cards never leave the database layer.
      cards: {
        where: { deletedAt: null },
        orderBy: [{ columnId: 'asc' }, { position: 'asc' }, { id: 'asc' }],
      },
    },
  });
  if (!board) throw notFound();
  return {
    board: { id: board.id, projectId: board.projectId },
    columns: board.columns.map(toColumn),
    cards: board.cards.map(toCardSummary),
  };
}

export async function createColumn(
  prisma: PrismaClient,
  user: { id: string },
  boardId: string,
  input: CreateColumnRequest,
): Promise<{ column: Column; created: boolean }> {
  await authorize(prisma, user, { type: 'board', id: boardId }, 'board:manage');
  return prisma.$transaction(async (tx) => {
    if (!(await lockBoard(tx, boardId))) throw notFound();
    if (input.id) {
      // A6: repeating a create returns the existing column; another board's id is a conflict.
      const existing = await tx.column.findUnique({ where: { id: input.id } });
      if (existing) {
        if (existing.boardId !== boardId) {
          throw new AppError(409, ErrorCode.CONFLICT, 'This id is already in use');
        }
        return { column: toColumn(existing), created: false };
      }
    }
    await assertNeighboursUsable(tx, boardId, [input.afterColumnId, input.beforeColumnId]);
    const siblings = await orderedColumns(tx, boardId);
    const position = await placeWithRebalance(
      siblings,
      input.afterColumnId,
      input.beforeColumnId,
      async (updates) => {
        for (const u of updates) {
          await tx.column.update({ where: { id: u.id }, data: { position: u.position } });
        }
      },
    );
    const row = await tx.column.create({
      data: { ...(input.id && { id: input.id }), boardId, name: input.name, position },
    });
    return { column: toColumn(row), created: true };
  });
}

export async function updateColumn(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
  input: UpdateColumnRequest,
): Promise<Column> {
  await authorize(prisma, user, { type: 'column', id }, 'board:manage');
  return prisma.$transaction(async (tx) => {
    const first = await tx.column.findUnique({ where: { id }, select: { boardId: true } });
    if (!first || !(await lockBoard(tx, first.boardId))) throw notFound();
    // Re-read under the lock: the column may have been deleted while we waited.
    const column = await tx.column.findUnique({ where: { id } });
    if (!column) throw notFound();

    const data: { name?: string; position?: string; isDone?: boolean } = {};
    if (input.name !== undefined) data.name = input.name;

    if (input.isDone === false && column.isDone) throw doneRequired();
    if (input.isDone === true && !column.isDone) {
      // Clear the old Done column first so the partial unique index never sees two.
      await tx.column.updateMany({
        where: { boardId: column.boardId, isDone: true, id: { not: id } },
        data: { isDone: false },
      });
      data.isDone = true;
    }

    if (input.afterColumnId !== undefined || input.beforeColumnId !== undefined) {
      await assertNeighboursUsable(tx, column.boardId, [input.afterColumnId, input.beforeColumnId]);
      const siblings = (await orderedColumns(tx, column.boardId)).filter((c) => c.id !== id);
      data.position = await placeWithRebalance(
        siblings,
        input.afterColumnId === id ? null : input.afterColumnId,
        input.beforeColumnId === id ? null : input.beforeColumnId,
        async (updates) => {
          for (const u of updates) {
            await tx.column.update({ where: { id: u.id }, data: { position: u.position } });
          }
        },
      );
    }

    return toColumn(await tx.column.update({ where: { id }, data }));
  });
}

export async function deleteColumn(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
  moveCardsTo?: string,
): Promise<void> {
  await authorize(prisma, user, { type: 'column', id }, 'board:manage');
  await prisma.$transaction(async (tx) => {
    const first = await tx.column.findUnique({ where: { id }, select: { boardId: true } });
    if (!first || !(await lockBoard(tx, first.boardId))) throw notFound();
    const column = await tx.column.findUnique({ where: { id } });
    if (!column) throw notFound();
    if (column.isDone) throw doneRequired();

    // The destination must be another column of the same board; one on another board is never linked.
    let target: { id: string; name: string } | null = null;
    if (moveCardsTo !== undefined) {
      if (moveCardsTo === id) {
        throw new AppError(
          400,
          ErrorCode.VALIDATION_ERROR,
          'Cards cannot be moved to the column being deleted',
        );
      }
      const found = await tx.column.findUnique({ where: { id: moveCardsTo } });
      if (!found || found.boardId !== column.boardId) throw notFound();
      target = found;
    }

    const cards = await tx.card.findMany({
      where: { columnId: id, deletedAt: null },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    if (cards.length > 0) {
      if (!target) {
        throw new AppError(
          409,
          ErrorCode.COLUMN_NOT_EMPTY,
          `This column still has ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}. Choose a column to move them to.`,
        );
      }
      await moveCardsToEnd(tx, user.id, cards, column, target);
    }
    // Cards soft-deleted earlier in this column go with it (cascade); live cards were moved above.
    await tx.column.delete({ where: { id } });
  });
}

/** Appends `cards` (already ordered) to the end of `target`, one transaction with their events. */
async function moveCardsToEnd(
  tx: Tx,
  actorId: string,
  cards: { id: string }[],
  from: { id: string; name: string },
  target: { id: string; name: string },
): Promise<void> {
  const existing = await tx.card.findMany({
    where: { columnId: target.id, deletedAt: null },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { id: true, position: true },
  });
  const last = existing.at(-1)?.position ?? null;
  let keys = keysBetween(last, null, cards.length);
  if (needsRebalance(keys.at(-1) ?? '')) {
    // Respace the destination as a whole (ADR 0001 section 4), then append after it.
    const respaced = keysBetween(null, null, existing.length + cards.length);
    for (const [index, card] of existing.entries()) {
      await tx.card.update({
        where: { id: card.id },
        data: { position: respaced[index] as string },
      });
    }
    keys = respaced.slice(existing.length);
  }
  for (const [index, card] of cards.entries()) {
    await tx.card.update({
      where: { id: card.id },
      data: { columnId: target.id, position: keys[index] as string, version: { increment: 1 } },
    });
    await recordActivity(tx, card.id, actorId, {
      type: 'column_deleted_moved',
      data: {
        from: { columnId: from.id, columnName: from.name },
        to: { columnId: target.id, columnName: target.name },
      },
    });
  }
}
