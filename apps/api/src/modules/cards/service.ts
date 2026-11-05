import {
  ErrorCode,
  type Card,
  type CardSummary,
  type CreateCardRequest,
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
}): CardSummary => ({
  id: row.id,
  columnId: row.columnId,
  number: row.number,
  title: row.title,
  position: row.position,
  version: row.version,
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
    // Nothing changed: no new version and no event.
    if (!titleChanged && !descriptionChanged) return toCard(card);

    const row = await tx.card.update({
      where: { id },
      data: {
        ...(titleChanged && { title: input.title as string }),
        ...(descriptionChanged && { description: input.description as string }),
        version: { increment: 1 },
      },
    });
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
