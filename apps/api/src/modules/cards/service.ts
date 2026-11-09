import {
  ErrorCode,
  type Card,
  type CardPriority,
  type CardSummary,
  type CreateCardRequest,
  type MoveCardRequest,
  type UpdateCardRequest,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError, notFound } from '../../lib/app-error.js';
import { authorize } from '../authz/index.js';
import { lockBoard, type Tx } from '../boards/lock.js';
import { placeWithRebalance } from '../boards/position.js';
import { recordActivity } from './activity.js';

interface CardRow {
  id: string;
  boardId: string;
  columnId: string;
  number: number;
  title: string;
  description: string;
  position: string;
  version: number;
  assigneeId: string | null;
  priority: CardPriority;
  estimate: number | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export const toCardSummary = (row: {
  id: string;
  columnId: string;
  number: number;
  title: string;
  position: string;
  version: number;
  assigneeId: string | null;
  priority: CardPriority;
  estimate: number | null;
}): CardSummary => ({
  id: row.id,
  columnId: row.columnId,
  number: row.number,
  title: row.title,
  position: row.position,
  version: row.version,
  assigneeId: row.assigneeId,
  priority: row.priority,
  estimate: row.estimate,
});

export const toCard = (row: CardRow): Card => ({
  ...toCardSummary(row),
  boardId: row.boardId,
  description: row.description,
  createdById: row.createdById,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Live cards of a column in the deterministic order (position under the "C" collation, then id). */
export const liveCardsOf = (tx: Pick<Tx, 'card'>, columnId: string) =>
  tx.card.findMany({
    where: { columnId, deletedAt: null },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });

export async function getCard(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
): Promise<Card> {
  await authorize(prisma, user, { type: 'card', id }, 'workspace:read');
  const row = await prisma.card.findFirst({ where: { id, deletedAt: null } });
  if (!row) throw notFound();
  return toCard(row);
}

export async function createCard(
  prisma: PrismaClient,
  user: { id: string },
  columnId: string,
  input: CreateCardRequest,
): Promise<{ card: Card; created: boolean }> {
  await authorize(prisma, user, { type: 'column', id: columnId }, 'card:edit');
  return prisma.$transaction(async (tx) => {
    const first = await tx.column.findUnique({
      where: { id: columnId },
      select: { boardId: true },
    });
    if (!first || !(await lockBoard(tx, first.boardId))) throw notFound();
    // Re-read under the lock: the column may have been deleted while we waited.
    const column = await tx.column.findUnique({ where: { id: columnId } });
    if (!column) throw notFound();
    const { boardId } = column;

    if (input.id) {
      // A6: repeating a create returns the existing card and never makes a duplicate.
      const existing = await tx.card.findUnique({ where: { id: input.id } });
      if (existing) {
        if (existing.boardId !== boardId || existing.deletedAt) {
          throw new AppError(409, ErrorCode.CONFLICT, 'This id is already in use');
        }
        return { card: toCard(existing), created: false };
      }
    }

    // Neighbours must be live cards of this very column (A4); a vanished one is simply stale.
    const wanted = [input.afterCardId, input.beforeCardId].filter(
      (id): id is string => typeof id === 'string',
    );
    if (wanted.length > 0) {
      const elsewhere = await tx.card.count({
        where: { id: { in: wanted }, deletedAt: null, columnId: { not: columnId } },
      });
      if (elsewhere > 0) throw notFound();
    }

    const siblings = await liveCardsOf(tx, columnId);
    const position = await placeWithRebalance(
      siblings,
      input.afterCardId,
      input.beforeCardId,
      async (updates) => {
        for (const u of updates) {
          await tx.card.update({ where: { id: u.id }, data: { position: u.position } });
        }
      },
    );

    // Atomic increment: the row lock of UPDATE hands out each number exactly once.
    const board = await tx.board.findUniqueOrThrow({
      where: { id: boardId },
      select: { projectId: true },
    });
    const project = await tx.project.update({
      where: { id: board.projectId },
      data: { nextCardNumber: { increment: 1 } },
      select: { nextCardNumber: true },
    });

    const row = await tx.card.create({
      data: {
        ...(input.id && { id: input.id }),
        boardId,
        columnId,
        number: project.nextCardNumber - 1,
        title: input.title,
        description: input.description ?? '',
        position,
        createdById: user.id,
      },
    });
    await recordActivity(tx, row.id, user.id, {
      type: 'created',
      data: { title: row.title, column: { columnId, columnName: column.name } },
    });
    return { card: toCard(row), created: true };
  });
}

export async function updateCard(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
  input: UpdateCardRequest,
): Promise<Card> {
  await authorize(prisma, user, { type: 'card', id }, 'card:edit');
  return prisma.$transaction(async (tx) => {
    const first = await tx.card.findFirst({
      where: { id, deletedAt: null },
      select: { boardId: true },
    });
    if (!first || !(await lockBoard(tx, first.boardId))) throw notFound();
    const card = await tx.card.findFirst({ where: { id, deletedAt: null } });
    if (!card) throw notFound();

    const titleChanged = input.title !== undefined && input.title !== card.title;
    const descriptionChanged =
      input.description !== undefined && input.description !== card.description;
    const assigneeChanged = input.assigneeId !== undefined && input.assigneeId !== card.assigneeId;
    const priorityChanged = input.priority !== undefined && input.priority !== card.priority;
    const estimateChanged = input.estimate !== undefined && input.estimate !== card.estimate;
    // Nothing changed: no new version and no event.
    if (
      !titleChanged &&
      !descriptionChanged &&
      !assigneeChanged &&
      !priorityChanged &&
      !estimateChanged
    ) {
      return toCard(card);
    }

    if (assigneeChanged && input.assigneeId) {
      // A4: only an owner or member of this card's workspace can be assigned (viewers cannot).
      const board = await tx.board.findUniqueOrThrow({
        where: { id: card.boardId },
        select: { project: { select: { workspaceId: true } } },
      });
      const membership = await tx.membership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: board.project.workspaceId,
            userId: input.assigneeId,
          },
        },
        select: { role: true },
      });
      if (!membership || membership.role === 'viewer') {
        throw new AppError(
          400,
          ErrorCode.INVALID_ASSIGNEE,
          'The assignee must be an owner or member of this workspace',
        );
      }
    }

    const row = await tx.card.update({
      where: { id },
      data: {
        ...(titleChanged && { title: input.title as string }),
        ...(descriptionChanged && { description: input.description as string }),
        ...(assigneeChanged && { assigneeId: input.assigneeId as string | null }),
        ...(priorityChanged && { priority: input.priority as CardPriority }),
        ...(estimateChanged && { estimate: input.estimate as number | null }),
        version: { increment: 1 },
      },
    });
    if (assigneeChanged) {
      await recordActivity(tx, id, user.id, {
        type: 'assignee_changed',
        data: { from: card.assigneeId, to: row.assigneeId },
      });
    }
    if (priorityChanged) {
      await recordActivity(tx, id, user.id, {
        type: 'priority_changed',
        data: { from: card.priority, to: row.priority },
      });
    }
    if (estimateChanged) {
      await recordActivity(tx, id, user.id, {
        type: 'estimate_changed',
        data: { from: card.estimate, to: row.estimate },
      });
    }
    if (titleChanged) {
      await recordActivity(tx, id, user.id, {
        type: 'title_changed',
        data: { from: card.title, to: row.title },
      });
    }
    if (descriptionChanged) {
      await recordActivity(tx, id, user.id, {
        type: 'description_changed',
        data: { from: card.description.length, to: row.description.length },
      });
    }
    return toCard(row);
  });
}

export async function deleteCard(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
): Promise<void> {
  await authorize(prisma, user, { type: 'card', id }, 'card:edit');
  await prisma.$transaction(async (tx) => {
    const first = await tx.card.findFirst({
      where: { id, deletedAt: null },
      select: { boardId: true },
    });
    if (!first || !(await lockBoard(tx, first.boardId))) throw notFound();
    const card = await tx.card.findFirst({ where: { id, deletedAt: null } });
    if (!card) throw notFound();
    await tx.card.update({
      where: { id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    await recordActivity(tx, id, user.id, { type: 'deleted', data: { title: card.title } });
  });
}

/**
 * Moves a card inside its column or to another column of the same board (KB-015). Under the board
 * lock the server reads the current neighbours and computes the final key (ADR 0001 section 3), so
 * parallel moves into one gap both land exactly once, in the deterministic `(position, id)` order.
 * A neighbour that vanished or moved elsewhere is stale and handled by the documented fallback.
 */
export async function moveCard(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
  input: MoveCardRequest,
): Promise<Card> {
  await authorize(prisma, user, { type: 'card', id }, 'card:edit');
  // The destination is authorized too: a column of a workspace the caller cannot see is a plain 404.
  await authorize(prisma, user, { type: 'column', id: input.columnId }, 'card:edit');
  return prisma.$transaction(async (tx) => {
    const first = await tx.card.findFirst({
      where: { id, deletedAt: null },
      select: { boardId: true },
    });
    if (!first || !(await lockBoard(tx, first.boardId))) throw notFound();
    // Re-read under the lock: the card or the column may have been deleted while we waited.
    const card = await tx.card.findFirst({ where: { id, deletedAt: null } });
    if (!card) throw notFound();
    const column = await tx.column.findUnique({ where: { id: input.columnId } });
    if (!column || column.boardId !== card.boardId) throw notFound();

    // A neighbour on another board is never linked; one that merely moved is stale.
    const wanted = [input.afterCardId, input.beforeCardId].filter(
      (n): n is string => typeof n === 'string',
    );
    if (wanted.length > 0) {
      const foreign = await tx.card.count({
        where: { id: { in: wanted }, deletedAt: null, boardId: { not: card.boardId } },
      });
      if (foreign > 0) throw notFound();
    }

    const siblings = (await liveCardsOf(tx, column.id)).filter((s) => s.id !== id);
    const position = await placeWithRebalance(
      siblings,
      input.afterCardId,
      input.beforeCardId,
      async (updates) => {
        for (const u of updates) {
          await tx.card.update({
            where: { id: u.id },
            data: { position: u.position, version: { increment: 1 } },
          });
        }
      },
    );

    const row = await tx.card.update({
      where: { id },
      data: { columnId: column.id, position, version: { increment: 1 } },
    });
    if (card.columnId !== column.id) {
      await recordActivity(tx, id, user.id, {
        type: 'moved',
        data: { fromColumnId: card.columnId, toColumnId: column.id },
      });
    }
    return toCard(row);
  });
}
