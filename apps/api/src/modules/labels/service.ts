import {
  ErrorCode,
  diffLabelIds,
  type BoardEvent,
  type Card,
  type CreateLabelRequest,
  type Label,
  type LabelListResponse,
  type SetCardLabelsRequest,
  type UpdateLabelRequest,
} from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { AppError, notFound } from '../../lib/app-error.js';
import {
  cardEvent,
  labelDeletedEvent,
  labelEvent,
  publishBoardEvents,
  type MutationMeta,
} from '../../lib/board-events.js';
import { authorize } from '../authz/index.js';
import { lockBoard, type Tx } from '../boards/lock.js';
import { recordActivity } from '../cards/activity.js';
import { toCard, toCardSummary, withLabels } from '../cards/service.js';
import { toLabel } from './mapper.js';

const nameTaken = (): AppError =>
  new AppError(409, ErrorCode.LABEL_NAME_TAKEN, 'A label with this name already exists');

/** The board of a project (1:1); every label change runs under its lock, like card writes. */
async function boardOfProject(tx: Tx, projectId: string): Promise<string> {
  const board = await tx.board.findUnique({ where: { projectId }, select: { id: true } });
  if (!board || !(await lockBoard(tx, board.id))) throw notFound();
  return board.id;
}

/** Is another label of the project already called `name` (case-insensitively)? */
async function nameInUse(
  tx: Tx,
  projectId: string,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const found = await tx.label.findFirst({
    where: {
      projectId,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId && { id: { not: exceptId } }),
    },
    select: { id: true },
  });
  return found !== null;
}

export async function listLabels(
  prisma: PrismaClient,
  user: { id: string },
  projectId: string,
): Promise<LabelListResponse> {
  await authorize(prisma, user, { type: 'project', id: projectId }, 'workspace:read');
  const rows = await prisma.label.findMany({
    where: { projectId },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return { labels: rows.map(toLabel) };
}

export async function createLabel(
  prisma: PrismaClient,
  user: { id: string },
  projectId: string,
  input: CreateLabelRequest,
  meta: MutationMeta = {},
): Promise<{ label: Label; created: boolean }> {
  await authorize(prisma, user, { type: 'project', id: projectId }, 'project:manage');
  const events: BoardEvent[] = [];
  const result = await prisma.$transaction(async (tx) => {
    const boardId = await boardOfProject(tx, projectId);
    if (input.id) {
      // A6: repeating a create returns the existing label; another project's id is a conflict.
      const existing = await tx.label.findUnique({ where: { id: input.id } });
      if (existing) {
        if (existing.projectId !== projectId) {
          throw new AppError(409, ErrorCode.CONFLICT, 'This id is already in use');
        }
        return { label: toLabel(existing), created: false };
      }
    }
    if (await nameInUse(tx, projectId, input.name)) throw nameTaken();
    const row = await tx.label.create({
      data: {
        ...(input.id && { id: input.id }),
        projectId,
        name: input.name,
        color: input.color,
      },
    });
    const label = toLabel(row);
    events.push(labelEvent('label_created', boardId, label, user.id, meta));
    return { label, created: true };
  });
  publishBoardEvents(events);
  return result;
}

export async function updateLabel(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
  input: UpdateLabelRequest,
  meta: MutationMeta = {},
): Promise<Label> {
  await authorize(prisma, user, { type: 'label', id }, 'project:manage');
  const events: BoardEvent[] = [];
  const result = await prisma.$transaction(async (tx) => {
    const first = await tx.label.findUnique({ where: { id }, select: { projectId: true } });
    if (!first) throw notFound();
    const boardId = await boardOfProject(tx, first.projectId);
    // Re-read under the lock: the label may have been deleted while we waited.
    const label = await tx.label.findUnique({ where: { id } });
    if (!label) throw notFound();

    const nameChanged = input.name !== undefined && input.name !== label.name;
    const colorChanged = input.color !== undefined && input.color !== label.color;
    if (!nameChanged && !colorChanged) return toLabel(label);
    if (nameChanged && (await nameInUse(tx, label.projectId, input.name as string, id))) {
      throw nameTaken();
    }
    const row = await tx.label.update({
      where: { id },
      data: {
        ...(nameChanged && { name: input.name as string }),
        ...(colorChanged && { color: input.color as string }),
      },
    });
    const updated = toLabel(row);
    events.push(labelEvent('label_updated', boardId, updated, user.id, meta));
    return updated;
  });
  publishBoardEvents(events);
  return result;
}

/**
 * Deleting a label removes it from every card (cascade). Each live card that carried it gets a new
 * version, a `labels_changed` activity event and a `card_updated` event (G5, R6).
 */
export async function deleteLabel(
  prisma: PrismaClient,
  user: { id: string },
  id: string,
  meta: MutationMeta = {},
): Promise<void> {
  await authorize(prisma, user, { type: 'label', id }, 'project:manage');
  const events: BoardEvent[] = [];
  await prisma.$transaction(async (tx) => {
    const first = await tx.label.findUnique({ where: { id }, select: { projectId: true } });
    if (!first) throw notFound();
    const boardId = await boardOfProject(tx, first.projectId);
    const label = await tx.label.findUnique({ where: { id } });
    if (!label) throw notFound();

    const cards = await tx.card.findMany({
      where: { deletedAt: null, labels: { some: { labelId: id } } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    for (const card of cards) {
      await tx.card.update({ where: { id: card.id }, data: { version: { increment: 1 } } });
      await recordActivity(tx, card.id, user.id, {
        type: 'labels_changed',
        data: { added: [], removed: [{ id: label.id, name: label.name }] },
      });
    }
    await tx.label.delete({ where: { id } });
    if (cards.length > 0) {
      const rows = await tx.card.findMany({
        where: { id: { in: cards.map((c) => c.id) } },
        orderBy: { id: 'asc' },
        include: withLabels,
      });
      for (const row of rows) {
        events.push(cardEvent('card_updated', boardId, toCardSummary(row), user.id, meta));
      }
    }
    events.push(labelDeletedEvent(boardId, label, user.id, meta));
  });
  publishBoardEvents(events);
}

/**
 * Replaces the labels of a card with `labelIds` (idempotent: the same set again changes nothing,
 * writes no activity and publishes no event). A label that is not of the card's project, or does
 * not exist, is `400 INVALID_LABEL` and never linked (A4).
 */
export async function setCardLabels(
  prisma: PrismaClient,
  user: { id: string },
  cardId: string,
  input: SetCardLabelsRequest,
  meta: MutationMeta = {},
): Promise<Card> {
  await authorize(prisma, user, { type: 'card', id: cardId }, 'card:edit');
  const events: BoardEvent[] = [];
  const result = await prisma.$transaction(async (tx) => {
    const first = await tx.card.findFirst({
      where: { id: cardId, deletedAt: null },
      select: { boardId: true },
    });
    if (!first || !(await lockBoard(tx, first.boardId))) throw notFound();
    const card = await tx.card.findFirst({
      where: { id: cardId, deletedAt: null },
      include: withLabels,
    });
    if (!card) throw notFound();

    const board = await tx.board.findUniqueOrThrow({
      where: { id: card.boardId },
      select: { projectId: true },
    });
    const current = card.labels.map((l) => l.labelId);
    const { added, removed } = diffLabelIds(current, input.labelIds);

    const known = await tx.label.findMany({
      where: { id: { in: [...input.labelIds, ...removed] } },
      select: { id: true, projectId: true, name: true },
    });
    const byId = new Map(known.map((l) => [l.id, l]));
    for (const labelId of input.labelIds) {
      if (byId.get(labelId)?.projectId !== board.projectId) {
        throw new AppError(
          400,
          ErrorCode.INVALID_LABEL,
          'Labels must belong to the same project as the card',
        );
      }
    }
    if (added.length === 0 && removed.length === 0) return toCard(card);

    if (removed.length > 0) {
      await tx.cardLabel.deleteMany({ where: { cardId, labelId: { in: removed } } });
    }
    if (added.length > 0) {
      await tx.cardLabel.createMany({
        data: added.map((labelId) => ({ cardId, labelId })),
      });
    }
    const row = await tx.card.update({
      where: { id: cardId },
      data: { version: { increment: 1 } },
      include: withLabels,
    });
    const ref = (labelId: string) => ({ id: labelId, name: byId.get(labelId)?.name ?? '' });
    await recordActivity(tx, cardId, user.id, {
      type: 'labels_changed',
      data: { added: added.map(ref), removed: removed.map(ref) },
    });
    events.push(cardEvent('card_updated', row.boardId, toCardSummary(row), user.id, meta));
    return toCard(row);
  });
  publishBoardEvents(events);
  return result;
}
